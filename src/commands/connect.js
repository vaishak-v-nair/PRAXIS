import { autoConnect, discoverAgents } from '../lib/agent-connect.js';
export function connect(argv = []) {
  const result = argv.includes('--check') ? { agents: discoverAgents() } : autoConnect();
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    for (const agent of result.agents) console.log(`${agent.name}: ${agent.installed ? 'installed' : 'not found'}`);
    for (const link of result.links || []) console.log(`${link.name}: ${link.state}${link.file ? ` (${link.file})` : ''}`);
    if (result.note) console.log(result.note);
  }
}
