import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE_PATH = path.join(REPO_ROOT, 'scripts/ef111-scope.manifest.json');
const SHA = /^[0-9a-f]{40}$/;

function fail(message) {
  throw new Error(`EF-111 review manifest rejected: ${message}`);
}

function sha(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`${label} must be a 40-character lowercase SHA`);
  return value;
}

function command(args, execFile = execFileSync) {
  try {
    return String(execFile('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })).trim();
  } catch {
    fail(`git ${args.join(' ')} failed`);
  }
}

export async function loadScope(read = readFile) {
  let parsed;
  try {
    parsed = JSON.parse(await read(SCOPE_PATH, 'utf8'));
  } catch {
    fail('scope manifest is unreadable');
  }
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.allowedPaths)
    || parsed.allowedPaths.length !== 7 || parsed.allowedPaths.some(entry => typeof entry !== 'string')) {
    fail('scope manifest is malformed');
  }
  return new Set(parsed.allowedPaths);
}

export function verifyPrScope(baseSha, headSha, allowedPaths, execFile = execFileSync) {
  const changed = command(['diff', '--name-only', `${baseSha}...${headSha}`], execFile)
    .split('\n').filter(Boolean);
  if (changed.length === 0) fail('pull request candidate has no changed paths');
  for (const entry of changed) if (!allowedPaths.has(entry)) fail(`out-of-scope path: ${entry}`);
  return changed;
}

export async function createReviewManifest(env = process.env, options = {}) {
  const eventName = env.GITHUB_EVENT_NAME;
  const checkedOutSha = sha(options.git?.(['rev-parse', 'HEAD']) ?? command(['rev-parse', 'HEAD'], options.execFile), 'checked-out SHA');
  const githubSha = sha(env.GITHUB_SHA, 'GITHUB_SHA');
  if (checkedOutSha !== githubSha) fail('checked-out SHA does not match GITHUB_SHA');

  if (eventName === 'pull_request') {
    if (!env.GITHUB_EVENT_PATH) fail('GITHUB_EVENT_PATH is required for pull_request');
    let event;
    try { event = JSON.parse(await (options.read ?? readFile)(env.GITHUB_EVENT_PATH, 'utf8')); } catch { fail('pull request event payload is unreadable'); }
    const prNumber = event?.pull_request?.number ?? event?.number;
    const baseSha = sha(event?.pull_request?.base?.sha, 'pull_request.base.sha');
    const headSha = sha(event?.pull_request?.head?.sha, 'pull_request.head.sha');
    if (!Number.isInteger(prNumber) || prNumber < 1) fail('pull_request.number must be a positive integer');
    if (event?.pull_request?.base?.ref !== 'dev') fail('pull request base ref must be dev');
    if (headSha !== githubSha) fail('pull request head SHA does not match GITHUB_SHA');
    const allowedPaths = await loadScope(options.read ?? readFile);
    const changedPaths = verifyPrScope(baseSha, headSha, allowedPaths, options.execFile);
    return { schemaVersion: 1, eventName, checkedOutSha, baseSha, headSha, prNumber, changedPaths };
  }
  if (eventName === 'push' || eventName === 'workflow_dispatch') {
    return { schemaVersion: 1, eventName, checkedOutSha, baseSha: null, headSha: githubSha, prNumber: null, changedPaths: null };
  }
  fail(`unsupported event: ${String(eventName)}`);
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex === -1 || !process.argv[outputIndex + 1] || process.argv.length !== 4) fail('usage: --output <path>');
  const output = path.resolve(process.argv[outputIndex + 1]);
  const manifest = await createReviewManifest();
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
