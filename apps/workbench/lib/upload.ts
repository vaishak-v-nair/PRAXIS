import { request } from "./client";

const excluded = new Set([".git", ".hg", ".svn", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", "target", ".next", ".cache", "coverage", ".regen", ".regen-runtime", ".praxis", ".gstack", ".obsidian"]);
const praxisPrivate = new Set([".agents", ".claude", "assets"]);
const MAX_FILES = 25_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const BATCH_FILES = 250;
const BATCH_BYTES = 6 * 1024 * 1024;

export interface PreparedFolder { files: File[]; name: string; skipped: number; bytes: number }
export interface UploadedFolder { source: string; name: string; accepted_files: number; skipped_files: number; accepted_bytes?: number }
export interface UploadProgress { files: number; totalFiles: number; bytes: number; totalBytes: number }

function relative(file: File) { return file.webkitRelativePath.replaceAll("\\", "/"); }
function isCredential(name: string) { return name.toLowerCase().startsWith(".env") && !/^\.env\..*?(example|sample|template|dist)$/i.test(name); }

export async function prepareFolder(list: FileList): Promise<PreparedFolder> {
  const files = Array.from(list);
  const first = files.find(file => relative(file).includes("/"));
  if (!first) throw new Error("Choose one project folder, not individual files.");
  const name = relative(first).split("/")[0];
  const manifest = files.find(file => relative(file).split("/").length === 2 && file.name === "package.json");
  let praxis = false;
  if (manifest && manifest.size <= MAX_FILE_BYTES) {
    try { praxis = JSON.parse(await manifest.text()).name === "praxis-memory"; } catch { /* Ordinary project without a readable manifest. */ }
  }
  let skipped = 0;
  const selected = files.filter(file => {
    const parts = relative(file).split("/");
    const rejected = parts[0] !== name || parts.length < 2
      || parts.slice(1).some(part => excluded.has(part.toLowerCase()) || part.toLowerCase().startsWith(".venv") || part.toLowerCase().endsWith("intelligence"))
      || (praxis && praxisPrivate.has(parts[1])) || isCredential(file.name)
      || /\.(pem|key|p12|pfx)$/i.test(file.name) || file.size > MAX_FILE_BYTES;
    if (rejected) skipped += 1;
    return !rejected;
  });
  if (!selected.length) throw new Error("No reviewable project files remain after excluding credentials, dependencies, generated output, and files above 2 MiB.");
  const bytes = selected.reduce((sum, file) => sum + file.size, 0);
  if (selected.length > MAX_FILES) throw new Error(`This folder has ${selected.length.toLocaleString()} reviewable files. Browser upload supports ${MAX_FILES.toLocaleString()}; use a local folder path for larger repositories.`);
  if (bytes > MAX_TOTAL_BYTES) throw new Error(`Reviewable project files total ${(bytes / 1024 / 1024).toFixed(1)} MiB. Browser upload supports 100 MiB; use a local folder path for larger repositories.`);
  return { files: selected, name, skipped, bytes };
}

async function encoded(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return { path: relative(file), content: btoa(chunks.join("")) };
}

export async function uploadFolder(folder: PreparedFolder, progress: (value: UploadProgress) => void): Promise<UploadedFolder> {
  const session = await request<{ upload_id: string }>("/uploads/sessions", {
    name: folder.name, total_files: folder.files.length, total_bytes: folder.bytes, skipped_files: folder.skipped,
  });
  let sentFiles = 0, sentBytes = 0;
  try {
    for (let index = 0; index < folder.files.length;) {
      const batch: File[] = []; let size = 0;
      while (index < folder.files.length && batch.length < BATCH_FILES) {
        const file = folder.files[index];
        if (batch.length && size + file.size > BATCH_BYTES) break;
        batch.push(file); size += file.size; index += 1;
      }
      const files = [];
      for (const file of batch) files.push(await encoded(file));
      await request(`/uploads/sessions/${session.upload_id}/files`, { files });
      sentFiles += batch.length; sentBytes += size;
      progress({ files: sentFiles, totalFiles: folder.files.length, bytes: sentBytes, totalBytes: folder.bytes });
    }
    return await request<UploadedFolder>(`/uploads/sessions/${session.upload_id}/complete`, {});
  } catch (error) {
    await request(`/uploads/sessions/${session.upload_id}/cancel`, {}).catch(() => undefined);
    throw error;
  }
}
