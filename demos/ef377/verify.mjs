import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('.', import.meta.url));
for (const path of [
  'ef377-integrated-v01/build.mjs',
  'ef377-integrated-v01/owner-test.mjs',
  'ef377-independent-qa/review.mjs',
  'ef377-independent-qa/isolation.mjs',
  'ef377-independent-qa/race.mjs',
  'ef377-independent-qa/ui-review.mjs',
]) {
  const result = spawnSync(process.execPath, [path], { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const html = readFileSync(new URL('ef377-integrated-v01/EmotionFlow-EF377-Integrated.html', import.meta.url));
const sha256 = createHash('sha256').update(html).digest('hex');
if (sha256 !== 'e40ae524f7f48a5304e0bb14b7fb3008fa5c97f8a737b55f4b510a5ef39a4771') {
  throw new Error('Frozen EF-377 artifact digest mismatch');
}
console.log(JSON.stringify({ bytes: html.length, sha256, scope: 'source import and synthetic checks; browser E2E Not Run; not deployed' }));
