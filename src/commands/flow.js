// `praxis flow` — Native Multi-Agent DAG Orchestration
//
// Zero external dependencies. Orchestrates multi-step workflows where steps
// depend on parent steps, execute across Claude Code and OpenAI Codex in
// parallel tiers, and seal verifiable receipts at every milestone.

import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from '../lib/paths.js';
import {
  validateDag,
  topologicalSort,
  createWorkflowRun,
  readWorkflowRun,
  updateWorkflowRun,
  workflowsDir,
  workflowRunsDir,
  interpolateStepTask,
} from '../lib/jobs/dag.js';
import { startJob } from './run.js';
import { readMeta, jobStatus } from '../lib/jobs/store.js';
import { bold, grey, sage, rose, amber, dim, timeAgo } from '../lib/ui.js';
import { praxisCmd } from '../lib/runner.js';
import { wantsJson, emitJson } from '../lib/jsonout.js';

function badge(status) {
  if (status === 'running') return amber('● running');
  if (status === 'done') return sage('✓ done   ');
  if (status === 'failed') return rose('✗ failed ');
  if (status === 'pending') return grey('○ pending');
  return grey('? ' + status);
}

/** List available workflow definitions in .praxis/flows/ */
export function listFlowSpecs(praxisDir) {
  const dir = workflowsDir(praxisDir);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .map((f) => {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return { file: f, name: content.name || f.replace(/\.json$/, ''), description: content.description || '' };
        } catch {
          return { file: f, name: f.replace(/\.json$/, ''), description: '(invalid json)' };
        }
      });
  } catch {
    return [];
  }
}

/** List recent workflow runs in .praxis/flows/runs/ */
export function listWorkflowRuns(praxisDir) {
  const dir = workflowRunsDir(praxisDir);
  try {
    return fs
      .readdirSync(dir)
      .filter((d) => d.startsWith('wf-'))
      .sort()
      .reverse()
      .map((id) => readWorkflowRun(praxisDir, id))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Advance workflow run: check running jobs and trigger next tier if ready */
export async function advanceWorkflowRun(praxisDir, id) {
  const run = readWorkflowRun(praxisDir, id);
  if (!run || run.status !== 'running') return run;

  const currentTierIndex = run.currentTier;
  const currentTierStepIds = run.tiers[currentTierIndex] || [];
  let allTierDone = true;
  let anyFailed = false;

  const stepOutputs = {};

  for (const stepId of Object.keys(run.steps)) {
    const step = run.steps[stepId];
    if (step.jobId) {
      const job = readMeta(praxisDir, step.jobId);
      if (job) {
        const s = jobStatus(job);
        if (s === 'done' || s === 'draft') {
          step.status = 'done';
          step.receiptId = job.receiptId || null;
          step.resultTail = job.resultTail || null;
          stepOutputs[stepId] = job.resultTail || '';
        } else if (s === 'failed' || s === 'gone') {
          step.status = 'failed';
          anyFailed = true;
        }
      }
    }
  }

  for (const stepId of currentTierStepIds) {
    if (run.steps[stepId].status !== 'done') {
      allTierDone = false;
      break;
    }
  }

  if (anyFailed) {
    run.status = 'failed';
    updateWorkflowRun(praxisDir, id, { status: 'failed', steps: run.steps });
    return run;
  }

  if (allTierDone) {
    const nextTierIndex = currentTierIndex + 1;
    if (nextTierIndex >= run.tiers.length) {
      run.status = 'done';
      run.endedAt = new Date().toISOString();
      updateWorkflowRun(praxisDir, id, { status: 'done', endedAt: run.endedAt, steps: run.steps });
      return run;
    }

    // Launch next tier
    run.currentTier = nextTierIndex;
    const nextStepIds = run.tiers[nextTierIndex];
    for (const stepId of nextStepIds) {
      const step = run.steps[stepId];
      const interpolatedTask = interpolateStepTask(step.task, stepOutputs);
      const res = await startJob({
        task: interpolatedTask,
        tool: step.tool || 'claude',
        mode: step.mode || 'plan',
        goal: `Workflow ${run.name} [${run.id}] step: ${step.id}`,
      });
      if (res.id) {
        step.jobId = res.id;
        step.status = 'running';
        step.startedAt = new Date().toISOString();
      } else {
        step.status = 'failed';
        step.error = res.error;
        run.status = 'failed';
      }
    }
    updateWorkflowRun(praxisDir, id, {
      currentTier: nextTierIndex,
      status: run.status,
      steps: run.steps,
    });
  } else {
    updateWorkflowRun(praxisDir, id, { steps: run.steps });
  }

  return run;
}

export async function flow(argv = []) {
  const p = projectPaths();
  const c = praxisCmd();
  const sub = argv[0];
  const json = wantsJson(argv);

  if (sub === 'run') {
    const specArg = argv[1];
    if (!specArg) {
      console.log('\n  ' + rose('Usage: ') + `${c} flow run <spec.json | workflow-name>\n`);
      process.exitCode = 1;
      return;
    }

    let specPath = path.isAbsolute(specArg) ? specArg : path.join(workflowsDir(p.praxisDir), specArg);
    if (!fs.existsSync(specPath) && !specPath.endsWith('.json')) {
      specPath += '.json';
    }
    if (!fs.existsSync(specPath)) {
      console.log('\n  ' + rose('Workflow spec not found: ') + specArg + '\n');
      process.exitCode = 1;
      return;
    }

    let spec;
    try {
      spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch (e) {
      console.log('\n  ' + rose('Invalid JSON in spec: ') + e.message + '\n');
      process.exitCode = 1;
      return;
    }

    const created = createWorkflowRun(p.praxisDir, spec);
    if (created.error) {
      console.log('\n  ' + rose('DAG validation failed: ') + created.error + '\n');
      process.exitCode = 1;
      return;
    }

    // Launch Tier 0
    const tier0StepIds = created.meta.tiers[0] || [];
    for (const stepId of tier0StepIds) {
      const step = created.meta.steps[stepId];
      const res = await startJob({
        task: step.task,
        tool: step.tool || 'claude',
        mode: step.mode || 'plan',
        goal: `Workflow ${spec.name} [${created.id}] step: ${step.id}`,
      });
      if (res.id) {
        step.jobId = res.id;
        step.status = 'running';
        step.startedAt = new Date().toISOString();
      } else {
        step.status = 'failed';
        step.error = res.error;
        created.meta.status = 'failed';
      }
    }

    updateWorkflowRun(p.praxisDir, created.id, { steps: created.meta.steps, status: created.meta.status });

    if (json) {
      emitJson({ ok: true, workflow: created.meta });
      return;
    }

    console.log('\n  ' + bold('WORKFLOW LAUNCHED') + grey(`  · ${spec.name} (${created.id})`));
    console.log('  ' + grey(spec.description || 'Zero-dependency multi-agent DAG pipeline.'));
    console.log('\n  ' + bold('Tiers of Execution:'));
    created.meta.tiers.forEach((tier, i) => {
      const isCurrent = i === 0;
      const marker = isCurrent ? amber('▸ Tier ' + i) : grey('  Tier ' + i);
      console.log('    ' + marker + '  ' + tier.map((sId) => {
        const s = created.meta.steps[sId];
        return `${sId} [${s.tool || 'claude'}]`;
      }).join(', '));
    });

    console.log('\n  ' + grey('Inspect progress: ') + bold(`${c} flow status ${created.id}`) + grey(' · deck: ') + bold(`${c} jobs`) + '\n');
    return;
  }

  if (sub === 'status') {
    const runId = argv[1];
    if (!runId) {
      console.log('\n  ' + rose('Usage: ') + `${c} flow status <wf-id>\n`);
      process.exitCode = 1;
      return;
    }

    const run = await advanceWorkflowRun(p.praxisDir, runId);
    if (!run) {
      console.log('\n  ' + rose('Workflow run not found: ') + runId + '\n');
      process.exitCode = 1;
      return;
    }

    if (json) {
      emitJson({ ok: true, workflow: run });
      return;
    }

    console.log('\n  ' + bold('WORKFLOW STATUS') + '  ' + run.name + '  ' + badge(run.status));
    console.log('  ' + grey('id       ') + run.id + grey('  · started ' + timeAgo(new Date(run.startedAt))));
    if (run.endedAt) console.log('  ' + grey('ended    ') + timeAgo(new Date(run.endedAt)));

    console.log('\n  ' + bold('Steps & Tiers:'));
    run.tiers.forEach((tier, i) => {
      const isCurrent = i === run.currentTier && run.status === 'running';
      const tierMarker = isCurrent ? amber(`● Tier ${i} (active)`) : grey(`  Tier ${i}`);
      console.log('    ' + tierMarker);
      for (const stepId of tier) {
        const step = run.steps[stepId];
        const jobStatusLabel = step.jobId ? `job ${step.jobId}` : 'not started';
        console.log(`      ${badge(step.status)}  ${bold(stepId)} [${step.tool}] ${grey(jobStatusLabel)}`);
        if (step.receiptId) {
          console.log(`         ${grey('receipt: ' + step.receiptId)}`);
        }
      }
    });

    console.log('\n  ' + dim(`advance/refresh: ${c} flow status ${run.id}`) + '\n');
    return;
  }

  // Default: list flows and recent runs
  const specs = listFlowSpecs(p.praxisDir);
  const runs = listWorkflowRuns(p.praxisDir);

  if (json) {
    emitJson({ ok: true, specs, runs: runs.slice(0, 10) });
    return;
  }

  console.log('\n  ' + bold('PRAXIS FLOW') + grey(' — Zero-dependency multi-agent DAG orchestration\n'));

  if (specs.length) {
    console.log('  ' + bold('AVAILABLE WORKFLOWS') + grey(' (.praxis/flows/)'));
    for (const s of specs) {
      console.log('    ' + sage('▸') + ' ' + bold(s.file.replace(/\.json$/, '')) + '  ' + grey(s.description));
    }
  } else {
    console.log('  ' + grey('No workflows found in .praxis/flows/. Create one or use dynamic flows.'));
  }

  if (runs.length) {
    console.log('\n  ' + bold('RECENT WORKFLOW RUNS'));
    for (const r of runs.slice(0, 5)) {
      console.log('    ' + badge(r.status) + '  ' + bold(r.id) + '  ' + r.name + '  ' + grey(timeAgo(new Date(r.startedAt))));
    }
  }

  console.log('\n  ' + dim(`run a flow: ${c} flow run <name> · inspect: ${c} flow status <id>`) + '\n');
}
