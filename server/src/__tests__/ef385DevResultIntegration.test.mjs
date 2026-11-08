// Actual index handlers, cleaner, validator and context store; mock provider only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { body, deferred, harness, MODE, ORDINARY_START, plain, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';

const ACK = '我听到了。';
const overload = '很多事情挤在一起，脑子很乱，不知道从哪里开始说。';
function mixedResponse(content, reasoning) {
  const frames = [ { content }, { reasoning_content: reasoning } ];
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => frames.length
    ? { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: frames.shift() }] })}\n\n`) }
    : { done: true }, cancel: async () => {} }) } };
}
const wrap = text => `Here's a thinking process\n1. Check constraints\n${text}`;
function diagnostic(kind = 'enabled') {
  const tuples = [], modes = [];
  let finished = 0;
  return { tuples, modes, get finished() { return finished; }, factory() {
    if (kind === 'factory_throw') throw new Error('private test failure');
    return { begin(mode) {
      modes.push(mode);
      if (kind === 'begin_throw') throw new Error('private test failure');
      if (mode !== MODE || kind === 'absent') return undefined;
      return { complete(result) {
        tuples.push(plain(result));
        assert.deepEqual(Object.keys(result).sort(), ['candidateClass', 'cleanedClass', 'contentClass', 'finalClass', 'selection', 'validation']);
        if (kind === 'complete_throw') throw new Error('private test failure');
      }, finish() { finished++; if (kind === 'finish_throw') throw new Error('private test failure'); } };
    } };
  } };
}
const tuple = (contentClass, cleanedClass, selection, candidateClass, validation, finalClass) =>
  ({ contentClass, cleanedClass, selection, candidateClass, validation, finalClass });
const cases = [
  ['discarded content allows reasoning', () => mixedResponse(ACK, ACK), {}, tuple('exact_ack', 'empty', 'reasoning', 'exact_ack', 'accepted_plain', 'exact_ack')],
  ['selected content beats reasoning', () => mixedResponse('事'.repeat(10), ACK), {}, tuple('other', 'empty', 'last_resort', 'other', 'accepted_plain', 'other')],
  ['empty validated chunk prevents reasoning replacement', () => mixedResponse('事'.repeat(121), ACK), { prefix: '前'.repeat(116) }, tuple('other', 'other', 'cleaned', 'other', 'budget_fallback', 'empty')],
  ['short acknowledgement remains discarded', { text: ACK }, {}, tuple('exact_ack', 'empty', 'none', 'not_selected', 'not_called', 'empty')],
  ['whitespace acknowledgement remains discarded', { text: ` ${ACK} ` }, {}, tuple('exact_ack', 'empty', 'none', 'not_selected', 'not_called', 'empty')],
  ['empty stream', { text: '' }, {}, tuple('empty', 'empty', 'none', 'not_selected', 'not_called', 'empty')],
  ['non Chinese content', { text: 'English only' }, {}, tuple('other', 'empty', 'none', 'not_selected', 'not_called', 'empty')],
  ['cleaner selects wrapped acknowledgement', { text: wrap(ACK) }, {}, tuple('other', 'exact_ack', 'cleaned', 'exact_ack', 'accepted_plain', 'exact_ack')],
  ['reasoning acknowledgement', { text: ACK, reasoning: true }, {}, tuple('empty', 'empty', 'reasoning', 'exact_ack', 'accepted_plain', 'exact_ack')],
  ['last resort ten Chinese characters', { text: '事'.repeat(10) }, {}, tuple('other', 'empty', 'last_resort', 'other', 'accepted_plain', 'other')],
  ['cleaned plain', { text: '这是眼前的一件事情，也是此刻想要说清楚的一部分。' }, {}, tuple('other', 'other', 'cleaned', 'other', 'accepted_plain', 'other')],
  ['reasoning plain', { text: '事情仍在眼前。', reasoning: true }, {}, tuple('empty', 'empty', 'reasoning', 'other', 'accepted_plain', 'other')],
  ['budget substitution', { text: '事'.repeat(121) }, {}, tuple('other', 'other', 'cleaned', 'other', 'budget_fallback', 'exact_ack')],
  ['budget fallback cannot fit', { text: '事'.repeat(121) }, { prefix: '前'.repeat(116) }, tuple('other', 'other', 'cleaned', 'other', 'budget_fallback', 'empty')],
  ['raw fact substitution', { text: '我正在喝咖啡。', reasoning: true }, {}, tuple('empty', 'empty', 'reasoning', 'other', 'raw_fact_fallback', 'exact_ack')],
  ['raw fact fallback cannot fit', { text: '我正在喝咖啡。', reasoning: true }, { prefix: '前'.repeat(116) }, tuple('empty', 'empty', 'reasoning', 'other', 'raw_fact_fallback', 'empty')],
  ['one uninvited question', { text: '现在想说什么？', reasoning: true }, {}, tuple('empty', 'empty', 'reasoning', 'other', 'question_fallback', 'exact_ack')],
  ['two optional questions', { text: '如果你愿意，想说什么？还有什么？', reasoning: true }, {}, tuple('empty', 'empty', 'reasoning', 'other', 'question_fallback', 'exact_ack')],
  ['one optional question accepted', { text: '如果你愿意，想说什么？', reasoning: true }, {}, tuple('empty', 'empty', 'reasoning', 'other', 'accepted_plain', 'other')],
  ['EF41 sentence selection', { text: '眼前的事情暂时还没有清楚的顺序。', reasoning: true }, { message: overload }, tuple('empty', 'empty', 'reasoning', 'other', 'accepted_ef41_sentence', 'other')],
  ['EF41 default selection', { text: ACK, reasoning: true }, { message: overload }, tuple('empty', 'empty', 'reasoning', 'exact_ack', 'accepted_ef41_default', 'other')],
  ['post selection fact rejection', { text: `你\`\`\`${'x'.repeat(30)}\`\`\`以前留下的材料仍然摆在眼前。`, reasoning: true }, { message: overload }, tuple('empty', 'empty', 'reasoning', 'other', 'post_selection_fact_fallback', 'exact_ack')],
];

// Snapshots include exact wire chunks/terminals/headers, model request bodies,
// validator input, committed continuation context, and all persistence spies.
async function run(response, extra, kind) {
  const d = diagnostic(kind);
  const h = await harness({ realValidator: true, diagnosticFactory: () => d.factory(),
    provider: async () => typeof response === 'function' ? response() : providerResponse(response),
    ...(extra.prefix ? { reactionTimeline: [{ displayAt: 0, text: extra.prefix }], companionTimeline: [] } : {}),
  });
  const input = body(extra.message ? { message: extra.message } : {});
  const started = await h.request('POST', START, { input }); await settle();
  const chunks = plain(h.sessions[0].deepChunks);
  const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } });
  h.tick(3100); await settle();
  const firstTuples = [...d.tuples], firstFinished = d.finished;
  const continuation = await h.request('POST', START, { input: body({ requestId: `${h.now()}_next`,
    devConversationId: started.res.body.devConversationId, afterRequestId: input.requestId }) });
  await settle();
  assert.deepEqual(h.identityCalls(), []);
  return { d, firstTuples, firstFinished, snapshot: plain({ chunks, start: started.res.body,
    headers: stream.res.headers, writes: stream.res.writes, ended: stream.res.ended,
    continuation: { status: continuation.res.statusCode, body: continuation.res.body },
    requests: h.providerRequests.map(x => ({ url: x.url, method: x.options.method, headers: x.options.headers, body: x.options.body })),
    validatorInputs: h.calls.filter(x => x.name === 'validator').map(x => x.args[0]), identity: h.identityCalls(),
  }) };
}
for (const [name, response, extra, expected] of cases) test(`result tuple and side-by-side exact parity: ${name}`, async () => {
  const baseline = await run(response, extra, 'absent');
  for (const kind of ['enabled', 'factory_throw', 'begin_throw', 'complete_throw', 'finish_throw']) {
    const actual = await run(response, extra, kind);
    assert.deepEqual(actual.snapshot, baseline.snapshot, `${kind}: wire/provider/context parity`);
    assert.deepEqual(actual.firstTuples, ['enabled', 'complete_throw', 'finish_throw'].includes(kind) ? [expected] : []);
    assert.equal(actual.firstFinished, ['enabled', 'complete_throw', 'finish_throw'].includes(kind) ? 1 : 0);
  }
});

for (const [name, options] of [
  ['key missing', { apiKey: '' }], ['HTTP failure', { response: { status: 503 } }],
  ['missing reader', { response: { noReader: true } }], ['stream error', { response: { readError: true } }],
  ['fetch rejection', { reject: true }],
]) test(`incomplete processing always finishes without a tuple: ${name}`, async () => {
  const snapshots = [];
  for (const kind of ['absent', 'enabled', 'finish_throw']) {
    const d = diagnostic(kind);
    const h = await harness({ realValidator: true, diagnosticFactory: () => d.factory(),
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      provider: async () => { if (options.reject) throw new Error('mock transport'); return providerResponse(options.response); },
    });
    const start = await h.request('POST', START, { input: body() }); await settle();
    const stream = await h.request('GET', STREAM, { query: { sessionId: start.res.body.sessionId } });
    h.tick(3100); await settle();
    assert.deepEqual(d.tuples, []); assert.equal(d.finished, kind === 'absent' ? 0 : 1);
    assert.deepEqual(h.identityCalls(), []);
    snapshots.push(plain({ body: start.res.body, status: stream.res.statusCode, writes: stream.res.writes,
      error: h.sessions[0].deepError, chunks: h.sessions[0].deepChunks,
      requests: h.providerRequests.map(x => x.options.body) }));
  }
  assert.deepEqual(snapshots[1], snapshots[0]); assert.deepEqual(snapshots[2], snapshots[0]);
});

for (const phase of ['fetch', 'read']) test(`cancel during ${phase} finishes without completing a result`, async () => {
  const snapshots = [];
  for (const kind of ['absent', 'enabled', 'finish_throw']) {
    const gate = deferred(), d = diagnostic(kind);
    let cancelled = 0;
    const h = await harness({ realValidator: true, diagnosticFactory: () => d.factory(), provider: async () => {
      if (phase === 'fetch') return gate.promise;
      return { ok: true, status: 200, body: { getReader: () => ({ read: () => gate.promise,
        cancel: async () => { cancelled++; } }) } };
    } });
    const started = await h.request('POST', START, { input: body() }); await settle();
    const end = await h.request('POST', '/api/v1/chat/dev-journey/end', { input: { requestMode: MODE, requestId: body().requestId } });
    gate.resolve(phase === 'fetch' ? providerResponse() : { done: true }); await settle();
    assert.deepEqual(d.tuples, []); assert.equal(d.finished, kind === 'absent' ? 0 : 1);
    snapshots.push(plain({ started: started.res.body, end: end.res.body, chunks: h.sessions[0].deepChunks,
      done: h.sessions[0].deepDone, streaming: h.sessions[0].deepStreaming, cancelled,
      requests: h.providerRequests.map(x => x.options.body), identity: h.identityCalls() }));
  }
  assert.deepEqual(snapshots[1], snapshots[0]); assert.deepEqual(snapshots[2], snapshots[0]);
});

test('ordinary chat remains outside DEV capture and later-turn validation stays unchanged', async () => {
  const d = diagnostic();
  const h = await harness({ realValidator: true, diagnosticFactory: () => d.factory() });
  await h.request('POST', ORDINARY_START, { input: { roleId: 'clever-fox', message: '这是当前的一条测试消息。', conversationId: 'existing', requestId: 'ordinary' } });
  await settle();
  assert.deepEqual(d.tuples, []); assert.equal(d.finished, 0);
  assert.equal(h.providerRequests.length, 1);
  assert.equal(h.calls.find(x => x.name === 'validator').args[1], undefined);
});

test('stream timeout after partial content never manufactures a completed tuple', async () => {
  const snapshots = [];
  for (const kind of ['absent', 'enabled', 'finish_throw']) {
    const gate = deferred(), d = diagnostic(kind);
    let reads = 0;
    const h = await harness({ realValidator: true, diagnosticFactory: () => d.factory(), provider: async () => ({
      ok: true, status: 200, body: { getReader: () => ({ read: async () => ++reads === 1
        ? { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: wrap(ACK) } }] })}\n\n`) }
        : gate.promise, cancel: async () => {} }) },
    }) });
    const started = await h.request('POST', START, { input: body() }); await settle();
    h.tick(60001); await settle(); gate.resolve({ done: true }); await settle();
    assert.deepEqual(d.tuples, []); assert.equal(d.finished, kind === 'absent' ? 0 : 1);
    snapshots.push(plain({ start: started.res.body, chunks: h.sessions[0].deepChunks,
      error: h.sessions[0].deepError, done: h.sessions[0].deepDone,
      requests: h.providerRequests.map(x => x.options.body), identity: h.identityCalls() }));
  }
  assert.deepEqual(snapshots[1], snapshots[0]); assert.deepEqual(snapshots[2], snapshots[0]);
});

for (const failure of [false, true]) test(`actual handler to actual private receipt: ${failure ? 'incomplete' : 'captured'}`, async () => {
  const { diagnosticHarness, ARM, RESULT, SHA } = await import('./ef385DiagnosticHarness.mjs');
  const d = await diagnosticHarness();
  const h = await harness({ realValidator: true,
    diagnosticFactory: () => d.api.createEf385DevResultDiagnostic(),
    provider: async () => providerResponse(failure ? { readError: true } : { text: wrap(ACK) }),
  });
  assert.equal(d.arm(), true, 'arm only after runtime startup cleanup');
  await h.request('POST', START, { input: body() }); await settle();
  const receipt = d.receipt();
  assert.deepEqual(Object.keys(receipt).sort(), ['armedAt', 'deploymentSha', 'expiresAt', 'observedAt', 'result', 'windowState']);
  assert.equal(receipt.deploymentSha, SHA);
  assert.equal(receipt.windowState, failure ? 'incomplete' : 'captured');
  assert.deepEqual(receipt.result, failure ? null : tuple('other', 'exact_ack', 'cleaned', 'exact_ack', 'accepted_plain', 'exact_ack'));
  assert.equal(d.files.get(RESULT).mode, 0o600);
  assert.ok(d.files.get(RESULT).bytes.length <= 4096);
  assert.deepEqual(d.errors, []); assert.deepEqual(h.identityCalls(), []);
  assert.equal(h.providerRequests.length, 1);
  assert.equal(d.read(), true);
  assert.deepEqual(JSON.parse(d.stdout.at(-1)), receipt);
  assert.equal(d.files.has(ARM), false); assert.equal(d.files.has(RESULT), false);
});
