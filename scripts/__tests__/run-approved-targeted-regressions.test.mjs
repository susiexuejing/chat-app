import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { APPROVED_TARGETS, outputPath, runApprovedTargetedRegressions } from '../run-approved-targeted-regressions.mjs';

test('runner has only the reviewed gate-contract targets', () => {
  assert.deepEqual(APPROVED_TARGETS, [
    'scripts/__tests__/ef111-review-manifest.test.mjs',
    'scripts/__tests__/ef94-ci-release-gate.test.mjs',
  ]);
});

test('runner executes every approved target and records a passing result', async () => {
  const calls = [];
  const record = await runApprovedTargetedRegressions({
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
  });
  assert.deepEqual(calls.map(call => call.args), APPROVED_TARGETS.map(target => ['--test', target]));
  assert.ok(calls.every(call => call.command === process.execPath && call.options.shell === false));
  assert.equal(record.outcome, 'passed');
  assert.deepEqual(record.results, APPROVED_TARGETS.map(target => ({ target, exitCode: 0, signal: null })));
});

test('runner records failures without widening its target set', async () => {
  let index = 0;
  const record = await runApprovedTargetedRegressions({
    spawnImpl() {
      const child = new EventEmitter();
      const code = index++ === 0 ? 1 : 0;
      queueMicrotask(() => child.emit('exit', code, null));
      return child;
    },
  });
  assert.equal(record.outcome, 'failed');
  assert.equal(record.results.length, APPROVED_TARGETS.length);
  assert.equal(record.results[0].exitCode, 1);
});

test('output path is required and fails if a record already exists', async t => {
  assert.throws(() => outputPath([]), /usage/);
  const root = await mkdtemp(path.join(tmpdir(), 'ef179-targeted-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'record.json');
  assert.equal(outputPath(['--output', output]), output);
  await import('node:fs/promises').then(fs => fs.writeFile(output, '{}'));
  assert.throws(() => outputPath(['--output', output]), /already exists/);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).constructor, Object);
});
