/** Temporary EF-385 DEV-only categories. Remove through the normal release path.
 * No HTTP interface, raw text, identity, provider object, or error is accepted.
 */
import {
  constants, closeSync, fstatSync, ftruncateSync, lstatSync, openSync,
  readSync, unlinkSync, writeFileSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { DEV_EPHEMERAL_REQUEST_MODE } from '../devEphemeralChat';

export const EF385_ARM_PATH = '/var/log/emotionflow/ef385-deep-result.arm';
export const EF385_RESULT_PATH = '/var/log/emotionflow/ef385-deep-result.json';
export const EF385_HARD_STOP = Date.parse('2026-11-10T00:00:00Z');
export const EF385_WINDOW_MS = 5 * 60 * 1000;
const MAX_BYTES = 4096;
const TEXT_CLASSES = ['empty', 'exact_ack', 'other'] as const;
const VALIDATIONS = [
  'not_called', 'passthrough_later_turn', 'accepted_plain', 'accepted_ef41_sentence',
  'accepted_ef41_default', 'raw_fact_fallback', 'empty_candidate_fallback',
  'budget_fallback', 'post_selection_fact_fallback', 'question_fallback',
] as const;
export interface Ef385Result {
  contentClass: typeof TEXT_CLASSES[number];
  cleanedClass: typeof TEXT_CLASSES[number];
  selection: 'none' | 'cleaned' | 'last_resort' | 'reasoning';
  candidateClass: 'not_selected' | 'exact_ack' | 'other';
  validation: typeof VALIDATIONS[number];
  finalClass: typeof TEXT_CLASSES[number];
}
interface Receipt {
  deploymentSha: string;
  armedAt: string;
  expiresAt: string;
  observedAt: string | null;
  windowState: 'pending' | 'captured' | 'incomplete' | 'ambiguous';
  result: Ef385Result | null;
}

// Reject accessors and unknown keys before copying, rather than serializing input.
function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length
    && keys.every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'));
}
function member<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.includes(value as T);
}
export function projectEf385Result(value: unknown): Ef385Result | null {
  if (!fields(value, ['contentClass', 'cleanedClass', 'selection', 'candidateClass', 'validation', 'finalClass'])) return null;
  if (!member(value.contentClass, TEXT_CLASSES) || !member(value.cleanedClass, TEXT_CLASSES)
    || !member(value.selection, ['none', 'cleaned', 'last_resort', 'reasoning'])
    || !member(value.candidateClass, ['not_selected', 'exact_ack', 'other'])
    || !member(value.validation, VALIDATIONS) || !member(value.finalClass, TEXT_CLASSES)) return null;
  if ((value.selection === 'none') !== (value.candidateClass === 'not_selected')
    || (value.selection === 'none') !== (value.validation === 'not_called')) return null;
  return { contentClass: value.contentClass, cleanedClass: value.cleanedClass,
    selection: value.selection, candidateClass: value.candidateClass,
    validation: value.validation, finalClass: value.finalClass };
}
function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}
function iso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}
function projectReceipt(value: unknown, expectedSha: string, now: number): Receipt | null {
  if (!fields(value, ['deploymentSha', 'armedAt', 'expiresAt', 'observedAt', 'windowState', 'result'])
    || !sha(expectedSha) || value.deploymentSha !== expectedSha || !iso(value.armedAt) || !iso(value.expiresAt)
    || !member(value.windowState, ['pending', 'captured', 'incomplete', 'ambiguous'])) return null;
  const armed = Date.parse(value.armedAt), expires = Date.parse(value.expiresAt);
  if (armed > now || armed >= EF385_HARD_STOP || expires !== Math.min(armed + EF385_WINDOW_MS, EF385_HARD_STOP)
    || now >= expires) return null;
  const result = value.windowState === 'captured' ? projectEf385Result(value.result) : null;
  if (value.windowState === 'captured') {
    if (!result || !iso(value.observedAt) || Date.parse(value.observedAt) < armed
      || Date.parse(value.observedAt) > now || Date.parse(value.observedAt) >= expires) return null;
  } else if (value.result !== null || value.observedAt !== null) return null;
  return { deploymentSha: expectedSha, armedAt: value.armedAt, expiresAt: value.expiresAt,
    observedAt: value.observedAt as string | null, windowState: value.windowState, result };
}
function uid(): number {
  if (!process.getuid) throw new Error();
  return process.getuid();
}
function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
function safeParents(): void {
  const owner = uid();
  for (const path of ['/', '/var', '/var/log', '/var/log/emotionflow']) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== 0 && stat.uid !== owner)
      || (stat.mode & 0o022) !== 0) throw new Error();
    // This is an existing private directory. Never chmod/chown or create it.
    if (path === '/var/log/emotionflow' && stat.uid !== owner) throw new Error();
  }
}
function safeFile(stat: Stats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid()
    || (stat.mode & 0o7777) !== 0o600 || stat.nlink !== 1) throw new Error();
}
function statFile(path: string): Stats | null {
  safeParents();
  try { const stat = lstatSync(path); safeFile(stat); return stat; }
  catch (error) { if (missing(error)) return null; throw error; }
}
function sameFile(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function verifyOpen(path: string, fd: number): Stats {
  const stat = fstatSync(fd); safeFile(stat);
  const current = statFile(path);
  if (!current || !sameFile(stat, current)) throw new Error();
  return stat;
}
function openExisting(path: string, flags: number): number | null {
  const before = statFile(path);
  if (!before) return null;
  const fd = openSync(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!sameFile(before, verifyOpen(path, fd))) throw new Error();
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}
function removeFile(path: string): void {
  const fd = openExisting(path, constants.O_RDONLY);
  if (fd === null) return;
  try { verifyOpen(path, fd); unlinkSync(path); } finally { closeSync(fd); }
}
function clearFiles(): boolean {
  let ok = true;
  for (const path of [EF385_ARM_PATH, EF385_RESULT_PATH]) {
    try { removeFile(path); } catch { ok = false; }
  }
  return ok;
}
function readArm(): number | null {
  const fd = openExisting(EF385_ARM_PATH, constants.O_RDONLY);
  if (fd === null) return null;
  try {
    const stat = verifyOpen(EF385_ARM_PATH, fd);
    if (stat.size !== 0 || !Number.isFinite(stat.mtimeMs)) throw new Error();
    // ISO metadata has millisecond resolution; never round the window upward.
    return Math.floor(stat.mtimeMs);
  } finally { closeSync(fd); }
}
function readReceipt(expectedSha: string, now: number): Receipt | null {
  const fd = openExisting(EF385_RESULT_PATH, constants.O_RDONLY);
  if (fd === null) return null;
  try {
    const stat = verifyOpen(EF385_RESULT_PATH, fd);
    if (stat.size === 0 || stat.size > MAX_BYTES) return null;
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    if (count > MAX_BYTES || count !== stat.size || verifyOpen(EF385_RESULT_PATH, fd).size !== count) return null;
    return projectReceipt(JSON.parse(bytes.subarray(0, count).toString('utf8')), expectedSha, now);
  } finally { closeSync(fd); }
}
function writeReceipt(receipt: Receipt, create: boolean, opened?: (stat: Stats) => void, expected?: Stats): void {
  const checked = projectReceipt(receipt, receipt.deploymentSha, Date.now());
  if (!checked) throw new Error();
  const text = JSON.stringify(checked);
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error();
  safeParents();
  const fd = create
    ? openSync(EF385_RESULT_PATH, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    : openExisting(EF385_RESULT_PATH, constants.O_WRONLY);
  if (fd === null) throw new Error();
  try {
    const stat = verifyOpen(EF385_RESULT_PATH, fd);
    if (expected && !sameFile(expected, stat)) throw new Error();
    opened?.(stat);
    ftruncateSync(fd, 0);
    writeFileSync(fd, text, 'utf8');
    if (verifyOpen(EF385_RESULT_PATH, fd).size > MAX_BYTES) throw new Error();
  } finally { closeSync(fd); }
}
function enabled(expectedSha: unknown): expectedSha is string {
  return process.env.NODE_ENV === 'development' && sha(expectedSha) && Date.now() < EF385_HARD_STOP;
}

export interface Ef385Capture { complete(result: Ef385Result): void; finish(): void; }
/** One instance per backend process. Multiple processes are an operator stop condition. */
export function createEf385DevResultDiagnostic(): { begin(requestMode: unknown): Ef385Capture | undefined } {
  const deploymentSha = process.env.GIT_COMMIT;
  const noop = { begin: (_mode: unknown): undefined => undefined };
  if (process.env.NODE_ENV !== 'development') return noop;
  // Startup invalidates all prior windows, including stale stopped-process files.
  if (!clearFiles() || !enabled(deploymentSha)) return noop;
  let active = 0;
  interface Window {
    receipt: Receipt;
    selected: boolean;
    file?: Stats;
    expiryTimer?: ReturnType<typeof setTimeout>;
  }
  let state: Window | null = null;
  let disabled = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  function closeWindow(window: Window): void {
    if (state !== window) return;
    state = null;
    if (window.expiryTimer) clearTimeout(window.expiryTimer);
    // Never delete a newer explicit arm or a replacement receipt. Local inode
    // checks are filesystem safety, not serialized request/sample identifiers.
    const current = statFile(EF385_RESULT_PATH);
    if (window.file && current && sameFile(window.file, current)) removeFile(EF385_RESULT_PATH);
  }
  function stop(): void {
    disabled = true;
    if (poll) clearInterval(poll);
    try { if (state) closeWindow(state); } catch { /* Manual verification required. */ }
  }
  function save(): void {
    if (!state) return;
    const current = statFile(EF385_RESULT_PATH);
    if (!state.file || !current || !sameFile(state.file, current)) { closeWindow(state); return; }
    writeReceipt(state.receipt, false, undefined, state.file);
  }
  function ambiguous(): void {
    if (!state) return;
    state.receipt.windowState = 'ambiguous'; state.receipt.result = null; state.receipt.observedAt = null;
    save();
  }
  function sync(): void {
    if (disabled) return;
    if (Date.now() >= EF385_HARD_STOP) {
      // At the immutable hard stop no future window is valid.
      stop(); clearFiles(); return;
    }
    if (state) {
      const current = statFile(EF385_RESULT_PATH);
      if (!state.file || !current || !sameFile(state.file, current)
        || Date.now() >= Date.parse(state.receipt.expiresAt)) {
        closeWindow(state);
      } else {
        // Never extend a consumed live window, even if manually rearmed.
        if (statFile(EF385_ARM_PATH)) { ambiguous(); removeFile(EF385_ARM_PATH); }
        return;
      }
    }
    const armed = readArm();
    if (armed === null) return;
    const now = Date.now(), expires = Math.min(armed + EF385_WINDOW_MS, EF385_HARD_STOP);
    if (armed > now || now >= expires) { removeFile(EF385_ARM_PATH); return; }
    const window: Window = { selected: false, receipt: { deploymentSha: deploymentSha!,
      armedAt: new Date(armed).toISOString(), expiresAt: new Date(expires).toISOString(),
      observedAt: null, windowState: active > 0 ? 'ambiguous' : 'pending', result: null } };
    state = window;
    writeReceipt(window.receipt, true, stat => { window.file = stat; });
    removeFile(EF385_ARM_PATH);
    window.expiryTimer = setTimeout(() => {
      try { closeWindow(window); } catch { stop(); }
    }, Math.max(0, expires - Date.now()));
    window.expiryTimer.unref?.();
  }

  // Fixed-path polling also expires an arm with no model invocation. No files are
  // created while unarmed; no old audit or application data is inspected.
  poll = setInterval(() => { try { sync(); } catch { stop(); } }, 1000);
  poll.unref?.();
  return { begin(requestMode: unknown): Ef385Capture | undefined {
    if (disabled || requestMode !== DEV_EPHEMERAL_REQUEST_MODE) return undefined;
    try {
      sync(); if (disabled) return undefined;
      const window = state;
      if (window) {
        if (active > 0 || window.selected) ambiguous();
        else window.selected = true;
      }
      active++;
      let done = false, completed = false;
      return {
        complete(value: Ef385Result): void {
          if (done || completed || disabled) return;
          try {
            sync();
            if (!window || state !== window || window.receipt.windowState === 'ambiguous') return;
            const result = projectEf385Result(value);
            if (!result) { stop(); return; }
            completed = true;
            window.receipt = { ...window.receipt, observedAt: new Date(Date.now()).toISOString(), windowState: 'captured', result };
            save();
          } catch { stop(); }
        },
        finish(): void {
          if (done) return;
          done = true;
          try {
            // Arming while this invocation was in flight is never attributable.
            sync();
            if (!disabled && window && state === window && !completed && window.receipt.windowState !== 'ambiguous') {
              window.receipt.windowState = 'incomplete'; save();
            }
          } catch { stop(); }
          finally { active--; }
        },
      };
    } catch { stop(); return undefined; }
  } };
}

/** Fixed-path CLI implementation. Returns closed status only; no raw errors. */
export function runEf385DevResultOperator(args: readonly string[], print: (text: string) => void): boolean {
  const [operation, expectedSha, ...extra] = args;
  if (extra.length || !['arm', 'read-clear', 'clear'].includes(operation)) return false;
  if (operation === 'clear') return expectedSha === undefined && clearFiles();
  if (!sha(expectedSha)) return false;
  if (operation === 'read-clear') {
    let receipt: Receipt | null = null;
    let cleared = false;
    try {
      if (enabled(expectedSha)) receipt = readReceipt(expectedSha, Date.now());
    } catch { /* Invalid/unsafe input is never printed. */ }
    finally { cleared = clearFiles(); }
    if (!cleared || !receipt || Date.now() >= Date.parse(receipt.expiresAt)) return false;
    try { print(JSON.stringify(receipt)); return true; } catch { return false; }
  }
  try {
    if (!enabled(expectedSha)) {
      if (process.env.NODE_ENV === 'development' && Date.now() >= EF385_HARD_STOP) clearFiles();
      return false;
    }
    // These files are the only arming state; refuse any live or malformed receipt
    // rather than renewing its deadline. Explicit clear is a separate operation.
    if (statFile(EF385_RESULT_PATH)) {
      // A receipt requires explicit read-clear/clear before another manual arm.
      return false;
    }
    const previous = readArm();
    if (previous !== null) {
      if (previous > Date.now() || Date.now() < Math.min(previous + EF385_WINDOW_MS, EF385_HARD_STOP)) return false;
      removeFile(EF385_ARM_PATH);
    }
    safeParents();
    const fd = openSync(EF385_ARM_PATH, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { verifyOpen(EF385_ARM_PATH, fd); } finally { closeSync(fd); }
    return true;
  } catch { return false; }
}
