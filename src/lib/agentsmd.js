import fs from 'node:fs';

const START = '<!-- PRAXIS:START (managed - do not edit) -->';
const END = '<!-- PRAXIS:END -->';
const BLOCK = `${START}\n@.praxis/memory.md\n${END}`;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Insert or refresh the PRAXIS managed block in AGENTS.md.
 * Enables OpenAI Codex and other agents to automatically load PRAXIS project memory.
 * Never clobbers the user's own content — only the region between the PRAXIS markers is touched.
 */
export function patchAgentsMd(agentsMdPath) {
  let content = '';
  let existed = false;
  try {
    content = fs.readFileSync(agentsMdPath, 'utf8');
    existed = true;
  } catch {
    /* file does not exist yet */
  }

  if (content.includes(START) && content.includes(END)) {
    const re = new RegExp(escapeRegExp(START) + '[\\s\\S]*?' + escapeRegExp(END));
    content = content.replace(re, BLOCK);
  } else if (!existed || content.trim() === '') {
    content = `# Project Memory\n\nThis project uses PRAXIS so AI agents (Codex, Claude) remember context across sessions.\n\n${BLOCK}\n`;
  } else {
    content = content.trimEnd() + `\n\n${BLOCK}\n`;
  }

  fs.writeFileSync(agentsMdPath, content);
  return { existed };
}
