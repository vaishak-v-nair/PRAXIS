export const RECEIPT_SCHEMA = 'praxis.verify.receipt/v1';
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function base64ToBytes(value) {
  const binary = atob(String(value || '').replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function receiptToFragment(receipt) {
  const bytes = new TextEncoder().encode(JSON.stringify(receipt));
  if (bytes.length > MAX_RECEIPT_BYTES) throw new Error('Receipt exceeds the 2 MiB explorer limit.');
  return `receipt=${bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export function receiptFromFragment(fragment) {
  const params = new URLSearchParams(String(fragment || '').replace(/^#/, ''));
  const encoded = params.get('receipt'); if (!encoded) return null;
  const bytes = base64ToBytes(encoded);
  if (bytes.length > MAX_RECEIPT_BYTES) throw new Error('Receipt exceeds the 2 MiB explorer limit.');
  return JSON.parse(new TextDecoder().decode(bytes));
}

function pemDer(pem) {
  const body = String(pem || '').replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  if (!body) throw new Error('Receipt has no public key.');
  return base64ToBytes(body);
}

export async function verifyPublicReceipt(receipt, cryptoImpl = globalThis.crypto) {
  if (receipt?.schema !== RECEIPT_SCHEMA) return { ok: false, reason: 'unsupported-schema' };
  if (receipt?.signature?.algorithm !== 'Ed25519' || !receipt.signature.value) return { ok: false, reason: 'missing-ed25519-signature' };
  if (!cryptoImpl?.subtle) return { ok: false, reason: 'webcrypto-unavailable' };
  try {
    const { signature, ...body } = receipt;
    const key = await cryptoImpl.subtle.importKey('spki', pemDer(body.publicKey), { name: 'Ed25519' }, false, ['verify']);
    const ok = await cryptoImpl.subtle.verify({ name: 'Ed25519' }, key, base64ToBytes(signature.value), new TextEncoder().encode(canonicalJson(body)));
    return { ok, reason: ok ? null : 'signature-invalid' };
  } catch { return { ok: false, reason: 'signature-error' }; }
}
