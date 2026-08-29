import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createReviewManifest, declaredScopeId, loadScope } from '../review-manifest.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const EF118_HEAD = 'f35b3ca99fd498b13b530c6c2eed305c5f7688c3';
const LEGACY_PATHS = [
  '.github/workflows/release-gate.yml',
  'scripts/ef111-scope.manifest.json',
  'scripts/review-manifest.mjs',
  'scripts/release-suite.manifest.json',
  'scripts/__tests__/ef94-ci-release-gate.test.mjs',
  'scripts/__tests__/ef111-review-manifest.test.mjs',
  'docs/EF-94-ci-release-gate.md',
];
const EF118_PATHS = [
  '.github/workflows/deploy-dev.yml',
  'server/src/__tests__/ef118-runtime-audit.test.ts',
  'server/src/index.ts',
  'server/src/observability/ef118RuntimeAudit.ts',
  'server/src/routes/conversations.ts',
];
const scopeObject = {
  schemaVersion: 2,
  legacyAllowedPaths: LEGACY_PATHS,
  approvedProfiles: [{
    id: 'ef-118-pr-43-f35b3ca',
    pullRequestNumber: 43,
    baseRef: 'dev',
    headSha: EF118_HEAD,
    allowedPaths: EF118_PATHS,
  }],
};
const scope = JSON.stringify(scopeObject);
const gitAt = value => args => { assert.deepEqual(args, ['rev-parse', 'HEAD']); return value; };

async function eventFixture({ number = 17, head = HEAD, baseRef = 'dev', body = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ef111-event-'));
  const file = path.join(root, 'event.json');
  await writeFile(file, JSON.stringify({
    number,
    pull_request: { number, body, base: { ref: baseRef, sha: BASE }, head: { sha: head } },
  }));
  return { root, file };
}

function optionsFor(file, head, changed, scopeText = scope) {
  return {
    git: gitAt(head),
    read: async target => target === file ? readFile(target, 'utf8') : scopeText,
    execFile: (_bin, args) => {
      assert.deepEqual(args, ['diff', '--name-only', `${BASE}...${head}`]);
      return changed;
    },
  };
}

test('push and workflow dispatch retain the non-PR identity contract', async () => {
  for (const eventName of ['push', 'workflow_dispatch']) {
    const manifest = await createReviewManifest({ GITHUB_EVENT_NAME: eventName, GITHUB_SHA: HEAD }, { git: gitAt(HEAD) });
    assert.deepEqual(manifest, {
      schemaVersion: 2, eventName, checkedOutSha: HEAD, baseSha: null,
      headSha: HEAD, prNumber: null, scopeId: null, changedPaths: null,
    });
  }
});

test('legacy EF-111 seven-path behavior passes without a declaration', async t => {
  const { root, file } = await eventFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = await createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, HEAD, `${LEGACY_PATHS.join('\n')}\n`),
  );
  assert.equal(manifest.scopeId, 'ef-111-legacy-seven-path');
  assert.deepEqual(manifest.changedPaths, LEGACY_PATHS);
});

test('legacy scope rejects a non-seven path and an empty diff', async t => {
  const { root, file } = await eventFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, HEAD, 'server/src/index.ts\n'),
  ), /out-of-scope path/);
  await assert.rejects(createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, HEAD, ''),
  ), /no changed paths/);
});

test('the exact EF-118 PR 43 profile and five-path diff pass', async t => {
  const { root, file } = await eventFixture({
    number: 43,
    head: EF118_HEAD,
    body: 'Bounded runtime audit.\n\nReview-Scope: ef-118-pr-43-f35b3ca',
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = await createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, EF118_HEAD, `${EF118_PATHS.join('\n')}\n`),
  );
  assert.equal(manifest.scopeId, 'ef-118-pr-43-f35b3ca');
  assert.equal(manifest.prNumber, 43);
  assert.equal(manifest.headSha, EF118_HEAD);
  assert.deepEqual(manifest.changedPaths, EF118_PATHS);
});

test('EF-118 PR 43 is rejected when its explicit declaration is missing', async t => {
  const { root, file } = await eventFixture({ number: 43, head: EF118_HEAD });
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, EF118_HEAD, `${EF118_PATHS.join('\n')}\n`),
  ), /out-of-scope path/);
});

test('EF-118 declaration rejects an extra or unknown path', async t => {
  const { root, file } = await eventFixture({ number: 43, head: EF118_HEAD, body: 'Review-Scope: ef-118-pr-43-f35b3ca' });
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, EF118_HEAD, `${EF118_PATHS.join('\n')}\nserver/src/unknown.ts\n`),
  ), /out-of-scope path/);
});

test('profile is bound to the exact PR, base, head and checkout identity', async t => {
  const variants = [
    { number: 44, head: EF118_HEAD, baseRef: 'dev', checkedOut: EF118_HEAD },
    { number: 43, head: HEAD, baseRef: 'dev', checkedOut: HEAD },
    { number: 43, head: EF118_HEAD, baseRef: 'main', checkedOut: EF118_HEAD },
    { number: 43, head: EF118_HEAD, baseRef: 'dev', checkedOut: HEAD },
  ];
  for (const variant of variants) {
    const { root, file } = await eventFixture({ ...variant, body: 'Review-Scope: ef-118-pr-43-f35b3ca' });
    t.after(() => rm(root, { recursive: true, force: true }));
    const action = createReviewManifest(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
      { ...optionsFor(file, variant.head, `${EF118_PATHS.join('\n')}\n`), git: gitAt(variant.checkedOut) },
    );
    await assert.rejects(action, /base ref must be dev|head SHA.*checked-out|profile does not match PR identity/);
  }
});

test('unknown scope declaration is rejected through the production path', async t => {
  const { root, file } = await eventFixture({ body: 'Review-Scope: unknown-profile' });
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, HEAD, 'scripts/review-manifest.mjs\n'),
  ), /unknown scope declaration/);
  assert.throws(() => declaredScopeId('Review-Scope: one\nReview-Scope: two'), /exactly once/);
  assert.throws(() => declaredScopeId(' review-scope: ef-118-pr-43-f35b3ca'), /malformed/);
  assert.throws(() => declaredScopeId('Review-Scope: ../escape'), /malformed/);
});

test('scope manifest rejects replacement, duplicate, glob, prefix and unknown fields', async () => {
  const mutations = [
    { ...scopeObject, legacyAllowedPaths: [...LEGACY_PATHS.slice(0, 6), 'client/app/index.tsx'] },
    { ...scopeObject, legacyAllowedPaths: [...LEGACY_PATHS.slice(0, 6), LEGACY_PATHS[0]] },
    { ...scopeObject, approvedProfiles: [{ ...scopeObject.approvedProfiles[0], allowedPaths: [...EF118_PATHS.slice(0, 4), 'server/src/**'] }] },
    { ...scopeObject, approvedProfiles: [{ ...scopeObject.approvedProfiles[0], allowedPaths: [...EF118_PATHS.slice(0, 4), 'server/src'] }] },
    { ...scopeObject, unexpected: true },
    { ...scopeObject, approvedProfiles: [{ ...scopeObject.approvedProfiles[0], headSha: HEAD }] },
  ];
  for (const mutation of mutations) {
    await assert.rejects(loadScope(async () => JSON.stringify(mutation)), /malformed|unapproved|non-exact/);
  }
});

test('non-dev PR, malformed SHA and mismatched checkout remain rejected', async t => {
  const wrongBase = await eventFixture({ baseRef: 'main' });
  const badSha = await eventFixture({ head: 'short' });
  t.after(() => Promise.all([wrongBase, badSha].map(item => rm(item.root, { recursive: true, force: true }))));
  await assert.rejects(createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: wrongBase.file },
    optionsFor(wrongBase.file, HEAD, 'scripts/review-manifest.mjs\n'),
  ), /base ref must be dev/);
  await assert.rejects(createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: badSha.file },
    { git: gitAt(HEAD), read: async target => target === badSha.file ? readFile(target, 'utf8') : scope },
  ), /40-character lowercase SHA/);
  const valid = await eventFixture();
  t.after(() => rm(valid.root, { recursive: true, force: true }));
  await assert.rejects(createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: valid.file },
    { ...optionsFor(valid.file, HEAD, 'scripts/review-manifest.mjs\n'), git: gitAt(BASE) },
  ), /head SHA.*checked-out candidate/);
});
