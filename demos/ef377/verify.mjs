import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('./ef377-integrated-v01/', import.meta.url));
for (const path of ['build.mjs', 'journey-test.mjs']) {
  const result = spawnSync(process.execPath, [path], { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const html = readFileSync(new URL('./ef377-integrated-v01/EmotionFlow-EF377-Integrated.html', import.meta.url));
const sha256 = createHash('sha256').update(html).digest('hex');
if (sha256 !== '95680f8f44d03bf62c7e6586de81b75ba21ca84f526b09646550e7735d04cc22') {
  throw Error('EF-377 candidate digest mismatch');
}
console.log(JSON.stringify({
  bytes: html.length,
  sha256,
  scope: 'author Node DOM simulation; native browser and independent integrated QA Not Run',
}));
