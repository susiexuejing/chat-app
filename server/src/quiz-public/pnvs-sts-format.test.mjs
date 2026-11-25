import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPublicQuizRuntime} from './runtime.mjs';

const now=1_800_000_000_000;
const digest=label=>createHash('sha256').update('synthetic:'+label).digest('hex');
const envFor=id=>({
  EF_QUIZ_ACCOUNT_MODE:'qa-live-dev',
  EF_QUIZ_DEV_QA_PLAN:JSON.stringify({
    runId:'qa-sts-format',release:digest('release'),from:now-1000,until:now+60000,
    subjects:[{digest:digest('subject'),limit:2}],
  }),
  EF_QUIZ_CONSENT_VERSION:'dev-qa-synthetic-test',
  ...Object.fromEntries(['PHONE','BROWSER','ACCOUNT','SESSION'].map(name=>['EF_QUIZ_'+name+'_HMAC', digest(name)])),
  EF_QUIZ_PNVS_STS_ID:id,EF_QUIZ_PNVS_STS_SECRET:digest('secret'),EF_QUIZ_PNVS_STS_TOKEN:digest('token'),
  EF_QUIZ_PNVS_SCHEME:'',EF_QUIZ_PNVS_SIGN:'synthetic',EF_QUIZ_PNVS_TEMPLATE:'100001',
});

for (const id of ['STS.fixtureValueOnly12345','AlphanumericFixture12345']) {
  test('passes the complete accepted ID directly to a network-free provider: '+id, async()=>{
    let seen;
    const runtime=await createPublicQuizRuntime({
      env:envFor(id),now:()=>now,
      connect:async()=>({query:async()=>({rows:[{ready:true}]}),end:async()=>{}}),
      providerFactory:p=>{seen=p.keyId;return {send:async()=>null,verify:async()=>null};},
    });
    try {
      assert.equal(runtime.enabled,true);
      assert.equal(seen,id);
    } finally {await runtime.close();}
  });
}

test('rejects malformed separators, whitespace and overlong IDs before any IO',async()=>{
  for(const id of ['NOT.fixtureValueOnly12345','STS.fixture.valueOnly12345','STS.fixtureValueOnly12345\n',
    ' STS.fixtureValueOnly12345','STS.short','STS.'+'A'.repeat(125)]) {
    let connectCalls=0,providerCalls=0;
    const runtime=await createPublicQuizRuntime({
      env:envFor(id),now:()=>now,
      connect:async()=>{connectCalls++;},
      providerFactory:()=>{providerCalls++;},
    });
    assert.equal(runtime.enabled,false);
    assert.deepEqual([connectCalls,providerCalls],[0,0]);
  }
});
