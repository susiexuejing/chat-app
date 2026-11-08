// In-memory fixed-path filesystem only. No host diagnostics, network, or secrets.
import { constants } from 'node:fs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';
export const SHA = 'b'.repeat(40);
export const ARM = '/var/log/emotionflow/ef385-deep-result.arm';
export const RESULT = '/var/log/emotionflow/ef385-deep-result.json';
export const MODE = 'dev-ephemeral-v1';
export const RESULT_VALUE = Object.freeze({ contentClass: 'other', cleanedClass: 'other', selection: 'cleaned',
  candidateClass: 'other', validation: 'accepted_plain', finalClass: 'other' });
const clone = value => JSON.parse(JSON.stringify(value));
export async function diagnosticHarness(options = {}) {
  let now = options.now ?? Date.parse('2026-11-08T16:00:00Z'), inode = 0, nextFd = 0, timerId = 0;
  const files = new Map(), descriptors = new Map(), timers = new Map(), fsCalls = [], stdout = [], errors = [];
  const process = { env: { NODE_ENV: 'development', GIT_COMMIT: SHA, ...options.env }, getuid: () => 1000 };
  function put(path, data = '', extra = {}) {
    const entry = { kind: 'file', mode: 0o600, uid: 1000, nlink: 1, dev: 1, ino: ++inode,
      mtimeMs: now, bytes: Buffer.from(data), ...extra };
    files.set(path, entry); return entry;
  }
  for (const path of ['/', '/var', '/var/log', '/var/log/emotionflow']) {
    put(path, '', { kind: 'directory', mode: path.endsWith('emotionflow') ? 0o700 : 0o755, uid: path.endsWith('emotionflow') ? 1000 : 0 });
  }
  function stat(entry) { return { ...entry, size: entry.bytes.length,
    isDirectory: () => entry.kind === 'directory', isFile: () => entry.kind === 'file', isSymbolicLink: () => entry.kind === 'symlink' }; }
  function fail(code = 'EACCES') { throw Object.assign(new Error('PRIVATE-ERROR-TEXT requestId=SECRET'), { code }); }
  function pathEntry(path) { return files.get(path) ?? fail('ENOENT'); }
  function fdEntry(fd) { return descriptors.get(fd) ?? fail('EBADF'); }
  const operations = {
    lstatSync(path) { return stat(pathEntry(path)); },
    fstatSync(fd) { return stat(fdEntry(fd)); },
    openSync(path, flags, mode) {
      let entry = files.get(path);
      if (flags & constants.O_CREAT) {
        if (entry && flags & constants.O_EXCL) fail('EEXIST');
        if (!entry) entry = put(path, '', { mode });
      }
      if (!entry) fail('ENOENT');
      if (entry.kind === 'symlink' && flags & constants.O_NOFOLLOW) fail('ELOOP');
      descriptors.set(++nextFd, entry); return nextFd;
    },
    closeSync(fd) { if (!descriptors.delete(fd)) fail('EBADF'); },
    unlinkSync(path) { pathEntry(path); files.delete(path); },
    ftruncateSync(fd, length) { fdEntry(fd).bytes = Buffer.alloc(length); },
    writeFileSync(fd, data) { fdEntry(fd).bytes = Buffer.from(data); },
    readSync(fd, buffer, offset, length, position) {
      const bytes = fdEntry(fd).bytes.subarray(position, position + length);
      bytes.copy(buffer, offset); return bytes.length;
    },
  };
  const fs = { constants };
  const inject = { failure: undefined, before: undefined, after: undefined };
  for (const [name, fn] of Object.entries(operations)) fs[name] = (...args) => {
    fsCalls.push({ name, args });
    inject.before?.(name, args);
    if (inject.failure === name) fail();
    const result = fn(...args); inject.after?.(name, args, result); return result;
  };
  function timer(fn, delay, repeat) {
    const id = { id: ++timerId, unref() {} }; timers.set(id, { fn, delay, repeat, due: now + delay }); return id;
  }
  function tick(ms) {
    const target = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, t] = next; now = t.due;
      if (t.repeat) t.due += t.delay; else timers.delete(id);
      t.fn();
    }
    now = target;
  }
  const api = await loadTsModule(new URL('../observability/ef385DevResultDiagnostic.ts', import.meta.url), {
    'node:fs': fs, '../devEphemeralChat': { DEV_EPHEMERAL_REQUEST_MODE: MODE },
  }, { Buffer, process, Date: class extends Date { static now() { return now; } },
    setInterval: (fn, delay) => timer(fn, delay, true), clearInterval: id => timers.delete(id),
    setTimeout: (fn, delay) => timer(fn, delay, false), clearTimeout: id => timers.delete(id),
    console: Object.fromEntries(['log', 'warn', 'error'].map(name => [name, (...args) => errors.push([name, args])])),
  });
  const operate = (args, print = text => stdout.push(text)) => api.runEf385DevResultOperator(args, print);
  return { api, files, fsCalls, stdout, errors, process, inject, timers, descriptors, put, tick, now: () => now,
    jump: ms => { now += ms; }, operate, arm: () => operate(['arm', SHA]), clear: () => operate(['clear']),
    read: () => operate(['read-clear', SHA]), receipt: () => files.has(RESULT) ? JSON.parse(files.get(RESULT).bytes.toString()) : null,
    capture: result => clone(result ?? RESULT_VALUE) };
}
