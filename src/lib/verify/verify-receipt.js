import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stableStringify } from '../receipt/store.js';

export const VERIFY_RECEIPT_SCHEMA = 'praxis.verify.receipt/v1';

function ensureKeyPair(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const privateFile = path.join(dir, 'ed25519-private.pem');
  const publicFile = path.join(dir, 'ed25519-public.pem');
  if (!fs.existsSync(privateFile) || !fs.existsSync(publicFile)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(publicFile, publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx', mode: 0o644 });
  }
  return { privateKey: fs.readFileSync(privateFile), publicKey: fs.readFileSync(publicFile, 'utf8') };
}

export function signVerifyReceipt(payload, keyDir) {
  const { privateKey, publicKey } = ensureKeyPair(keyDir);
  const body = { schema: VERIFY_RECEIPT_SCHEMA, ...payload, publicKey };
  const signature = crypto.sign(null, Buffer.from(stableStringify(body)), privateKey).toString('base64');
  return Object.freeze({ ...body, signature: Object.freeze({ algorithm: 'Ed25519', value: signature }) });
}

export function verifyVerifyReceipt(receipt) {
  if (receipt?.schema !== VERIFY_RECEIPT_SCHEMA || receipt?.signature?.algorithm !== 'Ed25519') return false;
  const { signature, ...body } = receipt;
  try { return crypto.verify(null, Buffer.from(stableStringify(body)), body.publicKey, Buffer.from(signature.value, 'base64')); }
  catch { return false; }
}
