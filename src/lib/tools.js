// The AI tools PRAXIS knows how to hand off to, and how to spot them on this
// machine. Shared by `praxis switch` (handoff) and `praxis health` (suggestions).

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
  },
  antigravity: {
    name: 'Antigravity',
    bin: 'antigravity',
    paste: true,
  },
};

export const ALIASES = { 'gemini-cli': 'gemini', 'codex-cli': 'codex', 'claude-code': 'claude' };

// when a Claude session is full, where can the work go? Order = preference.
export const ALTERNATES_FOR_CLAUDE = ['gemini', 'codex'];

export function onPath(bin) {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    return spawnSync(probe, [bin], { stdio: 'ignore', shell: false }).status === 0;
  } catch {
    return false;
  }
}
