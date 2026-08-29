import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createReviewManifest, declaredScopeId, loadScope, resolveLayout } from '../review-manifest.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const MERGE_BASE = 'c'.repeat(40);
const BOOTSTRAP_BASE = '7bba833e3612b0c9d21b3dc71002387d2cb9b31c';
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
const BOOTSTRAP_PATHS = [
  '.github/workflows/release-gate.yml',
  'docs/EF-94-ci-release-gate.md',
  'scripts/__tests__/ef111-review-manifest.test.mjs',
  'scripts/__tests__/ef94-ci-release-gate.test.mjs',
  'scripts/ef111-scope.manifest.json',
  'scripts/review-manifest.mjs',
];
const EF118_PATHS = [
  '.github/workflows/deploy-dev.yml',
  'server/src/__tests__/ef118-runtime-audit.test.ts',
  'server/src/index.ts',
  'server/src/observability/ef118RuntimeAudit.ts',
  'server/src/routes/conversations.ts',
];
const scopeObject = {
  schemaVersion: 3,
  bootstrap: {
    id: 'ef-111-bootstrap-7bba833e-exact-six',
    baseSha: BOOTSTRAP_BASE,
    allowedPaths: BOOTSTRAP_PATHS,
  },
  legacyAllowedPaths: LEGACY_PATHS,
  approvedProfiles: [{
    id: 'ef-118-pr-43-f35b3ca', pullRequestNumber: 43, baseRef: 'dev',
    headSha: EF118_HEAD, allowedPaths: EF118_PATHS,
  }],
};
const scope = JSON.stringify(scopeObject);

async function eventFixture({ number = 17, head = HEAD, base = BASE, baseRef = 'dev', body = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ef111-event-'));
  const file = path.join(root, 'event.json');
  await writeFile(file, JSON.stringify({
    number,
    pull_request: { number, body, base: { ref: baseRef, sha: base }, head: { sha: head } },
  }));
  return { root, file };
}

function gitFixture({ authorityRoot = '/fixed/authority', candidateRoot = '/fixed/candidate', authority = BASE, head = HEAD, changed = LEGACY_PATHS, failAt = null } = {}) {
  return (root, args) => {
    const operation = args[0];
    if (operation === failAt) throw new Error('synthetic git failure');
    if (operation === 'rev-parse') return root === authorityRoot ? authority : head;
    if (operation === 'cat-file') return '';
    if (operation === 'merge-base') return MERGE_BASE;
    if (operation === 'diff') return `${changed.join('\n')}\n`;
    throw new Error(`unexpected git operation: ${args.join(' ')}`);
  };
}

function optionsFor(file, layout, git, scopeText = scope) {
  return {
    layout,
    git,
    read: async target => target === file ? readFile(target, 'utf8') : scopeText,
  };
}

test('push and workflow dispatch retain one-checkout identity without PR claims', async () => {
  const layout = { mode: 'single', authorityRoot: '/single', candidateRoot: '/single' };
  for (const eventName of ['push', 'workflow_dispatch']) {
    const manifest = await createReviewManifest(
      { GITHUB_EVENT_NAME: eventName, GITHUB_SHA: HEAD },
      { layout, git: gitFixture({ authorityRoot: '/other', candidateRoot: '/single' }) },
    );
    assert.deepEqual(manifest, {
      schemaVersion: 3, eventName, mode: 'single', authoritySha: HEAD,
      bootstrapBaseSha: null, checkedOutSha: HEAD, baseSha: null, headSha: HEAD,
      mergeBaseSha: null, prNumber: null, scopeId: null, changedPaths: null,
    });
  }
});

test('one-time bootstrap passes only the exact old base and exact six-file set', async t => {
  const { root, file } = await eventFixture({ base: BOOTSTRAP_BASE });
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = { mode: 'bootstrap', authorityRoot: null, candidateRoot: '/single' };
  const manifest = await createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, layout, gitFixture({ candidateRoot: '/single', head: HEAD, changed: BOOTSTRAP_PATHS })),
  );
  assert.equal(manifest.mode, 'gate-maintenance-bootstrap');
  assert.equal(manifest.authoritySha, null);
  assert.equal(manifest.bootstrapBaseSha, BOOTSTRAP_BASE);
  assert.equal(manifest.scopeId, 'ef-111-bootstrap-7bba833e-exact-six');
  assert.deepEqual(manifest.changedPaths, BOOTSTRAP_PATHS);
});

test('bootstrap rejects a changed base, any declaration, and every non-exact diff', async t => {
  const variants = [
    { base: BASE, body: null, changed: BOOTSTRAP_PATHS, error: /base SHA is no longer authorized/ },
    { base: BOOTSTRAP_BASE, body: 'Review-Scope: ef-118-pr-43-f35b3ca', changed: BOOTSTRAP_PATHS, error: /cannot use a scope declaration/ },
    { base: BOOTSTRAP_BASE, body: ' review-scope: malformed', changed: BOOTSTRAP_PATHS, error: /scope declaration is malformed/ },
    { base: BOOTSTRAP_BASE, body: null, changed: BOOTSTRAP_PATHS.slice(0, 5), error: /exact six-file/ },
    { base: BOOTSTRAP_BASE, body: null, changed: [...BOOTSTRAP_PATHS, LEGACY_PATHS[3]], error: /exact six-file/ },
    { base: BOOTSTRAP_BASE, body: null, changed: [...BOOTSTRAP_PATHS.slice(0, 5), 'server/src/index.ts'], error: /exact six-file/ },
    { base: BOOTSTRAP_BASE, body: null, changed: [], error: /no changed paths/ },
  ];
  for (const variant of variants) {
    const { root, file } = await eventFixture({ base: variant.base, body: variant.body });
    t.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(createReviewManifest(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
      optionsFor(
        file,
        { mode: 'bootstrap', authorityRoot: null, candidateRoot: '/single' },
        gitFixture({ candidateRoot: '/single', head: HEAD, changed: variant.changed }),
      ),
    ), variant.error);
  }
});

test('dual mode executes legacy scope with base authority and candidate diff', async t => {
  const { root, file } = await eventFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' };
  const manifest = await createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, layout, gitFixture()),
  );
  assert.equal(manifest.mode, 'authority-candidate');
  assert.equal(manifest.authoritySha, BASE);
  assert.equal(manifest.checkedOutSha, HEAD);
  assert.equal(manifest.scopeId, 'ef-111-legacy-seven-path');
  assert.equal(manifest.mergeBaseSha, MERGE_BASE);
});

test('dual mode accepts only the exact bound EF-118 profile identity and paths', async t => {
  const { root, file } = await eventFixture({
    number: 43, head: EF118_HEAD, body: 'Review-Scope: ef-118-pr-43-f35b3ca',
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' };
  const manifest = await createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, layout, gitFixture({ head: EF118_HEAD, changed: EF118_PATHS })),
  );
  assert.equal(manifest.scopeId, 'ef-118-pr-43-f35b3ca');
  assert.deepEqual(manifest.changedPaths, EF118_PATHS);
});

test('dual mode rejects authority/head/profile mismatch and extra paths', async t => {
  const cases = [
    { number: 17, head: HEAD, body: null, authority: 'd'.repeat(40), candidateHead: HEAD, changed: LEGACY_PATHS, error: /authority checkout/ },
    { number: 17, head: HEAD, body: null, authority: BASE, candidateHead: 'd'.repeat(40), changed: LEGACY_PATHS, error: /head SHA.*candidate checkout/ },
    { number: 44, head: EF118_HEAD, body: 'Review-Scope: ef-118-pr-43-f35b3ca', authority: BASE, candidateHead: EF118_HEAD, changed: EF118_PATHS, error: /profile does not match/ },
    { number: 43, head: EF118_HEAD, body: 'Review-Scope: ef-118-pr-43-f35b3ca', authority: BASE, candidateHead: EF118_HEAD, changed: [...EF118_PATHS, 'server/src/extra.ts'], error: /out-of-scope/ },
  ];
  for (const entry of cases) {
    const { root, file } = await eventFixture(entry);
    t.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(createReviewManifest(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
      optionsFor(
        file,
        { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' },
        gitFixture({ authority: entry.authority, head: entry.candidateHead, changed: entry.changed }),
      ),
    ), entry.error);
  }
});

test('dual mode rejects an injected same-directory layout', async t => {
  const { root, file } = await eventFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(
      file,
      { mode: 'dual', authorityRoot: '/same', candidateRoot: '/same' },
      gitFixture({ authorityRoot: '/same', candidateRoot: '/same' }),
    ),
  ), /must be distinct/);
});

test('candidate git identity and merge-base failures reject before scope acceptance', async t => {
  const { root, file } = await eventFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const failAt of ['cat-file', 'merge-base', 'diff']) {
    await assert.rejects(createReviewManifest(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
      optionsFor(
        file,
        { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' },
        gitFixture({ failAt }),
      ),
    ), /git.*failed|synthetic git failure/);
  }
});

test('fixed production layout rejects partial, symlinked, same, and non-authority execution', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'ef111-layout-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const authority = path.join(root, 'authority');
  const candidate = path.join(root, 'candidate');
  await mkdir(authority);
  assert.throws(() => resolveLayout(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_WORKSPACE: `${root}/child/..` },
    { scriptRoot: authority },
  ), /path is not canonical/);
  assert.throws(() => resolveLayout(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_WORKSPACE: root },
    { scriptRoot: authority },
  ), /partial/);
  await mkdir(candidate);
  assert.deepEqual(resolveLayout(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_WORKSPACE: root },
    { scriptRoot: authority },
  ), { mode: 'dual', authorityRoot: authority, candidateRoot: candidate });
  assert.throws(() => resolveLayout(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_WORKSPACE: root },
    { scriptRoot: candidate },
  ), /must execute from authority/);

  const symlinkRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'ef111-layout-link-')));
  t.after(() => rm(symlinkRoot, { recursive: true, force: true }));
  await symlink(authority, path.join(symlinkRoot, 'authority'));
  await mkdir(path.join(symlinkRoot, 'candidate'));
  assert.throws(() => resolveLayout(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_WORKSPACE: symlinkRoot },
    { scriptRoot: authority },
  ), /unsafe/);
});

test('declarations and repository-controlled scope remain fail-closed', async () => {
  assert.throws(() => declaredScopeId('Review-Scope: one\nReview-Scope: two'), /exactly once/);
  assert.throws(() => declaredScopeId('Review-Scope: ../escape'), /malformed/);
  const mutations = [
    { ...scopeObject, legacyAllowedPaths: [...LEGACY_PATHS.slice(0, 6), 'client/app/index.tsx'] },
    { ...scopeObject, approvedProfiles: [{ ...scopeObject.approvedProfiles[0], allowedPaths: [...EF118_PATHS.slice(0, 4), 'server/src/**'] }] },
    { ...scopeObject, bootstrap: { ...scopeObject.bootstrap, baseSha: BASE } },
    { ...scopeObject, bootstrap: { ...scopeObject.bootstrap, allowedPaths: [...BOOTSTRAP_PATHS.slice(0, 5), 'server/src/index.ts'] } },
    { ...scopeObject, unexpected: true },
  ];
  for (const mutation of mutations) {
    await assert.rejects(loadScope(async () => JSON.stringify(mutation)), /malformed|unapproved|non-exact/);
  }
});

test('CLI rejects caller-provided authority, candidate, and scope path flags', () => {
  const script = fileURLToPath(new URL('../review-manifest.mjs', import.meta.url));
  for (const flag of ['--authority-root', '--candidate-root', '--scope-path']) {
    const result = spawnSync(process.execPath, [script, flag, '/tmp/untrusted', '--output', '/tmp/out'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /usage: --output/);
  }
});
