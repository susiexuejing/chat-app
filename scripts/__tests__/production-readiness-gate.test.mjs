import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import {
  createReadinessManifest,
  getCheckoutCommit,
  sha256File,
  validatePostDeployEvidence,
  validateReadinessManifest,
  verifyArtifactChecksums,
} from '../production-readiness-gate.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('../production-readiness-gate.mjs', import.meta.url));
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const CANDIDATE = 'a'.repeat(40);
const ROLLBACK = 'b'.repeat(40);
const CHECKSUM = 'c'.repeat(64);
const roots = [];

after(async () => Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))));

function validManifest() {
  return {
    schemaVersion: 1,
    manifestType: 'emotionflow-production-readiness',
    gitCommit: CANDIDATE,
    applicationVersion: '1.0.0',
    buildTime: '2026-08-14T01:02:03Z',
    environment: 'production',
    artifacts: [{ name: 'frontend.tar.gz', sha256: CHECKSUM, sizeBytes: 12 }],
    checks: [
      { id: 'ef-94-release-gate', status: 'passed', command: 'pnpm run test:release' },
      {
        id: 'ef-95-isolated-release-regression', status: 'passed',
        command: 'pnpm run test:release', evidenceSha256: CHECKSUM,
      },
      { id: 'gitleaks-current-tree', status: 'passed', command: 'gitleaks detect --no-git --redact' },
    ],
    provenance: {
      repository: 'synthetic/repository', workflow: 'Production Readiness Gate',
      runId: '100', runAttempt: '1',
    },
  };
}

function identity(gitCommit = CANDIDATE) {
  return {
    gitCommit,
    applicationVersion: '1.0.0',
    buildTime: '2026-08-14T01:02:03Z',
    environment: 'production',
    health: 'ok',
  };
}

function validPostDeployEvidence() {
  return {
    schemaVersion: 1,
    evidenceType: 'emotionflow-production-post-deploy',
    manifestSha256: CHECKSUM,
    activationOutcome: 'candidate_active',
    frontend: identity(),
    backend: identity(),
    rollbackPlan: {
      targetGitCommit: ROLLBACK,
      targetApplicationVersion: '0.9.0',
      targetBuildTime: '2026-08-13T01:02:03Z',
      capturedAt: '2026-08-14T00:00:00Z',
      artifactManifestSha256: 'd'.repeat(64),
      backupIntegrityVerified: true,
    },
    rollbackVerification: null,
  };
}

test('fully valid synthetic readiness and post-deploy evidence pass', () => {
  const manifest = validateReadinessManifest(validManifest(), {
    approvedCommit: CANDIDATE,
    checkoutCommit: CANDIDATE,
  });
  assert.equal(validatePostDeployEvidence(validPostDeployEvidence(), manifest).activationOutcome, 'candidate_active');
});

test('non-40-character and uppercase commits are rejected', () => {
  for (const gitCommit of ['abc', 'A'.repeat(40)]) {
    const manifest = validManifest();
    manifest.gitCommit = gitCommit;
    assert.throws(() => validateReadinessManifest(manifest), /40-character Git commit/);
  }
});

test('unknown or unauthorized checkout cannot masquerade as approved commit', () => {
  assert.throws(() => validateReadinessManifest(validManifest(), {
    approvedCommit: CANDIDATE,
    checkoutCommit: 'f'.repeat(40),
  }), /checkout commit/);
});

test('missing, DEV, and ambiguous environments are rejected', () => {
  for (const environment of [undefined, 'DEV', 'prod']) {
    const manifest = validManifest();
    manifest.environment = environment;
    assert.throws(() => validateReadinessManifest(manifest), /environment must be production/);
  }
});

test('missing application version or build time is rejected', () => {
  const noVersion = validManifest();
  noVersion.applicationVersion = '';
  assert.throws(() => validateReadinessManifest(noVersion), /applicationVersion is required/);
  const noTime = validManifest();
  noTime.buildTime = '';
  assert.throws(() => validateReadinessManifest(noTime), /UTC ISO timestamp/);
});

test('malformed or extensible manifest schema fails closed', () => {
  const malformed = validManifest();
  malformed.schemaVersion = 2;
  assert.throws(() => validateReadinessManifest(malformed), /malformed readiness manifest/);
  const extended = validManifest();
  extended.notes = 'unapproved';
  assert.throws(() => validateReadinessManifest(extended), /unsupported field/);
});

test('artifact tampering and missing artifact files are rejected', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ef93-checksum-'));
  roots.push(root);
  const file = path.join(root, 'frontend.tar.gz');
  await writeFile(file, 'approved artifact');
  const manifest = validManifest();
  manifest.artifacts[0] = {
    name: 'frontend.tar.gz',
    sha256: await sha256File(file),
    sizeBytes: 17,
  };
  await verifyArtifactChecksums(manifest, { 'frontend.tar.gz': file });
  await writeFile(file, 'tampered artifact');
  await assert.rejects(verifyArtifactChecksums(manifest, { 'frontend.tar.gz': file }), /checksum mismatch/);
  await assert.rejects(verifyArtifactChecksums(manifest, {}), /artifact file missing/);
});

test('missing or failed EF-94, EF-95, and secret checks are rejected', () => {
  for (const id of ['ef-94-release-gate', 'ef-95-isolated-release-regression', 'gitleaks-current-tree']) {
    const missing = validManifest();
    missing.checks = missing.checks.filter(check => check.id !== id);
    assert.throws(() => validateReadinessManifest(missing), /required check missing/);
    const failed = validManifest();
    failed.checks.find(check => check.id === id).status = 'failed';
    assert.throws(() => validateReadinessManifest(failed), /required check failed/);
  }
});

test('EF-94 and EF-95 provenance cannot replace the canonical command or manifest checksum', () => {
  const commandChanged = validManifest();
  commandChanged.checks[0].command = 'node synthetic-other-runner.js';
  assert.throws(() => validateReadinessManifest(commandChanged), /canonical provenance/);
  const noManifestChecksum = validManifest();
  delete noManifestChecksum.checks[1].evidenceSha256;
  assert.throws(() => validateReadinessManifest(noManifestChecksum), /canonical provenance/);
});

test('manifest generation derives cryptographic artifact and EF-95 provenance', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ef93-generate-'));
  roots.push(root);
  const artifact = path.join(root, 'artifact.tar.gz');
  const ef95 = path.join(root, 'release-suite.manifest.json');
  await writeFile(artifact, 'synthetic immutable artifact');
  await writeFile(ef95, '{"schemaVersion":1}');
  const manifest = await createReadinessManifest({
    approvedCommit: CANDIDATE,
    checkoutCommit: CANDIDATE,
    applicationVersion: '1.0.0',
    buildTime: '2026-08-14T01:02:03Z',
    artifacts: [{ name: 'artifact.tar.gz', filePath: artifact }],
    ef95ManifestPath: ef95,
    provenance: {
      repository: 'synthetic/repository', workflow: 'Production Readiness Gate',
      runId: '100', runAttempt: '1',
    },
  });
  assert.equal(manifest.artifacts[0].sha256, await sha256File(artifact));
  assert.equal(manifest.checks[1].evidenceSha256, await sha256File(ef95));
});

test('real CLI generates and validates an exact-checkout synthetic artifact', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ef93-cli-'));
  roots.push(root);
  const artifact = path.join(root, 'frontend.tar.gz');
  const ef95 = path.join(root, 'release-suite.manifest.json');
  const output = path.join(root, 'manifest.json');
  await writeFile(artifact, 'synthetic CLI artifact');
  await writeFile(ef95, '{"schemaVersion":1}');
  const checkoutCommit = getCheckoutCommit();
  const generate = spawnSync(process.execPath, [
    SCRIPT_PATH, 'generate',
    '--approved-commit', checkoutCommit,
    '--app-version', '1.0.0',
    '--build-time', '2026-08-14T01:02:03Z',
    '--ef95-manifest', ef95,
    '--repository', 'synthetic/repository',
    '--workflow', 'Production Readiness Gate',
    '--run-id', '100',
    '--run-attempt', '1',
    '--artifact', `frontend.tar.gz=${artifact}`,
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(generate.status, 0, generate.stderr);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).gitCommit, checkoutCommit);
  const validate = spawnSync(process.execPath, [
    SCRIPT_PATH, 'validate',
    '--approved-commit', checkoutCommit,
    '--manifest', output,
    '--artifact', `frontend.tar.gz=${artifact}`,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(validate.status, 0, validate.stderr);
});

test('frontend/backend commit mismatch is rejected', () => {
  const evidence = validPostDeployEvidence();
  evidence.backend.gitCommit = 'e'.repeat(40);
  assert.throws(() => validatePostDeployEvidence(evidence, validManifest()), /identity does not match/);
});

test('post-deploy evidence must reference the exact readiness manifest checksum', () => {
  assert.throws(() => validatePostDeployEvidence(
    validPostDeployEvidence(), validManifest(), { manifestSha256: 'd'.repeat(64) },
  ), /different readiness manifest/);
});

test('backend environment other than production is rejected', () => {
  const evidence = validPostDeployEvidence();
  evidence.backend.environment = 'DEV';
  assert.throws(() => validatePostDeployEvidence(evidence, validManifest()), /environment must be production/);
});

test('unhealthy backend is rejected', () => {
  const evidence = validPostDeployEvidence();
  evidence.backend.health = 'degraded';
  assert.throws(() => validatePostDeployEvidence(evidence, validManifest()), /unhealthy/);
});

test('rollback target absent, same as candidate, or unverifiable is rejected', () => {
  const absent = validPostDeployEvidence();
  absent.rollbackPlan.targetGitCommit = '';
  assert.throws(() => validatePostDeployEvidence(absent, validManifest()), /40-character Git commit/);
  const same = validPostDeployEvidence();
  same.rollbackPlan.targetGitCommit = CANDIDATE;
  assert.throws(() => validatePostDeployEvidence(same, validManifest()), /must differ/);
  const unverifiable = validPostDeployEvidence();
  unverifiable.rollbackPlan.backupIntegrityVerified = false;
  assert.throws(() => validatePostDeployEvidence(unverifiable, validManifest()), /unverifiable/);
});

test('rolled-back outcome requires independently healthy exact target verification', () => {
  const evidence = validPostDeployEvidence();
  evidence.activationOutcome = 'rolled_back';
  evidence.rollbackVerification = {
    ...identity(ROLLBACK),
    applicationVersion: '0.9.0',
    buildTime: '2026-08-13T01:02:03Z',
  };
  validatePostDeployEvidence(evidence, validManifest());
  evidence.rollbackVerification.gitCommit = 'e'.repeat(40);
  assert.throws(() => validatePostDeployEvidence(evidence, validManifest()), /does not match/);
});

test('secret-like and raw-user-data evidence fields are rejected recursively', () => {
  for (const field of ['accessToken', 'rawUserMessage']) {
    const evidence = validPostDeployEvidence();
    evidence.rollbackPlan[field] = 'synthetic forbidden value';
    assert.throws(() => validatePostDeployEvidence(evidence, validManifest()), /disallowed sensitive or user-data field/);
  }
});
