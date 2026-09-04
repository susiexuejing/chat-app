import { spawn } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APPROVED_CHECKS = Object.freeze({
  'review-manifest-contract': Object.freeze(['--test', 'scripts/__tests__/ef111-review-manifest.test.mjs']),
  'release-gate-contract': Object.freeze(['--test', 'scripts/__tests__/ef94-ci-release-gate.test.mjs']),
});
export const APPROVED_TARGETS = Object.freeze(Object.keys(APPROVED_CHECKS));

function fail(message) { throw new Error(`EF-179 targeted regressions rejected: ${message}`); }

export function parseArguments(argv = process.argv.slice(2)) {
  if (!((argv.length === 2 && argv[0] === '--output') || (argv.length === 4 && argv[0] === '--output' && argv[2] === '--checks')) || !argv[1]) fail('usage: --output <path> [--checks <id,id>]');
  const output = path.resolve(argv[1]);
  if (existsSync(output)) fail('output path already exists');
  const parent = path.dirname(output);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) fail('output artifact directory is unsafe or missing');
  const ids = argv.length === 4 ? argv[3].split(',') : [...APPROVED_TARGETS];
  if (ids.length === 0 || ids.some(id => !Object.hasOwn(APPROVED_CHECKS, id))) fail('unknown approved check');
  if (new Set(ids).size !== ids.length) fail('duplicate approved check');
  return { output, ids };
}

function runTarget(id, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, APPROVED_CHECKS[id], {
      cwd: REPO_ROOT,
      env: { ...process.env, CI: '1' },
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ id, exitCode: code ?? 1, signal: signal ?? null }));
  });
}

export async function runApprovedTargetedRegressions(ids = APPROVED_TARGETS, options = {}) {
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length || ids.some(id => !Object.hasOwn(APPROVED_CHECKS, id))) fail('invalid approved checks');
  const results = [];
  for (const id of ids) results.push(await runTarget(id, options.spawnImpl));
  return {
    schemaVersion: 2,
    runner: 'ef-183-approved-targeted-regressions',
    approvedChecks: [...ids],
    results,
    outcome: results.every(result => result.exitCode === 0 && result.signal === null) ? 'passed' : 'failed',
  };
}

async function main() {
  const { output, ids } = parseArguments();
  const record = await runApprovedTargetedRegressions(ids);
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  if (record.outcome !== 'passed') process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
