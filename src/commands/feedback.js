import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const QUESTIONS = `**1. What would make you pay for PRAXIS?**

(write here)

**2. Would you pay for it? How much per month?**

(write here — "no" is as useful as "yes")

---
`;

export function buildFeedbackUrl() {
  let version = '';
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    version = JSON.parse(fs.readFileSync(path.join(dir, '..', '..', 'package.json'), 'utf8')).version;
  } catch { /* version line is nice-to-have, never blocks feedback */ }
  const body = QUESTIONS + `praxis v${version} · ${process.platform} · node ${process.version}\n`;
  return 'https://github.com/vaishak-v-nair/PRAXIS/issues/new'
    + '?title=' + encodeURIComponent('feedback: ')
    + '&labels=feedback'
    + '&body=' + encodeURIComponent(body);
}

function openInBrowser(url) {
  // rundll32 avoids cmd.exe, which would split the URL at every "&"
  const [cmd, args] = process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

export function feedback() {
  const url = buildFeedbackUrl();
  const opened = openInBrowser(url);
  console.log(`
PRAXIS is free and local. Two questions decide whether it becomes more:

  1. What would make you PAY for PRAXIS?
  2. Would you pay for it? How much per month?

"No" is as useful as "yes" — tell me straight.
${opened
    ? '\nYour browser just opened a pre-filled GitHub issue — type your answers, hit Submit.'
    : `\n  ${url}`}
No GitHub account? Email vaishak.v.nair.dev@gmail.com — same two questions.
`);
}
