import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const workflowPath = path.join(
  repositoryRoot,
  '.github/workflows/ef122-reproducible-verification-pack.yml',
);
const documentationPath = path.join(
  repositoryRoot,
  'docs/EF-122-reproducible-verification-pack.md',
);

const approvedSuites = [
  'src/__tests__/ef110-index-runtime-sanitization.test.ts',
  'src/__tests__/ef110-security-sanitization.test.ts',
  'src/__tests__/ef102-stream-events.test.ts',
];

async function readArtifacts() {
  const [workflow, documentation] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    readFile(documentationPath, 'utf8'),
  ]);
  return { workflow, documentation };
}

test('EF-122 workflow is a reproducible, dev-targeted CI check', async () => {
  const { workflow } = await readArtifacts();

  assert.match(workflow, /^name: EF-122 Reproducible Verification Pack$/m);
  assert.match(workflow, /pull_request:\n    branches: \[dev\]/);
  assert.match(workflow, /push:\n    branches: \[dev\]/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /pnpm\/action-setup@[0-9a-f]{40}/);
  assert.match(workflow, /version: 9\.0\.0/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm run lint:server/);
  assert.match(workflow, /pnpm --dir server run build/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /git diff --exit-code HEAD --/);
});

test('EF-122 workflow invokes exactly the three approved server suites', async () => {
  const { workflow } = await readArtifacts();
  const approvedSuitesStep = workflow.match(
    /- name: Run approved server verification suites([\s\S]*?)(?=\n      - name:)/,
  )?.[1] ?? '';
  const suiteMatches = approvedSuitesStep.match(/src\/__tests__\/[^\s]+\.test\.ts/g) ?? [];

  assert.deepEqual(suiteMatches, approvedSuites);
  assert.match(workflow, /NODE_OPTIONS: --experimental-vm-modules/);
  assert.match(workflow, /\.\/node_modules\/\.bin\/jest --no-cache --runInBand/);
});

test('EF-122 workflow fails closed and contains no dispatch, deployment, credentials, or provider access', async () => {
  const { workflow } = await readArtifacts();

  for (const forbiddenPattern of [
    /workflow_dispatch/i,
    /continue-on-error/i,
    /\|\|\s*true/i,
    /secrets\./i,
    /\bdeploy(?:ment)?\b/i,
    /\bcurl\b/i,
    /\bwget\b/i,
    /\bssh\b/i,
    /\brsync\b/i,
    /\bscp\b/i,
    /\bsupabase\b/i,
    /\bdatabase\b/i,
    /\bcoze\b/i,
    /\.cozeproj/i,
  ]) {
    assert.doesNotMatch(workflow, forbiddenPattern);
  }
});

test('EF-122 documentation records command authority, isolation, and rollback boundaries', async () => {
  const { documentation } = await readArtifacts();

  for (const requiredText of [
    'pnpm install --frozen-lockfile',
    'pnpm run lint:server',
    'pnpm --dir server run build',
    'EF-122 Reproducible Verification Pack',
    'No credentials are required',
    'does not deploy',
    'does not change branch protection',
    'rollback',
  ]) {
    assert.ok(documentation.includes(requiredText), `Missing documentation text: ${requiredText}`);
  }

  assert.match(documentation, /does not contact databases, providers, DEV,\s*or Production/);

  for (const suitePath of approvedSuites) {
    assert.ok(documentation.includes(suitePath), `Missing approved suite: ${suitePath}`);
  }
});
