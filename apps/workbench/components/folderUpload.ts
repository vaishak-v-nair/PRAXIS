const excluded = new Set([".git", ".hg", ".svn", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", "target", ".next", ".cache", "coverage", ".regen", ".regen-runtime", ".praxis", ".gstack", ".obsidian"]);
const praxisPrivate = new Set([".agents", ".claude", "assets"]);
export interface FolderPayload { files: Array<{ path: string; content: string }>; skipped: number }
export interface UploadedFolder { source: string; name: string; accepted_files: number; skipped_files: number }

export async function prepareFolder(list: FileList): Promise<FolderPayload> {
  const files = Array.from(list);
  const manifest = files.find(file => file.webkitRelativePath.split("/").length === 2 && file.name === "package.json");
  let praxis = false;
  if (manifest && manifest.size <= 2 * 1024 * 1024) {
    try { praxis = JSON.parse(await manifest.text()).name === "praxis-memory"; } catch { /* Ordinary project without a readable manifest. */ }
  }
  const selected = files.filter(file => {
    const parts = file.webkitRelativePath.split("/");
    return parts.length >= 2 && !parts.slice(1).some(part => excluded.has(part.toLowerCase()) || part.toLowerCase().startsWith(".venv") || part.toLowerCase().endsWith("intelligence"))
      && !(praxis && praxisPrivate.has(parts[1]))
      && !(file.name.toLowerCase().startsWith(".env") && !/^\.env\..*?(example|sample|template|dist)$/i.test(file.name))
      && !/\.(pem|key|p12|pfx)$/i.test(file.name);
  });
  if (!selected.length) throw new Error("No project files remain after excluding credentials and generated files.");
  if (selected.length > 10000 || selected.some(file => file.size > 2 * 1024 * 1024) || selected.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) {
    throw new Error("Upload limits: 10,000 files, 2 MiB per file, 20 MiB total. Exclude large data files or use a local folder path.");
  }
  const payload: FolderPayload = { files: [], skipped: files.length - selected.length };
  for (const file of selected) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    payload.files.push({ path: file.webkitRelativePath, content: btoa(chunks.join("")) });
  }
  return payload;
}
