// The AI tools PRAXIS knows how to hand off to, and how to spot them on this
// machine. Shared by `praxis switch` (handoff) and `praxis health` (suggestions).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CAPSULE = '.praxis/handoff.md';
const ASK = `Read ${CAPSULE} first, then continue the work it describes.`;

export const TOOLS = {
  claude: {
    name: 'Claude Code',
    bin: 'claude',
    run: `claude "${ASK}"`,
    install: 'npm install -g @anthropic-ai/claude-code',
  },
  gemini: {
    name: 'Gemini CLI',
    bin: 'gemini',
    run: `gemini -i "${ASK}"`,
    install: 'npm install -g @google/gemini-cli',
  },
  codex: {
    name: 'Codex CLI',
    bin: 'codex',
    run: `codex "${ASK}"`,
    install: 'npm install -g @openai/codex',
  },
  cursor: {
    name: 'Cursor',
    bin: 'cursor',
    paste: true,
    detect: { winPaths: ['Programs\\cursor\\Cursor.exe'], macApp: 'Cursor.app', regName: 'Cursor' },
  },
  antigravity: {
    name: 'Antigravity',
    bin: 'antigravity',
    paste: true,
    detect: { winPaths: ['Programs\\Antigravity IDE', 'Programs\\Antigravity'], macApp: 'Antigravity.app', regName: 'Antigravity' },
  },
};

export const ALIASES = { 'gemini-cli': 'gemini', 'codex-cli': 'codex', 'claude-code': 'claude' };

// when a Claude session is full, where can the work go? Order = preference:
// CLI tools launch the handoff themselves; IDE tools take it via clipboard.
export const ALTERNATES_FOR_CLAUDE = ['gemini', 'codex', 'cursor', 'antigravity'];

export function onPath(bin) {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    return spawnSync(probe, [bin], { windowsHide: true, stdio: 'ignore', shell: false }).status === 0;
  } catch {
    return false;
  }
}

// IDEs rarely put a CLI on PATH (and people install them anywhere — D:\, E:\).
// The Windows uninstall registry sees every install location; read it once.
let regNamesCache = null;
function windowsInstalledNames() {
  if (regNamesCache !== null) return regNamesCache;
  regNamesCache = '';
  if (process.platform !== 'win32') return regNamesCache;
  const hives = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  for (const hive of hives) {
    try {
      const r = spawnSync('reg', ['query', hive, '/s', '/v', 'DisplayName'], {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
      });
      if (r.stdout) regNamesCache += r.stdout.toLowerCase();
    } catch {
      /* partial visibility is fine */
    }
  }
  return regNamesCache;
}

/** Real installed-or-not: PATH, known install dirs, /Applications, registry. */
export function isInstalled(t) {
  if (t.bin && onPath(t.bin)) return true;
  const d = t.detect;
  if (!d) return false;
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || '';
    for (const p of d.winPaths || []) {
      if (base && fs.existsSync(path.join(base, p))) return true;
    }
    if (d.regName && windowsInstalledNames().includes(d.regName.toLowerCase())) return true;
  } else if (process.platform === 'darwin' && d.macApp) {
    if (fs.existsSync('/Applications/' + d.macApp)) return true;
  }
  return false;
}
