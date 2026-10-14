// A build artifact is not a signed/public-tested release. Publication is a
// separate manual action after exact-artifact native acceptance on every OS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const requiredTargets = Object.freeze(['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64']);
const artifactHash = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

// JSON metadata is an acceptance record, never a signature verifier. In particular,
// signature.verified and notarization: 'passed' cannot authenticate any artifact.
// https://learn.microsoft.com/powershell/module/microsoft.powershell.security/get-authenticodesignature
export function verifyNativeSignature(filename, target) {
  if (target !== 'win32-x64' || process.platform !== 'win32') {
    throw new Error(`${target}: independent platform signature/notarization verification is unavailable on this host. Cross-platform release attestations are not implemented; public release remains closed.`);
  }
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.isAbsolute(systemRoot)) throw new Error(`${target}: trusted Windows signature verifier is unavailable.`);
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!fs.existsSync(powershell)) throw new Error(`${target}: trusted Windows signature verifier is unavailable.`);
  const script = `$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
$signature = Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:PRAXIS_RELEASE_ARTIFACT
[pscustomobject]@{
  status = $signature.Status.ToString()
  signatureType = $signature.SignatureType.ToString()
  thumbprint = $signature.SignerCertificate.Thumbprint
} | Microsoft.PowerShell.Utility\\ConvertTo-Json -Compress`;
  let observed;
  try {
    const output = execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 16_384, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // PowerShell 7's inherited module paths are incompatible with Windows
      // PowerShell 5.1. Only its fixed system modules may supply the verifier.
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath')), PSModulePath: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'), PRAXIS_RELEASE_ARTIFACT: filename }
    });
    observed = JSON.parse(output.replace(/^\uFEFF/, '').trim());
  } catch {
    throw new Error(`${target}: native Authenticode verification failed or was unavailable; declared signature metadata is insufficient.`);
  }
  if (observed.status !== 'Valid' || observed.signatureType !== 'Authenticode' || !/^[A-Fa-f0-9]{40}$/.test(observed.thumbprint || '')) {
    throw new Error(`${target}: native Authenticode signature is not valid (${observed.status || 'unknown'}). Public release remains closed.`);
  }
  return { verifier: 'Windows Authenticode', thumbprint: observed.thumbprint.toUpperCase() };
}

export function validateReleaseEvidence(evidence) {
  if (evidence?.schema !== 'praxis.desktop-release-evidence.v1' || !Array.isArray(evidence.targets)) throw new Error('Unrecognized desktop release evidence.');
  for (const target of requiredTargets) {
    const matches = evidence.targets.filter(item => item?.target === target);
    if (matches.length !== 1) throw new Error(`${target}: exactly one artifact acceptance record is required.`);
    const item = matches[0];
    if (typeof item.artifact !== 'string' || !path.isAbsolute(item.artifact) || !fs.existsSync(item.artifact) || item.nativeAcceptance !== 'passed' || item.cleanInstall !== 'passed') throw new Error(`${target}: exact-artifact clean installation and native acceptance have not passed.`);
    const stat = fs.lstatSync(item.artifact);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${target}: artifact must be a regular file, not a link.`);
    if (!/^[a-f0-9]{64}$/.test(item.sha256 || '') || artifactHash(item.artifact) !== item.sha256) throw new Error(`${target}: artifact hash does not match the acceptance record.`);
    verifyNativeSignature(item.artifact, target);
    if (artifactHash(item.artifact) !== item.sha256) throw new Error(`${target}: artifact changed during signature verification.`);
  }
  return true;
}

export function checkReleaseEvidenceFile(filename) {
  if (!fs.existsSync(filename)) throw new Error('Public desktop release is unavailable: exact signed-artifact native acceptance evidence has not been supplied. Dev builds remain usable.');
  if (fs.statSync(filename).size > 1024 * 1024) throw new Error('Desktop release evidence exceeds the bounded record size.');
  return validateReleaseEvidence(JSON.parse(fs.readFileSync(filename, 'utf8')));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkReleaseEvidenceFile(process.argv[2] || path.join(desktop, 'artifacts/release-evidence.json'));
    console.log('All advertised native targets have independently verified signatures and exact-artifact acceptance evidence. Publication remains a separate authorized action.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
