import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/production-readiness.yml', import.meta.url);
const packageUrl = new URL('../../package.json', import.meta.url);
const gateScriptUrl = new URL('../production-readiness-gate.mjs', import.meta.url);
const docsUrl = new URL('../../docs/EF-93-production-deployment-gate.md', import.meta.url);

async function workflowText() {
  return readFile(workflowUrl, 'utf8');
}

test('workflow is manual readiness-only with least permissions and production-only input', async () => {
  const workflow = await workflowText();
  assert.match(workflow, /^name: Production Readiness Gate$/m);
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /options:\n          - production/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
});

test('exact approved commit is syntax checked, checked out, and compared to HEAD', async () => {
  const workflow = await workflowText();
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /ref: \$\{\{ inputs\.approved_commit \}\}/);
  assert.match(workflow, /CHECKED_OUT_COMMIT="\$\(git rev-parse HEAD\)"/);
  assert.match(workflow, /\[ "\$CHECKED_OUT_COMMIT" = "\$APPROVED_COMMIT" \]/);
});

test('EF-94 and EF-95 reuse the one canonical release command and fixed manifest', async () => {
  const [workflow, packageRaw, gateScript] = await Promise.all([
    workflowText(), readFile(packageUrl, 'utf8'), readFile(gateScriptUrl, 'utf8'),
  ]);
  const packageJson = JSON.parse(packageRaw);
  assert.equal(packageJson.scripts['test:release'], 'node scripts/run-release-regression.mjs');
  assert.equal((workflow.match(/run: pnpm run test:release/g) ?? []).length, 1);
  assert.match(gateScript, /scripts\/release-suite\.manifest\.json/);
  assert.doesNotMatch(workflow, /--ef95-manifest/);
  assert.doesNotMatch(workflow, /jest|runTestsByPath/);
});

test('post-deploy contract requires an external approved manifest digest and two-sided rollback', async () => {
  const [gateScript, docs] = await Promise.all([
    readFile(gateScriptUrl, 'utf8'), readFile(docsUrl, 'utf8'),
  ]);
  assert.match(gateScript, /args\['approved-manifest-sha256'\]/);
  assert.match(gateScript, /verification\.frontend/);
  assert.match(gateScript, /verification\.backend/);
  assert.match(docs, /--approved-manifest-sha256/);
  assert.match(docs, /external approved digest/);
  assert.match(docs, /separate `frontend` and `backend` identities/);
});

test('artifact job cannot run unless identity, release regression, and secret scan pass', async () => {
  const workflow = await workflowText();
  assert.match(workflow, /needs: \[identity, release-regression, secret-scan\]/);
  assert.doesNotMatch(workflow, /continue-on-error|if:\s*always\(\)|\|\| true/);
  assert.match(workflow, /if-no-files-found: error/);
});

test('workflow creates checksummed archives and validates evidence before upload', async () => {
  const workflow = await workflowText();
  assert.match(workflow, /frontend\.tar\.gz/);
  assert.match(workflow, /backend\.tar\.gz/);
  assert.match(workflow, /production-readiness-gate\.mjs generate/);
  assert.match(workflow, /production-readiness-gate\.mjs validate/);
  assert.match(workflow, /production-readiness-manifest\.sha256/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
});

test('workflow has no production side effects, hostnames, credentials, or live requests', async () => {
  const workflow = await workflowText();
  assert.doesNotMatch(workflow, /secrets\.|ssh|rsync|scp|curl|wget|fetch\(|https?:\/\//i);
  assert.doesNotMatch(workflow, /deploy|activate|pm2|systemctl|kubectl|terraform|database|supabase/i);
  assert.doesNotMatch(workflow, /environment:\s*production/m);
});
