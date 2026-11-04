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
if (sha256 !== 'd9b06016059078e4872abdcf3601fefbf43bf11313c51ec30342a7ef7443fd76') {
  throw Error('EF-377 candidate digest mismatch');
}
console.log(JSON.stringify({
  bytes: html.length,
  sha256,
  scope: 'author Node DOM simulation; native browser and independent integrated QA Not Run',
}));
