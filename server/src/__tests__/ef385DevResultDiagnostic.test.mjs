import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';
import { ARM, RESULT, SHA, MODE, RESULT_VALUE, diagnosticHarness } from './ef385DiagnosticHarness.mjs';
const project = value => JSON.parse(JSON.stringify(value));
const OLD = '/var/log/emotionflow/ef118-runtime-sanitized.jsonl';
async function armed(options) {
  const h = await diagnosticHarness(options), runtime = h.api.createEf385DevResultDiagnostic();
  assert.equal(h.arm(), true); return { h, runtime };
}
function pathsTouched(h) { return h.fsCalls.flatMap(call => typeof call.args[0] === 'string' ? [call.args[0]] : []); }
function assertClean(h) { assert.equal(h.files.has(ARM), false); assert.equal(h.files.has(RESULT), false); }

test('module evaluation has no I/O or server startup; development unarmed writes nothing', async () => {
  const h = await diagnosticHarness(); assert.deepEqual(h.fsCalls, []);
  const r = h.api.createEf385DevResultDiagnostic();
  const c = r.begin(MODE); c.complete(RESULT_VALUE); c.finish(); h.tick(2000);
  assertClean(h); assert.equal(h.fsCalls.some(x => ['writeFileSync', 'ftruncateSync'].includes(x.name)), false);
  assert.equal(h.descriptors.size, 0); assert.deepEqual(h.errors, []);
});
for (const NODE_ENV of ['production', 'test', '', undefined]) test(`non-DEV environment ${NODE_ENV} has zero filesystem calls`, async () => {
  const h = await diagnosticHarness({ env: { NODE_ENV } });
  assert.equal(h.api.createEf385DevResultDiagnostic().begin(MODE), undefined);
  h.tick(600000); assert.deepEqual(h.fsCalls, []); assert.equal(h.arm(), false); assertClean(h);
});
for (const mode of [undefined, null, '', 'ordinary', 'dev-ephemeral-v2', { requestMode: MODE }]) test(`ordinary/unknown mode cannot capture: ${JSON.stringify(mode)}`, async () => {
  const { h, runtime } = await armed(); const prior = h.fsCalls.length;
  assert.equal(runtime.begin(mode), undefined); assert.equal(h.fsCalls.length, prior);
  assert.equal(h.files.has(RESULT), false); assert.equal(h.files.has(ARM), true);
});
for (const GIT_COMMIT of [undefined, '', 'HEAD', 'b'.repeat(39), 'B'.repeat(40), 'b'.repeat(40) + '\n']) test(`missing/malformed runtime build SHA disables capture: ${GIT_COMMIT}`, async () => {
  const h = await diagnosticHarness({ env: { GIT_COMMIT } });
  assert.equal(h.api.createEf385DevResultDiagnostic().begin(MODE), undefined); assertClean(h);
});
test('one tuple is projected, bounded, 0600, read-cleared with exact expected deployment', async () => {
  const { h, runtime } = await armed(); const c = runtime.begin(MODE);
  assert.equal(h.receipt().windowState, 'pending');
  c.complete(RESULT_VALUE); c.finish();
  const receipt = h.receipt(); assert.deepEqual(receipt.result, RESULT_VALUE);
  assert.equal(receipt.deploymentSha, SHA); assert.equal(receipt.windowState, 'captured');
  assert.deepEqual(Object.keys(receipt), ['deploymentSha', 'armedAt', 'expiresAt', 'observedAt', 'windowState', 'result']);
  assert.equal(Date.parse(receipt.expiresAt) - Date.parse(receipt.armedAt), 300000);
  assert.equal(h.files.get(RESULT).mode, 0o600); assert.ok(h.files.get(RESULT).bytes.length <= 4096);
  assert.equal(h.read(), true); assert.deepEqual(JSON.parse(h.stdout[0]), receipt); assertClean(h);
  h.tick(1000); c.complete(RESULT_VALUE); assertClean(h); assert.equal(h.stdout.length, 1);
  assert.ok(pathsTouched(h).every(p => ['/', '/var', '/var/log', '/var/log/emotionflow', ARM, RESULT].includes(p)));
});
test('failure/cancellation without completed processing produces incomplete without tuple/error', async () => {
  const { h, runtime } = await armed(); const c = runtime.begin(MODE); c.finish(); c.finish();
  assert.equal(h.receipt().windowState, 'incomplete'); assert.equal(h.receipt().result, null); assert.equal(h.receipt().observedAt, null);
  assert.deepEqual(h.errors, []);
});
test('overlapping and sequential eligible invocations invalidate attribution without identity', async () => {
  for (const sequential of [false, true]) {
    const { h, runtime } = await armed(), first = runtime.begin(MODE);
    if (sequential) { first.complete(RESULT_VALUE); first.finish(); }
    const second = runtime.begin(MODE); second.complete(RESULT_VALUE); second.finish();
    first.complete(RESULT_VALUE); first.finish();
    assert.equal(h.receipt().windowState, 'ambiguous'); assert.equal(h.receipt().result, null); assert.equal(h.receipt().observedAt, null);
    assert.doesNotMatch(JSON.stringify(h.receipt()), /request|session|owner|marker|count|model|role/i);
  }
});
test('pre-arm in-flight request is ambiguous whether poll, complete or finish notices arm', async () => {
  for (const notice of ['poll', 'complete', 'finish', 'another']) {
    const h = await diagnosticHarness(), r = h.api.createEf385DevResultDiagnostic(), c = r.begin(MODE);
    assert.equal(h.arm(), true);
    if (notice === 'poll') h.tick(1000);
    if (notice === 'complete') c.complete(RESULT_VALUE);
    if (notice === 'another') { const next = r.begin(MODE); next.finish(); }
    c.finish();
    assert.equal(h.receipt().windowState, 'ambiguous', notice); assert.equal(h.receipt().result, null);
  }
});
test('duplicate complete is idempotent and cannot change the one record', async () => {
  const { h, runtime } = await armed(), c = runtime.begin(MODE); c.complete(RESULT_VALUE);
  const before = h.files.get(RESULT).bytes.toString(); c.complete({ ...RESULT_VALUE, finalClass: 'exact_ack' }); c.finish();
  assert.equal(h.files.get(RESULT).bytes.toString(), before);
});
test('host cannot extend live arm or consumed result; explicit clear closes current window', async () => {
  const { h, runtime } = await armed(); const original = h.files.get(ARM).mtimeMs;
  h.jump(1000); assert.equal(h.arm(), false); assert.equal(h.files.get(ARM).mtimeMs, original);
  const c = runtime.begin(MODE); assert.equal(h.arm(), false); assert.equal(h.clear(), true);
  c.complete(RESULT_VALUE); c.finish(); assertClean(h);
});
test('rearming while a consumed window remains never extends its deadline', async () => {
  const { h, runtime } = await armed(), c = runtime.begin(MODE), expires = h.receipt().expiresAt;
  h.put(ARM); h.tick(1000); c.complete(RESULT_VALUE); c.finish();
  assert.equal(h.receipt().windowState, 'ambiguous'); assert.equal(h.receipt().expiresAt, expires); assert.equal(h.files.has(ARM), false);
});
test('armed but unused window is pending then deleted at exact expiry', async () => {
  const { h } = await armed(); const armedAt = h.files.get(ARM).mtimeMs;
  h.tick(1000); assert.equal(h.receipt().windowState, 'pending');
  h.tick(298999); assert.equal(h.files.has(RESULT), true);
  h.tick(1); assert.equal(h.now(), armedAt + 300000); assertClean(h);
});
test('late completion cannot recreate an expired receipt', async () => {
  const { h, runtime } = await armed(), c = runtime.begin(MODE); h.tick(300000);
  c.complete(RESULT_VALUE); c.finish(); assertClean(h); assert.equal(h.read(), false); assert.deepEqual(h.stdout, []);
});
test('hard stop shortens last window and blocks all subsequent data reads/captures/arms', async () => {
  const stop = Date.parse('2026-11-10T00:00:00Z');
  const { h, runtime } = await armed({ now: stop - 2000 }), c = runtime.begin(MODE);
  assert.equal(Date.parse(h.receipt().expiresAt), stop); c.complete(RESULT_VALUE);
  h.tick(2000); assertClean(h); c.finish(); assert.equal(h.arm(), false); assert.equal(h.read(), false); assert.deepEqual(h.stdout, []);
});
test('stopped-process physical data remains but logical expiry forbids output; startup clears it', async () => {
  const { h, runtime } = await armed(), c = runtime.begin(MODE); c.complete(RESULT_VALUE); c.finish();
  h.jump(300000); assert.equal(h.files.has(RESULT), true);
  assert.equal(h.read(), false); assertClean(h); assert.deepEqual(h.stdout, []);
  h.put(ARM); h.put(RESULT, '{"raw":"PRIVATE"}'); h.api.createEf385DevResultDiagnostic(); assertClean(h);
});
test('startup/clear never touches old EF118 file or adjusts directory permissions', async () => {
  const h = await diagnosticHarness(); const old = h.put(OLD, 'LEGACY PRIVATE TEXT', { mode: 0o600 });
  h.put(ARM); h.put(RESULT, 'MALFORMED'); h.api.createEf385DevResultDiagnostic(); assertClean(h);
  assert.equal(h.files.get(OLD), old); assert.equal(pathsTouched(h).includes(OLD), false);
  assert.equal(h.files.get('/var/log/emotionflow').mode, 0o700);
});
for (const attack of [
  { requestId: 'PRIVATE-REQUEST-ID' }, { error: new Error('PRIVATE') }, { content: 'PRIVATE-TEXT' },
  { reasoning: 'PRIVATE' }, { marker: 'PRIVATE' }, { selection: 'PRIVATE' }, { validation: 'unknown' },
  { finalClass: '我听到了。' }, { candidateClass: 'empty' }, { selection: 'none' },
]) test(`closed projection rejects injected values: ${Object.keys(attack)}`, async () => {
  const { h, runtime } = await armed(), c = runtime.begin(MODE);
  const value = { ...RESULT_VALUE, ...attack }; assert.equal(h.api.projectEf385Result(value), null);
  c.complete(value); c.finish(); assertClean(h); assert.deepEqual(h.stdout, []); assert.deepEqual(h.errors, []);
});
test('projection rejects symbols and accessors without invoking them', async () => {
  const h = await diagnosticHarness(); const getter = { ...RESULT_VALUE };
  Object.defineProperty(getter, 'contentClass', { get() { throw new Error('must not run'); } });
  assert.equal(h.api.projectEf385Result(getter), null);
  assert.equal(h.api.projectEf385Result({ ...RESULT_VALUE, [Symbol('request')]: 'PRIVATE' }), null);
});
for (const mutate of [
  r => ({ ...r, requestId: 'PRIVATE-ID' }), r => ({ ...r, deploymentSha: 'c'.repeat(40) }),
  r => ({ ...r, armedAt: 'not-date' }), r => ({ ...r, expiresAt: new Date(Date.parse(r.expiresAt) + 1).toISOString() }),
  r => ({ ...r, observedAt: new Date(Date.parse(r.expiresAt)).toISOString() }), r => ({ ...r, windowState: 'PRIVATE' }),
  r => ({ ...r, result: { ...r.result, raw: 'PRIVATE-TEXT' } }), r => ({ ...r, windowState: 'pending' }),
  r => ({ ...r, observedAt: null }), r => ({ ...r, result: null }),
]) test(`read-clear rejects altered envelope ${mutate.toString()}`, async () => {
  const { h, runtime } = await armed(), c = runtime.begin(MODE); c.complete(RESULT_VALUE); c.finish();
  h.files.get(RESULT).bytes = Buffer.from(JSON.stringify(mutate(h.receipt())));
  assert.equal(h.read(), false); assert.deepEqual(h.stdout, []); assertClean(h);
});
for (const bytes of ['{', 'PRIVATE-TEXT', 'x'.repeat(4097), '']) test(`read-clear safely deletes malformed receipt bytes${bytes.length}`, async () => {
  const h = await diagnosticHarness(); h.put(RESULT, bytes); h.put(ARM);
  assert.equal(h.read(), false); assertClean(h); assert.deepEqual(h.stdout, []);
  if (bytes.length > 4096) assert.equal(h.fsCalls.some(x => x.name === 'readSync'), false);
});
test('growing file is bounded to 4097 bytes and rejected', async () => {
  const { h, runtime } = await armed(); runtime.begin(MODE).complete(RESULT_VALUE);
  h.inject.before = name => { if (name === 'readSync') h.files.get(RESULT).bytes = Buffer.alloc(10000, 'x'); };
  assert.equal(h.read(), false); assertClean(h); assert.deepEqual(h.stdout, []);
  assert.equal(h.fsCalls.find(x => x.name === 'readSync').args[3], 4097);
});
for (const target of [ARM, RESULT]) for (const extra of [
  { kind: 'symlink' }, { kind: 'directory' }, { kind: 'fifo' }, { nlink: 2 }, { uid: 999 }, { mode: 0o644 }, { mode: 0o4600 },
]) test(`unsafe ${target.split('.').at(-1)} ${JSON.stringify(extra)} refused without repair`, async () => {
  const h = await diagnosticHarness(), file = h.put(target, '', extra);
  assert.equal(h.arm(), false); assert.equal(h.read(), false); assert.equal(h.clear(), false);
  assert.equal(h.files.get(target), file); assert.deepEqual(h.stdout, []);
  assert.equal(h.api.createEf385DevResultDiagnostic().begin(MODE), undefined);
  assert.equal(h.fsCalls.some(x => ['writeFileSync', 'ftruncateSync'].includes(x.name)), false);
});
for (const path of ['/', '/var', '/var/log', '/var/log/emotionflow']) for (const extra of [{ kind: 'symlink' }, { uid: 999 }, { mode: 0o777 }]) test(`unsafe parent ${path} ${JSON.stringify(extra)}`, async () => {
  const h = await diagnosticHarness(); Object.assign(h.files.get(path), extra);
  assert.equal(h.arm(), false); assert.equal(h.api.createEf385DevResultDiagnostic().begin(MODE), undefined);
  assertClean(h); assert.deepEqual(h.stdout, []);
});
for (const op of ['lstatSync', 'openSync', 'fstatSync', 'closeSync', 'unlinkSync', 'ftruncateSync', 'writeFileSync']) test(`optional storage failure is swallowed: ${op}`, async () => {
  const { h, runtime } = await armed(); h.inject.failure = op;
  assert.doesNotThrow(() => { const c = runtime.begin(MODE); c?.complete(RESULT_VALUE); c?.finish(); h.tick(301000); });
  assert.deepEqual(h.errors, []); assert.deepEqual(h.stdout, []);
});
test('file replacement between checked open and use is refused', async () => {
  const { h, runtime } = await armed(); let swapped = false;
  h.inject.after = (name, args) => {
    if (!swapped && name === 'openSync' && args[0] === ARM) { swapped = true; h.put(ARM, '', { kind: 'symlink' }); }
  };
  assert.equal(runtime.begin(MODE), undefined); assert.equal(h.files.get(RESULT), undefined); assert.deepEqual(h.stdout, []);
});
test('read-clear never prints if cleanup fails, even for a valid receipt', async () => {
  const { h, runtime } = await armed(); runtime.begin(MODE).complete(RESULT_VALUE); h.inject.failure = 'unlinkSync';
  assert.equal(h.read(), false); assert.deepEqual(h.stdout, []);
});
for (const args of [[], ['cat'], ['arm'], ['arm', SHA, '/tmp/path'], ['clear', SHA], ['read-clear', 'wrong'], ['arm', SHA + '\n']]) test(`operator rejects arbitrary arguments ${JSON.stringify(args)}`, async () => {
  const h = await diagnosticHarness(); assert.equal(h.operate(args), false); assert.deepEqual(h.stdout, []); assert.deepEqual(h.fsCalls, []);
});
test('standalone CLI forwards only explicit args and valid receipt; no index import', async () => {
  const source = await readFile(new URL('../observability/ef385DevResultOperator.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"].*index|dotenv|listen\(|process\.env/);
  const calls = [], process = { argv: ['node', 'helper', 'clear'], stdout: { write: x => calls.push(x) }, exitCode: null };
  await loadTsModule(new URL('../observability/ef385DevResultOperator.ts', import.meta.url), {
    './ef385DevResultDiagnostic': { runEf385DevResultOperator: (args, print) => { assert.deepEqual(project(args), ['clear']); print('CLOSED'); return true; } },
  }, { process });
  assert.deepEqual(calls, ['CLOSED\n']); assert.equal(process.exitCode, 0);
});
test('existing build preserves index path/options and emits standalone operator under dist', async () => {
  const source = await readFile(new URL('../../build.js', import.meta.url), 'utf8');
  assert.match(source, /entryPoints: \{ index: 'src\/index.ts', ef385DevResultOperator: 'src\/observability\/ef385DevResultOperator.ts' \}/);
  for (const option of ["bundle: true", "platform: 'node'", "target: 'node18'", "format: 'esm'", "outdir: 'dist'", 'external: externalList']) assert.ok(source.includes(option));
});

test('existing owned 0750 directory is accepted without chmod/chown', async () => {
  const h = await diagnosticHarness(); h.files.get('/var/log/emotionflow').mode = 0o750;
  const runtime = h.api.createEf385DevResultDiagnostic(); assert.equal(h.arm(), true);
  const c = runtime.begin(MODE); c.complete(RESULT_VALUE); c.finish(); assert.equal(h.read(), true);
  assert.equal(h.files.get('/var/log/emotionflow').mode, 0o750);
});
for (const operation of ['clear', 'read-clear']) test(`${operation} then immediate new arm revokes the old capture without deleting the new window`, async () => {
  const { h, runtime } = await armed(), old = runtime.begin(MODE);
  assert.equal(h.operate(operation === 'clear' ? ['clear'] : ['read-clear', SHA]), true);
  h.jump(2000); assert.equal(h.arm(), true); const armedAt = h.files.get(ARM).mtimeMs;
  old.complete(RESULT_VALUE); old.finish();
  assert.equal(Date.parse(h.receipt().armedAt), armedAt);
  assert.equal(h.receipt().windowState, 'ambiguous', 'pre-existing in-flight invocation makes new window unattributable');
  assert.equal(h.receipt().result, null);
  h.tick(298000); assert.equal(h.files.has(RESULT), true, 'old expiry cannot delete new receipt');
  h.tick(2000); assertClean(h);
});
test('old timer cannot delete a new arm before next poll', async () => {
  const { h, runtime } = await armed(), c = runtime.begin(MODE); c.complete(RESULT_VALUE); c.finish();
  // Stop polling to isolate the timer callback from all other runtime behavior.
  for (const [id, t] of h.timers) if (t.repeat) h.timers.delete(id);
  h.tick(299999); h.clear(); assert.equal(h.arm(), true);
  const fresh = h.files.get(ARM); h.tick(1);
  assert.equal(h.files.get(ARM), fresh); assert.equal(h.files.has(RESULT), false);
});
test('old cleanup never deletes or overwrites a replacement receipt inode', async () => {
  const { h, runtime } = await armed(), c = runtime.begin(MODE);
  const replacement = h.put(RESULT, 'PRIVATE-REPLACEMENT');
  c.complete(RESULT_VALUE); c.finish(); h.tick(300000);
  assert.equal(h.files.get(RESULT), replacement); assert.equal(replacement.bytes.toString(), 'PRIVATE-REPLACEMENT');
  assert.deepEqual(h.stdout, []);
});
test('explicit next arm after completion/clear can create a fresh bounded window without process restart', async () => {
  const { h, runtime } = await armed(), c = runtime.begin(MODE); c.complete(RESULT_VALUE); c.finish();
  assert.equal(h.read(), true); h.tick(1000); assert.equal(h.arm(), true);
  const second = runtime.begin(MODE); second.complete(RESULT_VALUE); second.finish();
  assert.equal(h.receipt().windowState, 'captured');
  assert.equal(Date.parse(h.receipt().expiresAt) - Date.parse(h.receipt().armedAt), 300000);
});
test('expired empty signal can be explicitly cleared/rearmed before hard stop', async () => {
  const h = await diagnosticHarness(); h.put(ARM, '', { mtimeMs: h.now() - 300000 });
  assert.equal(h.arm(), true); assert.equal(h.files.get(ARM).mtimeMs, h.now()); assert.equal(h.files.has(RESULT), false);
});
test('future or nonempty arm cannot record a tuple', async () => {
  for (const [data, extra] of [['PRIVATE', {}], ['', { mtimeMs: Date.parse('2026-11-09T00:00:00Z') }]]) {
    const h = await diagnosticHarness(), runtime = h.api.createEf385DevResultDiagnostic(); h.put(ARM, data, extra);
    const c = runtime.begin(MODE); c?.complete(RESULT_VALUE); c?.finish();
    assert.equal(h.files.has(RESULT), false); assert.deepEqual(h.stdout, []);
  }
});
test('production arm has no filesystem side effect', async () => {
  const h = await diagnosticHarness({ env: { NODE_ENV: 'production' } });
  assert.equal(h.arm(), false); assert.deepEqual(h.fsCalls, []);
});
test('hard-stop startup and explicit clear remove only safe artifacts without printing', async () => {
  const h = await diagnosticHarness({ now: Date.parse('2026-11-10T00:00:00Z') });
  h.put(ARM); h.put(RESULT, 'PRIVATE'); assert.equal(h.api.createEf385DevResultDiagnostic().begin(MODE), undefined); assertClean(h);
  h.put(RESULT, 'PRIVATE'); assert.equal(h.clear(), true); assertClean(h); assert.deepEqual(h.stdout, []);
});
test('operator emitter throw produces only failure status and no raw error', async () => {
  const { h, runtime } = await armed(); runtime.begin(MODE).complete(RESULT_VALUE);
  assert.equal(h.operate(['read-clear', SHA], () => { throw new Error('PRIVATE'); }), false);
  assertClean(h); assert.deepEqual(h.errors, []);
});
test('replacement between save precheck and open cannot be overwritten', async () => {
  const { h, runtime } = await armed(), c = runtime.begin(MODE);
  let replacement;
  h.inject.before = (name, args) => {
    if (name === 'openSync' && args[0] === RESULT && !replacement) replacement = h.put(RESULT, 'PRIVATE-NEW-RECEIPT');
  };
  c.complete(RESULT_VALUE); c.finish();
  assert.equal(h.files.get(RESULT), replacement); assert.equal(replacement.bytes.toString(), 'PRIVATE-NEW-RECEIPT');
  assert.deepEqual(h.stdout, []);
});
test('actual build script passes unchanged bundle options and explicit stable output names', async () => {
  let built;
  await loadTsModule(new URL('../../build.js', import.meta.url), {
    esbuild: { build: async options => { built = project(options); } },
    module: { createRequire: () => path => { assert.equal(path, './package.json'); return { dependencies: { dayjs: 'version', express: 'version' } }; } },
  }, { process: { exit: () => assert.fail('build unexpectedly failed') } });
  assert.deepEqual(built, { entryPoints: { index: 'src/index.ts', ef385DevResultOperator: 'src/observability/ef385DevResultOperator.ts' },
    bundle: true, platform: 'node', target: 'node18', format: 'esm', outdir: 'dist', external: ['express'] });
});
