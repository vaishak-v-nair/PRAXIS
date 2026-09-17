// `praxis eval` — Offline Agent Benchmark & Evaluation Harness
//
// Zero cloud dependencies. Scores agent runs against local git assertions,
// file precision constraints, and cryptographic receipts.

import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from '../lib/paths.js';
import {
  evalsDir,
  validateEvalSuite,
  scoreEvalCase,
  aggregateEvalMetrics,
  listEvalSuites,
} from '../lib/eval/harness.js';
import { startJob } from './run.js';
import { readMeta, jobStatus } from '../lib/jobs/store.js';
import { loadReceipt } from '../lib/receipt/render.js';
import { bold, grey, sage, rose, amber, dim } from '../lib/ui.js';
import { praxisCmd } from '../lib/runner.js';
import { wantsJson, emitJson } from '../lib/jsonout.js';

export async function evalCmd(argv = []) {
  const p = projectPaths();
  const c = praxisCmd();
  const json = wantsJson(argv);
  const suiteArg = argv.find((a) => !a.startsWith('--'));

  if (!suiteArg) {
    const suites = listEvalSuites(p.praxisDir);
    if (json) {
      emitJson({ ok: true, suites });
      return;
    }

    console.log('\n  ' + bold('PRAXIS EVAL') + grey(' — Offline agent benchmark & evaluation harness\n'));
    if (suites.length) {
      console.log('  ' + bold('AVAILABLE BENCHMARK SUITES') + grey(' (.praxis/evals/)'));
      for (const s of suites) {
        console.log('    ' + sage('▸') + ' ' + bold(s.file.replace(/\.json$/, '')) + ` (${s.casesCount} cases)  ` + grey(s.description));
      }
    } else {
      console.log('  ' + grey('No benchmark suites found in .praxis/evals/.'));
      console.log('  ' + grey('Create one to evaluate agent fidelity on your codebase:'));
      console.log('    ' + dim(`{"name": "core-bench", "cases": [{"id": "test1", "task": "..."}]}`));
    }
    console.log('\n  ' + dim(`run a suite: ${c} eval <suite-name> [--tool codex]`) + '\n');
    return;
  }

  let suitePath = path.isAbsolute(suiteArg) ? suiteArg : path.join(evalsDir(p.praxisDir), suiteArg);
  if (!fs.existsSync(suitePath) && !suitePath.endsWith('.json')) {
    suitePath += '.json';
  }

  if (!fs.existsSync(suitePath)) {
    console.log('\n  ' + rose('Evaluation suite not found: ') + suiteArg + '\n');
    process.exitCode = 1;
    return;
  }

  let suite;
  try {
    suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
  } catch (e) {
    console.log('\n  ' + rose('Invalid JSON in eval suite: ') + e.message + '\n');
    process.exitCode = 1;
    return;
  }

  const v = validateEvalSuite(suite);
  if (!v.ok) {
    console.log('\n  ' + rose('Invalid eval suite: ') + v.error + '\n');
    process.exitCode = 1;
    return;
  }

  const tool = argv.includes('--codex') ? 'codex' : 'claude';
  const mode = argv.includes('--allow-edits') ? 'acceptEdits' : 'plan';

  console.log('\n  ' + bold('RUNNING BENCHMARK SUITE') + grey(`  · ${suite.name} (${suite.cases.length} cases)`));
  console.log('  ' + grey(`agent: ${tool}  · mode: ${mode}  · local-first offline harness\n`));

  const results = [];
  for (const testCase of suite.cases) {
    const started = Date.now();
    const res = await startJob({
      task: testCase.task,
      tool,
      mode,
      goal: `Benchmark [${suite.name}]: ${testCase.id}`,
    });

    const durationMs = Date.now() - started;

    if (res.error) {
      results.push({
        id: testCase.id,
        pass: false,
        assertionPass: false,
        claimFidelity: 0,
        filePrecision: 0,
        forbiddenViolations: 0,
        durationMs,
        receiptVerdict: 'SPAWN_ERROR',
        error: res.error,
      });
      continue;
    }

    // Read job meta and receipt if already sealed or synchronous
    const jobMeta = readMeta(p.praxisDir, res.id);
    const receipt = jobMeta && jobMeta.receiptId ? loadReceipt(path.join(p.praxisDir, 'receipts'), jobMeta.receiptId) : null;

    const scored = scoreEvalCase({
      testCase,
      exitCode: jobMeta ? jobMeta.exitCode : 0,
      touchedFiles: (receipt && receipt.evidence && receipt.evidence.filesTouched) || [],
      receipt,
      durationMs,
    });
    scored.jobId = res.id;
    results.push(scored);

    const badge = scored.pass ? sage('✓ PASS') : rose('✗ FAIL');
    console.log(`  ${badge}  ${bold(testCase.id)}  ${grey('fidelity: ' + Math.round(scored.claimFidelity * 100) + '%')}  ${grey('job: ' + res.id)}`);
  }

  const metrics = aggregateEvalMetrics(results);

  if (json) {
    emitJson({ ok: true, suite: suite.name, metrics, results });
    return;
  }

  console.log('\n  ' + bold('BENCHMARK REPORT: ' + suite.name));
  console.log('  ' + (metrics.passRate >= 80 ? sage(`Pass Rate: ${metrics.passRate}% (${metrics.passed}/${metrics.total})`) : rose(`Pass Rate: ${metrics.passRate}% (${metrics.passed}/${metrics.total})`)));
  console.log('  ' + grey(`Avg Claim Fidelity : ${Math.round(metrics.avgClaimFidelity * 100)}%`));
  console.log('  ' + grey(`Avg File Precision : ${Math.round(metrics.avgFilePrecision * 100)}%`));
  console.log('  ' + grey(`Avg Duration       : ${metrics.avgDurationMs}ms\n`));
}
