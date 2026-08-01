// praxis checkpoint [folder] — save everything, then start fresh WITHOUT losing
// anything or opening a new session. The CLI half: archive the full
// conversation, write the RESUME brief, mirror into Obsidian when a vault is
// there, log the pointer into project memory — all pre-flight-checked, nothing
// overwritten silently, and on ANY doubt it asks instead of guessing.
// The clear+reload half lives in /praxis-checkpoint + Claude's own /compact:
// an external CLI cannot clear a live Claude session, and we don't pretend to.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { projectPaths } from '../lib/paths.js';
import { recordError } from '../lib/errors.js';
import { readMemory, ensureMemory, addSessionEntry } from '../lib/memory.js';
import { transcriptDir, newestTranscript } from '../lib/transcript.js';
import { buildArchive, buildResume, extractEssence, findObsidianVault } from '../lib/checkpoint.js';
import { vaultPathAllowed, vaultDirFor, mirrorMemory, writeSessionNote } from '../lib/vault.js';
import { redact } from '../lib/redact.js';
import { writeState } from '../lib/state.js';
import { rose, sage, amber, bold, grey, dim } from '../lib/ui.js';

function stamp(d = new Date()) {
  return d.toISOString().slice(0, 19).replace('T', '-').replaceAll(':', '.');
}

/** One question, a few options, safe default. Non-TTY (hooks, Claude's shell) never hangs. */
async function ask(question, options, fallback) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n  ' + amber('?') + ' ' + bold(question));
  for (const [key, label] of options) console.log(`    ${rose('[' + key + ']')} ${label}`);
  const ans = await new Promise((resolve) => rl.question('  > ', resolve));
  rl.close();
  const key = String(ans).trim().toLowerCase().slice(0, 1);
  return options.some(([k]) => k === key) ? key : fallback;
}

export async function checkpoint(args = []) {
  const flags = new Set(args.filter((a) => a.startsWith('-')));
  const fromClaude = flags.has('--from-claude');
  const folderArg = args.find((a) => !a.startsWith('-'));

  const p = projectPaths();
  if (!fs.existsSync(p.praxisDir)) {
    console.log(`\n  No PRAXIS memory here yet — nothing to checkpoint.\n  Run ${bold('npx praxis-memory')} first, work a while, then checkpoint.\n`);
    process.exitCode = 1;
    return;
  }

  const dir = folderArg ? path.resolve(folderArg) : path.join(p.praxisDir, 'checkpoints');

  // Same confinement rule as the vault: a checkpoint folder outside home AND
  // outside the repo is either a typo or a trap — refuse instead of writing.
  if (!vaultPathAllowed(dir, os.homedir(), p.root)) {
    console.log(`\n  ${amber('!')} ${bold('That folder is outside your home directory and this repo.')}\n  A checkpoint writes your session there — pick a folder you own:\n  ${grey('praxis checkpoint ./notes')}  ${grey('or just')}  ${grey('praxis checkpoint')}\n`);
    process.exitCode = 1;
    return;
  }

  writeState(p.praxisDir, 'switching');
  const now = new Date();
  const project = path.basename(p.root);
  const resumeFile = path.join(dir, 'RESUME.md');
  const archiveFile = path.join(dir, 'archive', `${stamp(now)}-session.md`);

  // ---- pre-flight: can we write, and would we collide? ----
  try {
    fs.mkdirSync(path.join(dir, 'archive'), { recursive: true });
    const probe = path.join(dir, '.praxis-write-check');
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch (e) {
    console.log(`\n  ${amber('!')} Cannot write to ${bold(dir)} — ${e && e.message ? e.message : e}\n  Nothing was changed.\n`);
    writeState(p.praxisDir, 'restored');
    process.exitCode = 1;
    return;
  }

  // ---- the session, read from the source of truth ----
  const tFile = newestTranscript(transcriptDir(p.root));
  let text = '';
  if (tFile) {
    try {
      text = fs.readFileSync(tFile, 'utf8');
    } catch {
      /* degrade to memory-only */
    }
  }
  const memory = readMemory(p.memoryFile);
  const essence = extractEssence(text);

  // ---- RESUME.md: never overwritten silently ----
  let resumeTarget = resumeFile;
  let resumeWritten = false;
  if (fromClaude) {
    // Claude (with the live context) wrote the rich brief already; redact it
    // in place as a safety net and leave its words alone.
    if (!fs.existsSync(resumeFile)) {
      console.log(`\n  ${amber('!')} ${bold('--from-claude expects RESUME.md to exist already.')}\n  Write the rich brief to ${grey(path.relative(p.root, resumeFile))} first, then run this again.\n`);
      writeState(p.praxisDir, 'restored');
      process.exitCode = 1;
      return;
    }
    try {
      fs.writeFileSync(resumeFile, redact(fs.readFileSync(resumeFile, 'utf8')));
    } catch {
      /* redaction pass is best-effort */
    }
  } else {
    if (fs.existsSync(resumeFile)) {
      const choice = await ask(
        'RESUME.md already exists in that folder. What should happen?',
        [
          ['k', 'keep both — write a new timestamped brief next to it (safe default)'],
          ['o', 'overwrite it with a fresh brief'],
          ['c', 'cancel — change nothing'],
        ],
        'k',
      );
      if (choice === 'c') {
        console.log('\n  Cancelled. Nothing was written.\n');
        writeState(p.praxisDir, 'restored');
        return;
      }
      if (choice === 'k') resumeTarget = path.join(dir, `RESUME-${stamp(now)}.md`);
    }
    fs.writeFileSync(resumeTarget, redact(buildResume(memory, essence, { now: now.toISOString() })));
    resumeWritten = true;
  }

  // ---- the full archive ----
  let archived = null;
  if (text) {
    const a = buildArchive(text, { project, now: now.toISOString() });
    fs.writeFileSync(archiveFile, redact(a.markdown));
    archived = a.stats;
  }

  // ---- Obsidian: config vault first, else a vault the target folder lives in ----
  let vaultNote = null;
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
  } catch {
    /* defaults */
  }
  const existsDir = (d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  };
  let vd = vaultDirFor(cfg, project, os.homedir(), p.root);
  if (!vd) {
    const found = findObsidianVault(dir, [p.root, os.homedir()], existsDir);
    if (found) {
      const choice = await ask(
        `Obsidian vault detected at ${found}. Mirror this checkpoint into it?`,
        [
          ['y', 'yes — write the linked notes there too'],
          ['n', 'no — plain markdown only'],
        ],
        // no TTY: only trust the unambiguous signal — the target folder IS in the vault
        found ? 'y' : 'n',
      );
      if (choice === 'y') vd = path.join(found, 'Praxis', project);
    }
  }
  if (vd) {
    try {
      mirrorMemory(vd, project, memory);
      writeSessionNote(vd, project, {
        snapshot: false,
        asks: essence.asks,
        files: archived ? archived.files.slice(0, 20).map((f) => path.basename(f)) : [],
        turns: archived ? archived.userMsgs + archived.claudeMsgs : 0,
        tokens: archived ? archived.tokens : 0,
      });
      vaultNote = vd;
    } catch (e) {
      // The vault is a mirror and never a blocker — but "never a blocker" is
      // not the same as "never worth mentioning". An unmounted drive or a
      // permissions change stops notes arriving in Obsidian while memory.md
      // keeps growing, and without this the two just quietly drift apart.
      recordError(p.praxisDir, 'vault-mirror', e);
    }
  }

  // ---- the reload wiring: the pointer lives in memory.md, which every future
  // context (including the one right after /compact) loads automatically ----
  ensureMemory(p.memoryFile);
  const rel = (f) => path.relative(p.root, f).replace(/\\/g, '/');
  addSessionEntry(
    p.memoryFile,
    `${now.toISOString()} - checkpoint`,
    [
      essence.asks.length ? `- Working on: ${essence.asks.slice(-3).map((a) => `"${a.slice(0, 80)}"`).join(' · ')}` : null,
      `- Resume brief: read \`${rel(resumeTarget)}\` and continue from it — do not start over.`,
      archived ? `- Full archive: \`${rel(archiveFile)}\`` : '- (no live transcript found — brief built from memory only)',
    ]
      .filter(Boolean)
      .join('\n'),
    { maxBytes: Number.isFinite(cfg.maxLogBytes) ? cfg.maxLogBytes : 16384, redact: cfg.redact !== false },
  );

  writeState(p.praxisDir, 'restored');

  // ---- tell the human what happened, in plain words ----
  console.log(`\n  ${rose('✦')} ${bold('Checkpoint saved. Nothing is lost.')}\n`);
  if (resumeWritten || fromClaude) console.log(`  ${sage('✓')} Resume brief   ${grey(rel(resumeTarget))}${fromClaude ? grey('  (written by Claude, redaction-checked)') : ''}`);
  if (archived) {
    console.log(`  ${sage('✓')} Full archive   ${grey(rel(archiveFile))}  ${dim(`(${archived.userMsgs}+${archived.claudeMsgs} messages, ${archived.tools} actions${archived.tokens ? ', ' + Math.round(archived.tokens / 1000) + 'k tokens' : ''})`)}`);
  } else {
    console.log(`  ${amber('!')} No live transcript found — the brief was built from project memory alone.`);
  }
  if (vaultNote) console.log(`  ${sage('✓')} Obsidian       ${grey(vaultNote)}`);
  console.log(`  ${sage('✓')} Memory         ${grey('.praxis/memory.md — the brief reloads into every future context')}\n`);
  console.log(`  ${bold('Do this next')}
  Inside Claude Code, run ${rose('/compact')} — the session clears and continues
  ${bold('right here, same terminal')}; your brief reloads automatically.
  ${dim('(Or just start the next session whenever — the memory block carries it in.)')}\n`);
}
