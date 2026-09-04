import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APPROVED_TARGETS = Object.freeze([
  'scripts/__tests__/ef111-review-manifest.test.mjs',
  'scripts/__tests__/ef94-ci-release-gate.test.mjs',
]);

function fail(message) { throw new Error(`EF-179 targeted regressions rejected: ${message}`); }

export function outputPath(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) fail('usage: --output <path>');
  const output = path.resolve(argv[1]);
  if (existsSync(output)) fail('output path already exists');
  return output;
}

function runTarget(target, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, ['--test', target], {
      cwd: REPO_ROOT,
      env: { ...process.env, CI: '1' },
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ target, exitCode: code ?? 1, signal: signal ?? null }));
  });
}

export async function runApprovedTargetedRegressions(options = {}) {
  const results = [];
  for (const target of APPROVED_TARGETS) results.push(await runTarget(target, options.spawnImpl));
  return {
    schemaVersion: 1,
    runner: 'ef-179-approved-targeted-regressions',
    approvedTargets: [...APPROVED_TARGETS],
    results,
    outcome: results.every(result => result.exitCode === 0 && result.signal === null) ? 'passed' : 'failed',
  };
}

async function main() {
  const output = outputPath();
  const record = await runApprovedTargetedRegressions();
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  if (record.outcome !== 'passed') process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
