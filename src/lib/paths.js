import os from 'node:os';
import path from 'node:path';

/**
 * Where the demo keeps its receipts.
 *
 * Deliberately NOT inside the project: receipts are cwd-rooted, the demo works
 * in a throwaway directory, and its own cleanup would delete the one artifact
 * the stranger is supposed to keep. This home is stable, outside any repo, and
 * survives everything the demo tears down.
 */
export function demoPaths(home = os.homedir()) {
  const root = path.join(home, '.praxis', 'demo');
  return { root, receiptsDir: path.join(root, 'receipts') };
}

/**
 * Resolve every path PRAXIS touches, relative to a project root.
 * @param {string} [cwd] project root (defaults to process.cwd()).
 */
export function projectPaths(cwd = process.cwd()) {
  return {
    root: cwd,
    praxisDir: path.join(cwd, '.praxis'),
    memoryFile: path.join(cwd, '.praxis', 'memory.md'),
    configFile: path.join(cwd, '.praxis', 'config.json'),
    receiptsDir: path.join(cwd, '.praxis', 'receipts'),
    mcpFile: path.join(cwd, '.mcp.json'),
    claudeDir: path.join(cwd, '.claude'),
    settingsFile: path.join(cwd, '.claude', 'settings.json'),
    commandsDir: path.join(cwd, '.claude', 'commands'),
    claudeMd: path.join(cwd, 'CLAUDE.md'),
  };
}
