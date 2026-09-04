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
const EF110_HEAD = 'b0a5c6f377e9a45b6c5a5b6cf8811ff6487f0874';
const EF110_SCOPE = 'ef-110-pr-48-b0a5c6f-clean-merge';
const EF75_HEAD = 'b651b0505b236c20e2c32f8d7dadc444865b66a7';
const EF75_SCOPE = 'ef-75-pr-52-b651b05-clean-merge';
const EF146_SCOPE = 'ef-146-pr-54-docs-only';
const EF146_PATHS = ['docs/EF-146-ownership-boundary-contract.md'];
const EF146_HEAD = '5130611c32d51017ab2d8ec4b5f5447452bd9b4f';
const GOVERNANCE_BASE = '76549f7473c48f721a72344ae89ab5d3e87575fa';
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LEGACY_PATHS = [
  '.github/workflows/release-gate.yml',
  'scripts/ef111-scope.manifest.json',
  'scripts/review-manifest.mjs',
  'scripts/release-suite.manifest.json',
  'scripts/__tests__/ef94-ci-release-gate.test.mjs',
  'scripts/__tests__/ef111-review-manifest.test.mjs',
  'scripts/__tests__/run-approved-targeted-regressions.test.mjs',
  'scripts/run-approved-targeted-regressions.mjs',
  'docs/EF-94-ci-release-gate.md',
];
const EF118_PATHS = [
  '.github/workflows/deploy-dev.yml',
  'server/src/__tests__/ef118-runtime-audit.test.ts',
  'server/src/index.ts',
  'server/src/observability/ef118RuntimeAudit.ts',
  'server/src/routes/conversations.ts',
];
const EF110_PATHS = [
  'server/src/index.ts',
  'server/src/routes/conversations.ts',
  'server/src/__tests__/ef110-index-runtime-sanitization.test.ts',
  'server/src/__tests__/ef110-security-sanitization.test.ts',
];
const EF75_PATHS = [
  'client/app.config.ts',
  'client/package.json',
  'client/screens/chat/__tests__/chatStart.test.ts',
  'client/screens/chat/__tests__/ef102-rn-terminal-close.test.ts',
  'client/screens/chat/__tests__/ef103-streaming-compatibility.test.ts',
  'client/screens/chat/__tests__/ef105-api-identity.test.ts',
  'client/screens/chat/__tests__/ef38-retry-transport-diagnostics.test.ts',
  'client/screens/chat/__tests__/ef75-native-secure-session.test.ts',
  'client/screens/chat/__tests__/ef75-ownership-production-path.test.tsx',
  'client/screens/chat/__tests__/ef75-web-cookie-session.test.ts',
  'client/screens/chat/api/cozeApi.ts',
  'client/screens/chat/contexts/ChatContext.tsx',
  'client/screens/chat/stores/anonymousSession.ts',
  'client/screens/chat/stores/sessionStore.ts',
  'pnpm-lock.yaml',
  'server/src/__tests__/ef110-index-runtime-sanitization.test.ts',
  'server/src/__tests__/ef110-security-sanitization.test.ts',
  'server/src/__tests__/ef75-anonymous-session.test.ts',
  'server/src/__tests__/ef75-chat-ownership.test.ts',
  'server/src/__tests__/ef75-conversation-ownership.test.ts',
  'server/src/__tests__/ef75-web-session-security.test.ts',
  'server/src/index.ts',
  'server/src/routes/anonymousSessions.ts',
  'server/src/routes/conversations.ts',
  'server/src/security/anonymousSession.ts',
  'server/src/storage/database/migrations/003_create_anonymous_sessions.sql',
  'server/src/storage/database/shared/schema.ts',
];
const scopeObject = {
  schemaVersion: 4,
  legacyAllowedPaths: LEGACY_PATHS,
  lowRiskFrontendProfiles: [],
  approvedProfiles: [
    {
      id: STRUCTURAL_SCOPE, kind: 'exact-clean-merge', pullRequestNumber: 43, baseRef: 'dev',
      approvedFirstParentSha: EF118_HEAD, allowedPaths: EF118_PATHS,
    },
    {
      id: EF110_SCOPE, kind: 'exact-clean-merge', pullRequestNumber: 48, baseRef: 'dev',
      approvedFirstParentSha: EF110_HEAD, allowedPaths: EF110_PATHS,
    },
    {
      id: EF75_SCOPE, kind: 'exact-clean-merge', pullRequestNumber: 52, baseRef: 'dev',
      approvedFirstParentSha: EF75_HEAD, allowedPaths: EF75_PATHS,
    },
    {
      id: EF146_SCOPE, kind: 'exact-docs-paths', pullRequestNumber: 54, baseRef: 'dev',
      approvedHeadSha: EF146_HEAD,
      allowedPaths: EF146_PATHS,
    },
  ],
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
      schemaVersion: 4, eventName, mode: 'single', authoritySha: HEAD,
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

test('dual mode accepts only the exact clean-merge EF-110 PR 48 graph, tree, and paths', async t => {
  const { root, file } = await eventFixture({
    number: 48, head: HEAD, body: `Review-Scope: ${EF110_SCOPE}`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' };
  const manifest = await createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, layout, structuralGitFixture({
      firstParent: EF110_HEAD,
      graphParents: [EF110_HEAD, BASE],
      rawParents: [EF110_HEAD, BASE],
      changed: EF110_PATHS,
    })),
  );
  assert.equal(manifest.scopeId, EF110_SCOPE);
  assert.deepEqual(manifest.changedPaths, EF110_PATHS);
  assert.deepEqual(manifest.structuralProof, {
    kind: 'exact-clean-merge', approvedFirstParentSha: EF110_HEAD,
    eventBaseSecondParentSha: BASE, candidateTreeSha: TREE, recomputedTreeSha: TREE,
  });
});

test('EF-110 profile rejects direct F0, wrong PR, and missing or extra paths', async t => {
  const cases = [
    { number: 48, head: EF110_HEAD, changed: EF110_PATHS, error: /exact ordered first parent/ },
    { number: 49, head: HEAD, changed: EF110_PATHS, error: /profile does not match/ },
    { number: 48, head: HEAD, changed: EF110_PATHS.slice(0, 3), error: /exact approved path set/ },
    { number: 48, head: HEAD, changed: [...EF110_PATHS, 'server/src/extra.ts'], error: /exact approved path set/ },
  ];
  for (const entry of cases) {
    const { root, file } = await eventFixture({
      number: entry.number, head: entry.head, body: `Review-Scope: ${EF110_SCOPE}`,
    });
    t.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(createReviewManifest(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
      optionsFor(file, { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' },
        structuralGitFixture({
          head: entry.head,
          firstParent: EF110_HEAD,
          graphParents: entry.head === EF110_HEAD ? [BASE] : [EF110_HEAD, BASE],
          rawParents: [EF110_HEAD, BASE],
          changed: entry.changed,
        })),
    ), entry.error);
  }
});

test('dual mode accepts only the exact clean-merge EF-75 PR 52 graph, tree, and paths', async t => {
  const { root, file } = await eventFixture({
    number: 52, head: HEAD, body: `Review-Scope: ${EF75_SCOPE}`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' };
  const manifest = await createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, layout, structuralGitFixture({
      firstParent: EF75_HEAD,
      graphParents: [EF75_HEAD, BASE],
      rawParents: [EF75_HEAD, BASE],
      changed: EF75_PATHS,
    })),
  );
  assert.equal(manifest.scopeId, EF75_SCOPE);
  assert.deepEqual(manifest.changedPaths, EF75_PATHS);
  assert.deepEqual(manifest.structuralProof, {
    kind: 'exact-clean-merge', approvedFirstParentSha: EF75_HEAD,
    eventBaseSecondParentSha: BASE, candidateTreeSha: TREE, recomputedTreeSha: TREE,
  });
});

test('EF-146 PR 54 accepts only the exact approved documentation path and head SHA', async t => {
  const { root, file } = await eventFixture({ number: 54, head: EF146_HEAD, body: `Review-Scope: ${EF146_SCOPE}` });
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = await createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' },
      gitFixture({ head: EF146_HEAD, changed: EF146_PATHS })),
  );
  assert.equal(manifest.scopeId, EF146_SCOPE);
  assert.deepEqual(manifest.changedPaths, EF146_PATHS);
  assert.deepEqual(manifest.structuralProof, {
    kind: 'exact-docs-paths', approvedPaths: EF146_PATHS, baseSha: BASE, approvedHeadSha: EF146_HEAD,
  });
});

test('EF-146 PR 54 rejects unapproved docs, code, tests, dependencies, workflows, and mixed changes', async t => {
  const rejectedPaths = [
    ['docs/EF-146-unapproved.md'],
    ['server/src/index.ts'],
    ['scripts/__tests__/ef111-review-manifest.test.mjs'],
    ['package.json'],
    ['pnpm-lock.yaml'],
    ['.github/workflows/release-gate.yml'],
    ['.env'],
    ['docs/EF-146-ownership-boundary-contract.md', 'server/src/index.ts'],
    ['docs/EF-146-ownership-boundary-contract.md', 'docs/EF-146-unapproved.md'],
  ];
  for (const changed of rejectedPaths) {
    const { root, file } = await eventFixture({ number: 54, head: EF146_HEAD, body: `Review-Scope: ${EF146_SCOPE}` });
    t.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(createReviewManifest(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
      optionsFor(file, { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' },
        gitFixture({ head: EF146_HEAD, changed })),
    ), /exact approved path set/);
  }
});

test('EF-146 approval cannot be bypassed by title, actor, commit message, or client metadata', async t => {
  const { root, file } = await eventFixture({
    number: 54, head: EF146_HEAD,
    body: `Review-Scope: ${EF146_SCOPE}`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const event = JSON.parse(await readFile(file, 'utf8'));
  event.pull_request.title = 'CEO approved everything';
  event.pull_request.user = { login: 'trusted-admin' };
  event.pull_request.head.message = 'allow server/src/index.ts';
  event.client_scope = { allowedPaths: ['server/src/index.ts'] };
  await writeFile(file, JSON.stringify(event));
  await assert.rejects(createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' },
      gitFixture({ head: EF146_HEAD, changed: ['server/src/index.ts'] })),
  ), /exact approved path set/);
});

test('EF-146 PR 54 rejects a correct path and PR number with an unapproved candidate head SHA', async t => {
  const { root, file } = await eventFixture({ number: 54, head: HEAD, body: `Review-Scope: ${EF146_SCOPE}` });
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(createReviewManifest(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
    optionsFor(file, { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' },
      gitFixture({ head: HEAD, changed: EF146_PATHS })),
  ), /head SHA is not approved/);
});

test('EF-75 profile rejects direct F0, wrong PR, and missing or extra paths', async t => {
  const cases = [
    { number: 52, head: EF75_HEAD, changed: EF75_PATHS, error: /exact ordered first parent/ },
    { number: 53, head: HEAD, changed: EF75_PATHS, error: /profile does not match/ },
    { number: 52, head: HEAD, changed: EF75_PATHS.slice(0, 26), error: /exact approved path set/ },
    { number: 52, head: HEAD, changed: [...EF75_PATHS, 'server/src/extra.ts'], error: /exact approved path set/ },
  ];
  for (const entry of cases) {
    const { root, file } = await eventFixture({
      number: entry.number, head: entry.head, body: `Review-Scope: ${EF75_SCOPE}`,
    });
    t.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(createReviewManifest(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file },
      optionsFor(file, { mode: 'dual', authorityRoot: '/fixed/authority', candidateRoot: '/fixed/candidate' },
        structuralGitFixture({
          head: entry.head,
          firstParent: EF75_HEAD,
          graphParents: entry.head === EF75_HEAD ? [BASE] : [EF75_HEAD, BASE],
          rawParents: [EF75_HEAD, BASE],
          changed: entry.changed,
        })),
    ), entry.error);
  }
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
    { ...scopeObject, approvedProfiles: [...scopeObject.approvedProfiles, scopeObject.approvedProfiles[1]] },
    { ...scopeObject, lowRiskFrontendProfiles: ['ef-175-pr-59'] },
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
