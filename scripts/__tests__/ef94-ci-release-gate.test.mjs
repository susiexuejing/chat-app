import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/release-gate.yml', import.meta.url);
const docsUrl = new URL('../../docs/EF-94-ci-release-gate.md', import.meta.url);
const scopeManifestUrl = new URL('../ef111-scope.manifest.json', import.meta.url);
const secretScanUrl = new URL('../../.github/workflows/secret-scan.yml', import.meta.url);
const deployDevUrl = new URL('../../.github/workflows/deploy-dev.yml', import.meta.url);

async function text(url) {
  return readFile(url, 'utf8');
}

test('release gate has stable names and the three approved triggers', async () => {
  const workflow = await text(workflowUrl);
  assert.match(workflow, /^name: Release Gate$/m);
  assert.match(workflow, /^    name: EF-94 Release Gate$/m);
  assert.match(workflow, /^  pull_request:\n    branches:\n      - dev$/m);
  assert.match(workflow, /^  push:\n    branches:\n      - dev$/m);
  assert.match(workflow, /^  workflow_dispatch:$/m);
});

test('release gate uses minimum permissions and no secrets or external runtime', async () => {
  const workflow = await text(workflowUrl);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflow, /secrets\.|supabase|douhaoyu|curl|ssh|rsync/i);
  assert.doesNotMatch(workflow, /deploy/i);
});

test('pull requests use exact fixed authority and candidate checkouts', async () => {
  const workflow = await text(workflowUrl);
  assert.match(workflow, /name: Checkout pull request authority[\s\S]*ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}[\s\S]*path: authority/);
  assert.match(workflow, /name: Checkout pull request candidate[\s\S]*ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}[\s\S]*path: candidate/);
  assert.match(workflow, /git -C authority rev-parse HEAD/);
  assert.match(workflow, /git -C candidate rev-parse HEAD/);
  assert.match(workflow, /git -C candidate cat-file -e/);
  assert.match(workflow, /GATE_ROOT="\$GITHUB_WORKSPACE\/authority"/);
  assert.match(workflow, /node "\$GATE_ROOT\/scripts\/review-manifest\.mjs"/);
  assert.deepEqual(workflow.match(/GATE_ROOT="[^"]+"/g), [
    'GATE_ROOT="$GITHUB_WORKSPACE"',
    'GATE_ROOT="$GITHUB_WORKSPACE/authority"',
    'GATE_ROOT="$GITHUB_WORKSPACE"',
    'GATE_ROOT="$GITHUB_WORKSPACE/authority"',
  ]);
});

test('scope authority runs before candidate-only install and release regression', async () => {
  const workflow = await text(workflowUrl);
  assert.match(workflow, /version: 9\.0\.0/);
  assert.match(workflow, /node "\$GATE_ROOT\/scripts\/review-manifest\.mjs" --output "\$RUNNER_TEMP\/ef111-review-manifest\.json"/);
  assert.match(workflow, /review_scope_id=\$SCOPE_ID/);
  assert.ok(workflow.indexOf('Verify fail-closed review scope contract') < workflow.indexOf('Produce fail-closed review manifest'));
  assert.match(workflow, /name: Run approved targeted gate regressions[\s\S]*id: targeted_regressions/);
  assert.match(workflow, /node scripts\/run-approved-targeted-regressions\.mjs --output "\$RUNNER_TEMP\/ef179-approved-targeted-regressions\.json"/);
  assert.match(workflow, /targeted_regression_record=\$RUNNER_TEMP\/ef179-approved-targeted-regressions\.json/);
  assert.match(workflow, /cache-dependency-path: \$\{\{ github\.event_name == 'pull_request' && 'candidate\/pnpm-lock\.yaml' \|\| 'pnpm-lock\.yaml' \}\}/);
  assert.equal((workflow.match(/working-directory: \$\{\{ github\.event_name == 'pull_request' && 'candidate' \|\| '\.' \}\}/g) ?? []).length, 3);
  assert.match(workflow, /run: pnpm install --frozen-lockfile/);
  assert.match(workflow, /run: pnpm run test:release/);
  assert.equal((workflow.match(/pnpm run test:release/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /release-suite\.manifest\.json|runTestsByPath/);
  assert.doesNotMatch(workflow, /ef124|credential hardening/i);
});

test('scope manifest preserves exact legacy and bounded structural profile boundaries', async () => {
  const manifest = JSON.parse(await text(scopeManifestUrl));
  assert.equal(manifest.schemaVersion, 4);
  assert.deepEqual(Object.keys(manifest).sort(), ['approvedProfiles', 'legacyAllowedPaths', 'lowRiskFrontendProfiles', 'schemaVersion']);
  assert.deepEqual(manifest.lowRiskFrontendProfiles, []);
  assert.equal(manifest.legacyAllowedPaths.length, 9);
  assert.ok(manifest.legacyAllowedPaths.includes('.github/workflows/release-gate.yml'));
  assert.ok(manifest.legacyAllowedPaths.every(entry => !/(deploy|runtime|secret|permission)/i.test(entry)));
  assert.deepEqual(manifest.legacyAllowedPaths, [
    '.github/workflows/release-gate.yml',
    'scripts/ef111-scope.manifest.json',
    'scripts/review-manifest.mjs',
    'scripts/release-suite.manifest.json',
    'scripts/__tests__/ef94-ci-release-gate.test.mjs',
    'scripts/__tests__/ef111-review-manifest.test.mjs',
    'scripts/__tests__/run-approved-targeted-regressions.test.mjs',
    'scripts/run-approved-targeted-regressions.mjs',
    'docs/EF-94-ci-release-gate.md',
  ]);
  assert.deepEqual(manifest.approvedProfiles, [
    {
      id: 'ef-118-pr-43-f35b3ca-clean-merge',
      kind: 'exact-clean-merge',
      pullRequestNumber: 43,
      baseRef: 'dev',
      approvedFirstParentSha: 'f35b3ca99fd498b13b530c6c2eed305c5f7688c3',
      allowedPaths: [
        '.github/workflows/deploy-dev.yml',
        'server/src/__tests__/ef118-runtime-audit.test.ts',
        'server/src/index.ts',
        'server/src/observability/ef118RuntimeAudit.ts',
        'server/src/routes/conversations.ts',
      ],
    },
    {
      id: 'ef-110-pr-48-b0a5c6f-clean-merge',
      kind: 'exact-clean-merge',
      pullRequestNumber: 48,
      baseRef: 'dev',
      approvedFirstParentSha: 'b0a5c6f377e9a45b6c5a5b6cf8811ff6487f0874',
      allowedPaths: [
        'server/src/index.ts',
        'server/src/routes/conversations.ts',
        'server/src/__tests__/ef110-index-runtime-sanitization.test.ts',
        'server/src/__tests__/ef110-security-sanitization.test.ts',
      ],
    },
    {
      id: 'ef-75-pr-52-b651b05-clean-merge',
      kind: 'exact-clean-merge',
      pullRequestNumber: 52,
      baseRef: 'dev',
      approvedFirstParentSha: 'b651b0505b236c20e2c32f8d7dadc444865b66a7',
      allowedPaths: [
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
      ],
    },
    {
      id: 'ef-146-pr-54-docs-only',
      kind: 'exact-docs-paths',
      pullRequestNumber: 54,
      baseRef: 'dev',
      approvedHeadSha: '5130611c32d51017ab2d8ec4b5f5447452bd9b4f',
      allowedPaths: ['docs/EF-146-ownership-boundary-contract.md'],
    },
  ]);
});

test('release gate fails closed and scopes concurrency to one PR or branch', async () => {
  const workflow = await text(workflowUrl);
  assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /group: ef94-release-gate-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true|if:\s*always\(\)/);
  assert.doesNotMatch(workflow, /secrets\.|curl|ssh|rsync|deploy/i);
});

test('branch-protection and rollback documentation preserves independent gates', async () => {
  const docs = await text(docsUrl);
  assert.match(docs, /exact required check `EF-94 Release Gate`/);
  assert.match(docs, /`dev` branch/);
  assert.match(docs, /`Gitleaks \(current tree\)`/);
  assert.match(docs, /Remove only `EF-94 Release Gate`/);
  assert.match(docs, /must not create a push to `dev`/);
  assert.match(docs, /No branch protection or ruleset is changed by this PR/);
  assert.match(docs, /EF-111 review manifest/);
  assert.match(docs, /does not require EF-124/);
  assert.match(docs, /exact first parent `f35b3ca99fd498b13b530c6c2eed305c5f7688c3`/);
  assert.match(docs, /exact first parent `b0a5c6f377e9a45b6c5a5b6cf8811ff6487f0874`/);
  assert.match(docs, /exact first parent `b651b0505b236c20e2c32f8d7dadc444865b66a7`/);
  assert.match(docs, /exactly the 27 enumerated EF-75 paths/);
  assert.match(docs, /exact event-base second parent/);
  assert.match(docs, /`git merge-tree --write-tree`/);
  assert.match(docs, /Current GitHub API values are never validator inputs/);
});

test('existing secret scan and deployment checks remain independently named', async () => {
  const [secretScan, deployDev] = await Promise.all([text(secretScanUrl), text(deployDevUrl)]);
  assert.match(secretScan, /^name: Secret Scan$/m);
  assert.match(secretScan, /^    name: Gitleaks \(current tree\)$/m);
  assert.match(secretScan, /^  pull_request:\n    branches:\n      - dev$/m);
  assert.match(secretScan, /^  push:\n    branches:\n      - dev$/m);
  assert.match(deployDev, /^name: Deploy Application to Dev$/m);
  assert.match(deployDev, /^    name: Test, build and deploy dev$/m);
  assert.doesNotMatch(deployDev, /^  pull_request:/m);
});
