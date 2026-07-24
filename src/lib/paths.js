import path from 'node:path';

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
