import fs from 'node:fs';

const START = '<!-- PRAXIS:START (managed - do not edit) -->';
const END = '<!-- PRAXIS:END -->';
const BLOCK = `${START}\n@.praxis/memory.md\n${END}`;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Insert or refresh the PRAXIS managed block in CLAUDE.md. Never clobbers the
 * user's own content — only the region between the PRAXIS markers is touched.
 */
export function patchClaudeMd(claudeMdPath) {
  let content = '';
  let existed = false;
  try {
    content = fs.readFileSync(claudeMdPath, 'utf8');
    existed = true;
  } catch {
    /* file does not exist yet */
  }

  if (content.includes(START) && content.includes(END)) {
    const re = new RegExp(escapeRegExp(START) + '[\\s\\S]*?' + escapeRegExp(END));
    content = content.replace(re, BLOCK);
  } else if (!existed || content.trim() === '') {
    content = `# Project Memory\n\nThis project uses PRAXIS so Claude Code remembers context across sessions.\n\n${BLOCK}\n`;
  } else {
    content = content.trimEnd() + `\n\n${BLOCK}\n`;
  }

  fs.writeFileSync(claudeMdPath, content);
  return { existed };
}
