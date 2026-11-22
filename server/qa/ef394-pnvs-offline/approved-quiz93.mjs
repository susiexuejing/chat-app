import { readFileSync } from 'node:fs';

const bank = JSON.parse(readFileSync(new URL('approved-quiz93.json', import.meta.url), 'utf8'));
const letters = 'EISNTFJP';
const dimensions = ['EI','SN','TF','JP'];
const totals = [24,23,23,23];
if (bank.length !== 93 || bank.some((q,i) =>
  q.id !== 'q' + String(i + 1).padStart(2,'0') ||
  typeof q.prompt !== 'string' || !q.prompt ||
  !['A','B'].every(k => typeof q.options[k] === 'string' && q.options[k].length) ||
  !dimensions.includes(q.awards.A + q.awards.B)) ||
  dimensions.some((dim,i) => bank.filter(q => q.awards.A + q.awards.B === dim).length !== totals[i])) {
  throw new Error('invalid approved quiz source');
}
export const questions = Object.freeze(bank.map(({id,prompt,options}) =>
  Object.freeze({id,prompt,options:Object.freeze({...options})})));

export function fromQuestionChoices(choices) {
  if (!Array.isArray(choices) || choices.length !== questions.length) throw new TypeError('93 distinct choices required');
  const byId = new Map();
  const allowed = new Set(questions.map(q => q.id));
  for (const {id,option} of choices) {
    if (!allowed.has(id) || byId.has(id) || (option !== 'A' && option !== 'B')) throw new TypeError('invalid choice');
    byId.set(id,option);
  }
  return questions.map(q => byId.get(q.id));
}
export function approvedScore(answers) {
  if (!Array.isArray(answers) || answers.length !== bank.length) throw new TypeError('93 choices required');
  const counts = Object.fromEntries([...letters].map(l => [l,0]));
  for (const [i,q] of bank.entries()) {
    const answer = answers[i];
    if (answer !== 'A' && answer !== 'B') throw new TypeError('invalid choice');
    counts[q.awards[answer]]++;
  }
  return Object.fromEntries(dimensions.map(dim => [dim, [...dim].map(l => counts[l])]));
}
export function summarize(scores) {
  const sides = dimensions.map(dim => {
    const [a,b] = scores[dim];
    return { dimension:dim, preferred: a === b ? null : a > b ? dim[0] : dim[1], scores:[a,b] };
  });
  return { sides, type: sides.some(side => side.preferred === null) ? null : sides.map(side => side.preferred).join('') };
}
