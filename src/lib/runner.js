import fs from 'node:fs';
import path from 'node:path';

// How should the user type praxis commands on THIS machine?
// A global install (`npm install -g praxis-memory`) puts a `praxis` shim on
// PATH — short commands work. Someone who only ran `npx praxis-memory` has no
// such shim, and every "try `praxis tray --once`" suggestion is a dead end.
// So: suggest `praxis` only when the shim is really there; otherwise suggest
// the npx form, which works for everyone.
//
// Hooks are different — they must survive EITHER install method changing
// later, so they always go through `npx -y praxis-memory` (see settings.js).
let cached;
export function praxisCmd() {
  if (cached) return cached;
  const exts = process.platform === 'win32' ? ['.cmd', '.ps1', ''] : [''];
  const onPath = (process.env.PATH || '')
    .split(path.delimiter)
    .some((dir) => {
      if (!dir) return false;
      return exts.some((ext) => {
        try {
          return fs.existsSync(path.join(dir, 'praxis' + ext));
        } catch {
          return false;
        }
      });
    });
  cached = onPath ? 'praxis' : 'npx praxis-memory';
  return cached;
}
