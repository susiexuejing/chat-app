import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const allowedMarkers = new Set([
  'server/data/ltu/.gitkeep',
  'server/data/evolution/.gitkeep',
  'server/auto/data/.gitkeep',
]);

const tracked = execFileSync('git', ['ls-files'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean);

const forbiddenTracked = tracked.filter((file) => {
  if (allowedMarkers.has(file)) return false;
  return file.startsWith('server/data/ltu/')
    || file.startsWith('server/data/evolution/')
    || file === 'server/data/neural_profiles.json'
    || file.startsWith('server/auto/data/');
});

const forbiddenArtifactNames = new Set([
  'neural_profiles.json',
  'userChangeData.json',
]);

function collectArtifactViolations(root) {
  if (!existsSync(root)) return [];
  const violations = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      const normalized = relative(repositoryRoot, fullPath).split(sep).join('/');
      if (
        forbiddenArtifactNames.has(entry.name)
        || normalized.includes('/data/ltu/')
        || normalized.includes('/data/evolution/')
        || normalized.includes('/auto/data/')
      ) {
        violations.push(normalized);
      }
    }
  }
  return violations;
}

const artifactViolations = [
  ...collectArtifactViolations(join(repositoryRoot, 'server', 'dist')),
  ...collectArtifactViolations(join(repositoryRoot, 'client', 'dist')),
];

const violations = [...forbiddenTracked, ...artifactViolations];
if (violations.length > 0) {
  console.error('Runtime/user-derived data path check failed:');
  for (const file of violations) console.error(`- ${file}`);
  process.exit(1);
}

console.log('Runtime/user-derived data path check passed.');
