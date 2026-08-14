import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import {
  CANONICAL_EF95_MANIFEST_SHA256,
  CANONICAL_REQUIRED_CHECKS,
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
    checks: CANONICAL_REQUIRED_CHECKS.map(check => ({ ...check })),
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

function postDeployOptions(manifestSha256 = CHECKSUM) {
  return { approvedManifestSha256: manifestSha256, manifestSha256 };
}

test('fully valid synthetic readiness and post-deploy evidence pass', () => {
  const manifest = validateReadinessManifest(validManifest(), {
    approvedCommit: CANDIDATE,
    checkoutCommit: CANDIDATE,
  });
  assert.equal(validatePostDeployEvidence(
    validPostDeployEvidence(), manifest, postDeployOptions(),
  ).activationOutcome, 'candidate_active');
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
    assert.throws(() => validateReadinessManifest(missing), /canonical checks|required check missing/);
    const failed = validManifest();
    failed.checks.find(check => check.id === id).status = 'failed';
    assert.throws(() => validateReadinessManifest(failed), /required check failed/);
  }
});

test('all required checks enforce exact centralized command provenance and EF-95 digest', () => {
  const commandChanged = validManifest();
  commandChanged.checks[0].command = 'node synthetic-other-runner.js';
  assert.throws(() => validateReadinessManifest(commandChanged), /canonical check provenance mismatch/);
  const gitleaksChanged = validManifest();
  gitleaksChanged.checks[2].command = 'echo secret-scan-skipped';
  assert.throws(() => validateReadinessManifest(gitleaksChanged), /gitleaks-current-tree/);
  const manifestDigestChanged = validManifest();
  manifestDigestChanged.checks[1].evidenceSha256 = 'f'.repeat(64);
  assert.throws(() => validateReadinessManifest(manifestDigestChanged), /ef-95-isolated/);
  assert.equal(validManifest().checks[1].evidenceSha256, CANONICAL_EF95_MANIFEST_SHA256);
});

test('manifest generation derives cryptographic artifact and EF-95 provenance', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ef93-generate-'));
  roots.push(root);
  const artifact = path.join(root, 'artifact.tar.gz');
  await writeFile(artifact, 'synthetic immutable artifact');
  const manifest = await createReadinessManifest({
    approvedCommit: CANDIDATE,
    checkoutCommit: CANDIDATE,
    applicationVersion: '1.0.0',
    buildTime: '2026-08-14T01:02:03Z',
    artifacts: [{ name: 'artifact.tar.gz', filePath: artifact }],
    provenance: {
      repository: 'synthetic/repository', workflow: 'Production Readiness Gate',
      runId: '100', runAttempt: '1',
    },
  });
  assert.equal(manifest.artifacts[0].sha256, await sha256File(artifact));
  assert.equal(manifest.checks[1].evidenceSha256, CANONICAL_EF95_MANIFEST_SHA256);
});

test('real CLI generates and validates an exact-checkout synthetic artifact', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ef93-cli-'));
  roots.push(root);
  const artifact = path.join(root, 'frontend.tar.gz');
  const output = path.join(root, 'manifest.json');
  await writeFile(artifact, 'synthetic CLI artifact');
  const checkoutCommit = getCheckoutCommit();
  const generate = spawnSync(process.execPath, [
    SCRIPT_PATH, 'generate',
    '--approved-commit', checkoutCommit,
    '--app-version', '1.0.0',
    '--build-time', '2026-08-14T01:02:03Z',
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

test('post-deploy CLI requires a separately supplied approved manifest trust anchor', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ef93-postdeploy-cli-'));
  roots.push(root);
  const artifact = path.join(root, 'frontend.tar.gz');
  const manifestPath = path.join(root, 'manifest.json');
  const evidencePath = path.join(root, 'evidence.json');
  await writeFile(artifact, 'synthetic postdeploy artifact');
  const checkoutCommit = getCheckoutCommit();
  const generate = spawnSync(process.execPath, [
    SCRIPT_PATH, 'generate', '--approved-commit', checkoutCommit,
    '--app-version', '1.0.0', '--build-time', '2026-08-14T01:02:03Z',
    '--repository', 'synthetic/repository', '--workflow', 'Production Readiness Gate',
    '--run-id', '100', '--run-attempt', '1',
    '--artifact', `frontend.tar.gz=${artifact}`, '--output', manifestPath,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(generate.status, 0, generate.stderr);
  const approvedDigest = await sha256File(manifestPath);
  const evidence = validPostDeployEvidence();
  evidence.manifestSha256 = approvedDigest;
  evidence.frontend.gitCommit = checkoutCommit;
  evidence.backend.gitCommit = checkoutCommit;
  await writeFile(evidencePath, JSON.stringify(evidence));
  const baseArgs = [
    SCRIPT_PATH, 'validate-postdeploy', '--manifest', manifestPath, '--evidence', evidencePath,
  ];
  const missing = spawnSync(process.execPath, baseArgs, { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /approvedManifestSha256/);
  const malformed = spawnSync(process.execPath, [
    ...baseArgs, '--approved-manifest-sha256', 'bad',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /64-character SHA-256/);
  const mismatched = spawnSync(process.execPath, [
    ...baseArgs, '--approved-manifest-sha256', 'f'.repeat(64),
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /must match/);
  const valid = spawnSync(process.execPath, [
    ...baseArgs, '--approved-manifest-sha256', approvedDigest,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  const originalManifest = await readFile(manifestPath, 'utf8');
  await writeFile(manifestPath, `${originalManifest} `);
  const localManifestTampered = spawnSync(process.execPath, [
    ...baseArgs, '--approved-manifest-sha256', approvedDigest,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(localManifestTampered.status, 0);
  assert.match(localManifestTampered.stderr, /must match/);
});

test('frontend/backend commit mismatch is rejected', () => {
  const evidence = validPostDeployEvidence();
  evidence.backend.gitCommit = 'e'.repeat(40);
  assert.throws(() => validatePostDeployEvidence(
    evidence, validManifest(), postDeployOptions(),
  ), /identity does not match/);
});

test('post-deploy requires external approved digest and three-way exact match', () => {
  assert.throws(() => validatePostDeployEvidence(
    validPostDeployEvidence(), validManifest(), { manifestSha256: CHECKSUM },
  ), /approvedManifestSha256/);
  assert.throws(() => validatePostDeployEvidence(
    validPostDeployEvidence(), validManifest(), {
      approvedManifestSha256: 'bad', manifestSha256: CHECKSUM,
    },
  ), /64-character SHA-256/);
  assert.throws(() => validatePostDeployEvidence(
    validPostDeployEvidence(), validManifest(), {
      approvedManifestSha256: 'd'.repeat(64), manifestSha256: CHECKSUM,
    },
  ), /must match/);
  const evidenceMismatch = validPostDeployEvidence();
  evidenceMismatch.manifestSha256 = 'e'.repeat(64);
  assert.throws(() => validatePostDeployEvidence(
    evidenceMismatch, validManifest(), postDeployOptions(),
  ), /must match/);
});

test('backend environment other than production is rejected', () => {
  const evidence = validPostDeployEvidence();
  evidence.backend.environment = 'DEV';
  assert.throws(() => validatePostDeployEvidence(
    evidence, validManifest(), postDeployOptions(),
  ), /environment must be production/);
});

test('unhealthy backend is rejected', () => {
  const evidence = validPostDeployEvidence();
  evidence.backend.health = 'degraded';
  assert.throws(() => validatePostDeployEvidence(
    evidence, validManifest(), postDeployOptions(),
  ), /unhealthy/);
});

test('rollback target absent, same as candidate, or unverifiable is rejected', () => {
  const absent = validPostDeployEvidence();
  absent.rollbackPlan.targetGitCommit = '';
  assert.throws(() => validatePostDeployEvidence(absent, validManifest(), postDeployOptions()), /40-character Git commit/);
  const same = validPostDeployEvidence();
  same.rollbackPlan.targetGitCommit = CANDIDATE;
  assert.throws(() => validatePostDeployEvidence(same, validManifest(), postDeployOptions()), /must differ/);
  const unverifiable = validPostDeployEvidence();
  unverifiable.rollbackPlan.backupIntegrityVerified = false;
  assert.throws(() => validatePostDeployEvidence(unverifiable, validManifest(), postDeployOptions()), /unverifiable/);
});

function exactRollbackIdentity() {
  return {
    ...identity(ROLLBACK),
    applicationVersion: '0.9.0',
    buildTime: '2026-08-13T01:02:03Z',
  };
}

function rolledBackEvidence() {
  const evidence = validPostDeployEvidence();
  evidence.activationOutcome = 'rolled_back';
  evidence.rollbackVerification = {
    frontend: exactRollbackIdentity(),
    backend: exactRollbackIdentity(),
  };
  return evidence;
}

test('valid two-sided exact rollback proof passes', () => {
  validatePostDeployEvidence(rolledBackEvidence(), validManifest(), postDeployOptions());
});

test('flat or missing-sided rollback verification is rejected', () => {
  const flat = rolledBackEvidence();
  flat.rollbackVerification = exactRollbackIdentity();
  assert.throws(() => validatePostDeployEvidence(
    flat, validManifest(), postDeployOptions(),
  ), /unsupported field/);
  for (const side of ['frontend', 'backend']) {
    const missing = rolledBackEvidence();
    delete missing.rollbackVerification[side];
    assert.throws(() => validatePostDeployEvidence(
      missing, validManifest(), postDeployOptions(),
    ), new RegExp(`rollbackVerification\\.${side} must be an object`));
  }
});

test('rollback frontend/backend commit, version, and build mismatches are rejected', () => {
  for (const [field, value] of [
    ['gitCommit', 'e'.repeat(40)],
    ['applicationVersion', '0.8.0'],
    ['buildTime', '2026-08-12T01:02:03Z'],
  ]) {
    const evidence = rolledBackEvidence();
    evidence.rollbackVerification.backend[field] = value;
    assert.throws(() => validatePostDeployEvidence(
      evidence, validManifest(), postDeployOptions(),
    ), /does not match/);
  }
});

test('rollback rejects unhealthy or non-production frontend/backend proof', () => {
  const unhealthy = rolledBackEvidence();
  unhealthy.rollbackVerification.frontend.health = 'degraded';
  assert.throws(() => validatePostDeployEvidence(
    unhealthy, validManifest(), postDeployOptions(),
  ), /unhealthy/);
  const wrongEnvironment = rolledBackEvidence();
  wrongEnvironment.rollbackVerification.backend.environment = 'DEV';
  assert.throws(() => validatePostDeployEvidence(
    wrongEnvironment, validManifest(), postDeployOptions(),
  ), /environment must be production/);
});

test('secret-like and raw-user-data evidence fields are rejected recursively', () => {
  for (const field of ['accessToken', 'rawUserMessage']) {
    const evidence = validPostDeployEvidence();
    evidence.rollbackPlan[field] = 'synthetic forbidden value';
    assert.throws(() => validatePostDeployEvidence(
      evidence, validManifest(), postDeployOptions(),
    ), /disallowed sensitive or user-data field/);
  }
});
