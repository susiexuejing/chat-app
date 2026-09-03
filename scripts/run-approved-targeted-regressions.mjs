import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScope } from './review-manifest.mjs';

const AUTHORITY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fail(message) { throw new Error(`EF-179 targeted regression rejected: ${message}`); }
function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is malformed`);
  const keys = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) fail(`${label} is malformed`);
}
function safeDirectory(target, label) {
  if (!existsSync(target)) fail(`${label} is missing`);
  const stat = lstatSync(target); const expected = path.resolve(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(target) !== expected) fail(`${label} is unsafe`);
  return expected;
}
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function normalizedChecks(checks) { return checks.map(check => ({ id: check.id, testPath: check.testPath, expectedResult: { ...check.expectedResult } })); }
async function json(target, label) { try { return JSON.parse(await readFile(target, 'utf8')); } catch { fail(`${label} is unreadable`); } }
function checkContract(check) {
  exactKeys(check, ['id', 'testPath', 'expectedResult'], 'authority check');
  if (check.id !== 'client-jest-file' || typeof check.testPath !== 'string' || !check.testPath.startsWith('client/')
    || !check.testPath.includes('/__tests__/') || !/\.test\.tsx?$/.test(check.testPath)
    || /[*?\[\]{}\\]/.test(check.testPath)) fail('authority check is unsafe');
  exactKeys(check.expectedResult, ['passed', 'failed', 'skipped'], 'authority check result');
  if (!Number.isInteger(check.expectedResult.passed) || check.expectedResult.passed < 1
    || check.expectedResult.failed !== 0 || check.expectedResult.skipped !== 0) fail('authority check is unsafe');
}
function validate(manifest, record) {
  exactKeys(manifest, ['schemaVersion', 'eventName', 'mode', 'authoritySha', 'checkedOutSha', 'baseSha', 'headSha', 'mergeBaseSha', 'prNumber', 'scopeId', 'changedPaths', 'structuralProof'], 'review manifest');
  if (manifest.schemaVersion !== 3 || manifest.eventName !== 'pull_request' || manifest.mode !== 'authority-candidate'
    || manifest.prNumber !== record.pullRequestNumber || manifest.scopeId !== `authority-low-risk-${record.ticketKey.toLowerCase()}`
    || manifest.baseSha !== record.baseSha || manifest.headSha !== record.candidateSha || manifest.mergeBaseSha !== record.baseSha) fail('review manifest does not match authority record');
  exactKeys(manifest.structuralProof, ['kind', 'ticketKey', 'baseSha', 'candidateSha', 'approvedPaths', 'targetedChecks'], 'review manifest proof');
  for (const check of record.targetedChecks) checkContract(check);
  if (manifest.structuralProof.kind !== 'low-risk-frontend' || manifest.structuralProof.ticketKey !== record.ticketKey
    || manifest.structuralProof.baseSha !== record.baseSha || manifest.structuralProof.candidateSha !== record.candidateSha
    || !same(manifest.structuralProof.approvedPaths, [...record.changedPaths]) || !same(manifest.structuralProof.targetedChecks, normalizedChecks(record.targetedChecks))) fail('review manifest proof does not match authority record');
}
function argv(check, resultPath) {
  if (check.id !== 'client-jest-file') fail('unknown check ID');
  const relative = check.testPath.slice('client/'.length);
  if (!relative || relative.startsWith('/') || relative.split('/').some(part => part === '.' || part === '..')) fail('test path escapes client root');
  return ['pnpm', '--dir', 'client', 'exec', 'jest', '--runInBand', '--json', '--outputFile', resultPath, relative];
}
function defaultExecute(command, cwd) { return spawnSync(command[0], command.slice(1), { cwd, encoding: 'utf8', env: process.env }); }

export async function runApprovedTargetedRegressions({ manifestPath, outputPath, authorityRoot = AUTHORITY_ROOT, scopeLoader = loadScope, execute = defaultExecute, now = () => new Date().toISOString() } = {}) {
  const authority = safeDirectory(authorityRoot, 'authority checkout');
  const candidate = safeDirectory(path.join(path.dirname(authority), 'candidate'), 'candidate checkout');
  const manifest = await json(manifestPath, 'review manifest');
  const scope = await scopeLoader(); const record = scope.lowRiskProfilesByPr.get(manifest?.prNumber);
  if (!record || !Array.isArray(record.targetedChecks) || record.targetedChecks.length === 0) fail('authority record is missing');
  validate(manifest, record);
  const temp = await mkdtemp(path.join(tmpdir(), 'ef179-targeted-'));
  try {
    const checks = [];
    for (let index = 0; index < record.targetedChecks.length; index += 1) {
      const check = record.targetedChecks[index];
      const resultPath = path.join(temp, `${index}.json`); const command = argv(check, resultPath); const result = await execute(command, candidate);
      if (!result || !Number.isInteger(result.status)) fail('command execution is malformed');
      if (!existsSync(resultPath)) fail('targeted test artifact is missing');
      const output = await json(resultPath, 'targeted test artifact');
      const counts = { passed: output.numPassedTests, failed: output.numFailedTests, skipped: output.numPendingTests };
      if (!Object.values(counts).every(Number.isInteger) || result.status !== 0 || counts.failed !== 0 || counts.skipped !== 0 || !same(counts, check.expectedResult)) fail('targeted regression did not meet the required result');
      checks.push({ id: check.id, testPath: check.testPath, command, exitCode: result.status, ...counts, timestamp: now() });
    }
    const evidence = { schemaVersion: 1, scopeId: manifest.scopeId, checks, timestamp: now() };
    const output = path.resolve(outputPath); if (output !== outputPath) fail('output path is noncanonical');
    await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return evidence;
  } finally { await rm(temp, { recursive: true, force: true }); }
}

async function main() {
  const [first, manifestPath, third, outputPath] = process.argv.slice(2);
  if (first !== '--manifest' || !manifestPath || third !== '--output' || !outputPath || process.argv.length !== 6) fail('usage: --manifest <path> --output <path>');
  await runApprovedTargetedRegressions({ manifestPath: path.resolve(manifestPath), outputPath: path.resolve(outputPath) });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
