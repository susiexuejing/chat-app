// Hermetic execution of the actual registered handlers and provider/SSE code.
// No sockets, credentials, filesystem persistence, or live provider requests.
import { readFile } from 'node:fs/promises';
import * as nodeModule from 'node:module';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

export const MODE = 'dev-ephemeral-v1';
export const START = '/api/v1/chat/dev-journey/start';
export const ORDINARY_START = '/api/v1/chat/start';
export const STREAM = '/api/v1/chat/stream';
export const OWNER = 'shared-anonymous-cookie-owner';
export const MESSAGE = '今天的测试任务让我有点紧张，我想先把眼前的事情说清楚。';
export const REPLY = '这件事情让你有些紧张，你可以从眼前最想说清楚的那一部分开始。';
export const body = (extra = {}) => ({ requestMode: MODE, roleId: 'clever-fox', message: MESSAGE, requestId: '100000_request_1', ...extra });
export const plain = value => JSON.parse(JSON.stringify(value));
export async function settle() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function providerResponse({ status = 200, text = REPLY, readError = false, noReader = false, reasoning = false } = {}) {
  let read = false;
  return {
    status, ok: status >= 200 && status < 300, text: async () => 'mock provider failure',
    body: noReader ? null : { getReader: () => ({ read: async () => {
      if (readError) throw new Error('mock stream failure');
      if (read) return { done: true };
      read = true;
      return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { [reasoning ? 'reasoning_content' : 'content']: text } }] })}\n\ndata: [DONE]\n\n`) };
    } }) },
  };
}

export async function harness(options = {}) {
  const { provider = async () => providerResponse(), apiKey = 'mock-only-key', authWait } = options;
  const nodeEnv = Object.hasOwn(options, 'nodeEnv') ? options.nodeEnv : 'development';
  const calls = [];
  const logs = [];
  const observedSessions = [];
  const providerRequests = [];
  const routes = new Map();
  const timers = new Map();
  let now = 100_000, timerId = 0, sessionId = 0;
  const processMock = { env: { NODE_ENV: nodeEnv, DASHSCOPE_API_KEY: apiKey,
    ...(Object.hasOwn(options, 'model') ? { MODEL_DEEP: options.model } : {}),
    ...(Object.hasOwn(options, 'baseUrl') ? { DASHSCOPE_BASE_URL: options.baseUrl } : {}),
  }, cwd: () => '/mock-server' };
  const tracked = (name, fn = () => undefined) => (...args) => {
    calls.push({ name, args });
    options.onCall?.(name, args);
    return fn(...args);
  };
  const timer = (fn, delay, repeat) => {
    const id = ++timerId;
    timers.set(id, { fn, delay, due: now + delay, repeat });
    return id;
  };
  function tick(ms) {
    const target = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, t] = next;
      now = Math.max(now, t.due);
      if (t.repeat) t.due += t.delay; else timers.delete(id);
      t.fn();
    }
    now = Math.max(now, target);
  }
  const app = {
    use() {},
    post(path, handler) { routes.set(`POST ${path}`, handler); },
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    // Registration only. Never bind a port or invoke server startup I/O.
    listen() {},
  };
  const express = Object.assign(() => app, { json: () => () => {}, urlencoded: () => () => {} });
  const profile = {
    userId: OWNER, roleId: 'clever-fox', attentionBias: 'PRIOR-PRIVATE-PROFILE', valueBias: 'default',
    influenceLog: ['PRIOR-PRIVATE-INFLUENCE'], longTermChangeLog: ['PRIOR-PRIVATE-CHANGE'],
    subconscious: { analyticalDepth: 0.9, emotionalSupport: 0.9, actionGuidance: 0.9, reflectiveSpace: 0.9,
      totalInteractions: 42, dominantEmotions: ['PRIOR-PRIVATE-EMOTION'], recentTopics: ['PRIOR-PRIVATE-TOPIC'], lastUpdated: 99 },
    createdAt: 99, updatedAt: 99,
  };
  const flow = { primaryFlow: null, secondaryFlow: null, status: 'stable', isMixed: false,
    position: { cognition: 1, attribution: 1, agency: 1, abstraction: 'low' } };
  const imports = {
    'dotenv/config': {}, express: { default: express }, cors: { default: () => () => {} },
    crypto: { default: { randomUUID: () => `run-${++sessionId}`, createHash } },
    path: { join: (...args) => args.join('/') },
    fs: {
      existsSync: tracked('fs.existsSync', () => true),
      readFileSync: tracked('fs.readFileSync', () => '{"weights":{"updatedAt":"mock"}}'),
    },
    './flows/recognizer': { recognizeEmotion: () => 'anxiety', recognizeEvent: () => 'general' },
    './flows/stateDetector': { detectUserState: () => 'anxiety', extractKeywords: () => ['当前输入'] },
    './flows/frontFlowTemplates': { buildFrontFlowText: () => '当前输入的本地陪伴。' },
    './flows/signalExtractor': { extractSignal: () => ({}) },
    './flows/neuralProfileManager': { neuralManager: {
      getOrCreateProfile: tracked('neural.getOrCreateProfile', () => profile),
      updateAfterSession: tracked('neural.updateAfterSession'),
      saveProfiles: tracked('neural.saveProfiles'), loadProfiles: tracked('neural.loadProfiles'),
    } },
    './flows/localReactionEngine': {
      generateReactionTimeline: tracked('local.reaction', () => options.reactionTimeline ?? [{ displayAt: 0, text: '我听到了。' }]),
      generateCompanionTimeline: tracked('local.companion', () => options.companionTimeline ?? [{ displayAt: 0, text: '可以慢慢说。' }]),
    },
    './flows/index': {
      analyzeFlow: tracked('flow.analyzeFlow', () => flow), recordChange: tracked('change.recordChange', () => null),
      getChangeBlock: tracked('change.getChangeBlock', () => 'PRIOR-PRIVATE-CHANGE-BLOCK'),
      getChangeTrends: tracked('change.getChangeTrends', () => ({})),
    },
    './flows/longTermUnderstanding': {
      loadProfile: tracked('ltu.loadProfile', async () => ({ totalInteractions: 42 })),
      generateLTUSummary: tracked('ltu.generateLTUSummary', () => 'PRIOR-PRIVATE-LTU'),
      updateProfile: tracked('ltu.updateProfile'),
    },
    './flows/personalityEvolution': {
      adjustWeights: tracked('evolution.adjustWeights', () => ({ weights: { updatedAt: 'mock' }, trigger: { factor: 'mock' } })),
      getDefaultWeights: tracked('evolution.getDefaultWeights'), logWeightChange: tracked('evolution.logWeightChange'),
    },
    './flows/conversationTurns': {
      incrementConversationTurn: tracked('turn.increment'),
      incrementConversationTurnIdempotent: tracked('turn.incrementIdempotent', () => options.ordinaryTurn ?? 3),
      getConversationTurn: tracked('turn.get'),
    },
    './routes/conversations': { default: () => {} }, './routes/anonymousSessions': { default: () => {} },
    './security/anonymousSession': {
      EF75_WEB_ORIGIN: 'https://dev.example.invalid',
      authenticateAnonymousRequest: tracked('auth', async (req, options) => {
        await authWait?.(req, options);
        if (!req.owner) return { ok: false, kind: 'invalid' };
        if (options?.requireCsrf && req.get('x-ef-csrf') !== 'mock-csrf') return { ok: false, kind: 'request_not_allowed' };
        return { ok: true, session: { id: req.owner } };
      }),
      sendAnonymousFailure: (res, kind) => res.status(kind === 'request_not_allowed' ? 403 : 401).json({ error: kind }),
      verifyOwnedConversation: tracked('conversation.verifyOwned', async () => 'owned'),
    },
    './contracts/streamEvents': {
      TurnEventSequencer: class { sequence = 0; next(eventType, payload) { return { eventType, ...payload, sequence: ++this.sequence }; } },
      serializeStreamEvent: event => `data: ${JSON.stringify(event)}\n\n`,
      mapSafeStreamError: code => options.realErrorMapping ? {
        code: code === 'stream_timeout' ? 'STREAM_TIMEOUT' : 'DEEP_RESPONSE_FAILED',
        message: code === 'stream_timeout' ? 'The response timed out before completion.' : 'The response could not be completed.',
        recoverable: true, recoveryAction: 'retry_turn',
      } : ({ code }),
    },
    './observability/ef118RuntimeAudit': { EF45_R2_PROBE_MARKER: 'mock-probe', writeEf118RuntimeAudit: tracked('audit') },
    './observability/ef45CategoryReader': { ef45CategoryReader() {}, isFixedEf45SyntheticProbe: () => false },
    './observability/ef45OneShotDiagnostic': {
      bindEf45OneShotDiagnosticMarker: session => observedSessions.push(session),
      ef45OneShotDiagnosticArm() {}, ef45OneShotDiagnosticFrontendTerminal() {}, ef45OneShotDiagnosticReader() {},
      knownEf45OneShotDiagnosticMarker: () => undefined, markerForEf45OneShotDiagnosticSession: () => undefined,
      recordEf45OneShotDiagnosticCategory: tracked('diagnostic'),
    },
  };
  for (const [name, constant] of [
    ['ef235IdentityWriteProbe', 'EF235_IDENTITY_WRITE_PROBE_PATH'],
    ['ef235IdentitySchemaRepair', 'EF235_IDENTITY_SCHEMA_REPAIR_PATH'],
    ['ef235IdentityRuntimeClassification', 'EF235_IDENTITY_RUNTIME_CLASSIFICATION_PATH'],
    ['ef235ConversationRuntimeClassification', 'EF235_CONVERSATION_RUNTIME_CLASSIFICATION_PATH'],
  ]) imports[`./diagnostics/${name}`] = { [constant]: `/mock/${name}`, [`${name}Handler`]: () => {} };

  const context = vm.createContext({
    process: processMock, AbortController, TextDecoder,
    JSON: Object.assign(Object.create(JSON), { stringify: (...args) => {
      const result = JSON.stringify(...args);
      options.onSerialize?.(args[0]);
      return result;
    } }),
    Date: class extends Date { static now() { return now; } },
    setInterval: (fn, ms) => timer(fn, ms, true), clearInterval: id => timers.delete(id),
    setTimeout: (fn, ms) => timer(fn, ms, false), clearTimeout: id => timers.delete(id),
    console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    fetch: async (url, options) => {
      providerRequests.push({ url, options });
      return provider(url, options);
    },
  });
  const ts = nodeModule.stripTypeScriptTypes ? null : nodeModule.createRequire(import.meta.url)('typescript');
  async function sourceModule(relative) {
    const url = new URL(relative, import.meta.url);
    const original = await readFile(url, 'utf8');
    const source = nodeModule.stripTypeScriptTypes
      ? nodeModule.stripTypeScriptTypes(original, { mode: 'strip' })
      : ts.transpileModule(original, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    return new vm.SourceTextModule(source, { context, identifier: url.href });
  }
  if (options.realStreamContract) {
    const { z } = nodeModule.createRequire(import.meta.url)('zod');
    const streamModule = await sourceModule('../contracts/streamEvents.ts');
    await streamModule.link(specifier => {
      if (specifier !== 'zod') throw new Error(`Unexpected stream dependency: ${specifier}`);
      return new vm.SyntheticModule(['z'], function () { this.setExport('z', z); }, { context });
    });
    await streamModule.evaluate();
    imports['./contracts/streamEvents'] = streamModule.namespace;
  }
  const practiceModule = await sourceModule('../contracts/devPracticeCandidate.ts');
  await practiceModule.link(() => { throw new Error('Unexpected practice contract dependency'); });
  await practiceModule.evaluate();
  imports['./contracts/devPracticeCandidate'] = practiceModule.namespace;
  const modeModule = await sourceModule('../devEphemeralChat.ts');
  const reactionModule = await sourceModule('../flows/firstTwoRoundsReaction.ts');
  await reactionModule.link(() => { throw new Error('Unexpected reaction dependency'); });
  const validatorModule = await sourceModule('../flows/ef41DeepCompositionValidator.ts');
  await validatorModule.link(specifier => {
    if (specifier === './firstTwoRoundsReaction') return reactionModule;
    throw new Error(`Unexpected validator dependency: ${specifier}`);
  });
  await validatorModule.evaluate();
  imports['./flows/ef41DeepCompositionValidator'] = {
    FIRST_TWO_ROUNDS_MAX_CHARS: validatorModule.namespace.FIRST_TWO_ROUNDS_MAX_CHARS,
    validateEf41DeepOutputOutcome: tracked('validator', input => options.realValidator
      ? validatorModule.namespace.validateEf41DeepOutputOutcome(input) : { text: input.text, rejected: false }),
    validateEf41DeepOutput: tracked('validator', input => options.realValidator
      ? validatorModule.namespace.validateEf41DeepOutput(input) : input.text),
  };
  const promptModule = await sourceModule('../flows/deepSystemPromptBuilder.ts');
  await modeModule.link(() => { throw new Error('Unexpected helper dependency'); });
  await promptModule.link(specifier => {
    if (specifier === './ef41DeepCompositionValidator') return validatorModule;
    throw new Error(`Unexpected prompt dependency: ${specifier}`);
  });
  await modeModule.evaluate(); await promptModule.evaluate();
  // Exercise the real pure status classifier and DEV gate; keep the audit sink a spy.
  const auditModule = await sourceModule('../observability/ef118RuntimeAudit.ts');
  await auditModule.link(specifier => {
    const unexpectedIo = () => { throw new Error('Unexpected audit filesystem access in handler harness'); };
    const exported = specifier === 'node:fs'
      ? { appendFileSync: unexpectedIo, existsSync: unexpectedIo, lstatSync: unexpectedIo, mkdirSync: unexpectedIo }
      : specifier === 'node:path' ? { dirname: unexpectedIo } : null;
    if (!exported) throw new Error(`Unexpected audit dependency: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(exported), function () {
      for (const [name, value] of Object.entries(exported)) this.setExport(name, value);
    }, { context });
  });
  await auditModule.evaluate();
  Object.assign(imports['./observability/ef118RuntimeAudit'], {
    classifyEf118ProviderHttpStatus: auditModule.namespace.classifyEf118ProviderHttpStatus,
    isEf118RuntimeAuditEnabled: auditModule.namespace.isEf118RuntimeAuditEnabled,
  });
  imports['./flows/deepSystemPromptBuilder'] = {
    buildDeepSystemPrompt: tracked('prompt', (...args) => promptModule.namespace.buildDeepSystemPrompt(...args)),
  };
  const module = await sourceModule('../index.ts');
  await module.link(specifier => {
    if (specifier === './devEphemeralChat') return modeModule;
    if (!Object.hasOwn(imports, specifier)) throw new Error(`Unmocked import: ${specifier}`);
    const exported = imports[specifier];
    return new vm.SyntheticModule(Object.keys(exported), function () {
      for (const [name, value] of Object.entries(exported)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();

  async function request(method, path, { input, owner = OWNER, csrf = 'mock-csrf', query = {}, accept, retryContract } = {}) {
    const events = new Map();
    const req = { owner, body: input, query, get: name => name.toLowerCase() === 'x-ef-csrf' ? csrf : name.toLowerCase() === 'accept' ? accept : name.toLowerCase() === 'x-dev-retry-contract' ? retryContract : undefined,
      on: (name, fn) => events.set(name, fn) };
    const res = {
      statusCode: 200, headers: {}, body: undefined, writes: [], ended: false,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; this.ended = true; return this; },
      on(name, fn) { events.set(name, fn); },
      setHeader(key, value) { this.headers[key] = value; },
      write(value) { this.writes.push(value); options.onWrite?.(value); },
      end() { this.ended = true; events.get('close')?.(); },
    };
    const handler = routes.get(`${method} ${path}`);
    if (!handler) res.status(404).json({ error: 'route_missing' });
    else await handler(req, res);
    return { req, res, close: () => events.get('close')?.(), events: () => res.writes.filter(x => x.startsWith('data: ')).map(x => JSON.parse(x.slice(6))) };
  }
  return { now: () => now, calls, logs, sessions: observedSessions, providerRequests, routes, tick, elapse: ms => { now += ms; }, request, process: processMock,
    mode: modeModule.namespace, startDeepAnalysis: module.namespace.startDeepAnalysis, profile,
    identityCalls: () => calls.filter(({ name }) => /^(neural\.|flow\.|change\.|ltu\.|evolution\.|fs\.|turn\.|conversation\.)/.test(name)),
  };
}
