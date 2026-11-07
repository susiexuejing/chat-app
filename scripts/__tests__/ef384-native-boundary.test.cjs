'use strict';
// Source guards complement renderer tests; they are not browser/router integration QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('root retains global Provider and sibling live/demo routes, with no root ChatProvider', () => {
  const layout = read('client/app/_layout.tsx');
  assert.match(layout, /<Provider>/);
  assert.match(layout, /global\.css/);
  assert.match(layout, /<Stack.Screen name="\(live\)"/);
  assert.match(layout, /<Stack.Screen name="demo"/);
  assert.doesNotMatch(layout, /ChatProvider|AppRuntimeProvider|RuntimeBoundary/);
  assert.equal(fs.existsSync(path.join(root, 'client/app/index.tsx')), false);
  assert.equal(fs.existsSync(path.join(root, 'client/app/chat.tsx')), false);
});

test('original / and /chat remain original chat routes under a shared live provider', () => {
  for (const route of ['index', 'chat']) {
    assert.match(read(`client/app/(live)/${route}.tsx`), /export\s*\{\s*default\s*\}\s*from\s*['"]@\/screens\/chat['"]/);
  }
  assert.match(read('client/app/(live)/_layout.tsx'), /from ['"]@\/features\/synthetic-demo\/LiveChatLayout['"]/);
  const live = read('client/features/synthetic-demo/LiveChatLayout.tsx');
  assert.match(live, /<ChatProvider><Stack/);
  assert.match(live, /<Stack.Screen name="index"/);
  assert.match(live, /<Stack.Screen name="chat"/);
  assert.doesNotMatch(live, /EXPO_PUBLIC_APP_ENV|SyntheticDemoScreen/);
});

test('/demo is DEV-only and imports no live provider or chat fallback', () => {
  assert.match(read('client/app/demo.tsx'), /from ['"]@\/features\/synthetic-demo\/DemoEntry['"]/);
  const entry = read('client/features/synthetic-demo/DemoEntry.tsx');
  assert.match(entry, /if\s*\(process\.env\.EXPO_PUBLIC_APP_ENV === 'DEV'\) return <SyntheticDemoScreen\s*\/>/);
  assert.match(entry, /合成演示仅在 DEV 环境开放/);
  assert.doesNotMatch(entry, /from ['"][^'"]*(?:ChatContext|screens\/chat)['"]|<ChatProvider|<ChatScreen/);
});

test('original chat demo button only replaces route, is DEV-only, and waits for hydration and live requests', () => {
  const chat = read('client/screens/chat/index.tsx');
  const button = chat.match(/function NativeDemoEntry\([\s\S]*?\nfunction ChatContent\(/)?.[0];
  assert.ok(button, 'expected bounded NativeDemoEntry component');
  assert.match(button, /process\.env\.EXPO_PUBLIC_APP_ENV !== 'DEV'\) return null/);
  assert.match(button, /testID="native-demo-open"/);
  assert.match(button, /disabled=\{disabled\}/);
  assert.match(button, /onPress=\{\(\) => \{\s*if \(!disabled\) router\.replace\('\/demo'\);\s*\}\}/);
  assert.doesNotMatch(button, /sendMessage|fetch\s*\(|axios|useChat\s*\(/);
  assert.equal((chat.match(/<NativeDemoEntry disabled=\{!isHydrated \|\| isLoading\}\s*\/>/g) || []).length, 2);
});

test('synthetic screen and repository use injected demo storage with no live chat, networking or embedded HTML', () => {
  const screen = read('client/screens/synthetic-demo/index.tsx');
  const repository = read('client/features/synthetic-demo/repository.js');
  for (const source of [screen, repository]) {
    assert.doesNotMatch(source, /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|\baxios\b|\buseChat\s*\(|<iframe\b|<WebView\b/);
    assert.doesNotMatch(source, /(?:from\s*|require\s*\()\s*['"][^'"]*(?:ChatContext|services\/api|AsyncStorage)/);
  }
  assert.match(repository, /const STORAGE_KEY = 'emotionflow\.ef384\.native\.v1'/);
  assert.match(screen, /createDemoRepository\(window\.localStorage\)/);
  assert.doesNotMatch(repository, /(?:window|globalThis)\.(?:localStorage|sessionStorage)|\b(?:localStorage|sessionStorage)\s*\./);
  assert.match(screen, /testID="return-live-chat"[\s\S]*?navigate\('chat'\);\s*router\.replace\('\/'\)/);
});
