import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/qa-verification-pack.yml', import.meta.url);
const staticGateUrl = new URL('../../.github/workflows/ef92-static-gate.yml', import.meta.url);
const immutableActionReference = /^\s*uses:\s*[^\s@]+@[0-9a-f]{40}(?:\s+#\s*[^\n]+)?\s*$/;

test('EF-115 contract runs automatically as a blocking EF-92 PR gate step', async () => {
  const staticGate = await readFile(staticGateUrl, 'utf8');
  assert.match(staticGate, /^  pull_request:$/m);
  assert.match(
    staticGate,
    /^      - name: Run EF-115 QA verification-pack contract\n        id: ef115_qa_verification_pack\n        run: node --test scripts\/__tests__\/ef115-qa-verification-pack\.test\.mjs$/m,
  );
  assert.doesNotMatch(
    staticGate,
    /id: ef115_qa_verification_pack\n\s+continue-on-error:/,
  );
  assert.match(
    staticGate,
    /test "\$\{\{ steps\.ef115_qa_verification_pack\.outcome \}\}" = success/,
  );
});

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
  const usesLines = workflow.match(/^\s*uses:\s*[^\n]+$/gm) ?? [];

  assert.ok(usesLines.length > 0, 'the runner must declare at least one action');
  for (const line of usesLines) {
    assert.match(
      line,
      immutableActionReference,
      `mutable or malformed action reference: ${line}`,
    );
  }
});

test('EF-115 action pin rule rejects every mutable ref, including commented refs', () => {
  assert.match(
    'uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4',
    immutableActionReference,
  );
  for (const reference of [
    'uses: actions/checkout@v4',
    'uses: actions/checkout@v4 # comment',
    'uses: actions/checkout@main',
    'uses: actions/checkout@master',
    'uses: actions/checkout@11d5960',
    'uses: actions/checkout@11D5960A326750D5838078E36CF38B85AF677262',
  ]) assert.doesNotMatch(reference, immutableActionReference);
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
