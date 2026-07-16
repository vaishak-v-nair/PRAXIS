import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  freshHudState,
  applyLine,
  cleanUserText,
  toolDetail,
  toolInPlainEnglish,
  whatIsHappening,
  transcriptDir,
} from '../src/lib/transcript.js';
import { buildCapsule } from '../src/lib/handoff.js';
import { wrap } from '../src/commands/hud.js';

const j = (o) => JSON.stringify(o);

test('transcriptDir sanitizes the cwd the way Claude Code does', () => {
  const dir = transcriptDir('E:\\PRAXIS', 'C:\\Users\\v');
  assert.match(dir, /E--PRAXIS$/);
});

test('hud reducer: ask, respond, run, done', () => {
  const s = freshHudState();
  applyLine(s, j({ type: 'user', timestamp: '2026-07-15T10:00:00Z', message: { content: 'fix the login bug' } }));
  assert.equal(s.asking, 'fix the login bug');
  assert.equal(s.lastEvent, 'user');

  applyLine(
    s,
    j({
      type: 'assistant',
      timestamp: '2026-07-15T10:00:05Z',
      message: {
        content: [
          { type: 'text', text: 'Looking at the auth middleware.' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git log --oneline' } },
        ],
      },
    }),
  );
  assert.equal(s.responding, 'Looking at the auth middleware.');
  assert.equal(s.running.name, 'Bash');
  assert.equal(s.running.detail, 'git log --oneline');
  assert.equal(s.running.done, false);
  assert.equal(whatIsHappening(s).kind, 'busy');

  applyLine(s, j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }));
  assert.equal(s.running.done, true);

  // a new human prompt resets the turn
  applyLine(s, j({ type: 'user', message: { content: 'thanks, now add a test' } }));
  assert.equal(s.asking, 'thanks, now add a test');
  assert.equal(s.responding, '');
  assert.equal(s.toolsThisTurn, 0);
});

test('hud reducer: AskUserQuestion flips to needs-you', () => {
  const s = freshHudState();
  applyLine(
    s,
    j({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'q1',
            name: 'AskUserQuestion',
            input: { questions: [{ question: 'Which database should we use?' }] },
          },
        ],
      },
    }),
  );
  assert.equal(s.needsYou, true);
  assert.equal(s.asking, 'Which database should we use?');
  assert.equal(whatIsHappening(s).kind, 'ask');
});

test('hud reducer ignores noise: sidechains, bad JSON, hook stdout', () => {
  const s = freshHudState();
  applyLine(s, 'not json at all {{{');
  applyLine(s, j({ type: 'user', isSidechain: true, message: { content: 'agent chatter' } }));
  applyLine(s, j({ type: 'user', message: { content: '<local-command-stdout>noise</local-command-stdout>' } }));
  assert.equal(s.asking, '');
});

test('hud reducer: timeline retells the session and merges tool bursts', () => {
  const s = freshHudState();
  applyLine(s, j({ type: 'user', timestamp: '2026-07-16T10:00:00Z', message: { content: 'fix the login bug' } }));
  applyLine(
    s,
    j({
      type: 'assistant',
      timestamp: '2026-07-16T10:00:05Z',
      message: {
        id: 'm1',
        content: [
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/a.js' } },
          { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'src/b.js' } },
        ],
      },
    }),
  );
  applyLine(
    s,
    j({
      type: 'assistant',
      timestamp: '2026-07-16T10:00:09Z',
      message: { id: 'm1', content: [{ type: 'text', text: 'Found it. Fixing.' }] },
    }),
  );
  applyLine(s, j({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-07-16T10:01:00Z' }));

  assert.equal(s.timeline.length, 4);
  assert.deepEqual(
    s.timeline.map((t) => t.who),
    ['you', 'action', 'claude', 'note'],
  );
  assert.equal(s.timeline[1].count, 2, 'two Reads merged into one story line');
  assert.match(s.timeline[1].text, /Reading a file — src\/b\.js/);
  assert.match(s.timeline[3].text, /squeezed/);

  // streamed duplicate of the same assistant text does not double the story
  applyLine(
    s,
    j({
      type: 'assistant',
      timestamp: '2026-07-16T10:01:05Z',
      message: { id: 'm1', content: [{ type: 'text', text: 'Found it. Fixing.' }] },
    }),
  );
  assert.equal(s.timeline.length, 4);
});

test('cleanUserText: slash commands and reminders', () => {
  assert.equal(cleanUserText('<command-name>/compact</command-name> <command-message>x</command-message>'), '/compact');
  assert.equal(cleanUserText('<system-reminder>secret context</system-reminder>do the thing'), 'do the thing');
});

test('toolDetail picks the human-relevant field', () => {
  assert.equal(toolDetail('Bash', { command: 'npm test' }), 'npm test');
  assert.equal(toolDetail('Read', { file_path: 'src/a.js' }), 'src/a.js');
  assert.equal(toolDetail('Grep', { pattern: 'foo.*bar' }), 'foo.*bar');
  assert.equal(toolDetail('X', null), '');
});

test('toolInPlainEnglish translates jargon', () => {
  assert.match(toolInPlainEnglish('Bash', 'git status'), /Running a command — git status/);
  assert.match(toolInPlainEnglish('mcp__github__create_issue', ''), /connected app \(github\)/);
});

test('wrap: bounds lines and hard-slices long words', () => {
  const lines = wrap('short words then averyveryverylongunbrokenword end', 10, 3);
  assert.ok(lines.length <= 3);
  for (const l of lines) assert.ok(l.length <= 10);
});

test('buildCapsule: project brief + capped sessions + instructions', () => {
  const memory = `# PRAXIS Memory
<!-- managed -->

## Project
Node CLI. Ships as praxis-memory on npm.

## Session Log
<!-- newest first -->
### 2026-07-15 - session
- built the hud

### 2026-07-14 - session
- tray glow

### 2026-07-13 - session
- init flow

### 2026-07-12 - session
- ancient history
`;
  const out = buildCapsule(memory, { toolName: 'Gemini CLI', now: '2026-07-15T00:00:00Z' });
  assert.match(out, /continue this project in Gemini CLI/);
  assert.match(out, /Node CLI\. Ships as praxis-memory/);
  assert.match(out, /built the hud/);
  assert.doesNotMatch(out, /ancient history/, 'only the newest 3 sessions ship');
  assert.doesNotMatch(out, /<!--/, 'html comments stripped');
  assert.match(out, /do not start over/);
});

test('buildCapsule survives an empty or fresh memory file', () => {
  const out = buildCapsule('', { toolName: 'Codex CLI' });
  assert.match(out, /No project brief saved yet/);
  assert.match(out, /No sessions logged yet/);
});
