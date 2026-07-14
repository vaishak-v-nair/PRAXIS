// Self-contained terminal demo for the README GIF. Runs anywhere (no install,
// no npm publish) so the GIF renders identically on any machine.
//   node scripts/demo.mjs      (driven by demo.tape via `vhs demo.tape`)

const out = (s) => process.stdout.write(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const c = {
  p: '\x1b[38;5;205m', // rose prompt
  dim: '\x1b[38;5;245m',
  note: '\x1b[38;5;244m\x1b[3m',
  ok: '\x1b[38;5;42m',
  win: '\x1b[1m\x1b[38;5;231m',
  r: '\x1b[0m',
};

async function type(s, d = 42) {
  for (const ch of s) {
    out(ch);
    await sleep(d);
  }
}
const line = (s = '') => out(s + '\n');

async function main() {
  await sleep(500);

  out(c.p + '$ ' + c.r);
  await type('npx praxis init');
  line();
  await sleep(450);
  line(c.ok + '  ✓' + c.dim + ' memory installed — Claude Code reads it automatically' + c.r);
  await sleep(1100);
  line();

  line(c.note + '# monday. you build for three hours. the session ends.' + c.r);
  await sleep(700);
  line(c.dim + '  🦎 captured: auth refactor · cache.ts workaround · 2 dead ends' + c.r);
  await sleep(1500);
  line();

  line(c.note + '# tuesday. a brand-new session.' + c.r);
  await sleep(700);
  out(c.p + '$ ' + c.r);
  await type('claude');
  line();
  await sleep(700);

  line(c.win + 'Claude already knows your project.' + c.r);
  await sleep(500);
  line(c.dim + '  no re-explaining. no context dump. it just remembers.' + c.r);
  await sleep(1800);
}

main();
