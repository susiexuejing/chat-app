import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/release-gate.yml', import.meta.url);
const docsUrl = new URL('../../docs/EF-94-ci-release-gate.md', import.meta.url);
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

test('release gate installs deterministically, delegates release regression to EF-95, and runs the bounded EF-124 guard', async () => {
  const workflow = await text(workflowUrl);
  assert.match(workflow, /version: 9\.0\.0/);
  assert.match(workflow, /run: pnpm install --frozen-lockfile/);
  assert.match(workflow, /run: pnpm run test:release/);
  assert.equal((workflow.match(/pnpm run test:release/g) ?? []).length, 1);
  assert.match(workflow, /NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest --no-cache src\/__tests__\/ef124-credential-hardening\.test\.ts/);
  assert.equal((workflow.match(/ef124-credential-hardening\.test\.ts/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /release-suite\.manifest\.json|runTestsByPath/);
});

test('release gate fails closed and scopes concurrency to one PR or branch', async () => {
  const workflow = await text(workflowUrl);
  assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /group: ef94-release-gate-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true|if:\s*always\(\)/);
});

test('branch-protection and rollback documentation preserves independent gates', async () => {
  const docs = await text(docsUrl);
  assert.match(docs, /exact required check `EF-94 Release Gate`/);
  assert.match(docs, /`dev` branch/);
  assert.match(docs, /`Gitleaks \(current tree\)`/);
  assert.match(docs, /Remove only `EF-94 Release Gate`/);
  assert.match(docs, /must not create a push to `dev`/);
  assert.match(docs, /No branch protection or ruleset is changed by this PR/);
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
