import { TASK_SCHEMA, VerifyInputError, deepFreeze, stableId, stripControls } from './schema.js';

export function captureTask(input, source = { kind: 'manual' }) {
  const description = stripControls(input).replace(/\s+/g, ' ').trim();
  if (!description) throw new VerifyInputError('task-required', 'Provide a task with --task <text> or --task-file <file>.');
  if (Buffer.byteLength(description) > 32 * 1024) throw new VerifyInputError('task-too-large', 'Task description exceeds 32 KiB.');
  return deepFreeze({ schema: TASK_SCHEMA, id: stableId(description, 't'), description, source: { ...source } });
}
