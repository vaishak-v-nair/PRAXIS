const status = document.getElementById('status');
const retry = document.getElementById('retry');
async function refresh() {
  try {
    const result = await window.__TAURI_INTERNALS__.invoke('startup_status');
    if (result.error) { status.textContent = result.error; retry.hidden = false; }
    else { status.textContent = result.message || 'Opening your local project workspace…'; retry.hidden = true; }
  } catch { status.textContent = 'The desktop service is unavailable. Reopen PRAXIS or check its local service log.'; }
}
retry.addEventListener('click', async () => {
  retry.disabled = true;
  try { await window.__TAURI_INTERNALS__.invoke('retry_startup'); await refresh(); }
  catch { status.textContent = 'The local service could not restart. Check the service log or reopen PRAXIS.'; }
  finally { retry.disabled = false; }
});
refresh(); setInterval(refresh, 1000);
