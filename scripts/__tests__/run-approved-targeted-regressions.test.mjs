import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runApprovedTargetedRegressions } from '../run-approved-targeted-regressions.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const CHECK = {
  id: 'client-jest-file',
  testPath: 'client/screens/chat/__tests__/roleHeader.test.tsx',
  expectedResult: { passed: 2, failed: 0, skipped: 0 },
};

function record(overrides = {}) {
  return {
    ticketKey: 'EF-999', pullRequestNumber: 99, baseBranch: 'dev', baseSha: BASE, candidateSha: HEAD,
    changedPaths: new Set(['client/screens/chat/components/RoleHeader.tsx']), targetedChecks: [CHECK], ...overrides,
  };
}
function manifest(overrides = {}) {
  return {
    schemaVersion: 3, eventName: 'pull_request', mode: 'authority-candidate', authoritySha: BASE,
    checkedOutSha: HEAD, baseSha: BASE, headSha: HEAD, mergeBaseSha: BASE, prNumber: 99,
    scopeId: 'authority-low-risk-ef-999', changedPaths: ['client/screens/chat/components/RoleHeader.tsx'],
    structuralProof: {
      kind: 'low-risk-frontend', ticketKey: 'EF-999', baseSha: BASE, candidateSha: HEAD,
      approvedPaths: ['client/screens/chat/components/RoleHeader.tsx'], targetedChecks: [CHECK],
    }, ...overrides,
  };
}
async function fixture(t, input = manifest()) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'ef179-runner-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const authority = path.join(root, 'authority');
  const candidate = path.join(root, 'candidate');
  await mkdir(authority);
  await mkdir(candidate);
  const manifestPath = path.join(root, 'manifest.json');
  const outputPath = path.join(root, 'evidence.json');
  await writeFile(manifestPath, JSON.stringify(input));
  return { authority, candidate, manifestPath, outputPath };
}
function loader(current = record()) {
  return async () => ({ lowRiskProfilesByPr: new Map([[99, current]]) });
}
function passingExecutor(command) {
  const outputIndex = command.indexOf('--outputFile');
  return writeFile(command[outputIndex + 1], JSON.stringify({ numPassedTests: 2, numFailedTests: 0, numPendingTests: 0 }))
    .then(() => ({ status: 0 }));
}

test('executes only the hard-coded authority check and records sanitized actual evidence', async t => {
  const input = await fixture(t);
  const seen = [];
  const evidence = await runApprovedTargetedRegressions({
    ...input, authorityRoot: input.authority, scopeLoader: loader(), now: () => '2026-09-03T00:00:00.000Z',
    execute: async (command, cwd) => { seen.push({ command, cwd }); return passingExecutor(command); },
  });
  assert.deepEqual(seen, [{
    command: ['pnpm', '--dir', 'client', 'exec', 'jest', '--runInBand', '--json', '--outputFile', seen[0].command[8], 'screens/chat/__tests__/roleHeader.test.tsx'],
    cwd: input.candidate,
  }]);
  assert.deepEqual(evidence.checks[0], {
    id: CHECK.id, testPath: CHECK.testPath, command: seen[0].command, exitCode: 0,
    passed: 2, failed: 0, skipped: 0, timestamp: '2026-09-03T00:00:00.000Z',
  });
  assert.deepEqual(JSON.parse(await readFile(input.outputPath, 'utf8')), evidence);
});

test('fails closed for unknown ID, unsafe path, missing expected result, and candidate-supplied commands', async t => {
  const cases = [
    { record: record({ targetedChecks: [{ ...CHECK, id: 'unknown' }] }), error: /authority targeted check/ },
    { record: record({ targetedChecks: [{ ...CHECK, testPath: 'client/screens/**' }] }), error: /authority targeted check/ },
    { record: record({ targetedChecks: [{ ...CHECK, testPath: 'client/../server/src/__tests__/escape.test.ts' }] }), error: /authority targeted check/ },
    { record: record({ targetedChecks: [{ id: CHECK.id, testPath: CHECK.testPath }] }), error: /authority targeted check is malformed/ },
    { manifest: manifest({ structuralProof: { ...manifest().structuralProof, targetedChecks: [{ ...CHECK, command: 'curl example.invalid' }] } }), error: /review manifest proof does not match authority record/ },
  ];
  for (const entry of cases) {
    const input = await fixture(t, entry.manifest ?? manifest());
    await assert.rejects(runApprovedTargetedRegressions({
      ...input, authorityRoot: input.authority, scopeLoader: loader(entry.record), execute: passingExecutor,
    }), entry.error);
  }
});

test('fails closed for a missing artifact, nonzero exit, failed results, skipped results, and count mismatch', async t => {
  const cases = [
    { execute: async () => ({ status: 0 }), error: /artifact is missing/ },
    { result: { numPassedTests: 2, numFailedTests: 0, numPendingTests: 0 }, status: 1, error: /did not meet/ },
    { result: { numPassedTests: 1, numFailedTests: 1, numPendingTests: 0 }, status: 0, error: /did not meet/ },
    { result: { numPassedTests: 2, numFailedTests: 0, numPendingTests: 1 }, status: 0, error: /did not meet/ },
    { result: { numPassedTests: 1, numFailedTests: 0, numPendingTests: 0 }, status: 0, error: /did not meet/ },
  ];
  for (const entry of cases) {
    const input = await fixture(t);
    const execute = entry.execute ?? (async command => {
      const outputIndex = command.indexOf('--outputFile');
      await writeFile(command[outputIndex + 1], JSON.stringify(entry.result));
      return { status: entry.status };
    });
    await assert.rejects(runApprovedTargetedRegressions({
      ...input, authorityRoot: input.authority, scopeLoader: loader(), execute,
    }), entry.error);
  }
});
