import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installPraxisSkills, repairPraxisHookFile, skillSource } from '../src/lib/skills.js';

test('slash templates become named portable Agent Skills', () => {
  const source = '---\ndescription: Show project status\n---\n\nRead memory.\n';
  const result = skillSource('praxis-status.md', source);
  assert.match(result, /^---\nname: praxis-status\ndescription:/);
  assert.match(result, /PRAXIS:GENERATED-SKILL/);
});

test('skill install is idempotent and preserves user-authored collisions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-skills-'));
  const templates = path.join(root, 'templates');
  const skills = path.join(root, 'skills');
  fs.mkdirSync(templates);
  fs.writeFileSync(path.join(templates, 'praxis-status.md'), '---\ndescription: Status\n---\n\nDo status.\n');
  fs.mkdirSync(path.join(skills, 'praxis-save'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'praxis-save', 'SKILL.md'), 'user authored');
  fs.writeFileSync(path.join(templates, 'praxis-save.md'), '---\ndescription: Save\n---\n\nDo save.\n');
  const first = installPraxisSkills(templates, skills);
  const second = installPraxisSkills(templates, skills);
  assert.equal(first.find(item => item.name === 'praxis-status').state, 'installed');
  assert.equal(first.find(item => item.name === 'praxis-save').state, 'preserved');
  assert.equal(second.find(item => item.name === 'praxis-status').state, 'existing');
  assert.equal(fs.readFileSync(path.join(skills, 'praxis-save', 'SKILL.md'), 'utf8'), 'user authored');
  fs.rmSync(root, { recursive: true, force: true });
});

test('legacy personal hooks use the dependency-free npx entrypoint without touching other hooks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-hooks-'));
  const file = path.join(root, 'hooks.json');
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [
    { type: 'command', command: 'cmd /d /c "praxis capture & exit /b 0"' },
    { type: 'command', command: 'other-tool stop' },
  ] }] } }));
  const result = repairPraxisHookFile(file);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(result.repaired, 1);
  assert.match(value.hooks.Stop[0].hooks[0].command, /npx -y praxis-memory capture/);
  assert.equal(value.hooks.Stop[0].hooks[1].command, 'other-tool stop');
  assert.equal(repairPraxisHookFile(file).repaired, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
