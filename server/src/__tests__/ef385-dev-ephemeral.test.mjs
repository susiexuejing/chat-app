import assert from 'node:assert/strict';
import test from 'node:test';
import {
  body, deferred, harness, MESSAGE, MODE, ORDINARY_START, OWNER, plain,
  providerResponse, REPLY, settle, START, STREAM,
} from './devEphemeralHarness.mjs';

function assertIsolated(h) {
  assert.deepEqual(h.identityCalls(), [], 'no identity content read/write or durable conversation operation');
}
async function start(h, input = body(), options = {}) {
  const run = await h.request('POST', START, { input, ...options });
  await settle();
  return run;
}
async function open(h, sessionId, options = {}) {
  return h.request('GET', STREAM, { query: { sessionId }, ...options });
}

test('shared cookie DEV turn runs real provider path with current input only, no persistent state through completion/close', async () => {
  const h = await harness();
  const initialProfile = plain(h.profile);
  const { res } = await start(h);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.requestMode, MODE);
  assert.equal(res.body.userTurn, 1);
  const session = h.sessions[0];
  assert.equal(session.ownerSessionId, OWNER);
  assert.equal(session.userId, '');
  assert.equal(session.neuralProfile.userId, '');
  assert.equal(session.requestMode, MODE);
  assert.throws(() => { session.requestMode = undefined; }, TypeError);
  assert.equal(Object.getOwnPropertyDescriptor(session, 'requestMode').configurable, false);
  assert.equal(session.flowResult, null);
  assert.equal(session.deepDone, true);
  assert.equal(h.providerRequests.length, 1);
  const request = JSON.parse(h.providerRequests[0].options.body);
  assert.equal(request.stream, true);
  assert.equal(request.model, 'qwen3.6-plus');
  assert.equal(request.messages.length, 2);
  assert.deepEqual(request.messages[1], { role: 'user', content: MESSAGE });
  assert.match(request.messages[0].content, /当前是第 1 轮/);
  assert.match(request.messages[0].content, /当前这条用户消息是关于用户的唯一事实来源/);
  assert.doesNotMatch(JSON.stringify(request), /PRIOR-PRIVATE|shared-anonymous-cookie-owner/);
  assertIsolated(h);
  const stream = await open(h, res.body.sessionId);
  h.tick(3100);
  assert.equal(stream.res.ended, true);
  assert.deepEqual(stream.events().map(x => x.eventType), ['turn.started', 'reaction', 'companion', 'deep.delta', 'deep.completed', 'turn.completed']);
  assert.equal(stream.events().find(x => x.eventType === 'deep.delta').content, REPLY);
  stream.close(); // Duplicate close must not introduce a late persistence write.
  assertIsolated(h);
  assert.deepEqual(plain(h.profile), initialProfile);
  for (const secret of [OWNER, MESSAGE, REPLY]) assert.ok(!JSON.stringify(h.logs).includes(secret));
  for (const { name, args } of h.calls.filter(x => ['audit', 'diagnostic'].includes(x.name))) {
    assert.ok(!JSON.stringify(args).includes(MESSAGE), `${name} does not acquire raw input`);
    assert.ok(!JSON.stringify(args).includes(OWNER), `${name} does not acquire owner identity`);
  }
});

test('unmarked ordinary chat on the same cookie retains neural, flow, LTU, evolution and close behavior', async () => {
  const h = await harness();
  const { res } = await h.request('POST', ORDINARY_START, { input: {
    roleId: 'clever-fox', message: MESSAGE, conversationId: 'existing-conversation', requestId: 'ordinary-1',
  } });
  await settle();
  assert.equal(res.statusCode, 200);
  assert.equal(Object.hasOwn(res.body, 'requestMode'), false);
  assert.equal(res.body.userTurn, 3);
  for (const name of ['local.reaction', 'local.companion']) {
    const calls = h.calls.filter(call => call.name === name);
    assert.equal(calls.length, 1);
    assert.deepEqual(plain(calls[0].args), ['clever-fox', MESSAGE, {}, 3], 'ordinary generators receive raw input and actual turn');
  }
  const session = h.sessions[0];
  assert.equal(session.userId, OWNER);
  assert.equal(session.neuralProfile, h.profile);
  const sent = JSON.parse(h.providerRequests[0].options.body);
  assert.match(sent.messages[0].content, /PRIOR-PRIVATE-LTU/);
  assert.match(sent.messages[0].content, /PRIOR-PRIVATE-CHANGE-BLOCK/);
  const stream = await open(h, res.body.sessionId);
  h.tick(3100);
  assert.equal(stream.res.ended, true);
  const names = h.identityCalls().map(x => x.name);
  for (const required of [
    'conversation.verifyOwned', 'turn.incrementIdempotent', 'neural.getOrCreateProfile', 'flow.analyzeFlow',
    'change.recordChange', 'change.getChangeBlock', 'change.getChangeTrends', 'ltu.loadProfile',
    'ltu.generateLTUSummary', 'ltu.updateProfile', 'fs.existsSync', 'fs.readFileSync',
    'evolution.adjustWeights', 'evolution.logWeightChange', 'neural.updateAfterSession', 'neural.saveProfiles',
  ]) assert.ok(names.includes(required), `${required} remains on the ordinary path`);
  assert.deepEqual(h.calls.find(x => x.name === 'neural.getOrCreateProfile').args, [OWNER, 'clever-fox']);
});

test('ordinary unmarked first turn still uses real profile and still updates it after completion', async () => {
  const h = await harness();
  const { res } = await h.request('POST', ORDINARY_START, { input: { roleId: 'clever-fox', message: MESSAGE } });
  await settle();
  const stream = await open(h, res.body.sessionId);
  h.tick(3100);
  assert.equal(res.body.userTurn, 1);
  for (const name of ['local.reaction', 'local.companion']) {
    const calls = h.calls.filter(call => call.name === name);
    assert.equal(calls.length, 1);
    assert.deepEqual(plain(calls[0].args), ['clever-fox', MESSAGE, {}, 1], 'ordinary first-turn arguments remain unchanged');
  }
  assert.equal(stream.res.ended, true);
  const names = h.identityCalls().map(x => x.name);
  assert.ok(names.includes('neural.getOrCreateProfile'));
  assert.ok(names.includes('ltu.updateProfile'));
  assert.ok(names.includes('neural.updateAfterSession'));
  assert.ok(!names.includes('turn.incrementIdempotent'));
});

test('DEV normal_chat preserves the original local-only greeting branch without profile access', async () => {
  const h = await harness();
  const { res } = await start(h, body({ message: '你好' }));
  assert.equal(res.body.requestMode, MODE);
  assert.equal(h.providerRequests.length, 0);
  const stream = await open(h, res.body.sessionId);
  h.tick(100);
  assert.equal(stream.res.ended, true);
  assert.ok(!stream.events().some(x => x.eventType === 'deep.delta'));
  assertIsolated(h);
});

test('stop/close during in-flight provider does not write identity state when provider later finishes', async () => {
  const result = deferred();
  const h = await harness({ provider: () => result.promise });
  const { res } = await start(h);
  const stream = await open(h, res.body.sessionId);
  const initialWrites = stream.res.writes.length;
  stream.close();
  assertIsolated(h);
  result.resolve(providerResponse());
  await settle();
  h.tick(3100);
  assert.equal(h.sessions[0].deepDone, false, 'closed DEV work cannot publish late completion');
  assert.equal(h.sessions[0].userMessage, '');
  assert.deepEqual(plain(h.sessions[0].deepChunks), []);
  assert.equal(stream.res.writes.length, initialWrites, 'stopped SSE is not resumed');
  assertIsolated(h);
});

test('close/stop before SSE attachment and later expiry do not create durable identity/history', async () => {
  const h = await harness();
  const { res } = await start(h);
  h.tick(11 * 60 * 1000);
  const expired = await open(h, res.body.sessionId);
  assert.equal(expired.res.statusCode, 404);
  assertIsolated(h);
});

for (const [name, options] of [
  ['missing API key', { apiKey: '' }],
  ['provider HTTP failure', { provider: async () => providerResponse({ status: 503 }) }],
  ['provider network failure', { provider: async () => { throw new Error('mock network failure'); } }],
  ['missing response reader', { provider: async () => providerResponse({ noReader: true }) }],
  ['reader failure', { provider: async () => providerResponse({ readError: true }) }],
  ['empty output', { provider: async () => providerResponse({ text: '' }) }],
  ['reasoning fallback', { provider: async () => providerResponse({ reasoning: true }) }],
]) test(`${name} is isolated on completion/close`, async () => {
  const h = await harness(options);
  const { res } = await start(h);
  assert.equal(res.body.requestMode, MODE);
  const stream = await open(h, res.body.sessionId);
  h.tick(3100);
  assert.equal(stream.res.ended, true);
  assertIsolated(h);
});

test('SSE timeout followed by late provider response remains isolated', async () => {
  const result = deferred();
  const h = await harness({ provider: () => result.promise });
  const { res } = await start(h);
  const stream = await open(h, res.body.sessionId);
  h.tick(150001);
  assert.equal(stream.res.ended, true);
  assert.equal(stream.events().at(-1).eventType, 'error');
  result.resolve(providerResponse());
  await settle();
  assertIsolated(h);
});

test('authentication and CSRF remain required before mode can start', async () => {
  for (const options of [{ owner: null }, { csrf: '' }]) {
    const h = await harness();
    const { res } = await start(h, body(), options);
    assert.equal(res.statusCode, options.owner === null ? 401 : 403);
    assert.equal(h.providerRequests.length, 0);
    assert.equal(h.sessions.length, 0);
    assert.deepEqual(plain(h.calls.find(x => x.name === 'auth').args[1]), { requireCsrf: true });
    assertIsolated(h);
  }
});

test('SSE ownership is still the authenticated cookie owner, never supplied userId', async () => {
  const h = await harness();
  const { res } = await start(h);
  const other = await open(h, res.body.sessionId, { owner: 'different-owner' });
  assert.equal(other.res.statusCode, 404);
  assert.equal(other.res.writes.length, 0);
  const missing = await open(h, res.body.sessionId, { owner: null });
  assert.equal(missing.res.statusCode, 401);
  assertIsolated(h);
});

for (const nodeEnv of ['production', 'test', '', undefined]) test(`dedicated route absent outside explicit development (${String(nodeEnv)})`, async () => {
  const h = await harness({ nodeEnv });
  const { res } = await start(h);
  assert.equal(res.statusCode, 404);
  assert.equal(h.providerRequests.length, 0);
  assert.equal(h.sessions.length, 0);
  assertIsolated(h);
});

test('runtime environment recheck fails closed even if handler was registered earlier', async () => {
  const h = await harness();
  h.process.env.NODE_ENV = 'production';
  const { res } = await start(h);
  assert.equal(res.statusCode, 404);
  assert.equal(h.providerRequests.length, 0);
  assertIsolated(h);
});

for (const [name, input] of [
  ['missing body', undefined], ['null body', null], ['array body', []],
  ['missing mode', { roleId: 'clever-fox', message: MESSAGE, requestId: 'request-1' }],
  ['wrong mode', body({ requestMode: 'dev-ephemeral-v2' })], ['null mode', body({ requestMode: null })],
  ['wrong role', body({ roleId: 'warm-bear' })], ['object role', body({ roleId: {} })],
  ['missing message', body({ message: undefined })], ['object message', body({ message: {} })],
  ['empty message', body({ message: '' })], ['blank message', body({ message: ' \n\t' })],
  ['oversize message', body({ message: 'a'.repeat(1001) })], ['missing requestId', body({ requestId: undefined })],
  ['empty requestId', body({ requestId: '' })], ['unsafe requestId', body({ requestId: '../x' })],
  ['object requestId', body({ requestId: {} })], ['oversize requestId', body({ requestId: 'x'.repeat(101) })],
  ['conversationId', body({ conversationId: 'real-conversation' })], ['null conversationId', body({ conversationId: null })],
  ['empty conversationId', body({ conversationId: '' })], ['undefined conversationId', body({ conversationId: undefined })],
  ['userId', body({ userId: OWNER })], ['history', body({ history: ['private'] })],
  ['provider override', body({ model: 'other' })], ['turn override', body({ userTurn: 99 })],
]) test(`invalid DEV input rejects ${name} before provider or identity access`, async () => {
  const h = await harness();
  const { res } = await h.request('POST', START, { input });
  await settle();
  assert.equal(res.statusCode, 400);
  assert.equal(h.providerRequests.length, 0);
  assert.equal(h.sessions.length, 0);
  assertIsolated(h);
});

test('boundary lengths and safe request ID are accepted', async () => {
  const h = await harness();
  const { res } = await start(h, body({ message: 'a'.repeat(1000), requestId: '100000_A_z-0'.padEnd(100, 'x') }));
  assert.equal(res.statusCode, 200);
  assert.equal(h.providerRequests.length, 1);
  assertIsolated(h);
});

test('all markers reject on ordinary route, so no silent mode downgrade on new backend', async () => {
  const h = await harness();
  for (const requestMode of [MODE, 'unknown', null, false, undefined]) {
    const { res } = await h.request('POST', ORDINARY_START, { input: body({ requestMode }) });
    assert.equal(res.statusCode, 400);
  }
  assert.equal(h.providerRequests.length, 0);
  assert.equal(h.sessions.length, 0);
  assertIsolated(h);
});

test('separate ephemeral starts cannot acquire history or share mutable neutral profile arrays', async () => {
  const h = await harness();
  await start(h);
  const first = h.sessions[0];
  first.neuralProfile.influenceLog.push('PRIOR-PRIVATE-MUTATION');
  first.neuralProfile.subconscious.recentTopics.push('PRIOR-PRIVATE-TOPIC');
  await start(h, body({ requestId: '100000_request_2', message: '现在我只想谈另一件当前的事情。' }));
  const second = h.sessions[1];
  assert.notEqual(first.sessionId, second.sessionId);
  assert.notEqual(first.neuralProfile, second.neuralProfile);
  assert.deepEqual(plain(second.neuralProfile.influenceLog), []);
  assert.deepEqual(plain(second.neuralProfile.subconscious.recentTopics), []);
  assert.equal(second.neuralProfile.subconscious.totalInteractions, 0);
  assert.doesNotMatch(h.providerRequests[1].options.body, /PRIOR-PRIVATE|今天的测试/);
  assertIsolated(h);
});

test('direct provider invocation cannot force DEV into historical turn/prompt path', async () => {
  const h = await harness();
  await start(h);
  await h.startDeepAnalysis(h.sessions[0], 99);
  assert.equal(h.providerRequests.length, 2);
  const promptCalls = h.calls.filter(x => x.name === 'prompt');
  assert.deepEqual(promptCalls.map(x => x.args[8]), [1, 1]);
  assert.ok(h.calls.filter(x => x.name === 'validator').every(x => x.args[0].userTurn === 1));
  assertIsolated(h);
});

// EF-385 terminal transport regressions (synthetic provider, actual handlers).
{
const frame = text => ({ done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`) });
function provider({ partial = true, terminal = 'reject', cancel = 'resolve' } = {}) {
  const pending = deferred();
  let reads = 0, cancels = 0;
  return { pending, get reads() { return reads; }, get cancels() { return cancels; }, response: {
    status: 200, ok: true, body: { getReader: () => ({
      read: async () => {
        reads++;
        if (partial && reads === 1) return frame(REPLY);
        if (terminal === 'reject') throw new Error('PRIVATE-PROVIDER-ERROR');
        if (terminal === 'done') return { done: true };
        return pending.promise;
      },
      cancel: () => {
        cancels++;
        if (cancel === 'throw') throw new Error('PRIVATE-CANCEL-ERROR');
        if (cancel === 'reject') return Promise.reject(new Error('PRIVATE-CANCEL-ERROR'));
        if (cancel === 'hang') return new Promise(() => {});
        return Promise.resolve();
      },
    }) },
  } };
}
async function run(p, ordinary = false) {
  const h = await harness({ provider: async () => p.response });
  const start = await h.request('POST', ordinary ? ORDINARY_START : START, { input: ordinary
    ? { roleId: 'clever-fox', message: MESSAGE, conversationId: 'existing', requestId: 'ordinary' } : body() });
  await settle();
  const stream = await h.request('GET', STREAM, { query: { sessionId: start.res.body.sessionId } });
  return { h, stream, session: h.sessions[0] };
}
function assertFailed({ h, stream, session }, ordinary = false) {
  assert.equal(session.deepDone, false);
  assert.equal(session.deepStreaming, false);
  assert.equal(session.deepError, 'deep_analysis_failure');
  assert.deepEqual(plain(session.deepChunks), []);
  assert.equal(stream.res.ended, true);
  const events = stream.events();
  if (!ordinary && stream.res.statusCode === 404) {
    assert.deepEqual(events, [], 'failed DEV session already revoked before SSE attachment');
    assert.equal(session.userMessage, '');
  } else {
    assert.deepEqual(events.filter(x => ['error', 'deep.delta', 'deep.completed', 'turn.completed'].includes(x.eventType)).map(x => x.eventType), ['error']);
    assert.equal(events.find(x => x.eventType === 'error').code, 'deep_response_failed');
  }
  assert.ok(!h.calls.some(x => x.name === 'validator'));
  assert.ok(!h.calls.some(x => ['ltu.updateProfile', 'evolution.adjustWeights', 'evolution.logWeightChange', 'neural.updateAfterSession', 'neural.saveProfiles'].includes(x.name)));
  assert.ok(!h.calls.some(x => x.name === 'audit' && x.args[0].providerCategory === 'stream_completed'));
  assert.equal(h.providerRequests.length, 1, 'no automatic retry');
  assert.doesNotMatch(JSON.stringify([h.logs, events]), /PRIVATE-/);
  if (!ordinary) assert.deepEqual(h.identityCalls(), []);
}
for (const ordinary of [false, true]) for (const partial of [false, true]) {
  test(`${ordinary ? 'ordinary' : 'DEV'} ${partial ? 'partial' : 'empty'} read failure never succeeds or saves failed output`, async () => {
    const p = provider({ partial });
    const r = await run(p, ordinary);
    r.h.tick(3100); await settle();
    r.stream.close();
    assertFailed(r, ordinary);
    assert.equal(p.cancels, 1);
  });
}
for (const ordinary of [false, true]) for (const partial of [false, true]) for (const late of ['resolve', 'reject']) {
  test(`${ordinary ? 'ordinary' : 'DEV'} ${partial ? 'partial' : 'empty'} timeout ignores late ${late} even when cancel hangs`, async () => {
    const p = provider({ partial, terminal: 'pending', cancel: 'hang' });
    const r = await run(p, ordinary);
    r.h.tick(60000); await settle(); r.h.tick(100); await settle();
    assertFailed(r, ordinary);
    const before = JSON.stringify([r.session.deepChunks, r.h.calls, r.stream.res.writes]);
    const reads = p.reads;
    if (late === 'resolve') p.pending.resolve(frame('这个超时之后的内容必须被忽略。'));
    else p.pending.reject(new Error('PRIVATE-LATE-ERROR'));
    await settle(); r.h.tick(1000);
    assert.equal(JSON.stringify([r.session.deepChunks, r.h.calls, r.stream.res.writes]), before);
    assert.equal(p.reads, reads);
    assert.equal(p.cancels, 1);
  });
}
for (const cancel of ['throw', 'reject']) {
  test(`cancel ${cancel} does not replace safe failure or cause an unhandled rejection`, async () => {
    const r = await run(provider({ cancel }));
    r.h.tick(3100); await settle();
    assertFailed(r);
  });
}
test('clean completion retains success and clears its timeout', async () => {
  const p = provider({ terminal: 'done' });
  const { h, stream, session } = await run(p);
  h.tick(3100); await settle();
  assert.equal(session.deepDone, true);
  assert.equal(session.deepError, null);
  assert.equal(p.cancels, 0);
  assert.deepEqual(stream.events().slice(-3).map(x => x.eventType), ['deep.delta', 'deep.completed', 'turn.completed']);
  assert.deepEqual(plain(session.deepChunks), [], 'successful raw pair is retained only in bounded conversation context');
  assert.equal(session.userMessage, '');
  const before = JSON.stringify([h.calls, stream.res.writes]);
  h.tick(60000); await settle();
  assert.equal(JSON.stringify([h.calls, stream.res.writes]), before);
  assert.deepEqual(h.identityCalls(), []);
});

}

// Cross-handler coverage runs in the dedicated Node 24 server VM CI step.
import './streamTerminalIntegration.mjs';

// Status-only diagnostics use the real classifier; provider and audit I/O stay synthetic.
{
const cases = [
  [400, 'response_http_400'], [401, 'response_http_401'], [403, 'response_http_403'],
  [404, 'response_http_404'], [429, 'response_http_429'], [402, 'response_http_other_4xx'],
  [418, 'response_http_other_4xx'], [499, 'response_http_other_4xx'],
];
const providerCategories = h => h.calls.filter(x => x.name === 'audit').map(x => x.args[0].providerCategory).filter(Boolean);
const details = h => providerCategories(h).filter(x => x.startsWith('response_http_'));
async function begin(h, ordinary) {
  const result = await h.request('POST', ordinary ? ORDINARY_START : START, { input: ordinary
    ? { roleId: 'clever-fox', message: MESSAGE, conversationId: 'existing', requestId: 'ordinary-http' } : body() });
  await settle();
  return result;
}
for (const ordinary of [false, true]) for (const [status, category] of cases) {
  test(`${ordinary ? 'ordinary' : 'DEV'} HTTP ${status} adds exactly one private detail before reading the body`, async () => {
    let reads = 0, h;
    h = await harness({ provider: async () => ({ ...providerResponse({ status }), text: async () => {
      reads++;
      assert.deepEqual(details(h), [category]);
      assert.deepEqual(providerCategories(h).slice(-2), ['response_client_error', category]);
      return 'PRIVATE-RAW-CODE PRIVATE-RAW-MESSAGE PRIVATE-RAW-BODY https://private.invalid PRIVATE-MODEL PRIVATE-KEY';
    } }) });
    const initial = await begin(h, ordinary);
    assert.equal(initial.res.statusCode, 200);
    assert.equal(reads, 1, 'the existing error body read is neither removed nor duplicated');
    assert.equal(h.sessions[0].deepError, 'provider_api_error');
    assert.equal(h.sessions[0].deepDone, false);
    const stream = await open(h, initial.res.body.sessionId);
    h.tick(3100); await settle();
    assert.equal(stream.res.ended, true);
    if (ordinary) {
      assert.deepEqual(stream.events().filter(x => ['error', 'deep.delta', 'deep.completed', 'turn.completed'].includes(x.eventType)).map(x => x.eventType), ['error']);
      assert.equal(stream.events().at(-1).code, 'deep_response_failed');
    } else {
      assert.equal(stream.res.statusCode, 404, 'DEV failure revokes before stream attachment');
      assert.deepEqual(stream.events(), []);
      assert.equal(h.sessions[0].userMessage, '');
    }
    assert.deepEqual(details(h), [category]);
    assert.equal(providerCategories(h).filter(x => x === 'response_client_error').length, 1);
    assert.equal(h.calls.filter(x => x.name === 'diagnostic' && x.args[1] === 'provider_failed').length, 1);
    assert.equal(h.providerRequests.length, 1, 'no retry');
    assert.ok(!h.calls.some(x => ['ltu.updateProfile', 'evolution.adjustWeights', 'neural.updateAfterSession', 'neural.saveProfiles'].includes(x.name)));
    if (!ordinary) assertIsolated(h);
    else assert.ok(h.calls.some(x => x.name === 'change.recordChange'), 'ordinary start-stage input processing remains');
    assert.doesNotMatch(JSON.stringify([h.logs, initial.res.body, stream.events(), h.calls.filter(x => x.name === 'diagnostic')]), /PRIVATE-RAW|private\.invalid|PRIVATE-MODEL|PRIVATE-KEY|response_http_/);
    const detailedEvents = h.calls.filter(x => x.name === 'audit' && x.args[0].providerCategory === category);
    assert.deepEqual(Object.keys(detailedEvents[0].args[0]).sort(), ['ef45ProbeMarker', 'providerCategory']);
  });
}
for (const behavior of ['reject', 'hang']) test(`HTTP detail precedes existing error body ${behavior} without a new read`, async () => {
  const pending = deferred();
  let reads = 0;
  const h = await harness({ provider: async () => ({ ...providerResponse({ status: 401 }), text: () => {
    reads++;
    return behavior === 'reject' ? Promise.reject(new Error('PRIVATE-BODY-FAILURE')) : pending.promise;
  } }) });
  const initial = await begin(h, false);
  assert.equal(reads, 1);
  assert.deepEqual(providerCategories(h).slice(0, 4), ['request_reached', 'request_started', 'response_client_error', 'response_http_401']);
  assert.deepEqual(details(h), ['response_http_401']);
  if (behavior === 'hang') {
    assert.equal(h.sessions[0].deepError, null, 'existing body wait is not silently changed');
    pending.resolve('PRIVATE-BODY-CONTENT'); await settle();
  }
  const stream = await open(h, initial.res.body.sessionId);
  h.tick(3100); await settle();
  assert.equal(h.sessions[0].deepError, 'provider_api_error');
  assert.deepEqual(details(h), ['response_http_401']);
  assert.equal(reads, 1);
  assert.equal(h.providerRequests.length, 1);
  assert.doesNotMatch(JSON.stringify([h.logs, stream.events(), h.calls.filter(x => ['audit', 'diagnostic'].includes(x.name))]), /PRIVATE-BODY/);
});
for (const nodeEnv of ['production', 'test', '', undefined]) test(`no new private detail outside explicit DEV (${String(nodeEnv)})`, async () => {
  const h = await harness({ nodeEnv, provider: async () => providerResponse({ status: 401 }) });
  await begin(h, true);
  assert.deepEqual(details(h), []);
  assert.equal(providerCategories(h).filter(x => x === 'response_client_error').length, 1);
  assert.equal(h.sessions[0].deepError, 'provider_api_error');
  assert.equal(h.providerRequests.length, 1);
});
for (const status of [200, 302, 399, 500, 503]) test(`HTTP ${status} does not acquire a private 4xx detail`, async () => {
  const h = await harness({ provider: async () => providerResponse({ status }) });
  await begin(h, false);
  assert.deepEqual(details(h), []);
  assert.equal(h.providerRequests.length, 1);
  assert.equal(h.sessions[0].deepDone, status === 200);
  assert.equal(h.sessions[0].deepError, status === 200 ? null : 'provider_api_error');
});
test('provider rejection before an HTTP response adds no status detail', async () => {
  const h = await harness({ provider: async () => { throw new Error('PRIVATE-FETCH-FAILURE'); } });
  await begin(h, false);
  assert.deepEqual(details(h), []);
  assert.equal(h.providerRequests.length, 1);
  assert.equal(h.sessions[0].deepError, 'deep_analysis_failure');
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE-FETCH/);
});
}

// Same-session lifecycle and bounded context are part of this existing CI suite.
import './devSessionContext.test.mjs';

// Cross-layer pending-admission cancellation regression, on the same CI entrypoint.
import './devPendingCancellation.test.mjs';
