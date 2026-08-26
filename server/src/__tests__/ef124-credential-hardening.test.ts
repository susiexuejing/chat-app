import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('../../../client', import.meta.url));
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);

function collectClientSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '__tests__') return [];

    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectClientSources(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

describe('EF-124 client credential boundary', () => {
  const clientSource = collectClientSources(clientRoot)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  it('does not expose provider token environment variables to the client bundle', () => {
    expect(clientSource).not.toMatch(/EXPO_PUBLIC_[A-Z0-9_]*(?:TOKEN|API_KEY|SECRET)/);
  });

  it('does not contain provider credential-like literals or a Coze token config field', () => {
    expect(clientSource).not.toMatch(/(?:pat_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})/);
    expect(clientSource).not.toMatch(/["']?cozeToken["']?\s*:/);
  });
});
