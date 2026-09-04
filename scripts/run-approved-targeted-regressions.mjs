import { spawn } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APPROVED_CHECKS = Object.freeze({
  'review-manifest-contract': Object.freeze({ command: process.execPath, args: Object.freeze(['--test', 'scripts/__tests__/ef111-review-manifest.test.mjs']) }),
  'release-gate-contract': Object.freeze({ command: process.execPath, args: Object.freeze(['--test', 'scripts/__tests__/ef94-ci-release-gate.test.mjs']) }),
  'chat-ui-jest-path': Object.freeze({ command: 'pnpm', args: Object.freeze(['--dir', 'client', 'exec', 'jest', '--runInBand', '--no-cache']) }),
});
export const APPROVED_TARGETS = Object.freeze(Object.keys(APPROVED_CHECKS));
export const DEFAULT_TARGETS = Object.freeze(['review-manifest-contract', 'release-gate-contract']);

function fail(message) { throw new Error(`EF-179 targeted regressions rejected: ${message}`); }

export async function authorityManifest(file) {
  if (!file || !existsSync(file) || lstatSync(file).isSymbolicLink()) fail('authority manifest is missing or unsafe');
  let manifest; try { manifest = JSON.parse(await readFile(file, 'utf8')); } catch { fail('authority manifest is malformed'); }
  if (!Array.isArray(manifest.targetedRegressionIds) || manifest.targetedRegressionIds.length !== 1 || manifest.targetedRegressionIds[0] !== 'chat-ui-jest-path') fail('authority manifest is malformed');
  const testPaths = manifest.targetedTestPath === null && Array.isArray(manifest.affectedTestPaths)
    ? manifest.affectedTestPaths : [manifest.targetedTestPath];
  if (testPaths.length === 0 || testPaths.length > 3 || new Set(testPaths).size !== testPaths.length
    || testPaths.some(entry => typeof entry !== 'string' || !/^client\/screens\/chat\/__tests__\/[A-Za-z0-9][A-Za-z0-9._-]*\.test\.(ts|tsx)$/.test(entry))) fail('authority manifest is malformed');
  const root = await realpath(REPO_ROOT);
  for (const testPath of testPaths) {
    const target = path.resolve(REPO_ROOT, testPath);
    let actual; try { actual = await realpath(target); } catch { fail('authority test path is missing'); }
    if (!actual.startsWith(`${root}${path.sep}`) || lstatSync(target).isSymbolicLink()) fail('authority test path is unsafe');
  }
  return { ids: manifest.targetedRegressionIds, targetedTestPaths: testPaths };
}

export function parseArguments(argv = process.argv.slice(2)) {
  if (argv.length === 4 && argv[0] === '--output' && argv[2] === '--manifest') return { output: path.resolve(argv[1]), manifest: argv[3] };
  if (!((argv.length === 2 && argv[0] === '--output') || (argv.length === 4 && argv[0] === '--output' && argv[2] === '--checks')) || !argv[1]) fail('usage: --output <path> [--checks <id,id>]');
  const output = path.resolve(argv[1]);
  if (existsSync(output)) fail('output path already exists');
  const parent = path.dirname(output);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) fail('output artifact directory is unsafe or missing');
  const ids = argv.length === 4 ? argv[3].split(',') : [...DEFAULT_TARGETS];
  if (ids.length === 0 || ids.some(id => !Object.hasOwn(APPROVED_CHECKS, id))) fail('unknown approved check');
  if (new Set(ids).size !== ids.length) fail('duplicate approved check');
  return { output, ids };
}

function runTarget(id, targetedTestPaths, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const check = APPROVED_CHECKS[id];
    const child = spawnImpl(check.command, id === 'chat-ui-jest-path' ? [...check.args, ...targetedTestPaths] : check.args, {
      cwd: REPO_ROOT,
      env: { ...process.env, CI: '1' },
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ id, exitCode: code ?? 1, signal: signal ?? null }));
  });
}

export async function runApprovedTargetedRegressions(ids = DEFAULT_TARGETS, options = {}) {
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length || ids.some(id => !Object.hasOwn(APPROVED_CHECKS, id))) fail('invalid approved checks');
  const results = [];
  const targetedTestPaths = options.targetedTestPaths ?? (options.targetedTestPath ? [options.targetedTestPath] : []);
  if (ids.includes('chat-ui-jest-path') && targetedTestPaths.length === 0) fail('missing authority test paths');
  for (const id of ids) results.push(await runTarget(id, targetedTestPaths, options.spawnImpl));
  return {
    schemaVersion: 2,
    runner: 'ef-183-approved-targeted-regressions',
    approvedChecks: [...ids],
    results,
    outcome: results.every(result => result.exitCode === 0 && result.signal === null) ? 'passed' : 'failed',
  };
}

async function main() {
  const parsed = parseArguments();
  if (existsSync(parsed.output)) fail('output path already exists');
  const parent = path.dirname(parsed.output);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) fail('output artifact directory is unsafe or missing');
  const selected = parsed.manifest ? await authorityManifest(parsed.manifest) : { ids: parsed.ids, targetedTestPaths: undefined };
  const record = await runApprovedTargetedRegressions(selected.ids, { targetedTestPaths: selected.targetedTestPaths });
  await writeFile(parsed.output, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  if (record.outcome !== 'passed') process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
