import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const releaseGate = readFileSync(new URL('../../.github/workflows/release-gate.yml', import.meta.url), 'utf8');
const secretScan = readFileSync(new URL('../../.github/workflows/secret-scan.yml', import.meta.url), 'utf8');
const headExpression = '${{ github.event.pull_request.head.sha || github.sha }}';
const pinnedCheckout = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262';

function assertFailClosedHeadVerification(workflow) {
  assert.match(workflow, new RegExp(`uses: ${pinnedCheckout}`));
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /EXPECTED_SHA="\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}"/);
  assert.match(workflow, /ACTUAL_SHA="\$\(git rev-parse HEAD\)"/);
  assert.match(workflow, /test "\$ACTUAL_SHA" = "\$EXPECTED_SHA"/);
}

test('Release Gate runs the EF-124 credential hardening suite fail-closed', () => {
  assert.match(releaseGate, /working-directory: server/);
  assert.match(releaseGate, /NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest --no-cache src\/__tests__\/ef124-credential-hardening\.test\.ts/);
});

test('Release Gate checks out and verifies the event candidate SHA', () => {
  assertFailClosedHeadVerification(releaseGate);
});

test('Secret Scan checks out and verifies the event candidate SHA', () => {
  assertFailClosedHeadVerification(secretScan);
});

test('missing verification is rejected', () => {
  assert.throws(() => assertFailClosedHeadVerification(releaseGate.replace('test "$ACTUAL_SHA" = "$EXPECTED_SHA"', 'echo "$ACTUAL_SHA"')));
});

test('audit-only verification is rejected', () => {
  assert.throws(() => assertFailClosedHeadVerification(secretScan.replace('test "$ACTUAL_SHA" = "$EXPECTED_SHA"', 'echo "$ACTUAL_SHA"')));
});

test('missing PR-head checkout is rejected', () => {
  assert.throws(() => assertFailClosedHeadVerification(releaseGate.replace(headExpression, 'github.sha')));
});
