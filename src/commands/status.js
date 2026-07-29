import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../lib/paths.js';
import { readMemory } from '../lib/memory.js';
import { miniHeader, masthead, mascotBlock, slashBlock, rule, row, wrap, g, COL, CONTENT, sage, amber, red, rose, bold, grey, dim, timeAgo, dailyQuote } from '../lib/ui.js';
import { emitJson } from '../lib/jsonout.js';
import { praxisCmd } from '../lib/runner.js';
import { healthReport } from '../lib/health.js';
import { listReceipts } from '../lib/receipt/render.js';

function pkgVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

export function status(opts = {}) {
  const p = projectPaths();
  if (!fs.existsSync(p.memoryFile)) {
    if (opts.json) {
      emitJson({ ok: true, version: pkgVersion(), initialized: false });
      return;
    }
    console.log('\n  ' + miniHeader(pkgVersion()) + '\n');
    console.log('  PRAXIS is not set up in this directory yet.');
    console.log('  Run ' + bold('npx praxis-memory') + ' to set it up.\n');
    return;
  }
  const content = readMemory(p.memoryFile);
  const bytes = Buffer.byteLength(content);
  const entries = (content.match(/^### /gm) || []).length;
  const stat = fs.statSync(p.memoryFile);

  let cap = 16384;
  try {
    cap = JSON.parse(fs.readFileSync(p.configFile, 'utf8')).maxLogBytes || cap;
  } catch {
    /* default */
  }
  const fill = bytes / cap;

  if (opts.json) {
    // The same reads the human path renders, as one document. Suggestions and
    // pointers stay on the human path — a script wants state, not advice.
    const hr = healthReport();
    const receipts = listReceipts(p.receiptsDir);
    let armed = false;
    for (const f of [p.settingsLocalFile, p.settingsFile]) {
      try {
        if (fs.readFileSync(f, 'utf8').includes('praxis-memory capture')) armed = true;
      } catch {
        /* no settings file means no hook here */
      }
    }
    emitJson({
      ok: true,
      version: pkgVersion(),
      initialized: true,
      memory: {
        file: path.relative(p.root, p.memoryFile),
        bytes,
        capBytes: cap,
        fill: Number(fill.toFixed(3)),
        state: fill < 0.6 ? 'healthy' : fill < 0.9 ? 'filling-up' : 'near-cap',
        entries,
        updatedAt: stat.mtime.toISOString(),
      },
      claude: hr
        ? { connected: true, live: !!hr.live, idle: !!hr.idle, pct: hr.pct, level: hr.level || null, idleMinutes: hr.idleMinutes ?? null }
        : { connected: false },
      receipts: {
        count: receipts.length,
        // armed = the capture hook is installed (either scope, D85). Reported
        // independently of count: receipts can exist from a hook since removed.
        armed,
        latest: receipts[0] || null,
      },
    });
    return;
  }
  const health =
    fill < 0.6
      ? sage('●') + ' healthy'
      : fill < 0.9
        ? amber('●') + ' filling up'
        : red('●') + ' near the cap';
  // The caption never restates the state word — the row above already said it.
  // ("state ● near the cap — At the cap — …" shipped once. Once.)
  const healthPlain =
    fill < 0.6
      ? 'plenty of room — nothing to do'
      : fill < 0.9
        ? 'oldest session notes will be trimmed automatically — nothing to do'
        : 'oldest notes are trimmed as new ones arrive — put anything precious in the Project section, it is never trimmed';

  const caption = (text) => {
    for (const l of wrap(text, CONTENT - COL)) console.log(g(' '.repeat(COL) + dim(l)));
  };

  // The front door (`npx praxis-memory`, bare `praxis`) gets the full welcome —
  // masthead, mascot, slash menu. Plain `praxis status` keeps only the body.
  // Both are the same grid; the welcome is composition, not a second system.
  if (opts.welcome) {
    console.log('\n' + masthead(pkgVersion()) + '\n');
    const mascot = mascotBlock(); // empty on terminals that cannot draw it
    if (mascot) console.log(mascot + '\n');
    console.log(g(rule('this project')));
  } else {
    console.log('\n  ' + miniHeader(pkgVersion(), 'status') + '\n');
  }
  console.log(g(row('memory', path.relative(p.root, p.memoryFile))));
  console.log(g(row('size', `${(bytes / 1024).toFixed(1)} KB · ${entries} session entr${entries === 1 ? 'y' : 'ies'}`)));
  console.log(g(row('updated', timeAgo(stat.mtime))));
  console.log(g(row('state', health)));
  caption(healthPlain);

  // is Claude actually here right now? say so in one honest line
  const hr = healthReport();
  if (!hr) {
    console.log(g(row('claude', grey('○ not connected — start ') + bold('claude') + grey(' here'))));
  } else if (hr.live) {
    const dot = hr.level === 'critical' ? red('●') : hr.level === 'fresh' ? sage('●') : amber('●');
    console.log(g(row('claude', dot + ` active now — ${hr.pct}% full`)));
    caption(`${praxisCmd()} health for detail`);
  } else if (hr.idle) {
    console.log(g(row('claude', amber('◐') + ` idle at ${hr.pct}% — paused, ${hr.idleMinutes}m since the last message`)));
  } else {
    console.log(g(row('claude', grey(`○ no recent session — last one reached ${hr.pct}% full`))));
  }

  // proof-of-work: the receipts this project's sessions have left behind
  const receipts = listReceipts(p.receiptsDir);
  if (receipts.length) {
    const latest = receipts[0];
    const badge =
      latest.verdict === 'VERIFIED'
        ? sage('✓ VERIFIED')
        : latest.verdict === 'CLAIMS_FAILED'
          ? red('✗ CLAIMS FAILED')
          : latest.verdict === 'PARTIAL'
            ? amber('~ PARTIAL')
            : grey('· ' + latest.verdict);
    console.log(g(row('receipts', `${receipts.length} sealed · latest ${latest.label} ` + badge)));
    caption(`${praxisCmd()} receipt — the proof itself`);
  } else {
    // "Armed" is a claim, so it has to be checkable. The hook being installed
    // is what makes receipts automatic — saying so beats promising it.
    // Either file arms it (D85): personal by default, shared by choice.
    let armed = false;
    for (const f of [p.settingsLocalFile, p.settingsFile]) {
      try {
        if (fs.readFileSync(f, 'utf8').includes('praxis-memory capture')) armed = true;
      } catch {
        /* no settings file means no hook here */
      }
    }
    if (armed) {
      console.log(g(row('receipts', sage('○ armed'))));
      caption('none yet — the next session that ends seals one automatically');
    } else {
      console.log(g(row('receipts', amber('○ not armed'))));
      caption(`run ${praxisCmd()} init here to seal receipts automatically`);
    }
    caption(`want to see one now? ${praxisCmd()} demo — one minute, no setup, no network`);
  }

  if (opts.welcome) {
    console.log('');
    console.log(slashBlock());
  }
  console.log('\n  ' + dim('Loaded into Claude Code automatically via the PRAXIS block in CLAUDE.md.'));
  console.log('  ' + dim('All commands: ') + rose(`${praxisCmd()} help`) + '\n');
  if (opts.welcome) console.log('  ' + dim('“' + dailyQuote() + '”') + '\n');
}
