// praxis trace — on | off | --capture | log | [ref]
// The decision trail for AI-written commits, in plain git. `trace on` adds one
// line to the post-commit hook; every commit then gets an "AI context" note in
// refs/notes/praxis, readable with `praxis trace` and shareable with
// `git push origin refs/notes/praxis`. No server, no vendor, no lock-in.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { transcriptDir, newestTranscript } from '../lib/transcript.js';
import { DEFAULT_CONTEXT_LIMIT } from '../lib/health.js';
import { scanWindow, buildTraceBlock, patchHookScript, unpatchHookScript } from '../lib/trace.js';
import { vaultDirFor, writeCommitNote } from '../lib/vault.js';
import { miniHeader, rose, sage, amber, bold, grey, dim } from '../lib/ui.js';

const NOTES_REF = 'refs/notes/praxis';
const TAIL_BYTES = 2 * 1024 * 1024; // a commit window lives in the recent tail
const MAX_WINDOW_MS = 4 * 60 * 60 * 1000;

function git(args, opts = {}) {
  return spawnSync('git', args, { encoding: 'utf8', windowsHide: true, ...opts });
}

function pkgVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

export async function trace(args = []) {
  const quiet = args.includes('--quiet');
  const sub = args.filter((a) => !a.startsWith('--'))[0];

  const inRepo = git(['rev-parse', '--git-dir']).status === 0;
  if (!inRepo) {
    console.log('\n  Not a git repository — trace records the AI context behind commits.\n');
    process.exitCode = 1;
    return;
  }

  if (args.includes('--capture')) return capture(quiet);
  if (sub === 'on') return hookOn();
  if (sub === 'off') return hookOff();
  if (sub === 'log') return log();
  return show(sub || 'HEAD');
}

function capture(quiet) {
  const file = newestTranscript(transcriptDir());
  if (!file) return; // no session, nothing to say — never block a commit

  // window: since the parent commit (this runs post-commit), capped at 4h
  let since = Date.now() - MAX_WINDOW_MS;
  const parent = git(['log', '-1', '--format=%ct', 'HEAD~1']);
  if (parent.status === 0 && parent.stdout.trim()) {
    since = Math.max(since, parseInt(parent.stdout.trim(), 10) * 1000);
  }

  let text = '';
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const take = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(take);
    fs.readSync(fd, buf, 0, take, size - take);
    fs.closeSync(fd);
    text = buf.toString('utf8');
    const nl = text.indexOf('\n');
    if (size > TAIL_BYTES && nl >= 0) text = text.slice(nl + 1); // drop the partial first line
  } catch {
    return;
  }

  const root = (git(['rev-parse', '--show-toplevel']).stdout || '').trim();
  const scan = scanWindow(text, since);
  if (!scan.asks.length && !scan.said.length && !scan.files.size) return; // no AI involvement, no note

  const block = buildTraceBlock(scan, { root, version: pkgVersion(), contextLimit: DEFAULT_CONTEXT_LIMIT });
  const r = git(['notes', '--ref=' + NOTES_REF, 'add', '-f', '-m', block, 'HEAD']);

  // Obsidian bridge: the commit's AI context becomes a note in the vault too
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.praxis', 'config.json'), 'utf8'));
    const project = path.basename(root);
    const vd = vaultDirFor(cfg, project, undefined, root);
    if (vd && r.status === 0) {
      const head = git(['log', '-1', '--format=%h%x09%s']);
      const [hash, subject] = (head.stdout || '').trim().split('\t');
      writeCommitNote(vd, project, { hash, subject, block });
    }
  } catch {
    /* the vault is a mirror, never a blocker */
  }
  if (!quiet) {
    console.log(
      r.status === 0
        ? '\n  ' + sage('✓') + ' AI context recorded for this commit — ' + bold('praxis trace') + ' to read it.\n'
        : '\n  ' + amber('!') + ' could not write the trace note.\n',
    );
  }
}

function hookOn() {
  const hooksDir = (git(['rev-parse', '--git-path', 'hooks']).stdout || '').trim();
  const hookFile = path.join(hooksDir, 'post-commit');
  let existing = '';
  try {
    existing = fs.readFileSync(hookFile, 'utf8');
  } catch {
    /* new hook */
  }
  const { content, changed } = patchHookScript(existing);
  if (changed) {
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(hookFile, content);
    try {
      fs.chmodSync(hookFile, 0o755);
    } catch {
      /* windows: git runs hooks via sh regardless */
    }
  }
  console.log('\n  ' + miniHeader(pkgVersion(), 'trace') + '\n');
  console.log('  ' + sage('✓') + (changed ? ' trace is on — every commit now carries its AI context.' : ' already on.'));
  console.log('  ' + dim('Existing hooks were kept; praxis added one line, nothing more.'));
  console.log('  ' + dim('Read: ') + rose('praxis trace') + dim(' · share with the team: ') + rose('git push origin refs/notes/praxis'));
  console.log('  ' + amber('note') + dim('  notes distill your session — secrets are redacted best-effort,'));
  console.log('        ' + dim('so glance at a note before pushing it to a public repo.') + '\n');
}

function hookOff() {
  const hooksDir = (git(['rev-parse', '--git-path', 'hooks']).stdout || '').trim();
  const hookFile = path.join(hooksDir, 'post-commit');
  let existing = '';
  try {
    existing = fs.readFileSync(hookFile, 'utf8');
  } catch {
    /* nothing there */
  }
  const { content, changed } = unpatchHookScript(existing);
  if (changed) fs.writeFileSync(hookFile, content);
  console.log('\n  ' + sage('✓') + ' trace ' + bold('off') + ' — existing notes stay until you delete them.\n');
}

function show(ref) {
  console.log('\n  ' + miniHeader(pkgVersion(), 'trace') + '\n');
  const subject = git(['log', '-1', '--format=%h  %s', ref]);
  if (subject.status !== 0) {
    console.log('  Unknown commit: ' + ref + '\n');
    process.exitCode = 1;
    return;
  }
  console.log('  ' + bold(subject.stdout.trim()) + '\n');
  const note = git(['notes', '--ref=' + NOTES_REF, 'show', ref]);
  if (note.status !== 0) {
    console.log('  No AI context recorded for this commit.');
    console.log('  ' + dim('Turn it on for future commits: ') + rose('praxis trace on') + '\n');
    return;
  }
  for (const l of note.stdout.trimEnd().split('\n')) console.log('  ' + l);
  console.log('');
}

function log() {
  console.log('\n  ' + miniHeader(pkgVersion(), 'trace log') + '\n');
  const noted = new Set(
    (git(['notes', '--ref=' + NOTES_REF, 'list']).stdout || '')
      .split('\n')
      .map((l) => l.split(' ')[1])
      .filter(Boolean),
  );
  const out = git(['log', '-15', '--format=%H%x09%h%x09%s']);
  for (const line of (out.stdout || '').trim().split('\n')) {
    const [full, short, subject] = line.split('\t');
    if (!full) continue;
    const mark = noted.has(full) ? sage('●') : grey('○');
    console.log('  ' + mark + ' ' + short + '  ' + (subject || '').slice(0, 70));
  }
  console.log('\n  ' + dim('● has AI context — ') + rose('praxis trace <hash>') + dim(' to read it') + '\n');
}
