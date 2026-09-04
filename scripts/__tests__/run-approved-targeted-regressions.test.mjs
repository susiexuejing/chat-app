import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { APPROVED_CHECKS, APPROVED_TARGETS, DEFAULT_TARGETS, authorityManifest, parseArguments, runApprovedTargetedRegressions } from '../run-approved-targeted-regressions.mjs';

test('runner has only the reviewed gate-contract targets', () => {
  assert.deepEqual(APPROVED_TARGETS, ['review-manifest-contract', 'release-gate-contract', 'chat-ui-jest-path']);
  assert.deepEqual(DEFAULT_TARGETS, ['review-manifest-contract', 'release-gate-contract']);
});

test('runner executes every approved target and records a passing result', async () => {
  const calls = [];
  const record = await runApprovedTargetedRegressions(DEFAULT_TARGETS, {
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
  });
  assert.deepEqual(calls.map(call => call.args), DEFAULT_TARGETS.map(id => APPROVED_CHECKS[id].args));
  assert.ok(calls.every(call => call.command === process.execPath && call.options.shell === false));
  assert.equal(record.outcome, 'passed');
  assert.deepEqual(record.results, DEFAULT_TARGETS.map(id => ({ id, exitCode: 0, signal: null })));
});

test('runner executes the closed UI check only with an authority-supplied path', async () => {
  const calls = [];
  const targetedTestPath = 'client/screens/chat/__tests__/ChatContext.test.tsx';
  const record = await runApprovedTargetedRegressions(['chat-ui-jest-path'], {
    targetedTestPath,
    spawnImpl(command, args) {
      calls.push({ command, args });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
  });
  assert.deepEqual(calls, [{ command: 'pnpm', args: [...APPROVED_CHECKS['chat-ui-jest-path'].args, targetedTestPath] }]);
  assert.equal(record.outcome, 'passed');
});

test('runner executes the R1 affected-test inventory as closed argv values', async () => {
  const calls = [];
  const targetedTestPaths = [
    'client/screens/chat/__tests__/r1-ui-affected-a.test.tsx',
    'client/screens/chat/__tests__/r1-ui-affected-b.test.tsx',
  ];
  await runApprovedTargetedRegressions(['chat-ui-jest-path'], {
    targetedTestPaths,
    spawnImpl(command, args) {
      calls.push({ command, args });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
  });
  assert.deepEqual(calls, [{ command: 'pnpm', args: [...APPROVED_CHECKS['chat-ui-jest-path'].args, ...targetedTestPaths] }]);
});

test('runner records failures without widening its target set', async () => {
  let index = 0;
  const record = await runApprovedTargetedRegressions(DEFAULT_TARGETS, {
    spawnImpl() {
      const child = new EventEmitter();
      const code = index++ === 0 ? 1 : 0;
      queueMicrotask(() => child.emit('exit', code, null));
      return child;
    },
  });
  assert.equal(record.outcome, 'failed');
  assert.equal(record.results.length, DEFAULT_TARGETS.length);
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
  assert.deepEqual(parseArguments(['--output', output, '--manifest', 'authority.json']), { output, manifest: 'authority.json' });
});

test('authority manifest rejects malformed and symlinked input and accepts one validated UI path', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ef183-authority-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = path.join(root, 'manifest.json');
  await assert.rejects(authorityManifest(manifest), /missing or unsafe/);
  await writeFile(manifest, '{}');
  await assert.rejects(authorityManifest(manifest), /malformed/);
  await writeFile(manifest, JSON.stringify({
    targetedRegressionIds: ['chat-ui-jest-path'],
    targetedTestPath: 'client/screens/chat/__tests__/ChatContext.test.tsx',
  }));
  assert.deepEqual(await authorityManifest(manifest), {
    ids: ['chat-ui-jest-path'], targetedTestPaths: ['client/screens/chat/__tests__/ChatContext.test.tsx'],
  });
  await writeFile(manifest, JSON.stringify({
    targetedRegressionIds: ['chat-ui-jest-path'], targetedTestPath: null,
    affectedTestPaths: ['client/screens/chat/__tests__/ChatContext.test.tsx', 'client/screens/chat/__tests__/ef59-runtime-fix.test.tsx'],
  }));
  assert.deepEqual(await authorityManifest(manifest), {
    ids: ['chat-ui-jest-path'],
    targetedTestPaths: ['client/screens/chat/__tests__/ChatContext.test.tsx', 'client/screens/chat/__tests__/ef59-runtime-fix.test.tsx'],
  });
  const linked = path.join(root, 'linked.json');
  await symlink(manifest, linked);
  await assert.rejects(authorityManifest(linked), /missing or unsafe/);
});
