#!/usr/bin/env node
// The macOS host's only source of truth. Staged into .praxis/tray/ beside the
// JXA script and run once per poll: prints the tray state as one JSON line.
//
// It resolves src/lib/tray-state.js through the ORIGINAL install rather than a
// copy, so an upgrade changes the rules everywhere at once and a staged tray
// can never run last week's logic against this week's memory format.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [, , root, libDir] = process.argv;
if (!root) {
  console.error('usage: tray-state.mjs <projectRoot> [libDir]');
  process.exit(1);
}

const lib = libDir || process.env.PRAXIS_LIB_DIR;
const mod = lib
  ? pathToFileURL(path.join(lib, 'tray-state.js')).href
  : new URL('../lib/tray-state.js', import.meta.url).href;

try {
  const { computeTrayState } = await import(mod);
  process.stdout.write(JSON.stringify(computeTrayState(root)) + '\n');
} catch (e) {
  // A tray that crashes loudly every 4 seconds is worse than one that shows
  // nothing: print a shape the host can render as "idle" and move on.
  process.stdout.write(
    JSON.stringify({
      name: 'idle',
      label: 'healthy',
      ratio: 0,
      updated: '',
      kb: 0,
      capKb: 16,
      entries: 0,
      recent: [],
      sess: null,
      receipt: null,
      project: path.basename(root),
      error: String((e && e.message) || e),
    }) + '\n',
  );
}
