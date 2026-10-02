// Only trusted, hash-checked PRAXIS modules enter runPython. Project files are data.
const runtimeURL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
function progress(message) { self.postMessage({ type: 'progress', message }); }
async function checkedText(file, sha) {
  const response = await fetch(new URL('engine/' + file, import.meta.url), { cache: 'no-cache' });
  if (!response.ok) throw new Error('Analysis engine could not be loaded. Refresh and retry.');
  const bytes = await response.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== sha) throw new Error('Analysis engine version mismatch. Refresh before reviewing.');
  return new Uint8Array(bytes);
}
self.onmessage = async ({ data }) => {
  try {
    progress('Loading the private analysis runtime…');
    const response = await fetch(new URL('engine/manifest.json', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error('Analysis engine unavailable. Refresh or use local PRAXIS.');
    const manifest = await response.json();
    if (manifest.schema !== 'praxis.browser-engine.v1' || manifest.runtime !== '314.0.7') throw new Error('Unsupported analysis engine version.');
    const { loadPyodide } = await import(runtimeURL + 'pyodide.mjs');
    const py = await loadPyodide({ indexURL: runtimeURL });
    py.FS.mkdirTree('/engine/regen'); py.FS.writeFile('/engine/regen/__init__.py', '');
    for (const name of ['scanner.py', 'reality.py', 'browser.py']) py.FS.writeFile('/engine/regen/' + name, await checkedText(name, manifest.files[name]));
    py.runPython("import sys, json\nsys.path.insert(0, '/engine')\nfrom regen.browser import select_files, review_project\nfrom pathlib import Path");
    const files = data.files;
    const metadata = files.map(file => ({ path: file.webkitRelativePath || file.name, size: file.size }));
    // The root package manifest is parsed only to protect PRAXIS's brand vault.
    const manifestFile = files.find(file => {
      const parts = (file.webkitRelativePath || file.name).split('/');
      return (parts.length === 1 || parts.length === 2) && parts.at(-1) === 'package.json' && file.size <= 2097152;
    });
    let praxis = false;
    if (manifestFile) { try { praxis = JSON.parse(await manifestFile.text()).name === 'praxis-memory'; } catch {} }
    py.globals.set('_browser_metadata', JSON.stringify(metadata)); py.globals.set('_browser_praxis', praxis);
    const selection = JSON.parse(py.runPython('json.dumps(select_files(json.loads(_browser_metadata), praxis_checkout=_browser_praxis))'));
    py.FS.mkdir('/project');
    for (let index = 0; index < selection.accepted.length; index++) {
      const item = selection.accepted[index], destination = '/project/' + item.path;
      py.FS.mkdirTree(destination.slice(0, destination.lastIndexOf('/')));
      py.FS.writeFile(destination, new Uint8Array(await files[item.index].arrayBuffer()));
      if (index % 25 === 0 || index === selection.accepted.length - 1) progress(`Reading ${index + 1} of ${selection.accepted.length} selected files privately…`);
    }
    progress('Checking source, syntax, and behavioral patterns…');
    py.globals.set('_browser_selection', JSON.stringify(selection)); py.globals.set('_browser_goal', String(data.goal || ''));
    const result = JSON.parse(py.runPython('json.dumps(review_project(Path("/project"), json.loads(_browser_selection), _browser_goal))'));
    result.engine = { version: manifest.version, hashes: manifest.files, runtime: manifest.runtime };
    self.postMessage({ type: 'complete', result });
  } catch (error) {
    const match = String(error.message || error).match(/ValueError: ([^\n]+)/);
    self.postMessage({ type: 'error', message: match?.[1] || (error.name === 'PythonError' ? 'Source inspection could not finish. No result was produced. Retry or use local PRAXIS.' : String(error.message || 'Analysis runtime unavailable.')) });
  }
};
