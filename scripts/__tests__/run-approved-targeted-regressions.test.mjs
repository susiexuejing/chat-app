import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { APPROVED_CHECKS, APPROVED_TARGETS, parseArguments, runApprovedTargetedRegressions } from '../run-approved-targeted-regressions.mjs';

test('runner has only the reviewed gate-contract targets', () => {
  assert.deepEqual(APPROVED_TARGETS, ['review-manifest-contract', 'release-gate-contract']);
  assert.deepEqual(APPROVED_CHECKS['review-manifest-contract'], ['--test', 'scripts/__tests__/ef111-review-manifest.test.mjs']);
});

test('runner executes every approved target and records a passing result', async () => {
  const calls = [];
  const record = await runApprovedTargetedRegressions(APPROVED_TARGETS, {
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
  });
  assert.deepEqual(calls.map(call => call.args), APPROVED_TARGETS.map(id => APPROVED_CHECKS[id]));
  assert.ok(calls.every(call => call.command === process.execPath && call.options.shell === false));
  assert.equal(record.outcome, 'passed');
  assert.deepEqual(record.results, APPROVED_TARGETS.map(id => ({ id, exitCode: 0, signal: null })));
});

test('runner records failures without widening its target set', async () => {
  let index = 0;
  const record = await runApprovedTargetedRegressions(APPROVED_TARGETS, {
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

test('runner rejects unknown, duplicate, candidate command text, and unsafe artifacts', async t => {
  assert.throws(() => parseArguments([]), /usage/);
  assert.throws(() => parseArguments(['--output', '/definitely-missing/record.json']), /unsafe or missing/);
  await assert.rejects(runApprovedTargetedRegressions(['unknown']), /invalid/);
  await assert.rejects(runApprovedTargetedRegressions(['review-manifest-contract', 'review-manifest-contract']), /invalid/);
  const root = await mkdtemp(path.join(tmpdir(), 'ef179-targeted-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'record.json');
  assert.throws(() => parseArguments(['--output', output, '--checks', 'node -e bad']), /unknown/);
  assert.deepEqual(parseArguments(['--output', output, '--checks', 'review-manifest-contract']), { output, ids: ['review-manifest-contract'] });
});
