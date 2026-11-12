// Full offline client -> HTTP helper -> actual handler -> validated SSE round trip.
// Native hosts/auth/provider/network I/O are synthetic; no socket is opened.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';
import { harness, providerResponse, settle } from './devEphemeralHarness.mjs';
const { z } = createRequire(import.meta.url)('zod');
const CONTRACT = 'dev-reply-practice-v1';
async function setup(outputs) {
  let n = 0, sequence = 0;
  const requests = [];
  const h = await harness({ realValidator: true, realStreamContract: true,
    provider: async () => providerResponse({ text: JSON.stringify(outputs[n++]) }),
  });
  const fetchMock = async (url, options) => {
    const u = new URL(url); requests.push({ path: u.pathname, options });
    const started = options.method === 'POST';
    const r = await h.request(started ? 'POST' : 'GET', u.pathname, {
      input: started ? JSON.parse(options.body) : undefined,
      query: { sessionId: u.searchParams.get('sessionId') },
      accept: options.headers.Accept, retryContract: options.headers['X-Dev-Retry-Contract'],
    });
    await settle();
    let bytes = '';
    if (!started) {
      h.tick(100); await settle();
      bytes = r.res.writes.join('');
    }
    let read = false;
    return { ok: r.res.statusCode === 200, status: r.res.statusCode,
      headers: { get: name => Object.entries(r.res.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] },
      json: async () => r.res.body,
      body: { getReader: () => ({ read: async () => {
        if (read) return { done: true }; read = true;
        return { done: false, value: new TextEncoder().encode(bytes) };
      }, cancel: async () => {}, releaseLock() {} }) },
    };
  };
  const controllerModule = await loadTsModule(new URL('../../../client/features/dev-journey/realRequestController.ts', import.meta.url), {}, {
    Date: class extends Date { static now() { return h.now(); } },
  });
  const api = await loadTsModule(new URL('../../../client/screens/chat/api/cozeApi.ts', import.meta.url), {
    'expo-constants': { default: { expoConfig: { extra: { EXPO_PUBLIC_BACKEND_BASE_URL: 'https://mock.invalid' } } } },
    'react-native': { Platform: { OS: 'web' } }, zod: { z },
    '../utils/ef77Diagnostics': { emitEf77Trace() {}, getEf77ErrorType: () => 'synthetic', isEf77DiagnosticEnabled: () => false },
    '../stores/anonymousSession': { getAnonymousRequestOptions: async () => ({ credentials: 'include', headers: {} }) },
    'react-native-sse': { default: class {} },
  }, { process: { env: { EXPO_PUBLIC_APP_ENV: 'DEV' } }, fetch: fetchMock });
  const adapter = await loadTsModule(new URL('../../../client/features/dev-journey/realRequestAdapter.ts', import.meta.url), {
    'expo-crypto': { randomUUID: () => `synthetic-${++sequence}` },
    '@/features/dev-journey/realRequestController': controllerModule,
    '@/screens/chat/api/cozeApi': api,
  }, { process: { env: { EXPO_PUBLIC_APP_ENV: 'DEV' } } });
  const controller = controllerModule.createDevRealRequestController({ enabled: true,
    transport: adapter.createDevRealRequestTransport(), createRequestId: () => `${h.now()}_integration-${++sequence}` });
  return { controller, h, requests };
}


const observedFirst = '这是纯虚构产品验收场景，不是真人经历：小林整理桌面时，在先收笔还是先收纸之间犹豫，迟迟没有开始。请先用一句话确认你理解的困扰，不要诊断。';
const observedSecond = '这个理解符合上述虚构场景。小林愿意尝试一个一分钟内完成的小练习。请给出具体、可观察的小步骤，包含什么时候做和做什么，帮助他开始整理桌面，不要自动替他保存或开始。';
const positive = '这是纯虚构的第一人称产品测试，不代表真人经历：我整理桌面时，在先收笔还是先收纸之间犹豫，迟迟没有开始。我已经说清楚了，现在明确请求你给我一个一分钟内可观察的小练习；只提出建议，不保存、不开始。';
const positiveReply = '这段虚构场景中，你在整理桌面时犹豫先收笔还是纸。';
const observedReply = '小林在犹豫先收笔还是纸时卡住。建议现在选一样物品放入容器，仅做一次。';
function modelObject({ text = positiveReply, candidate = true, permission = '现在明确请求你给我一个一分钟内可观察的小练习', anchor = '我整理桌面时，在先收笔还是先收纸之间犹豫，迟迟没有开始', currentUserRequest = true } = {}) {
 return { contract: CONTRACT, reply: text, practiceCandidate: candidate ? {
   ifCue: '整理桌面时犹豫先收笔还是纸时', thenAction: '可以先选一支笔放进笔筒，只做一次',
   evidence: { permissionQuote: permission, anchorQuote: anchor, naturalClosing: true, smallChoiceFits: true,
    currentUserRequest, continuingExpression: false, correctionOrRefusalOrExit: false, topicChanged: false },
 } : null };
}
function candidateAt(c) { return c.getSnapshot().practiceCandidate; }
test('fixed-source full client/server wire preserves an eligible modeled first-person candidate', async t => {
 const { controller:c,h,requests } = await setup([modelObject()]); t.after(()=>c.dispose());
 assert.equal(await c.send(positive), true);
 assert.ok(candidateAt(c), JSON.stringify(c.getSnapshot()));
 assert.equal(candidateAt(c).thenAction, '可以先选一支笔放进笔筒，只做一次');
 assert.equal(h.providerRequests.length,1);
 assert.equal(requests[0].options.headers.Accept, 'application/json; dev-reply-contract=dev-reply-practice-v1');
 assert.equal(requests[0].options.headers['X-Dev-Retry-Contract'], 'dev-manual-retry-v1');
 const messages=JSON.parse(h.providerRequests[0].options.body).messages;
 assert.equal(messages.at(-1).content, positive);
 assert.ok(messages[0].content.includes('转述别人或台词中的请求，不是用户本轮许可'));
 assert.ok(messages[0].content.includes('不要把建议混入 reply'));
});
test('observed two-turn input with modeled absent candidate can complete without any transport failure', async t => {
 const {controller:c,h}=await setup([modelObject({text:'小林整理桌面时，犹豫先收笔还是纸，还没有开始。',candidate:false}),modelObject({text:observedReply,candidate:false})]);t.after(()=>c.dispose());
 assert.equal(await c.send(observedFirst),true);assert.equal(await c.send(observedSecond),true);
 assert.equal(candidateAt(c),null); assert.equal(c.getSnapshot().deepText,observedReply);
 const messages=JSON.parse(h.providerRequests[1].options.body).messages;
 assert.equal(messages.at(-1).content,observedSecond);
 assert.equal(messages[1].content,observedFirst);
 assert.equal(h.providerRequests.length,2);
});
test('modeled third-person non-permission suppresses candidate while ordinary reply survives', async t=>{
 const {controller:c}=await setup([modelObject({text:'小林愿意尝试一个一分钟内完成的小练习。', permission:'请给出具体、可观察的小步骤',anchor:'帮助他开始整理桌面',currentUserRequest:false})]);t.after(()=>c.dispose());
 assert.equal(await c.send(observedSecond),true);assert.equal(candidateAt(c),null);
});
test('anchor from previous turn cannot be promoted to latest-turn evidence',async t=>{
 const {controller:c}=await setup([modelObject({text:'小林愿意尝试一个一分钟内完成的小练习。',permission:'请给出具体、可观察的小步骤',anchor:'在先收笔还是先收纸之间犹豫'})]);t.after(()=>c.dispose());
 assert.equal(await c.send(observedSecond),true);assert.equal(candidateAt(c),null);
});
test('mechanical parser cannot establish whether model currentUserRequest=true is semantically true',async t=>{
 const {controller:c}=await setup([modelObject({text:'小林愿意尝试一个一分钟内完成的小练习。',permission:'请给出具体、可观察的小步骤',anchor:'帮助他开始整理桌面',currentUserRequest:true})]);t.after(()=>c.dispose());
 assert.equal(await c.send(observedSecond),true);assert.ok(candidateAt(c));
 // Characterization of an existing limitation, not a semantic-quality pass.
});
test('first-person current permission with absent candidate remains absent: frontend never invents a draft',async t=>{
 const {controller:c}=await setup([modelObject({candidate:false})]);t.after(()=>c.dispose());
 assert.equal(await c.send(positive),true);assert.equal(candidateAt(c),null);
});

test('natural-save direct request reaches old client shape without closing or confirmation', async t => {
 const value=modelObject(); value.practiceCandidate.evidence.naturalClosing=false; value.practiceCandidate.evidence.continuingExpression=true;
 const {controller:c,h}=await setup([value]);t.after(()=>c.dispose());
 assert.equal(await c.send(positive),true);
 assert.equal(candidateAt(c).thenAction,value.practiceCandidate.thenAction);
 assert.equal(c.getSnapshot().status,'success');
 assert.equal(h.providerRequests.length,1);
 const prompt=JSON.parse(h.providerRequests[0].options.body).messages[0].content;
 assert.ok(prompt.includes('不得额外要求先确认理解'));
 assert.ok(prompt.includes('这些操作需要用户另行显式选择'));
});
