import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { patchAgentsMd } from '../src/lib/agentsmd.js';
import { agentsMdHasBlock, removeAgentsMdBlock } from '../src/lib/uninstall.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-agentsmd-'));

test('patchAgentsMd creates the managed block in AGENTS.md', () => {
  const dir = tmp();
  const file = path.join(dir, 'AGENTS.md');
  const r = patchAgentsMd(file);
  assert.equal(r.existed, false);
  const content = fs.readFileSync(file, 'utf8');
  assert.match(content, /# Project Memory/);
  assert.match(content, /<!-- PRAXIS:START/);
  assert.match(content, /@\.praxis\/memory\.md/);
  assert.match(content, /<!-- PRAXIS:END/);
  assert.ok(agentsMdHasBlock(file));
});

test('patchAgentsMd preserves user content and is idempotent', () => {
  const dir = tmp();
  const file = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(file, '# User Agent Instructions\n\nAlways run tests before committing.\n');
  const r1 = patchAgentsMd(file);
  assert.equal(r1.existed, true);
  const r2 = patchAgentsMd(file);
  assert.equal(r2.existed, true);

  const content = fs.readFileSync(file, 'utf8');
  assert.match(content, /User Agent Instructions/);
  assert.match(content, /Always run tests before committing/);
  // Ensure block appears once
  const matches = content.match(/<!-- PRAXIS:START/g) || [];
  assert.equal(matches.length, 1);
});

test('removeAgentsMdBlock: deletes boilerplate-only AGENTS.md but preserves custom instructions', () => {
  const dir = tmp();
  const boilerplate = path.join(dir, 'boilerplate-AGENTS.md');
  patchAgentsMd(boilerplate);
  const r1 = removeAgentsMdBlock(boilerplate);
  assert.equal(r1.deleted, true);
  assert.equal(fs.existsSync(boilerplate), false);

  const custom = path.join(dir, 'custom-AGENTS.md');
  fs.writeFileSync(custom, '# Project Guidelines\n\nCode conventions here.\n');
  patchAgentsMd(custom);
  assert.ok(agentsMdHasBlock(custom));

  const r2 = removeAgentsMdBlock(custom);
  assert.equal(r2.deleted, false);
  assert.equal(r2.changed, true);
  const left = fs.readFileSync(custom, 'utf8');
  assert.match(left, /Project Guidelines/);
  assert.match(left, /Code conventions here/);
  assert.doesNotMatch(left, /PRAXIS/);
  assert.doesNotMatch(left, /@\.praxis\/memory\.md/);
});
