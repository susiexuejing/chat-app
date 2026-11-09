const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const registry = 'https://registry.npmjs.org';
const workflows = ['deploy-dev.yml', 'ef384-native-demo.yml', 'ef92-static-gate.yml'];

for (const filename of workflows) {
  test(`${filename}: official registry is scoped to dependency installation`, () => {
    const source = fs.readFileSync(path.join(root, '.github/workflows', filename), 'utf8');
    const steps = source.split(/(?=^      - )/m).slice(1);
    const bootstrap = steps.filter(step => step.includes('uses: pnpm/action-setup@v4'));
    const install = steps.filter(step => /run: pnpm install --frozen-lockfile/.test(step));
    assert.equal(bootstrap.length, 1);
    assert.equal(install.length, 1);
    assert.match(bootstrap[0], /        env:\n          npm_config_registry: https:\/\/registry\.npmjs\.org\n/);
    assert.match(bootstrap[0], /          version: 9\.0\.0\n/);
    assert.match(bootstrap[0], /          run_install: false\n/);
    if (filename === 'ef92-static-gate.yml') {
      assert.match(install[0], /run: pnpm install --frozen-lockfile --registry=https:\/\/registry\.npmjs\.org\n/);
    } else {
      assert.match(install[0], /        env:\n          npm_config_registry: https:\/\/registry\.npmjs\.org\n/);
      assert.match(install[0], /run: pnpm install --frozen-lockfile\n/);
    }
    for (const step of steps.filter(step => !bootstrap.includes(step) && !install.includes(step))) {
      assert.ok(!step.includes('npm_config_registry'), 'registry override must not reach build, runtime or deployment steps');
    }
    assert.doesNotMatch(source, /^(?:env:|    env:)/m, 'no workflow/job-wide environment override');
    assert.match(source, /^permissions:\n  contents: read$/m);
    assert.ok(source.includes(registry));
    assert.doesNotMatch(source, /strict-ssl|NODE_TLS_REJECT_UNAUTHORIZED|--no-frozen-lockfile|--force/);
  });
}

test('DEV deployment still tests, builds, activates and verifies the release without bypasses', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/deploy-dev.yml'), 'utf8');
  assert.match(source, /run: pnpm --dir client exec jest --runInBand/);
  assert.match(source, /run: pnpm --dir server exec jest --runInBand --runTestsByPath src\/__tests__\/em43\.test\.ts/);
  assert.match(source, /run: pnpm --dir client exec expo export --platform web --output-dir dist/);
  assert.match(source, /run: pnpm --dir server run build/);
  assert.match(source, /name: Activate dev release/);
  assert.match(source, /name: Verify dev deployment/);
  assert.match(source, /name: Verify DEV sanitized runtime audit file/);
  assert.match(source, /name: Roll back failed activation/);
  assert.doesNotMatch(source, /continue-on-error/);
});

test('Native CI executes this contract for workflow repair changes', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/ef384-native-demo.yml'), 'utf8');
  assert.ok(source.includes("'scripts/__tests__/ef385-*'"));
  assert.match(source, /run: node --test scripts\/__tests__\/ef384-native-\*\.test\.cjs scripts\/__tests__\/ef385-\*\.test\.cjs/);
});
