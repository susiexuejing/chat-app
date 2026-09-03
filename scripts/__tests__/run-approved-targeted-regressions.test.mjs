import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runApprovedTargetedRegressions } from '../run-approved-targeted-regressions.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const TEST_PATH = 'client/screens/chat/__tests__/roleHeader.test.tsx';
const CHECK = {
  id: 'client-jest-file',
  testPath: TEST_PATH,
  expectedResult: { passed: 2, failed: 0, skipped: 0 },
};

function record(overrides = {}) {
  return {
    ticketKey: 'EF-999', pullRequestNumber: 99, baseBranch: 'dev', baseSha: BASE,
    candidateSha: HEAD, changedPaths: new Set(['client/screens/chat/components/RoleHeader.tsx']),
    targetedChecks: [CHECK], ...overrides,
  };
}
function manifest(overrides = {}) {
  return {
    schemaVersion: 3, eventName: 'pull_request', mode: 'authority-candidate', authoritySha: BASE,
    checkedOutSha: HEAD, baseSha: BASE, headSha: HEAD, mergeBaseSha: BASE, prNumber: 99,
    scopeId: 'authority-low-risk-ef-999',
    changedPaths: ['client/screens/chat/components/RoleHeader.tsx'],
    structuralProof: {
      kind: 'low-risk-frontend', ticketKey: 'EF-999', baseSha: BASE, candidateSha: HEAD,
      approvedPaths: ['client/screens/chat/components/RoleHeader.tsx'], targetedChecks: [CHECK],
    },
    ...overrides,
  };
}
async function fixture(t, manifestValue = manifest(), recordValue = record()) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'ef179-runner-')));
  const authority = path.join(root, 'authority');
  const candidate = path.join(root, 'candidate');
  await Promise.all([mkdir(authority), mkdir(candidate)]);
  const manifestPath = path.join(root, 'manifest.json');
  const outputPath = path.join(root, 'evidence.json');
  await writeFile(manifestPath, JSON.stringify(manifestValue));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    authorityRoot: authority, candidate, manifestPath, outputPath,
    scopeLoader: async () => ({ lowRiskProfilesByPr: new Map([[99, recordValue]]) }),
  };
}
function passingExecute(calls) {
  return async (command, cwd) => {
    calls.push({ command, cwd });
    await writeFile(command[8], JSON.stringify({ numPassedTests: 2, numFailedTests: 0, numPendingTests: 0 }));
    return { status: 0 };
  };
}

test('executes the authority-approved client-relative Jest command and records sanitized evidence', async t => {
  const input = await fixture(t); const calls = [];
  const evidence = await runApprovedTargetedRegressions({ ...input, execute: passingExecute(calls), now: () => '2026-09-03T00:00:00.000Z' });
  assert.deepEqual(calls, [{
    cwd: input.candidate,
    command: ['pnpm', '--dir', 'client', 'exec', 'jest', '--runInBand', '--json', '--outputFile', calls[0].command[8], 'screens/chat/__tests__/roleHeader.test.tsx'],
  }]);
  assert.deepEqual(evidence.checks.map(({ command, timestamp, ...check }) => check), [{
    id: 'client-jest-file', testPath: TEST_PATH, exitCode: 0, passed: 2, failed: 0, skipped: 0,
  }]);
  assert.deepEqual(JSON.parse(await readFile(input.outputPath, 'utf8')).checks[0].command.slice(-1), ['screens/chat/__tests__/roleHeader.test.tsx']);
});

test('fails closed for command, path, manifest, and authority-record tampering', async t => {
  const cases = [
    ['unknown command ID', record({ targetedChecks: [{ ...CHECK, id: 'shell' }] }), /authority record is missing|unknown check ID|unsafe/],
    ['unsafe client escape', record({ targetedChecks: [{ ...CHECK, testPath: 'client/../server/secret.test.ts' }] }), /proof does not match|unsafe/],
    ['candidate command field', record({ targetedChecks: [{ ...CHECK, command: ['echo', 'unsafe'] }] }), /authority check is malformed/],
    ['candidate manifest mismatch', record(), /does not match authority record/, manifest({ headSha: 'c'.repeat(40) })],
  ];
  for (const [label, recordValue, error, manifestValue = manifest()] of cases) {
    await t.test(label, async child => {
      const input = await fixture(child, manifestValue, recordValue);
      await assert.rejects(runApprovedTargetedRegressions({ ...input, execute: passingExecute([]) }), error);
    });
  }
});

test('fails closed for missing artifact, process failure, skipped or mismatched results', async t => {
  const cases = [
    ['missing artifact', async () => ({ status: 0 }), /artifact is missing/],
    ['non-zero process', async command => { await writeFile(command[8], JSON.stringify({ numPassedTests: 2, numFailedTests: 0, numPendingTests: 0 })); return { status: 1 }; }, /did not meet/],
    ['failed test', async command => { await writeFile(command[8], JSON.stringify({ numPassedTests: 1, numFailedTests: 1, numPendingTests: 0 })); return { status: 1 }; }, /did not meet/],
    ['skipped test', async command => { await writeFile(command[8], JSON.stringify({ numPassedTests: 2, numFailedTests: 0, numPendingTests: 1 })); return { status: 0 }; }, /did not meet/],
    ['count mismatch', async command => { await writeFile(command[8], JSON.stringify({ numPassedTests: 3, numFailedTests: 0, numPendingTests: 0 })); return { status: 0 }; }, /did not meet/],
  ];
  for (const [label, execute, error] of cases) {
    await t.test(label, async child => {
      const input = await fixture(child);
      await assert.rejects(runApprovedTargetedRegressions({ ...input, execute }), error);
    });
  }
});
