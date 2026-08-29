import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createReviewManifest } from '../review-manifest.mjs';
const BASE = 'a'.repeat(40); const HEAD = 'b'.repeat(40);
const gitAt = value => args => { assert.deepEqual(args, ['rev-parse', 'HEAD']); return value; };
async function eventFile(payload) { const root = await mkdtemp(path.join(tmpdir(), 'ef111-event-')); const file = path.join(root, 'event.json'); await writeFile(file, JSON.stringify(payload)); return { root, file }; }
const scope = JSON.stringify({ schemaVersion: 1, allowedPaths: ['.github/workflows/release-gate.yml', 'scripts/ef111-scope.manifest.json', 'scripts/review-manifest.mjs', 'scripts/release-suite.manifest.json', 'scripts/__tests__/ef94-ci-release-gate.test.mjs', 'scripts/__tests__/ef111-review-manifest.test.mjs', 'docs/EF-94-ci-release-gate.md'] });
test('push records only checked-out identity and makes no PR claim', async () => {
  const manifest = await createReviewManifest({ GITHUB_EVENT_NAME: 'push', GITHUB_SHA: HEAD }, { git: gitAt(HEAD) });
  assert.deepEqual(manifest, { schemaVersion: 1, eventName: 'push', checkedOutSha: HEAD, baseSha: null, headSha: HEAD, prNumber: null, changedPaths: null });
});
test('workflow dispatch has the same non-PR identity contract', async () => {
  const manifest = await createReviewManifest({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: HEAD }, { git: gitAt(HEAD) }); assert.equal(manifest.baseSha, null); assert.equal(manifest.prNumber, null);
});
test('PR requires dev base, matching head/candidate, and allowlisted paths', async t => {
  const { root, file } = await eventFile({ number: 17, pull_request: { number: 17, base: { ref: 'dev', sha: BASE }, head: { sha: HEAD } } }); t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = await createReviewManifest({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: 'c'.repeat(40), GITHUB_EVENT_PATH: file }, { git: gitAt(HEAD), read: async target => target === file ? readFile(target, 'utf8') : scope, execFile: (_bin, args) => { assert.deepEqual(args, ['diff', '--name-only', `${BASE}...${HEAD}`]); return '.github/workflows/release-gate.yml\n'; } });
  assert.equal(manifest.prNumber, 17); assert.deepEqual(manifest.changedPaths, ['.github/workflows/release-gate.yml']);
});
test('PR fails closed for a mismatched checkout or out-of-scope diff', async t => {
  const { root, file } = await eventFile({ number: 1, pull_request: { base: { ref: 'dev', sha: BASE }, head: { sha: HEAD } } }); t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(createReviewManifest({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: HEAD, GITHUB_EVENT_PATH: file }, { git: gitAt(BASE) }), /head SHA.*checked-out candidate/);
  await assert.rejects(createReviewManifest({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: HEAD, GITHUB_EVENT_PATH: file }, { git: gitAt(HEAD), read: async target => target === file ? readFile(target, 'utf8') : scope, execFile: () => 'client/app/index.tsx\n' }), /out-of-scope path/);
});
