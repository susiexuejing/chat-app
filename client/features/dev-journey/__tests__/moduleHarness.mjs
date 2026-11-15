// Dependency-free execution of the real TS modules with hermetic mock imports.
// Run with --experimental-vm-modules; never calls a real network. Node 20 uses
// the repository's existing TypeScript dev dependency; newer Node can strip TS.
import { readFile } from 'node:fs/promises';
import * as nodeModule from 'node:module';
import vm from 'node:vm';

export async function loadTsModule(url, imports, globals = {}, dynamicImport) {
  const original = await readFile(url, 'utf8');
  const ts = nodeModule.stripTypeScriptTypes ? null : nodeModule.createRequire(import.meta.url)('typescript');
  const source = nodeModule.stripTypeScriptTypes
    ? nodeModule.stripTypeScriptTypes(original, { mode: 'strip' })
    : ts.transpileModule(original, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
  const context = vm.createContext({
    AbortController, TextDecoder, TextEncoder,
    setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref?.(); return timer; }, clearTimeout,
    console: {
      log() { return undefined; },
      warn() { return undefined; },
      error() { return undefined; },
    },
    fetch: () => { throw new Error('Unmocked network is forbidden'); },
    ...globals,
  });
  const modules = new Map();
  // Resolve the actual fixed diagnostic contract, never a copied enum mock.
  const diagnosticSpecifiers = new Set(['@/features/dev-journey/candidateDiagnostic', './candidateDiagnostic']);
  let diagnosticModule;
  if ([...diagnosticSpecifiers].some(specifier => original.includes(`from '${specifier}'`))) {
    const url = new URL('../candidateDiagnostic.ts', import.meta.url);
    const input = await readFile(url, 'utf8');
    const text = nodeModule.stripTypeScriptTypes ? nodeModule.stripTypeScriptTypes(input, { mode: 'strip' })
      : ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    diagnosticModule = new vm.SourceTextModule(text, { context, identifier: url.href });
    await diagnosticModule.link(() => { throw new Error('Unexpected diagnostic dependency'); });
    await diagnosticModule.evaluate();
  }

  function synthetic(specifier) {
    if (diagnosticModule && diagnosticSpecifiers.has(specifier)) return diagnosticModule;
    if (!Object.hasOwn(imports, specifier)) throw new Error(`Unmocked import: ${specifier}`);
    if (!modules.has(specifier)) {
      const exports = imports[specifier];
      modules.set(specifier, new vm.SyntheticModule(Object.keys(exports), function () {
        Object.entries(exports).forEach(([name, value]) => this.setExport(name, value));
      }, { context }));
    }
    return modules.get(specifier);
  }
  const module = new vm.SourceTextModule(source, {
    context, identifier: url.href,
    importModuleDynamically: async specifier => {
      await dynamicImport?.(specifier);
      const target = synthetic(specifier);
      if (target.status === 'unlinked') await target.link(() => { throw new Error('Unexpected nested import'); });
      if (target.status === 'linked') await target.evaluate();
      return target;
    },
  });
  await module.link(synthetic); await module.evaluate();
  return module.namespace;
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
