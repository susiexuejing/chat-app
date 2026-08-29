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
const EF118_HEAD = 'f35b3ca99fd498b13b530c6c2eed305c5f7688c3';
const TREE = 'd'.repeat(40);
const STRUCTURAL_SCOPE = 'ef-118-pr-43-f35b3ca-clean-merge';
const GOVERNANCE_BASE = '76549f7473c48f721a72344ae89ab5d3e87575fa';
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
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
  schemaVersion: 3,
  legacyAllowedPaths: LEGACY_PATHS,
  approvedProfiles: [{
    id: STRUCTURAL_SCOPE, kind: 'exact-clean-merge', pullRequestNumber: 43, baseRef: 'dev',
    approvedFirstParentSha: EF118_HEAD, allowedPaths: EF118_PATHS,
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

function structuralGitFixture({
  authorityRoot = '/fixed/authority', candidateRoot = '/fixed/candidate', authority = BASE,
  head = HEAD, firstParent = EF118_HEAD, secondParent = BASE,
  graphParents = [firstParent, secondParent],
  rawParents = [firstParent, secondParent], rawTree = TREE, candidateTree = TREE,
  recomputedTree = TREE, mergeBase = BASE, changed = EF118_PATHS,
  objectFormat = 'sha1', replacements = '', mergeTreeFailure = false,
} = {}) {
  return (root, args) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return root === authorityRoot ? authority : head;
    if (args[0] === 'rev-parse' && args[1] === '--show-object-format') return objectFormat;
    if (args[0] === 'rev-parse' && args[1] === `${head}^{tree}`) return candidateTree;
    if (args[0] === 'replace') return replacements;
    if (args[0] === 'cat-file' && args[1] === '-e') return '';
    if (args[0] === 'cat-file' && args[1] === '-p') {
      return `tree ${rawTree}\n${rawParents.map(parent => `parent ${parent}`).join('\n')}\nauthor synthetic`;
    }
    if (args[0] === 'cat-file' && args[1] === '-t') return 'tree';
    if (args[0] === 'rev-list') return `${head} ${graphParents.join(' ')}`;
    if (args[0] === 'merge-base') return mergeBase;
    if (args[0] === 'merge-tree') {
      if (mergeTreeFailure) throw new Error('synthetic merge conflict');
      return recomputedTree;
    }
    if (args[0] === 'diff') return `${changed.join('\n')}\n`;
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

function realGit(root, args, input, extraEnv = {}) {
  return spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', input,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', ...extraEnv },
  });
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
      checkedOutSha: HEAD, baseSha: null, headSha: HEAD,
      mergeBaseSha: null, prNumber: null, scopeId: null, changedPaths: null,
    });
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

test('dual mode accepts only the exact clean-merge EF-118 graph, tree, and paths', async t => {
  const { root, file } = await eventFixture({
    number: 43, head: HEAD, body: `Review-Scope: ${STRUCTURAL_SCOPE}`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' };
  const manifest = await createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, layout, structuralGitFixture()),
  );
  assert.equal(manifest.scopeId, STRUCTURAL_SCOPE);
  assert.deepEqual(manifest.changedPaths, EF118_PATHS);
  assert.deepEqual(manifest.structuralProof, {
    kind: 'exact-clean-merge', approvedFirstParentSha: EF118_HEAD,
    eventBaseSecondParentSha: BASE, candidateTreeSha: TREE, recomputedTreeSha: TREE,
  });
});

test('dual mode rejects authority, head, PR, and exact structural path mismatch', async t => {
  const cases = [
    { number: 17, body: null, authority: 'e'.repeat(40), candidateHead: HEAD, changed: LEGACY_PATHS, error: /authority checkout/ },
    { number: 17, body: null, authority: BASE, candidateHead: 'e'.repeat(40), changed: LEGACY_PATHS, error: /head SHA.*candidate checkout/ },
    { number: 44, body: `Review-Scope: ${STRUCTURAL_SCOPE}`, authority: BASE, candidateHead: HEAD, changed: EF118_PATHS, error: /profile does not match/ },
    { number: 43, body: `Review-Scope: ${STRUCTURAL_SCOPE}`, authority: BASE, candidateHead: HEAD, changed: [...EF118_PATHS, 'server/src/extra.ts'], error: /exact approved path set/ },
    { number: 43, body: `Review-Scope: ${STRUCTURAL_SCOPE}`, authority: BASE, candidateHead: HEAD, changed: EF118_PATHS.slice(0, 4), error: /exact approved path set/ },
  ];
  for (const entry of cases) {
    const { root, file } = await eventFixture(entry);
    t.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(createReviewManifest(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
      optionsFor(
        file,
        { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' },
        entry.body === null
          ? gitFixture({ authority: entry.authority, head: entry.candidateHead, changed: entry.changed })
          : structuralGitFixture({ authority: entry.authority, head: entry.candidateHead, changed: entry.changed }),
      ),
    ), entry.error);
  }
});

test('structural profile rejects parent order/count, merge-base, tree, conflict, and replacement attacks', async t => {
  const cases = [
    { git: structuralGitFixture({ firstParent: BASE, secondParent: EF118_HEAD }), error: /exact ordered first parent/ },
    { git: structuralGitFixture({ secondParent: MERGE_BASE }), error: /exact ordered first parent/ },
    { git: structuralGitFixture({ graphParents: [EF118_HEAD] }), error: /exact ordered first parent/ },
    { git: structuralGitFixture({ graphParents: [EF118_HEAD, BASE, MERGE_BASE] }), error: /exact ordered first parent/ },
    { git: structuralGitFixture({ rawParents: [EF118_HEAD] }), error: /exactly one tree and two parents/ },
    { git: structuralGitFixture({ rawParents: [EF118_HEAD, BASE, MERGE_BASE] }), error: /exactly one tree and two parents/ },
    { git: structuralGitFixture({ rawParents: [BASE, EF118_HEAD] }), error: /raw candidate parents/ },
    { git: structuralGitFixture({ mergeBase: MERGE_BASE }), error: /merge-base must equal/ },
    { git: structuralGitFixture({ rawTree: 'e'.repeat(40) }), error: /raw candidate tree/ },
    { git: structuralGitFixture({ candidateTree: 'e'.repeat(40) }), error: /raw candidate tree/ },
    { git: structuralGitFixture({ recomputedTree: 'e'.repeat(40) }), error: /does not equal/ },
    { git: structuralGitFixture({ recomputedTree: `${TREE}\nconflict` }), error: /40-character lowercase SHA/ },
    { git: structuralGitFixture({ mergeTreeFailure: true }), error: /synthetic merge conflict/ },
    { git: structuralGitFixture({ replacements: `${HEAD} ${BASE}` }), error: /replacement refs/ },
    { git: structuralGitFixture({ objectFormat: 'sha256' }), error: /sha1 object format/ },
  ];
  for (const entry of cases) {
    const { root, file } = await eventFixture({
      number: 43, head: HEAD, body: `Review-Scope: ${STRUCTURAL_SCOPE}`,
    });
    t.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(createReviewManifest(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
      optionsFor(file, { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' }, entry.git),
    ), entry.error);
  }
});

test('structural declaration rejects old, missing, malformed, duplicate, and wrong-base claims', async t => {
  const cases = [
    { body: 'Review-Scope: ef-118-pr-43-f35b3ca', baseRef: 'dev', error: /unknown scope declaration/ },
    { body: null, baseRef: 'dev', error: /out-of-scope path/ },
    { body: `Review-Scope: ${STRUCTURAL_SCOPE}\nReview-Scope: ${STRUCTURAL_SCOPE}`, baseRef: 'dev', error: /exactly once/ },
    { body: ` review-scope: ${STRUCTURAL_SCOPE}`, baseRef: 'dev', error: /malformed/ },
    { body: `Review-Scope: ${STRUCTURAL_SCOPE}`, baseRef: 'main', error: /base ref must be dev/ },
  ];
  for (const entry of cases) {
    const { root, file } = await eventFixture({ number: 43, head: HEAD, body: entry.body, baseRef: entry.baseRef });
    t.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(createReviewManifest(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
      optionsFor(
        file,
        { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' },
        structuralGitFixture(),
      ),
    ), entry.error);
  }
});

test('real git clean and conflicting merge-tree contracts are fail-closed', async t => {
  assert.equal(realGit(REPO_ROOT, ['rev-parse', '--show-object-format']).stdout.trim(), 'sha1');
  const objectRoot = await mkdtemp(path.join(tmpdir(), 'ef111-merge-objects-'));
  t.after(() => rm(objectRoot, { recursive: true, force: true }));
  const writableObjects = path.join(objectRoot, 'objects');
  await mkdir(writableObjects);
  const commonDir = realGit(REPO_ROOT, ['rev-parse', '--git-common-dir']).stdout.trim();
  const mergeEnv = {
    GIT_OBJECT_DIRECTORY: writableObjects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.resolve(REPO_ROOT, commonDir, 'objects'),
  };
  const clean = realGit(REPO_ROOT, ['merge-tree', '--write-tree', EF118_HEAD, GOVERNANCE_BASE], undefined, mergeEnv);
  assert.equal(clean.status, 0);
  assert.equal(clean.stderr, '');
  assert.match(clean.stdout, /^[0-9a-f]{40}\n$/);
  assert.equal(realGit(REPO_ROOT, ['cat-file', '-t', clean.stdout.trim()], undefined, mergeEnv).stdout.trim(), 'tree');

  const root = await mkdtemp(path.join(tmpdir(), 'ef111-merge-tree-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(realGit(root, ['init']).status, 0);
  assert.equal(realGit(root, ['config', 'user.name', 'Synthetic Gate']).status, 0);
  assert.equal(realGit(root, ['config', 'user.email', 'gate@example.invalid']).status, 0);
  await writeFile(path.join(root, 'conflict.txt'), 'base\n');
  assert.equal(realGit(root, ['add', 'conflict.txt']).status, 0);
  assert.equal(realGit(root, ['commit', '-m', 'base']).status, 0);
  const base = realGit(root, ['rev-parse', 'HEAD']).stdout.trim();
  await writeFile(path.join(root, 'conflict.txt'), 'left\n');
  assert.equal(realGit(root, ['commit', '-am', 'left']).status, 0);
  const left = realGit(root, ['rev-parse', 'HEAD']).stdout.trim();
  assert.equal(realGit(root, ['checkout', '--detach', base]).status, 0);
  await writeFile(path.join(root, 'conflict.txt'), 'right\n');
  assert.equal(realGit(root, ['commit', '-am', 'right']).status, 0);
  const right = realGit(root, ['rev-parse', 'HEAD']).stdout.trim();
  const conflict = realGit(root, ['merge-tree', '--write-tree', left, right]);
  assert.notEqual(conflict.status, 0);
  assert.doesNotMatch(conflict.stdout, /^[0-9a-f]{40}\n$/);
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
  assert.throws(() => resolveLayout(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_WORKSPACE: root },
    { scriptRoot: root },
  ), /requires fixed authority and candidate checkouts/);
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
    { ...scopeObject, approvedProfiles: [{ ...scopeObject.approvedProfiles[0], kind: 'ancestor-range' }] },
    { ...scopeObject, approvedProfiles: [{ ...scopeObject.approvedProfiles[0], approvedFirstParentSha: HEAD }] },
    { ...scopeObject, approvedProfiles: [{ ...scopeObject.approvedProfiles[0], headSha: HEAD }] },
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
