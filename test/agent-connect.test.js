import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverAgents, connectAgents } from '../src/lib/agent-connect.js';

test('discovery probes configured executables without launching agents', () => {
  const agents = discoverAgents(bin => bin === 'codex' || bin === 'other-cli', {
    PRAXIS_AGENT_ADAPTERS: JSON.stringify({ other: { plan: ['other-cli', '--read-only'] } }),
  });
  assert.deepEqual(agents.filter(a => a.installed).map(a => a.name), ['codex', 'other']);
});

test('links are idempotent, preserve existing servers and malformed configs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-links-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.gemini'));
  fs.writeFileSync(path.join(root, '.gemini/settings.json'), '{invalid');
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'keep' }, praxis: { disabled: true } } }));
  const agents = ['claude', 'codex', 'gemini', 'opencode', 'cursor'].map(name => ({ name, installed: true }));
  const first = connectAgents(root, agents);
  assert.equal(first.find(a => a.name === 'gemini').state, 'needs-attention');
  assert.equal(fs.readFileSync(path.join(root, '.gemini/settings.json'), 'utf8'), '{invalid');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'))).mcpServers.praxis.disabled, true);
  assert.equal(first.find(a => a.name === 'codex').state, 'instructions-linked');
  assert.equal(first.find(a => a.name === 'cursor').state, 'instructions-linked');
  assert.equal(fs.existsSync(path.join(root, '.codex/config.toml')), false);
  assert.equal(fs.existsSync(path.join(root, '.cursor/mcp.json')), false);
  connectAgents(root, agents);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'))).mcp.praxis.type, 'local');
});
