import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('./ef377-integrated-v01/', import.meta.url));
for (const path of ['build.mjs', 'journey-test.mjs', 'correction-test.mjs']) {
  const result = spawnSync(process.execPath, [path], { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const html = readFileSync(new URL('./ef377-integrated-v01/EmotionFlow-EF377-Integrated.html', import.meta.url));
const sha256 = createHash('sha256').update(html).digest('hex');
if (sha256 !== '2bde6207d2665dee93dc15f78e2bc445b5a579efddd675fb8a0020029bf77eae') {
  throw Error('EF-377 candidate digest mismatch');
}
for (const path of ['./ef377-integrated-v01/PROVENANCE.md', './RELEASE-REVIEW.md']) {
  const doc = readFileSync(new URL(path, import.meta.url), 'utf8');
  if (!doc.includes('当前候选 HTML 为 ' + html.length + ' 字节，SHA-256 ' + sha256)) {
    throw Error('EF-377 current artifact provenance mismatch: ' + path);
  }
}
console.log(JSON.stringify({
  bytes: html.length,
  sha256,
  scope: 'author Node DOM simulation; native browser and independent integrated QA Not Run',
}));
