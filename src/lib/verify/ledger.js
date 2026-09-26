import crypto from 'node:crypto';
import { stableStringify } from '../receipt/store.js';
import { deepFreeze } from './schema.js';

export function createLedger(target) {
  const entries = [];
  return {
    append(observation) {
      const previous = entries.length ? entries.at(-1).hash : null;
      const payload = deepFreeze(structuredClone({ schema: 'praxis.verify.observation/v1', ...observation, previous }));
      const hash = crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
      entries.push(deepFreeze({ ...payload, hash }));
      return entries.at(-1);
    },
    entries() { return Object.freeze([...entries]); },
    digest() { return crypto.createHash('sha256').update(stableStringify({ target, entries })).digest('hex'); },
  };
}
