// praxis switch <tool> — pack a handoff brief and move to another AI tool.
// Your session is filling up, or you want a different model on the problem.
// Instead of re-explaining everything, PRAXIS packs your project memory into
// one file and gives you the exact command that starts the next tool warm.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectPaths } from '../lib/paths.js';
import { readMemory } from '../lib/memory.js';
import { buildCapsule } from '../lib/handoff.js';
import { writeState } from '../lib/state.js';
import { TOOLS, ALIASES, CAPSULE, onPath } from '../lib/tools.js';
import { healthReport } from '../lib/health.js';
import { rose, sage, amber, red, bold, grey, dim } from '../lib/ui.js';

const ASK = `Read ${CAPSULE} first, then continue the work it describes.`;

export async function switchTool(args = []) {
  const target = ALIASES[args[0]] || args[0];
  const p = projectPaths();

  if (!fs.existsSync(p.memoryFile)) {
    console.log(`
  There is no PRAXIS memory in this folder yet, so there is nothing to hand off.

  Do this first: run ${bold('npx praxis-memory')} here, work a session or two,
  then ${bold('praxis switch ' + (target || '<tool>'))} will carry it all over.
`);
    process.exitCode = 1;
    return;
  }

  if (!target || !TOOLS[target]) {
    if (target) console.log('\n  Unknown tool: ' + bold(target));
    listTools();
    if (target) process.exitCode = 1;
    return;
  }

  const tool = TOOLS[target];
  writeState(p.praxisDir, 'switching'); // the tray mascot glows blue: context on the move

  const memory = readMemory(p.memoryFile);
  const capsule = buildCapsule(memory, { toolName: tool.name });
  const capsulePath = path.join(p.root, CAPSULE);
  fs.writeFileSync(capsulePath, capsule);

  const kb = (Buffer.byteLength(capsule) / 1024).toFixed(1);
  const sessions = (capsule.match(/^### /gm) || []).length;
  const installed = tool.bin ? onPath(tool.bin) : false;

  console.log(`
  ${rose('✦')} ${bold('Handoff packed for ' + tool.name + '.')}

  ${bold('What just happened')}
  Your project memory was packed into one file: ${bold(CAPSULE)}
  (${kb} KB — the project brief plus your ${sessions} most recent session note${sessions === 1 ? '' : 's'})

  ${bold('Do this next')}`);

  if (tool.paste) {
    console.log(`  1. Open this folder in ${tool.name}.
  2. In its chat, type: ${rose('"' + ASK + '"')}
  3. ${tool.name} starts with your project's memory. Nothing to re-explain.`);
    copyToClipboard(ASK);
    console.log('\n  ' + dim('(that message is already on your clipboard — just paste it)'));
  } else {
    console.log(`  1. Open a terminal in this folder.
  2. Run: ${rose(tool.run)}
  3. ${tool.name} starts with your project's memory. Nothing to re-explain.`);
    if (copyToClipboard(tool.run)) {
      console.log('\n  ' + dim('(that command is already on your clipboard — just paste it)'));
    }
    if (!installed) {
      console.log(`\n  ${amber('!')} ${tool.name} does not look installed yet. Install it first:
    ${bold(tool.install)}`);
    }
  }
  writeState(p.praxisDir, 'restored');
  console.log('');
}

function listTools() {
  console.log(`
  ${bold('praxis switch <tool>')} — pack your project memory and move to another AI tool.`);

  // why switch now? show the real session number when we have one
  const r = healthReport();
  if (r && r.contextTokens > 0) {
    const c = r.level === 'critical' ? red : r.level === 'fresh' ? sage : amber;
    console.log(
      '\n  ' +
        bold('Right now') +
        '  ' +
        c('●') +
        ` your Claude session is ${bold(r.pct + '% full')} ` +
        grey(`(${r.level}${r.compactions ? ', squeezed ' + r.compactions + 'x' : ''})`),
    );
  }

  console.log(`\n  ${bold('Tools it can hand off to')}`);
  for (const [key, t] of Object.entries(TOOLS)) {
    const here = t.bin && onPath(t.bin);
    const mark = here ? sage('● installed') : grey('○ not found');
    console.log('  ' + rose(('praxis switch ' + key).padEnd(26)) + t.name.padEnd(14) + mark);
  }
  console.log(`
  ${bold('What it does, in plain words')}
  1. Packs your project brief + recent session notes into ${bold(CAPSULE)}.
  2. Tells you the exact command that opens the next tool ${bold('already knowing')}
     your project — so you never re-explain it.
`);
}

/** Best-effort, zero-dependency clipboard. Failure is fine — text is on screen. */
function copyToClipboard(text) {
  try {
    const [cmd, cmdArgs] =
      process.platform === 'win32'
        ? ['clip', []]
        : process.platform === 'darwin'
          ? ['pbcopy', []]
          : ['xclip', ['-selection', 'clipboard']];
    return spawnSync(cmd, cmdArgs, { input: text, stdio: ['pipe', 'ignore', 'ignore'] }).status === 0;
  } catch {
    return false;
  }
}
