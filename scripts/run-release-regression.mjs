import { lstat, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'scripts/release-suite.manifest.json');
const RUN_PREFIX = 'emotionflow-ef95-release-';

export function validateOwnedRunPath(runRoot, osTempRoot = tmpdir()) {
  const resolvedRunRoot = path.resolve(runRoot);
  const resolvedTempRoot = path.resolve(osTempRoot);
  if (resolvedRunRoot === resolvedTempRoot
    || !resolvedRunRoot.startsWith(`${resolvedTempRoot}${path.sep}`)
    || path.basename(resolvedRunRoot).startsWith(RUN_PREFIX) === false) {
    throw new Error('cleanup safety boundary rejected');
  }
  return resolvedRunRoot;
}

export function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.included)
    || manifest.included.length === 0 || !Array.isArray(manifest.excluded)) {
    throw new Error('invalid release-suite manifest');
  }
  const ids = new Set();
  for (const suite of manifest.included) {
    if (!suite?.id || ids.has(suite.id) || !suite.gate || !suite.coverage
      || !suite.safety || !suite.fixtureIsolation || typeof suite.command !== 'string'
      || !Array.isArray(suite.args) || suite.args.some(arg => typeof arg !== 'string')
      || typeof suite.cwd !== 'string' || path.isAbsolute(suite.cwd)
      || path.resolve(REPO_ROOT, suite.cwd).startsWith(`${REPO_ROOT}${path.sep}`) === false
        && path.resolve(REPO_ROOT, suite.cwd) !== REPO_ROOT) {
      throw new Error('invalid included suite entry');
    }
    ids.add(suite.id);
  }
  for (const suite of manifest.excluded) {
    if (!suite?.id || !Array.isArray(suite.paths) || !suite.risk
      || !suite.reason || !suite.inclusionCondition) {
      throw new Error('invalid excluded suite entry');
    }
  }
  return manifest;
}

export async function cleanupOwnedRun(runRoot, remove = rm) {
  const ownedPath = validateOwnedRunPath(runRoot);
  try {
    const entry = await lstat(ownedPath);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error('cleanup target is not an owned directory');
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  await remove(ownedPath, { recursive: true, force: true });
  try {
    await stat(ownedPath);
    throw new Error('cleanup left run artifacts');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function runSuite(suite, env, abortSignal, onStarted, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(suite.command, suite.args, {
      cwd: path.resolve(REPO_ROOT, suite.cwd),
      env,
      stdio: 'inherit',
      shell: false,
    });
    const abortChild = () => child.kill?.('SIGTERM');
    abortSignal.addEventListener('abort', abortChild, { once: true });
    onStarted();
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      abortSignal.removeEventListener('abort', abortChild);
      resolve({ code: code ?? 1, signal });
    });
  });
}

export async function runReleaseRegression(options = {}) {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST;
  let failure = null;
  let interruptedSignal = null;
  let runRoot = null;
  let ready = false;
  let manifest = null;
  const runAbortController = new AbortController();
  const onSignal = signal => {
    interruptedSignal = signal;
    runAbortController.abort();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const raw = await readFile(manifestPath, 'utf8');
    manifest = validateManifest(JSON.parse(raw));
    runRoot = await mkdtemp(path.join(tmpdir(), RUN_PREFIX));
    const env = {
      ...process.env,
      CI: '1',
      NODE_ENV: 'test',
      EF95_ISOLATED_RUN: 'true',
      EF95_FIXTURE_DIR: path.join(runRoot, 'fixtures'),
      EF95_OUTPUT_DIR: path.join(runRoot, 'output'),
      TMPDIR: runRoot,
    };
    for (const suite of manifest.included) {
      if (interruptedSignal) throw new Error(`release suite interrupted: ${interruptedSignal}`);
      process.stdout.write(`[release] ${suite.id}\n`);
      const result = await runSuite(suite, env, runAbortController.signal, () => {
        if (!ready) {
          ready = true;
          process.stdout.write('[release] isolated runner ready\n');
        }
      }, options.spawnImpl);
      if (result.code !== 0 || result.signal) {
        throw new Error(`suite failed: ${suite.id}`);
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    if (runRoot) {
      try {
        await cleanupOwnedRun(runRoot, options.removeImpl);
      } catch (cleanupError) {
        failure = failure
          ? new AggregateError([failure, cleanupError], 'release failure followed by cleanup failure')
          : cleanupError;
      }
    }
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  if (failure) throw failure;
  if (!manifest) throw new Error('validated release-suite manifest unavailable');
  process.stdout.write(`[release] ${manifest.included.length} approved suites passed; isolated artifacts cleaned\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleaseRegression().catch(error => {
    process.stderr.write(`[release] failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
