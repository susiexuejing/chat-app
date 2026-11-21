import { PracticeDemo } from './vendor/practice.mjs';
import { PathController } from './vendor/path.mjs';
import { STORAGE_KEY, validPattern } from './vendor/editor.mjs';

export const CHAT_INPUT = '最近太累了，总觉得自己做得不够好。';
export const CANDIDATE = '累的时候，会不会容易先把责任揽到自己身上？';
export const PATTERN_ID = 'mode-fatigue-self-criticism-v1';
export const PRACTICE_TEXT = '听到自责时，先叫儿子的名字，停十秒，回到眼前。';
const PRACTICE_ID = 'practice-pause-10s-v1';
const PATTERN_NAME = '累时容易先责备自己';
const validText = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
const owns = (row, accountId, patternId) => row.accountId === accountId && row.patternId === patternId;
const failure = error => ({ ok: false, error });

export function createJourney(storage, session, now) {
  function read() {
    const raw = storage.getItem(STORAGE_KEY);
    const data = raw === null ? { schemaVersion: 1, patterns: [] } : JSON.parse(raw);
    if (data?.schemaVersion !== 1 || !Array.isArray(data.patterns) || !data.patterns.every(validPattern)) {
      throw Error('unavailable');
    }
    if (new Set(data.patterns.map(row => JSON.stringify([row.accountId, row.patternId]))).size !== data.patterns.length) {
      throw Error('unavailable');
    }
    data.journey ??= { practices: [], records: [], entries: [] };
    for (const key of ['practices', 'records', 'entries']) {
      if (!Array.isArray(data.journey[key]) || data.journey[key].some(row =>
        !row || typeof row.accountId !== 'string' || row.patternId !== PATTERN_ID
      )) throw Error('unavailable');
    }
    return data;
  }

  function write(data) {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function confirm(text) {
    if (!validText(text, 2000)) return failure('invalid');
    try {
      const accountId = session();
      if (!accountId) return failure('unauthenticated');
      const data = read();
      const existing = data.patterns.find(row => owns(row, accountId, PATTERN_ID));
      const stamp = new Date(Math.max(now(), existing ? Date.parse(existing.updatedAt) + 1 : 0)).toISOString();
      const pattern = {
        schemaVersion: 1, demoSource: 'synthetic', accountId, patternId: PATTERN_ID,
        name: existing?.name ?? PATTERN_NAME, currentUnderstanding: text.trim(), decision: 'confirmed',
        clues: existing?.clues ?? [], createdAt: existing?.createdAt ?? stamp, updatedAt: stamp,
      };
      if (existing) Object.assign(existing, pattern);
      else data.patterns.push(pattern);
      if (!data.journey.entries.some(row => owns(row, accountId, PATTERN_ID) && row.entryId === 'evt-1')) {
        data.journey.entries.push({
          schemaVersion: 1, demoSource: 'synthetic', accountId, patternId: PATTERN_ID,
          entryId: 'evt-1', type: 'event', createdAt: stamp, version: 1, linked: true,
          fact: '用户明确保存的合成事件：累的时候注意到自己先责备自己。',
          source: '用户确认保存', userConfirmed: true,
        });
      }
      write(data);
      return { ok: true };
    } catch { return failure('unavailable'); }
  }

  function openPractice(accountId, patternId) {
    if (!accountId || session() !== accountId) throw Error('unauthenticated');
    const data = read();
    if (patternId !== PATTERN_ID || !data.patterns.some(row =>
      owns(row, accountId, patternId) && row.decision === 'confirmed'
    )) throw Error('not_found');
    const rows = data.journey.practices.filter(row => owns(row, accountId, patternId));
    const records = data.journey.records.filter(row => owns(row, accountId, patternId));
    const model = new PracticeDemo({
      rows: rows.length ? rows : [{
        accountId, patternId, practiceId: PRACTICE_ID, name: '停十秒，回到眼前',
        ifCue: '听到自责时', thenAction: PRACTICE_TEXT, confirmed: false, paused: false, version: 0,
      }],
      records,
      commit(nextRows, nextRecords) {
        if (session() !== accountId) throw Error('unauthenticated');
        const latest = read();
        if (!latest.patterns.some(row => owns(row, accountId, patternId) && row.decision === 'confirmed')) {
          throw Error('not_found');
        }
        const current = latest.journey.practices.filter(row => owns(row, accountId, patternId));
        const currentRecords = latest.journey.records.filter(row => owns(row, accountId, patternId));
        if (JSON.stringify(current) !== JSON.stringify(rows) || JSON.stringify(currentRecords) !== JSON.stringify(records)) {
          throw Error('conflict');
        }
        latest.journey.practices = latest.journey.practices.filter(row => !owns(row, accountId, patternId)).concat(nextRows);
        for (const record of nextRecords.slice(records.length)) {
          latest.journey.records.push(record);
          latest.journey.entries.push({
            schemaVersion: 1, demoSource: 'synthetic', accountId, patternId,
            entryId: record.recordId, type: 'practice', record, createdAt: record.createdAt,
            source: '用户明确保存的练习记录', userConfirmed: true, version: 1, linked: true,
          });
        }
        write(latest);
        rows.splice(0, rows.length, ...nextRows);
        records.splice(0, records.length, ...nextRecords);
      },
    });
    model.open(accountId, patternId);
    return model;
  }

  function pathRows(accountId, patternId) {
    if (!accountId || session() !== accountId) throw Error('unauthenticated');
    const data = read();
    if (!data.patterns.some(row => owns(row, accountId, patternId))) throw Error('not_found');
    return { data, rows: data.journey.entries.filter(row => owns(row, accountId, patternId)) };
  }

  const path = new PathController({
    async list(accountId, patternId) {
      const { rows } = pathRows(accountId, patternId);
      return { ok: true, data: rows.filter(row => row.linked).sort((a,b) => b.createdAt.localeCompare(a.createdAt)) };
    },
    async update(accountId, patternId, entryId, patch, version) {
      const { data, rows } = pathRows(accountId, patternId);
      const row = rows.find(entry => entry.entryId === entryId);
      if (!row) return failure('not_found');
      if (row.version !== version) return failure('conflict');
      if (!patch || Object.getPrototypeOf(patch) !== Object.prototype
        || Object.keys(patch).some(key => !['linked', 'explanation', 'feeling'].includes(key))
        || ('linked' in patch && typeof patch.linked !== 'boolean')
        || ['explanation', 'feeling'].some(key => key in patch && (typeof patch[key] !== 'string' || patch[key].length > 1000))) return failure('invalid');
      Object.assign(row, patch, { version: version + 1 });
      write(data);
      return { ok: true, data: row };
    },
  });
  return { confirm, openPractice, path };
}
