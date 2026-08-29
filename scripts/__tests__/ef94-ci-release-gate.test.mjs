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
  assert.match(workflow, /if \[ "\$\{\{ github\.event\.pull_request\.base\.sha \}\}" = "7bba833e3612b0c9d21b3dc71002387d2cb9b31c" \]; then[\s\S]*GATE_ROOT="\$GITHUB_WORKSPACE\/candidate"/);
  assert.match(workflow, /MANIFEST_WORKSPACE="\$GITHUB_WORKSPACE\/candidate"/);
  assert.match(workflow, /GITHUB_WORKSPACE="\$MANIFEST_WORKSPACE" node "\$GATE_ROOT\/scripts\/review-manifest\.mjs"/);
});

test('scope authority runs before candidate-only install and release regression', async () => {
  const workflow = await text(workflowUrl);
  assert.match(workflow, /version: 9\.0\.0/);
  assert.match(workflow, /node "\$GATE_ROOT\/scripts\/review-manifest\.mjs" --output "\$RUNNER_TEMP\/ef111-review-manifest\.json"/);
  assert.match(workflow, /review_scope_id=\$SCOPE_ID/);
  assert.ok(workflow.indexOf('Verify fail-closed review scope contract') < workflow.indexOf('Produce fail-closed review manifest'));
  assert.match(workflow, /name: Verify proposed gate-maintenance contract[\s\S]*working-directory: candidate/);
  assert.match(workflow, /cache-dependency-path: \$\{\{ github\.event_name == 'pull_request' && 'candidate\/pnpm-lock\.yaml' \|\| 'pnpm-lock\.yaml' \}\}/);
  assert.equal((workflow.match(/working-directory: \$\{\{ github\.event_name == 'pull_request' && 'candidate' \|\| '\.' \}\}/g) ?? []).length, 2);
  assert.match(workflow, /run: pnpm install --frozen-lockfile/);
  assert.match(workflow, /run: pnpm run test:release/);
  assert.equal((workflow.match(/pnpm run test:release/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /release-suite\.manifest\.json|runTestsByPath/);
  assert.doesNotMatch(workflow, /ef124|credential hardening/i);
});

test('scope manifest preserves exact bootstrap, legacy, and EF-118 profile boundaries', async () => {
  const manifest = JSON.parse(await text(scopeManifestUrl));
  assert.equal(manifest.schemaVersion, 3);
  assert.deepEqual(Object.keys(manifest).sort(), ['approvedProfiles', 'bootstrap', 'legacyAllowedPaths', 'schemaVersion']);
  assert.deepEqual(manifest.bootstrap, {
    id: 'ef-111-bootstrap-7bba833e-exact-six',
    baseSha: '7bba833e3612b0c9d21b3dc71002387d2cb9b31c',
    allowedPaths: [
      '.github/workflows/release-gate.yml',
      'docs/EF-94-ci-release-gate.md',
      'scripts/__tests__/ef111-review-manifest.test.mjs',
      'scripts/__tests__/ef94-ci-release-gate.test.mjs',
      'scripts/ef111-scope.manifest.json',
      'scripts/review-manifest.mjs',
    ],
  });
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
