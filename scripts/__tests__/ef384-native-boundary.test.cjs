'use strict';
// Source-boundary guards only: these do not substitute for React runtime or browser QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('DEV runtime selects synthetic entry and omits ChatProvider before mounting descendants', () => {
  const source = read('client/features/synthetic-demo/RuntimeBoundary.tsx');
  assert.match(source, /IS_SYNTHETIC_DEMO\s*=\s*process\.env\.EXPO_PUBLIC_APP_ENV\s*===\s*'DEV'/);
  assert.match(source, /if\s*\(IS_SYNTHETIC_DEMO\)\s*return\s*<>\{children\}<\/>/);
  assert.match(source, /return\s*<ChatProvider>\{children\}<\/ChatProvider>/);
  assert.match(source, /IS_SYNTHETIC_DEMO\s*\?\s*<SyntheticDemoScreen\s*\/>\s*:\s*<ChatScreen\s*\/>/);
  const layout = read('client/app/_layout.tsx');
  assert.match(layout, /<AppRuntimeProvider>/);
  assert.doesNotMatch(layout, /<ChatProvider[\s>]/);
  assert.match(layout, /global\.css/);
});

test('synthetic screen and repository do not use real chat, networking, embedded HTML or production storage', () => {
  const screen = read('client/screens/synthetic-demo/index.tsx');
  const repository = read('client/features/synthetic-demo/repository.js');
  for (const source of [screen, repository]) {
    assert.doesNotMatch(source, /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|\baxios\b|\buseChat\s*\(|<iframe\b|<WebView\b/);
    assert.doesNotMatch(source, /(?:from\s*|require\s*\()\s*['"][^'"]*(?:ChatContext|services\/api|AsyncStorage)/);
  }
  assert.match(repository, /const STORAGE_KEY = 'emotionflow\.ef384\.native\.v1'/);
  assert.match(screen, /createDemoRepository\(window\.localStorage\)/);
  assert.doesNotMatch(repository, /(?:window|globalThis)\.(?:localStorage|sessionStorage)|\b(?:localStorage|sessionStorage)\s*\./); // injected storage only
});
