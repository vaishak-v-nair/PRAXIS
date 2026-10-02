// Do not advertise an unpublished command as a working consumer install.
export async function releaseAvailability(version, { fetchImpl = fetch } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release metadata.');
  const response = await fetchImpl(`https://registry.npmjs.org/praxis-memory/${version}`, { signal: AbortSignal.timeout(6000) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error('The npm registry could not be reached.');
  const metadata = await response.json();
  if (metadata.name !== 'praxis-memory' || metadata.version !== version || metadata.bin?.['praxis-memory'] !== 'src/cli.js') throw new Error('The npm release metadata does not match this launcher.');
  return true;
}

async function initialize() {
  const command = document.querySelector('#install-command'), button = document.querySelector('#copy-install');
  const status = document.querySelector('#install-status'), badge = document.querySelector('#release-badge');
  if (!command || !button || !status || !badge) return;
  try {
    const response = await fetch(new URL('./release.json', import.meta.url), { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error('Release information is unavailable.');
    const release = await response.json();
    if (release.schema !== 'praxis.review-install.v1') throw new Error('Release information is unavailable.');
    const available = await releaseAvailability(release.version);
    if (!available) {
      command.value = 'node src/cli.js review';
      badge.textContent = `${release.version} · awaiting release`;
      status.textContent = 'The new launcher is ready in source but has not been published to npm. Use the checkout command below for now; the public install command appears here after publication.';
      return;
    }
    command.value = `npx praxis-memory@${release.version} review`;
    badge.textContent = `${release.version} · available`;
    status.textContent = 'Run this command once to prepare and open Project Review. Run it again to reuse your installation.';
    button.disabled = false;
  } catch {
    command.value = 'node src/cli.js review';
    badge.textContent = 'Release check unavailable';
    status.textContent = 'Public release availability could not be confirmed. Use the source checkout instructions below, or reload this page to retry.';
  }
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(command.value); status.textContent = 'Command copied. Paste it into Terminal or PowerShell and press Enter.'; }
    catch { command.focus(); command.select(); status.textContent = 'Clipboard access is unavailable. The command is selected; copy it manually.'; }
  });
}

if (typeof document !== 'undefined') initialize();
