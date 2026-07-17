// praxis save — log the current session into project memory, from the
// terminal, right now. The deterministic twin of /praxis-save: the slash
// command writes a richer, decision-level summary because Claude holds the
// live context; this one reads the newest transcript and saves what can be
// known from the outside — asks, files touched, size.

import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from '../lib/paths.js';
import { ensureMemory, addSessionEntry } from '../lib/memory.js';
import { transcriptDir, newestTranscript } from '../lib/transcript.js';
import { summarizeTranscriptText, recentAsks, shorten } from './capture.js';
import { rose, sage, amber, bold, grey } from '../lib/ui.js';

export function save() {
  const p = projectPaths();
  if (!fs.existsSync(p.praxisDir)) {
    console.log(`\n  No PRAXIS memory here yet. Run ${bold('npx praxis-memory')} first.\n`);
    process.exitCode = 1;
    return;
  }

  const tFile = newestTranscript(transcriptDir(p.root));
  let text = '';
  if (tFile) {
    try {
      text = fs.readFileSync(tFile, 'utf8');
    } catch {
      /* fall through to the honest empty case */
    }
  }
  if (!text) {
    console.log(`\n  ${amber('!')} No Claude Code transcript found for this project — nothing to save yet.\n  ${grey('Sessions are captured automatically when they end; this command saves one mid-flight.')}\n`);
    process.exitCode = 1;
    return;
  }

  const { files, turns } = summarizeTranscriptText(text);
  const asks = recentAsks(text);
  const rel = files.map((f) => shorten(f, p.root));

  let maxBytes = 16384;
  let redactOn = true;
  try {
    const cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
    if (Number.isFinite(cfg.maxLogBytes)) maxBytes = cfg.maxLogBytes;
    if (cfg.redact === false) redactOn = false;
  } catch {
    /* defaults */
  }

  ensureMemory(p.memoryFile);
  addSessionEntry(
    p.memoryFile,
    `${new Date().toISOString()} - saved mid-session`,
    [
      asks.length ? `- Working on: ${asks.map((a) => `"${a}"`).join(' · ')}` : null,
      rel.length
        ? `- Files touched: ${rel.slice(0, 20).join(', ')}${rel.length > 20 ? ` (+${rel.length - 20} more)` : ''}`
        : '- (no file changes detected)',
      turns ? `- Transcript lines: ${turns}` : null,
      '- Run `/praxis-save` inside Claude for a richer, decision-level summary.',
    ]
      .filter(Boolean)
      .join('\n'),
    { maxBytes, redact: redactOn },
  );

  console.log(`\n  ${sage('✓')} ${bold('Session saved into project memory.')}\n  ${grey('Asks, files and size — captured from the live transcript. For the')}\n  ${grey('decision-level story, run ')}${rose('/praxis-save')}${grey(' inside Claude Code.')}\n`);
}
