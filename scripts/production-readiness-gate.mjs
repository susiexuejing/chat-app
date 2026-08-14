import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REQUIRED_CHECKS = [
  'ef-94-release-gate',
  'ef-95-isolated-release-regression',
  'gitleaks-current-tree',
];
const DISALLOWED_EVIDENCE_KEY = /(secret|token|password|authorization|cookie|email|phone|user.?message|raw.?user|prompt)/i;

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
}

function assertSafeEvidence(value, trail = 'evidence') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeEvidence(entry, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (DISALLOWED_EVIDENCE_KEY.test(key)) {
      throw new Error(`disallowed sensitive or user-data field: ${trail}.${key}`);
    }
    assertSafeEvidence(child, `${trail}.${key}`);
  }
}

function assertSha(value, label) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be a full lowercase 40-character Git commit`);
  }
}

function assertNonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
}

function assertUtc(value, label) {
  if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a UTC ISO timestamp`);
  }
}

export function getCheckoutCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

export async function sha256File(filePath) {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export function validateReadinessManifest(manifest, options = {}) {
  assertSafeEvidence(manifest);
  assertObject(manifest, 'manifest');
  assertExactKeys(manifest, [
    'schemaVersion', 'manifestType', 'gitCommit', 'applicationVersion', 'buildTime',
    'environment', 'artifacts', 'checks', 'provenance',
  ], 'manifest');
  if (manifest.schemaVersion !== 1 || manifest.manifestType !== 'emotionflow-production-readiness') {
    throw new Error('malformed readiness manifest schema');
  }
  assertSha(manifest.gitCommit, 'manifest.gitCommit');
  if (manifest.environment !== 'production') throw new Error('manifest environment must be production');
  assertNonEmpty(manifest.applicationVersion, 'manifest.applicationVersion');
  assertUtc(manifest.buildTime, 'manifest.buildTime');
  if (options.approvedCommit !== undefined) {
    assertSha(options.approvedCommit, 'approvedCommit');
    if (manifest.gitCommit !== options.approvedCommit) throw new Error('manifest commit does not match approved commit');
  }
  if (options.checkoutCommit !== undefined) {
    assertSha(options.checkoutCommit, 'checkoutCommit');
    if (manifest.gitCommit !== options.checkoutCommit) throw new Error('manifest commit does not match checkout commit');
  }

  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error('at least one artifact checksum is required');
  }
  const artifactNames = new Set();
  for (const artifact of manifest.artifacts) {
    assertObject(artifact, 'artifact');
    assertExactKeys(artifact, ['name', 'sha256', 'sizeBytes'], 'artifact');
    assertNonEmpty(artifact.name, 'artifact.name');
    if (artifactNames.has(artifact.name)) throw new Error('duplicate artifact name');
    artifactNames.add(artifact.name);
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256)) throw new Error('artifact checksum is malformed');
    if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
      throw new Error('artifact size must be positive');
    }
  }

  if (!Array.isArray(manifest.checks)) throw new Error('checks are required');
  const checks = new Map();
  for (const check of manifest.checks) {
    assertObject(check, 'check');
    assertExactKeys(check, ['id', 'status', 'command', 'evidenceSha256'], 'check');
    assertNonEmpty(check.id, 'check.id');
    if (checks.has(check.id)) throw new Error('duplicate required check');
    if (check.status !== 'passed') throw new Error(`required check failed: ${check.id}`);
    assertNonEmpty(check.command, 'check.command');
    if (check.evidenceSha256 !== undefined && !/^[0-9a-f]{64}$/.test(check.evidenceSha256)) {
      throw new Error('check evidence checksum is malformed');
    }
    checks.set(check.id, check);
  }
  for (const id of REQUIRED_CHECKS) {
    if (!checks.has(id)) throw new Error(`required check missing: ${id}`);
  }
  if (checks.get('ef-94-release-gate').command !== 'pnpm run test:release'
    || checks.get('ef-95-isolated-release-regression').command !== 'pnpm run test:release'
    || !checks.get('ef-95-isolated-release-regression').evidenceSha256) {
    throw new Error('EF-94/EF-95 canonical provenance is invalid');
  }

  assertObject(manifest.provenance, 'provenance');
  assertExactKeys(manifest.provenance, ['repository', 'workflow', 'runId', 'runAttempt'], 'provenance');
  for (const field of ['repository', 'workflow', 'runId', 'runAttempt']) {
    assertNonEmpty(String(manifest.provenance[field] ?? ''), `provenance.${field}`);
  }
  return manifest;
}

export async function verifyArtifactChecksums(manifest, artifactPaths) {
  for (const artifact of manifest.artifacts) {
    const artifactPath = artifactPaths[artifact.name];
    if (!artifactPath) throw new Error(`artifact file missing: ${artifact.name}`);
    const [checksum, metadata] = await Promise.all([sha256File(artifactPath), stat(artifactPath)]);
    if (checksum !== artifact.sha256 || metadata.size !== artifact.sizeBytes) {
      throw new Error(`artifact checksum mismatch: ${artifact.name}`);
    }
  }
}

export async function createReadinessManifest({
  approvedCommit,
  checkoutCommit,
  applicationVersion,
  buildTime,
  artifacts,
  ef95ManifestPath,
  provenance,
}) {
  assertSha(approvedCommit, 'approvedCommit');
  assertSha(checkoutCommit, 'checkoutCommit');
  if (approvedCommit !== checkoutCommit) throw new Error('checkout commit does not match approved commit');
  const artifactEntries = await Promise.all(artifacts.map(async ({ name, filePath }) => {
    const metadata = await stat(filePath);
    return { name, sha256: await sha256File(filePath), sizeBytes: metadata.size };
  }));
  const ef95ManifestSha256 = await sha256File(ef95ManifestPath);
  const manifest = {
    schemaVersion: 1,
    manifestType: 'emotionflow-production-readiness',
    gitCommit: checkoutCommit,
    applicationVersion,
    buildTime,
    environment: 'production',
    artifacts: artifactEntries,
    checks: [
      { id: 'ef-94-release-gate', status: 'passed', command: 'pnpm run test:release' },
      {
        id: 'ef-95-isolated-release-regression', status: 'passed',
        command: 'pnpm run test:release', evidenceSha256: ef95ManifestSha256,
      },
      { id: 'gitleaks-current-tree', status: 'passed', command: 'gitleaks detect --no-git --redact' },
    ],
    provenance,
  };
  return validateReadinessManifest(manifest, { approvedCommit, checkoutCommit });
}

function validateIdentity(identity, label, expected) {
  assertObject(identity, label);
  assertExactKeys(identity, ['gitCommit', 'applicationVersion', 'buildTime', 'environment', 'health'], label);
  assertSha(identity.gitCommit, `${label}.gitCommit`);
  assertNonEmpty(identity.applicationVersion, `${label}.applicationVersion`);
  assertUtc(identity.buildTime, `${label}.buildTime`);
  if (identity.environment !== 'production') throw new Error(`${label} environment must be production`);
  if (identity.health !== 'ok') throw new Error(`${label} is unhealthy`);
  if (expected && (identity.gitCommit !== expected.gitCommit
    || identity.applicationVersion !== expected.applicationVersion
    || identity.buildTime !== expected.buildTime)) {
    throw new Error(`${label} identity does not match approved artifact`);
  }
}

export function validatePostDeployEvidence(evidence, readinessManifest, options = {}) {
  validateReadinessManifest(readinessManifest);
  assertSafeEvidence(evidence);
  assertObject(evidence, 'postDeployEvidence');
  assertExactKeys(evidence, [
    'schemaVersion', 'evidenceType', 'manifestSha256', 'activationOutcome',
    'frontend', 'backend', 'rollbackPlan', 'rollbackVerification',
  ], 'postDeployEvidence');
  if (evidence.schemaVersion !== 1 || evidence.evidenceType !== 'emotionflow-production-post-deploy') {
    throw new Error('malformed post-deploy evidence schema');
  }
  if (!/^[0-9a-f]{64}$/.test(evidence.manifestSha256)) throw new Error('manifest checksum is required');
  if (options.manifestSha256 !== undefined && evidence.manifestSha256 !== options.manifestSha256) {
    throw new Error('post-deploy evidence references a different readiness manifest');
  }
  const expected = {
    gitCommit: readinessManifest.gitCommit,
    applicationVersion: readinessManifest.applicationVersion,
    buildTime: readinessManifest.buildTime,
  };
  validateIdentity(evidence.frontend, 'frontend', expected);
  validateIdentity(evidence.backend, 'backend', expected);
  if (evidence.frontend.gitCommit !== evidence.backend.gitCommit) {
    throw new Error('frontend/backend commit mismatch');
  }

  const rollback = assertObject(evidence.rollbackPlan, 'rollbackPlan');
  assertExactKeys(rollback, [
    'targetGitCommit', 'targetApplicationVersion', 'capturedAt',
    'targetBuildTime', 'artifactManifestSha256', 'backupIntegrityVerified',
  ], 'rollbackPlan');
  assertSha(rollback.targetGitCommit, 'rollbackPlan.targetGitCommit');
  if (rollback.targetGitCommit === readinessManifest.gitCommit) {
    throw new Error('rollback target must differ from failed candidate');
  }
  assertNonEmpty(rollback.targetApplicationVersion, 'rollbackPlan.targetApplicationVersion');
  assertUtc(rollback.targetBuildTime, 'rollbackPlan.targetBuildTime');
  assertUtc(rollback.capturedAt, 'rollbackPlan.capturedAt');
  if (!/^[0-9a-f]{64}$/.test(rollback.artifactManifestSha256)
    || rollback.backupIntegrityVerified !== true) {
    throw new Error('rollback target is unverifiable');
  }

  if (evidence.activationOutcome === 'candidate_active') {
    if (evidence.rollbackVerification !== null) throw new Error('unexpected rollback verification');
  } else if (evidence.activationOutcome === 'rolled_back') {
    validateIdentity(evidence.rollbackVerification, 'rollbackVerification', {
      gitCommit: rollback.targetGitCommit,
      applicationVersion: rollback.targetApplicationVersion,
      buildTime: rollback.targetBuildTime,
    });
  } else {
    throw new Error('activation outcome is invalid');
  }
  return evidence;
}

function parseArgs(argv) {
  const parsed = { artifact: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('invalid CLI arguments');
    if (key === '--artifact') parsed.artifact.push(value);
    else parsed[key.slice(2)] = value;
  }
  return parsed;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === 'generate') {
    const checkoutCommit = getCheckoutCommit();
    const artifacts = args.artifact.map(entry => {
      const separator = entry.indexOf('=');
      if (separator < 1) throw new Error('artifact must use name=path');
      return { name: entry.slice(0, separator), filePath: entry.slice(separator + 1) };
    });
    const manifest = await createReadinessManifest({
      approvedCommit: args['approved-commit'], checkoutCommit,
      applicationVersion: args['app-version'], buildTime: args['build-time'], artifacts,
      ef95ManifestPath: args['ef95-manifest'],
      provenance: {
        repository: args.repository, workflow: args.workflow,
        runId: args['run-id'], runAttempt: args['run-attempt'],
      },
    });
    await writeFile(args.output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    return;
  }
  if (command === 'validate') {
    const manifest = JSON.parse(await readFile(args.manifest, 'utf8'));
    validateReadinessManifest(manifest, {
      approvedCommit: args['approved-commit'], checkoutCommit: getCheckoutCommit(),
    });
    const artifactPaths = Object.fromEntries(args.artifact.map(entry => {
      const separator = entry.indexOf('=');
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }));
    await verifyArtifactChecksums(manifest, artifactPaths);
    return;
  }
  if (command === 'validate-postdeploy') {
    const [manifestRaw, evidenceRaw] = await Promise.all([
      readFile(args.manifest, 'utf8'), readFile(args.evidence, 'utf8'),
    ]);
    const evidence = JSON.parse(evidenceRaw);
    validatePostDeployEvidence(evidence, JSON.parse(manifestRaw), {
      manifestSha256: createHash('sha256').update(manifestRaw).digest('hex'),
    });
    return;
  }
  throw new Error('expected generate, validate, or validate-postdeploy command');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[production-readiness] failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
