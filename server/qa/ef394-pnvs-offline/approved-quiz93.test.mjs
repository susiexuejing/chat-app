import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { approvedScore, questions, fromQuestionChoices, summarize } from './approved-quiz93.mjs';

const oracle = {
  EI:[1,8,11,14,17,24,27,30,33,40,43,46,49,56,59,62,65,72,75,78,81,88,91,93],
  SN:[2,5,12,15,18,21,28,31,34,37,44,47,50,53,60,63,66,69,76,79,82,85,92],
  TF:[3,6,9,16,19,22,25,32,35,38,41,48,51,54,57,64,67,70,73,80,83,86,89],
  JP:[4,7,10,13,20,23,26,29,36,39,42,45,52,55,58,61,68,71,74,77,84,87,90],
};
const allA = Array(93).fill('A');

test('each of 93 single flips matches an independent extraction from the native tables', () => {
  const full=approvedScore(allA);
  assert.deepEqual(full,{EI:[24,0],SN:[23,0],TF:[23,0],JP:[23,0]});
  assert.equal(summarize(full).type,'ESTJ');
  const out = [];
  for (let id=1; id<=93; id++) {
    const options=allA.with(id-1,'B');
    const dimension=Object.keys(oracle).find(k=>oracle[k].includes(id));
    assert.ok(dimension);
    const expected={...full,[dimension]:[full[dimension][0]-1,1]};
    assert.deepEqual(approvedScore(options),expected,id);
    out.push({id,a:dimension[0],b:dimension[1]});
  }
  assert.equal(createHash('sha256').update(JSON.stringify(out)).digest('hex'),
    '25fc15e2291513d24034b2ae226e33f260b0385462a84984dffbc416c4bdb21c');
});
test('mixed order by question ID, changed payload and a true 12:12 tie are handled explicitly', () => {
  const mixed=questions.map(({id},i)=>({id,option:i%3===0||i%7===0?'B':'A'}));
  assert.deepEqual(approvedScore(fromQuestionChoices(mixed.toReversed())),{EI:[15,9],SN:[12,11],TF:[14,9],JP:[12,11]});
  const tie=allA.map((a,i)=>oracle.EI.slice(0,12).includes(i+1)?'B':a);
  assert.deepEqual(approvedScore(tie).EI,[12,12]);
  assert.equal(summarize(approvedScore(tie)).type,null);
  assert.equal(summarize(approvedScore(tie)).sides[0].preferred,null);
  assert.throws(()=>fromQuestionChoices([...mixed.slice(0,92),mixed[0]]));
  assert.throws(()=>fromQuestionChoices(mixed.with(1,{id:'q94',option:'A'})));
  assert.throws(()=>fromQuestionChoices(mixed.slice(1)));
  assert.throws(()=>approvedScore(Array(93)));
});
