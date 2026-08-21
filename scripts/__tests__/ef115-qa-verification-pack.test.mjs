import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/qa-verification-pack.yml', import.meta.url);

test('EF-115 runner is manual, read-only, and accepts only a named verification pack', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  assert.match(workflow, /^name: QA Verification Pack$/m);
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /authorized_sha:/);
  assert.match(workflow, /ef110-code-verification/);
  assert.doesNotMatch(workflow, /pull_request:|push:|schedule:|secrets\.|ssh|rsync|curl|deploy|supabase/i);
});

test('EF-115 runner fails closed on identity, branch ancestry, workspace, and lockfile', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  assert.match(workflow, /ref: \$\{\{ inputs\.authorized_sha \}\}/);
  assert.match(workflow, /grep -Ex '\[0-9a-f\]\{40\}'/);
  assert.match(workflow, /test "\$CHECKED_OUT_SHA" = "\$AUTHORIZED_SHA"/);
  assert.match(workflow, /git merge-base --is-ancestor "\$AUTHORIZED_SHA" origin\/dev/);
  assert.match(workflow, /git status --porcelain/);
  assert.match(workflow, /test -f pnpm-lock\.yaml/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true|if:\s*always\(\)/);
});

test('EF-115 runner installs pinned dependencies, executes the fixed suites, and retains evidence', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  assert.match(workflow, /version: 9\.0\.0/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  for (const suite of [
    'ef110-index-runtime-sanitization.test.ts',
    'ef110-security-sanitization.test.ts',
    'ef102-stream-events.test.ts',
  ]) assert.match(workflow, new RegExp(suite.replaceAll('.', '\\.')));
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /retention-days: 30/);
  assert.match(workflow, /runtimeE2E:'not-executed'/);
});
