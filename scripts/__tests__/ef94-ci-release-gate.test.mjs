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

test('release gate actively verifies the scope contract and emits a review manifest before release regression', async () => {
  const workflow = await text(workflowUrl);
  assert.match(workflow, /version: 9\.0\.0/);
  assert.match(workflow, /run: pnpm install --frozen-lockfile/);
  assert.match(workflow, /node scripts\/review-manifest\.mjs --output "\$RUNNER_TEMP\/ef111-review-manifest\.json"/);
  assert.match(workflow, /node --test\s+scripts\/__tests__\/ef111-review-manifest\.test\.mjs\s+scripts\/__tests__\/ef94-ci-release-gate\.test\.mjs/);
  assert.ok(workflow.indexOf('Verify fail-closed review scope contract') < workflow.indexOf('Produce fail-closed review manifest'));
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /run: pnpm run test:release/);
  assert.equal((workflow.match(/pnpm run test:release/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /release-suite\.manifest\.json|runTestsByPath/);
  assert.doesNotMatch(workflow, /ef124|credential hardening/i);
});

test('scope manifest preserves the seven-path legacy boundary and one exact EF-118 profile', async () => {
  const manifest = JSON.parse(await text(scopeManifestUrl));
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(Object.keys(manifest).sort(), ['approvedProfiles', 'legacyAllowedPaths', 'schemaVersion']);
  assert.equal(manifest.legacyAllowedPaths.length, 7);
  assert.ok(manifest.legacyAllowedPaths.includes('.github/workflows/release-gate.yml'));
  assert.ok(manifest.legacyAllowedPaths.every(entry => !/(deploy|runtime|secret|permission)/i.test(entry)));
  assert.deepEqual(manifest.approvedProfiles, [{
    id: 'ef-118-pr-43-f35b3ca',
    pullRequestNumber: 43,
    baseRef: 'dev',
    headSha: 'f35b3ca99fd498b13b530c6c2eed305c5f7688c3',
    allowedPaths: [
      '.github/workflows/deploy-dev.yml',
      'server/src/__tests__/ef118-runtime-audit.test.ts',
      'server/src/index.ts',
      'server/src/observability/ef118RuntimeAudit.ts',
      'server/src/routes/conversations.ts',
    ],
  }]);
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
