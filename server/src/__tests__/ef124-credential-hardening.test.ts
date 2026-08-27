import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('../../../client', import.meta.url));
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.mjs', '.cjs', '.mts', '.cts']);

function collectClientSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '__tests__') return [];

    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectClientSources(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function decodeEscapes(source: string): string {
  return source
    .replace(/\\u\{([0-9a-f]+)\}/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function normalizeSource(source: string): string {
  let normalized = decodeEscapes(source);
  let previous: string;
  do {
    previous = normalized;
    normalized = normalized.replace(/(['"`])([^'"`\n]*)\1\s*\+\s*(['"`])([^'"`\n]*)\3/g, '$2$4');
  } while (normalized !== previous);
  return normalized;
}

function findCredentialBoundaryViolations(source: string): string[] {
  const normalized = normalizeSource(source);
  const violations: string[] = [];
  if (/expo_public_[a-z0-9_]*(?:token|api_key|secret)\b/i.test(normalized)) violations.push('public-provider-env');
  if (/(?:pat_[a-z0-9]{20,}|sk-[a-z0-9_-]{20,})/i.test(normalized)) violations.push('credential-literal');
  if (/["']?cozetoken["']?\s*:/i.test(normalized)) violations.push('coze-token-field');
  if (/\bextra\s*:\s*\{[^}]*\bcozetoken\b/is.test(normalized)) violations.push('coze-token-shorthand');
  return violations;
}

describe('EF-124 client credential boundary', () => {
  const clientSource = collectClientSources(clientRoot)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  it('keeps all Expo-consumable client files free of credential boundary violations', () => {
    expect(findCredentialBoundaryViolations(clientSource)).toEqual([]);
  });

  it.each([
    ['direct public provider token', 'const value = process.env.EXPO_PUBLIC_COZE_TOKEN;'],
    ['mixed-case public provider token', 'const value = process.env.ExPo_PuBlIc_CoZe_ToKeN;'],
    ['escaped public provider token', 'const value = process.env.EXPO_PUBLIC_COZE_\\u0054OKEN;'],
    ['concatenated public provider token', "const value = 'EXPO_PUBLIC_COZE_' + 'TOKEN';"],
    ['credential literal', `const value = '${['pat_', 'abcdefghijklmnopqrst'].join('')}';`],
    ['escaped credential literal', `const value = '${['p\\u0061t_', 'abcdefghijklmnopqrst'].join('')}';`],
    ['direct token config field', 'export default { extra: { cozeToken: value } };'],
    ['shorthand token config field', 'const cozeToken = value; export default { extra: { cozeToken } };'],
    ['JSON token config field', '{ "extra": { "cozeToken": "value" } }'],
  ])('rejects %s', (_label, source) => {
    expect(findCredentialBoundaryViolations(source)).not.toEqual([]);
  });
});
