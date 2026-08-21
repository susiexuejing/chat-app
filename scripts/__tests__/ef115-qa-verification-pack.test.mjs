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

test('EF-115 runner pins every third-party action to a full immutable commit SHA', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  const expectedPins = {
    'actions/checkout': '11d5960a326750d5838078e36cf38b85af677262',
    'pnpm/action-setup': 'b906affcce14559ad1aafd4ab0e942779e9f58b1',
    'actions/setup-node': '49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/upload-artifact': 'ea165f8d65b6e75b540449e92b4886f43607fa02',
  };
  for (const [action, sha] of Object.entries(expectedPins)) {
    assert.match(workflow, new RegExp(`uses: ${action.replace('/', '\\/')}@${sha}`));
  }
  assert.doesNotMatch(workflow, /^\s*uses:\s*[^\n@]+@v\d+(?:\.\d+)*\s*$/m);
  for (const action of Object.keys(expectedPins)) {
    assert.doesNotMatch(workflow, new RegExp(`uses: ${action.replace('/', '\\/')}@(?:main|master|v\\d+)`));
  }
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
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /retention-days: 30/);
  assert.match(workflow, /runtimeE2E:'not-executed'/);
});
