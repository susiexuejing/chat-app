import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONFIG_PATH = path.join(REPO_ROOT, '.gitleaks.toml');
const roots = [];

const RUNTIME_CONFIG_PATH = 'server/src/storage/database/rds-runtime-config.ts';
const IDENTITY_DB_PATH = 'server/src/storage/database/identity-db.ts';
const OWNER_STORE_PATH = 'server/src/storage/database/rds-owner-binding-store.ts';
const APPROVED_PATHS = [RUNTIME_CONFIG_PATH, IDENTITY_DB_PATH, OWNER_STORE_PATH];

const credentialWord = ['pass', 'word'].join('');
const secretWord = ['sec', 'ret'].join('');
const tokenWord = ['to', 'ken'].join('');
const apiKeyWord = ['api', '_key'].join('');
const runtimePasswordName = ['EF_RDS_RUNTIME_', 'PASSWORD'].join('');
const syntheticValue = ['SYNTHETIC', 'ONLY', 'NOTREAL', '0123456789'].join('_');

after(async () => Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))));

async function scan(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'ef237-gitleaks-'));
  roots.push(root);
  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, source);
  }

  const reportPath = path.join(root, 'report.json');
  const result = spawnSync('gitleaks', [
    'detect',
    '--source', root,
    '--no-git',
    '--config', CONFIG_PATH,
    '--redact=100',
    '--report-format', 'json',
    '--report-path', reportPath,
    '--exit-code', '42',
    '--no-banner',
  ], { encoding: 'utf8' });

  assert.notEqual(result.error?.code, 'ENOENT', 'preinstalled gitleaks is required');
  let findings = [];
  try {
    findings = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { status: result.status, findings, stderr: result.stderr };
}

function dynamicSources() {
  return {
    [RUNTIME_CONFIG_PATH]: `const ${credentialWord} = env.${runtimePasswordName};\n`,
    [IDENTITY_DB_PATH]: `const options = { ${credentialWord}: config.${credentialWord}, };\n`,
    [OWNER_STORE_PATH]: `const options = { ${credentialWord}: config.${credentialWord}, };\n`,
  };
}

async function assertDetected(relativePath, source, expectedRules = ['generic-secret']) {
  const result = await scan({ [relativePath]: source });
  assert.equal(result.status, 42, result.stderr);
  const rules = new Set(result.findings.map(finding => finding.RuleID));
  for (const rule of expectedRules) assert.ok(rules.has(rule), `${rule} must reject ${relativePath}`);
}

test('generic-secret remains active and exceptions have no global or glob path scope', async () => {
  const config = await readFile(CONFIG_PATH, 'utf8');
  assert.match(config, /id = "generic-secret"/);
  assert.doesNotMatch(config, /^\s*entropy\s*=/m);

  const globalBlock = config.match(/\[allowlist\][\s\S]*?(?=\n\[\[rules\]\])/u)?.[0] ?? '';
  assert.doesNotMatch(globalBlock, /server\/src\/storage\/database/);

  for (const approvedPath of APPROVED_PATHS) {
    const escaped = approvedPath.replaceAll('.', '\\.');
    assert.ok(config.includes(escaped), `${approvedPath} must be explicitly listed`);
  }
  assert.doesNotMatch(config, /storage\/database\/\.\*/);
});

test('the three exact dynamic runtime references are allowed', async () => {
  const result = await scan(dynamicSources());
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.findings, []);
});

test('synthetic hardcoded passwords are rejected in every approved path', async () => {
  for (const relativePath of APPROVED_PATHS) {
    await assertDetected(relativePath, `const ${credentialWord} = "${syntheticValue}";\n`);
  }
});

test('other credential kinds remain rejected in the approved paths', async () => {
  await assertDetected(
    RUNTIME_CONFIG_PATH,
    `const ${tokenWord} = "${syntheticValue}";\nconst ${secretWord} = "${syntheticValue}";\n`,
  );
  await assertDetected(
    IDENTITY_DB_PATH,
    `const ${apiKeyWord} = "${'A'.repeat(28)}";\n`,
    ['generic-api-key'],
  );
});

test('environment-name and runtime-read structure variants fail closed', async () => {
  await assertDetected(
    RUNTIME_CONFIG_PATH,
    `const ${credentialWord} = env.${runtimePasswordName}_BACKUP;\n`,
  );
  await assertDetected(
    RUNTIME_CONFIG_PATH,
    `const ${credentialWord} = readRuntimeValue(runtimeKey);\n`,
  );
  await assertDetected(
    IDENTITY_DB_PATH,
    `const options = { ${credentialWord}: alternateConfig.${credentialWord}, };\n`,
  );
});

test('a fourth path and glob-like nested path do not inherit the exception', async () => {
  await assertDetected(
    'server/src/storage/database/other-store.ts',
    `const ${credentialWord} = env.${runtimePasswordName};\n`,
  );
  await assertDetected(
    'server/src/storage/database/nested/rds-runtime-config.ts',
    `const ${credentialWord} = env.${runtimePasswordName};\n`,
  );
});
