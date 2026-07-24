import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { patchMcpConfig } from '../src/lib/mcp/config.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-mcpcfg-'));
  return path.join(dir, '.mcp.json');
}

test('registers the praxis MCP server through npx', () => {
  const f = tmpFile();
  const res = patchMcpConfig(f);
  assert.equal(res.already, false);
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(cfg.mcpServers.praxis.command, 'npx');
  assert.deepEqual(cfg.mcpServers.praxis.args, ['-y', 'praxis-memory', 'mcp']);
});

test('is idempotent — a second call is a no-op', () => {
  const f = tmpFile();
  patchMcpConfig(f);
  const res = patchMcpConfig(f);
  assert.equal(res.already, true);
});

test('preserves any server already registered', () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }));
  patchMcpConfig(f);
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(cfg.mcpServers.other, 'kept the pre-existing server');
  assert.ok(cfg.mcpServers.praxis, 'added praxis alongside');
});

test('survives a corrupt .mcp.json by rewriting it clean', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{ this is not json');
  const res = patchMcpConfig(f);
  assert.equal(res.already, false);
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(cfg.mcpServers.praxis);
});
