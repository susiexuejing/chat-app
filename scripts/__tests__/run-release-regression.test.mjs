import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import {
  cleanupOwnedRun,
  runReleaseRegression,
  validateManifest,
  validateOwnedRunPath,
} from '../run-release-regression.mjs';

const validManifest = {
  schemaVersion: 1,
  suiteId: 'synthetic-runner-test',
  included: [{
    id: 'synthetic-suite', gate: 'runner-test', cwd: '.', command: 'synthetic-command', args: [],
    coverage: 'runner mechanics', safety: 'synthetic child only', fixtureIsolation: 'run temp root',
  }],
  excluded: [{
    id: 'unsafe', paths: ['synthetic-unsafe'], risk: 'external-state',
    reason: 'synthetic exclusion', inclusionCondition: 'prove isolation',
  }],
};
const manifestRoots = [];

async function releaseResidues() {
  return (await readdir(tmpdir()))
    .filter(name => name.startsWith('emotionflow-ef95-release-'))
    .sort();
}

after(async () => {
  await Promise.all(manifestRoots.map(root => rm(root, { recursive: true, force: true })));
});

async function manifestFile(manifest) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ef95-manifest-test-'));
  manifestRoots.push(dir);
  const file = path.join(dir, 'manifest.json');
  await writeFile(file, JSON.stringify(manifest));
  return file;
}

function spawnWithExit(code) {
  return (_command, _args, options) => {
    assert.equal(options.env.EF95_ISOLATED_RUN, 'true');
    assert.ok(options.env.EF95_FIXTURE_DIR.startsWith(tmpdir()));
    assert.ok(options.env.EF95_OUTPUT_DIR.startsWith(tmpdir()));
    const child = new EventEmitter();
    child.kill = () => { queueMicrotask(() => child.emit('exit', null, 'SIGTERM')); return true; };
    queueMicrotask(() => child.emit('exit', code, null));
    return child;
  };
}

function cliManifest(exitCode) {
  return {
    ...validManifest,
    included: [{
      ...validManifest.included[0],
      command: process.execPath,
      args: ['-e', `process.exit(${exitCode})`],
    }],
  };
}

async function runUntilReadyAndSignal(file, signal, readinessTimeoutMs = 2_000) {
  const before = new Set(await releaseResidues());
  const sibling = await mkdtemp(path.join(tmpdir(), 'emotionflow-ef95-release-'));
  const siblingName = path.basename(sibling);
  before.add(siblingName);
  const child = spawn(process.execPath, ['scripts/run-release-regression.mjs'], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, EF95_MANIFEST_PATH: file },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('readiness marker timeout'));
    }, readinessTimeoutMs);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('[release] isolated runner ready\n')) child.kill(signal);
    });
    child.once('exit', (code, terminationSignal) => {
      clearTimeout(timeout);
      resolve({ code, signal: terminationSignal });
    });
  });
  const after = new Set(await releaseResidues());
  const delta = [...after].filter(name => !before.has(name));
  assert.notEqual(result.code, 0);
  assert.equal(result.signal, null);
  assert.deepEqual(delta, []);
  assert.equal((await stat(sibling)).isDirectory(), true);
  await cleanupOwnedRun(sibling);
}

test('valid manifest and successful suite return without artifacts', async () => {
  const file = await manifestFile(validManifest);
  const before = await releaseResidues();
  let removedPath;
  await runReleaseRegression({
    manifestPath: file,
    spawnImpl: spawnWithExit(0),
    removeImpl: async runRoot => { removedPath = runRoot; await import('node:fs/promises').then(fs => fs.rm(runRoot, { recursive: true, force: true })); },
  });
  await assert.rejects(stat(removedPath), error => error.code === 'ENOENT');
  assert.deepEqual(await releaseResidues(), before);
});

test('one failing suite propagates a non-zero CLI outcome and still cleans', async () => {
  const file = await manifestFile(validManifest);
  const before = await releaseResidues();
  let cleanupCalled = false;
  await assert.rejects(runReleaseRegression({
    manifestPath: file,
    spawnImpl: spawnWithExit(7),
    removeImpl: async runRoot => { cleanupCalled = true; await import('node:fs/promises').then(fs => fs.rm(runRoot, { recursive: true, force: true })); },
  }), /suite failed/);
  assert.equal(cleanupCalled, true);
  assert.deepEqual(await releaseResidues(), before);
});

test('invalid manifest fails closed before suite execution', async () => {
  const file = await manifestFile({ schemaVersion: 99, included: [], excluded: [] });
  const before = await releaseResidues();
  await assert.rejects(runReleaseRegression({ manifestPath: file, spawnImpl: spawnWithExit(0) }), /invalid release-suite manifest/);
  assert.deepEqual(await releaseResidues(), before);
});

test('manifest bootstrap failure leaves zero new run directories', async () => {
  const before = await releaseResidues();
  await assert.rejects(runReleaseRegression({
    manifestPath: path.join(tmpdir(), 'ef95-missing-manifest.json'),
    spawnImpl: spawnWithExit(0),
  }), error => error.code === 'ENOENT');
  assert.deepEqual(await releaseResidues(), before);
});

test('cleanup failure is a safety failure', async () => {
  const file = await manifestFile(validManifest);
  const before = await releaseResidues();
  await assert.rejects(runReleaseRegression({
    manifestPath: file,
    spawnImpl: spawnWithExit(0),
    removeImpl: async runRoot => {
      await rm(runRoot, { recursive: true, force: true });
      throw new Error('synthetic cleanup failure');
    },
  }), /synthetic cleanup failure/);
  assert.deepEqual(await releaseResidues(), before);
});

test('cleanup rejects paths outside the owned OS temp run boundary', async () => {
  assert.throws(() => validateOwnedRunPath(process.cwd()), /cleanup safety boundary rejected/);
  assert.throws(() => validateOwnedRunPath(tmpdir()), /cleanup safety boundary rejected/);
  await assert.rejects(cleanupOwnedRun(path.join(tmpdir(), 'unowned-directory')), /cleanup safety boundary rejected/);
});

test('two consecutive successful invocations leave zero new run directories', async () => {
  const file = await manifestFile(validManifest);
  const before = await releaseResidues();
  await runReleaseRegression({ manifestPath: file, spawnImpl: spawnWithExit(0) });
  await runReleaseRegression({ manifestPath: file, spawnImpl: spawnWithExit(0) });
  assert.deepEqual(await releaseResidues(), before);
});

test('cleanup removes only its owned run ID and leaves a sibling invocation intact', async () => {
  const first = await mkdtemp(path.join(tmpdir(), 'emotionflow-ef95-release-'));
  const sibling = await mkdtemp(path.join(tmpdir(), 'emotionflow-ef95-release-'));
  await cleanupOwnedRun(first);
  await assert.rejects(stat(first), error => error.code === 'ENOENT');
  assert.equal((await stat(sibling)).isDirectory(), true);
  await cleanupOwnedRun(sibling);
});

test('cleanup of an already absent owned path is idempotently successful', async () => {
  const absent = path.join(tmpdir(), 'emotionflow-ef95-release-already-absent');
  await rm(absent, { recursive: true, force: true });
  await cleanupOwnedRun(absent);
});

test('cleanup rejects a symlink without deleting its target', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'ef95-symlink-target-'));
  const link = path.join(tmpdir(), 'emotionflow-ef95-release-symlink');
  await rm(link, { recursive: true, force: true });
  await symlink(target, link);
  await assert.rejects(cleanupOwnedRun(link), /not an owned directory/);
  assert.equal((await stat(target)).isDirectory(), true);
  await rm(link);
  await rm(target, { recursive: true });
});

test('cleanup rejects a regular file at an owned-looking path', async () => {
  const file = path.join(tmpdir(), 'emotionflow-ef95-release-file');
  await writeFile(file, 'fixture');
  await assert.rejects(cleanupOwnedRun(file), /not an owned directory/);
  await rm(file);
});

test('cleanup rejects temp root, repository, HOME, and out-of-bound paths', async () => {
  assert.throws(() => validateOwnedRunPath(tmpdir()), /cleanup safety boundary rejected/);
  assert.throws(() => validateOwnedRunPath(process.cwd()), /cleanup safety boundary rejected/);
  assert.throws(() => validateOwnedRunPath(process.env.HOME), /cleanup safety boundary rejected/);
  assert.throws(() => validateOwnedRunPath('/private/tmp/emotionflow-ef95-release-outside', tmpdir()), /cleanup safety boundary rejected/);
});

test('approved manifest documents every included and excluded entry', async () => {
  const manifest = validateManifest(JSON.parse(await readFile(
    new URL('../release-suite.manifest.json', import.meta.url), 'utf8')));
  assert.equal(manifest.included.length, 2);
  assert.ok(manifest.excluded.length >= 4);
});

test('package script and documentation expose the same canonical command', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '../..');
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const documentation = await readFile(path.join(repoRoot, 'docs/EF-95-isolated-release-regression.md'), 'utf8');
  assert.equal(packageJson.scripts['test:release'], 'node scripts/run-release-regression.mjs');
  assert.match(documentation, /pnpm run test:release/);
  assert.match(documentation, /scripts\/release-suite\.manifest\.json/);
});

test('CLI exits zero when every approved suite succeeds', async () => {
  const file = await manifestFile(cliManifest(0));
  const result = spawnSync(process.execPath, ['scripts/run-release-regression.mjs'], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, EF95_MANIFEST_PATH: file },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout.toString(), /\[release\] 1 approved suites passed; isolated artifacts cleaned/);
});

test('CLI exits non-zero when one approved suite fails', async () => {
  const file = await manifestFile(cliManifest(9));
  const result = spawnSync(process.execPath, ['scripts/run-release-regression.mjs'], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, EF95_MANIFEST_PATH: file },
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout.toString(), /approved suites passed/);
});

test('CLI exits non-zero for an invalid manifest', async () => {
  const file = await manifestFile({ schemaVersion: 7 });
  const result = spawnSync(process.execPath, ['scripts/run-release-regression.mjs'], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, EF95_MANIFEST_PATH: file },
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout.toString(), /approved suites passed/);
});

test('independent invocations report their own validated manifest counts', async () => {
  const oneSuite = await manifestFile(cliManifest(0));
  const twoSuiteManifest = cliManifest(0);
  twoSuiteManifest.included.push({ ...twoSuiteManifest.included[0], id: 'synthetic-suite-two' });
  const twoSuites = await manifestFile(twoSuiteManifest);
  const run = file => new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/run-release-regression.mjs'], {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, EF95_MANIFEST_PATH: file },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.once('exit', (code, signal) => resolve({ code, signal, stdout }));
  });
  const [first, second] = await Promise.all([run(oneSuite), run(twoSuites)]);
  assert.deepEqual([first.code, second.code], [0, 0]);
  assert.deepEqual([first.signal, second.signal], [null, null]);
  assert.match(first.stdout, /\[release\] 1 approved suites passed/);
  assert.match(second.stdout, /\[release\] 2 approved suites passed/);
});

test('readiness followed by SIGTERM stops the child, exits non-zero, and cleans only its run directory', async () => {
  const manifest = cliManifest(0);
  manifest.included[0].args = ['-e', 'setInterval(() => {}, 1000)'];
  const file = await manifestFile(manifest);
  await runUntilReadyAndSignal(file, 'SIGTERM');
});

test('readiness followed by SIGINT stops the child, exits non-zero, and cleans only its run directory', async () => {
  const manifest = cliManifest(0);
  manifest.included[0].args = ['-e', 'setInterval(() => {}, 1000)'];
  const file = await manifestFile(manifest);
  await runUntilReadyAndSignal(file, 'SIGINT');
});

test('readiness timeout safely terminates a test child without EF-95 residue', async () => {
  const before = await releaseResidues();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await new Promise(resolve => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 50);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
  assert.deepEqual(await releaseResidues(), before);
});
