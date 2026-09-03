import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScope } from './review-manifest.mjs';

const AUTHORITY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ID = 'client-jest-file';

function fail(message) { throw new Error(`EF-179 approved targeted regression rejected: ${message}`); }
function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is malformed`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(`${label} is malformed`);
}
function safeDirectory(target, label) {
  if (!existsSync(target)) fail(`${label} is missing`);
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} is unsafe`);
  const expected = path.resolve(target);
  if (realpathSync(target) !== expected) fail(`${label} is noncanonical`);
  return expected;
}
function safeOutput(target) {
  if (typeof target !== 'string' || target !== path.resolve(target)) fail('output path is noncanonical');
  return target;
}
function normalizeChecks(checks) {
  return checks.map(check => ({ id: check.id, testPath: check.testPath, expectedResult: { ...check.expectedResult } }));
}
function validateAuthorityChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) fail('authority targeted checks are malformed');
  const ids = new Set();
  for (const check of checks) {
    exactKeys(check, ['id', 'testPath', 'expectedResult'], 'authority targeted check');
    if (check.id !== CHECK_ID || ids.has(check.id) || typeof check.testPath !== 'string'
      || !check.testPath.startsWith('client/') || !check.testPath.includes('/__tests__/')
      || !/\.test\.tsx?$/.test(check.testPath) || /[*?\[\]{}\\]/.test(check.testPath)
      || check.testPath.split('/').some(part => part === '.' || part === '..')) {
      fail('authority targeted check is malformed');
    }
    exactKeys(check.expectedResult, ['passed', 'failed', 'skipped'], 'authority expected result');
    if (!Number.isInteger(check.expectedResult.passed) || check.expectedResult.passed < 1
      || check.expectedResult.failed !== 0 || check.expectedResult.skipped !== 0) {
      fail('authority expected result is malformed');
    }
    ids.add(check.id);
  }
}
function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
async function readJson(target, label) {
  try { return JSON.parse(await readFile(target, 'utf8')); }
  catch { fail(`${label} is unreadable`); }
}
function validateReviewManifest(manifest, record) {
  exactKeys(manifest, [
    'schemaVersion', 'eventName', 'mode', 'authoritySha', 'checkedOutSha', 'baseSha', 'headSha',
    'mergeBaseSha', 'prNumber', 'scopeId', 'changedPaths', 'structuralProof',
  ], 'review manifest');
  if (manifest.schemaVersion !== 3 || manifest.eventName !== 'pull_request' || manifest.mode !== 'authority-candidate'
    || manifest.scopeId !== `authority-low-risk-${record.ticketKey.toLowerCase()}`
    || manifest.prNumber !== record.pullRequestNumber || manifest.baseSha !== record.baseSha
    || manifest.headSha !== record.candidateSha || manifest.mergeBaseSha !== record.baseSha) {
    fail('review manifest does not match authority record');
  }
  exactKeys(manifest.structuralProof, [
    'kind', 'ticketKey', 'baseSha', 'candidateSha', 'approvedPaths', 'targetedChecks',
  ], 'review manifest proof');
  if (manifest.structuralProof.kind !== 'low-risk-frontend' || manifest.structuralProof.ticketKey !== record.ticketKey
    || manifest.structuralProof.baseSha !== record.baseSha || manifest.structuralProof.candidateSha !== record.candidateSha
    || !sameJson(manifest.structuralProof.approvedPaths, [...record.changedPaths])
    || !sameJson(manifest.structuralProof.targetedChecks, normalizeChecks(record.targetedChecks))) {
    fail('review manifest proof does not match authority record');
  }
}
function commandFor(check, resultPath) {
  if (check.id !== CHECK_ID) fail(`unknown check ID: ${String(check.id)}`);
  const clientRelativeTestPath = check.testPath.slice('client/'.length);
  if (!clientRelativeTestPath || clientRelativeTestPath.startsWith('/') || clientRelativeTestPath.split('/').some(part => part === '.' || part === '..')) {
    fail('authority targeted check path escapes client root');
  }
  return ['pnpm', '--dir', 'client', 'exec', 'jest', '--runInBand', '--json', '--outputFile', resultPath, clientRelativeTestPath];
}
function testCounts(result) {
  if (!result || typeof result !== 'object') fail('targeted test result is malformed');
  const passed = result.numPassedTests;
  const failed = result.numFailedTests;
  const skipped = result.numPendingTests;
  if (![passed, failed, skipped].every(Number.isInteger)) fail('targeted test result counts are malformed');
  return { passed, failed, skipped };
}
function defaultExecute(command, cwd) {
  return spawnSync(command[0], command.slice(1), { cwd, encoding: 'utf8', env: process.env });
}

export async function runApprovedTargetedRegressions({ manifestPath, outputPath, execute = defaultExecute, now = () => new Date().toISOString(), authorityRoot = AUTHORITY_ROOT, scopeLoader = loadScope } = {}) {
  const authority = safeDirectory(authorityRoot, 'authority checkout');
  const candidate = safeDirectory(path.join(path.dirname(authority), 'candidate'), 'candidate checkout');
  const manifest = await readJson(manifestPath, 'review manifest');
  const scope = await scopeLoader();
  const record = scope.lowRiskProfilesByPr.get(manifest?.prNumber);
  if (!record) fail('no authority low-risk record exists for the event PR');
  validateAuthorityChecks(record.targetedChecks);
  validateReviewManifest(manifest, record);
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'ef179-approved-targeted-'));
  try {
    const checks = [];
    for (let index = 0; index < record.targetedChecks.length; index += 1) {
      const check = record.targetedChecks[index];
      const resultPath = path.join(temporaryRoot, `check-${index}.json`);
      const command = commandFor(check, resultPath);
      const execution = await execute(command, candidate);
      if (!execution || !Number.isInteger(execution.status)) fail('targeted command execution is malformed');
      if (!existsSync(resultPath)) fail('targeted test artifact is missing');
      const counts = testCounts(await readJson(resultPath, 'targeted test artifact'));
      if (execution.status !== 0 || counts.skipped !== 0 || counts.failed !== 0 || !sameJson(counts, check.expectedResult)) {
        fail('targeted regression did not meet the required result');
      }
      checks.push({ id: check.id, testPath: check.testPath, command, exitCode: execution.status, ...counts, timestamp: now() });
    }
    const evidence = { schemaVersion: 1, scopeId: manifest.scopeId, checks, timestamp: now() };
    await writeFile(safeOutput(outputPath), `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return evidence;
  }
  finally { await rm(temporaryRoot, { recursive: true, force: true }); }
}

async function main() {
  const [manifestFlag, manifestPath, outputFlag, outputPath] = process.argv.slice(2);
  if (manifestFlag !== '--manifest' || !manifestPath || outputFlag !== '--output' || !outputPath || process.argv.length !== 6) {
    fail('usage: --manifest <path> --output <path>');
  }
  await runApprovedTargetedRegressions({ manifestPath: path.resolve(manifestPath), outputPath: path.resolve(outputPath) });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
