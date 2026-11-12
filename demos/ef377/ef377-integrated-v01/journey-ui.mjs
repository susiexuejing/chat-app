import { CHAT_INPUT, CANDIDATE, PATTERN_ID } from './journey.mjs';

export function createJourneyUI({ journey, active, by, esc, button, draw, openDetail, showNotice }) {
  let input = '', candidate = false, editing = false, understanding = '';
  let practice, pathEditing = null, explanation = '', pathFeeling = '';
  let generation = 0;

  function reset() {
    generation++;
    input = understanding = explanation = pathFeeling = '';
    candidate = editing = false;
    practice?.leave();
    practice = undefined;
    pathEditing = null;
    journey.path.leave();
  }

  function chat() {
    if (!active()) return '<h1>聊天</h1><p>请先到我的 → 账户信息登录。</p>';
    let html = '<h1>狐狸聊天</h1><p>固定合成演示，请只输入下方演示句。</p><p>' + CHAT_INPUT +
      '</p><label for="chat-input">演示消息</label><textarea id="chat-input" maxlength="100">' + esc(input) +
      '</textarea>' + button('chat-send', '发送演示句', 'primary');
    if (candidate) html += '<section class="card"><h2>狐狸 · 待观察候选</h2><p>' + CANDIDATE +
      '</p><p>由你判断是否符合。</p>' + button('candidate-edit', '确认并修改') +
      button('candidate-reject', '不符合') + button('candidate-unsure', '暂不确定') + button('candidate-stop', '停止') +
      (editing ? '<label for="candidate-text">我的理解</label><textarea id="candidate-text" maxlength="2000">' +
        esc(understanding) + '</textarea>' + button('candidate-save', '确认保存', 'primary') : '') + '</section>';
    return html;
  }

  function detail() {
    if (!practice) return '<p>无法读取练习。可返回并重试。</p>' + button('path-open', '查看路径');
    const { practice: p, draft, checkin, message, error } = practice.snapshot();
    let html = '<section class="card"><h2>练习</h2><p>' + esc(p.thenAction) + '</p><small>' +
      (p.confirmed ? p.paused ? '已暂停' : '当前练习' : '建议练习，等待你保存') +
      '</small><div>' + button('practice-edit', '调整练习') +
      (p.confirmed && !p.paused ? button('practice-pause', '暂停练习') + button('record-open', '记录今天') : '') +
      button('path-open', '查看路径') + '</div>';
    if (draft) html += '<label for="practice-cue">触发时刻</label><input id="practice-cue" maxlength="200" value="' +
      esc(draft.ifCue) + '"><label for="practice-action">选择这个练习或修改动作</label><textarea id="practice-action" maxlength="200">' +
      esc(draft.thenAction) + '</textarea>' + button('practice-save','保存练习','primary') + button('practice-cancel','取消');
    if (checkin) {
      html += '<h2>今天的记录</h2><p>是否发生了？ ' + button('occurred-yes','发生了') + button('occurred-no','没有发生') +
        (checkin.occurred === null ? '' : checkin.occurred ? ' 已选：发生了' : ' 已选：没有发生') + '</p>';
      if (checkin.occurred) html += '<p>做了什么？ ' + button('action-agreed','试了') +
        button('action-other','做了别的动作') + button('action-none','没有做') +
        (checkin.action ? ' 已选：' + actions[checkin.action] : '') + '</p>';
      if (['agreed','other'].includes(checkin.action)) html += '<p>感觉如何？ ' + button('feeling-helped','有一点帮助') +
        button('feeling-unchanged','差不多') + button('feeling-worse','更不舒服') + button('feeling-not_recorded','不想记录感受') +
        (checkin.feeling ? ' 已选：' + feelings[checkin.feeling] : '') + '</p>';
      html += '<label for="record-note">可选备注</label><input id="record-note" maxlength="200" value="' +
        esc(checkin.note) + '">' + button('record-save','保存记录','primary') + button('record-skip','跳过');
    }
    if (error) html += '<p role="alert">未保存。请检查输入或重试。</p>';
    if (message) html += '<p role="status">' + esc(message) + '</p>';
    return html + '</section>';
  }

  const actions = { agreed: '试了', other: '做了别的动作', none: '没有做' };
  const feelings = { helped: '有一点帮助', unchanged: '差不多', worse: '更不舒服', not_recorded: '不想记录感受' };
  const entryTypes = { event: '经历', exception: '例外', practice: '练习记录', correction: '理解修正' };
  function pathView() {
    const state = journey.path.snapshot();
    if (state.status !== 'ready') return '<h2>路径</h2><p>暂时无法读取路径。</p>' + button('path-open','重试');
    let html = '<section class="card"><h2>路径</h2>';
    if (state.error) html += '<p role="alert">路径未更新，原关联保持不变。可重试。</p>';
    for (const [i, entry] of state.entries.entries()) {
      const r = entry.record;
      const fact = r ? [r.occurred ? '发生了' : '没有发生', actions[r.action],
        feelings[r.feeling], r.note].filter(Boolean).join(' → ') : entry.fact;
      html += '<article><h3>' + esc(entryTypes[entry.type] ?? '记录') + ' · ' + esc(entry.entryId) + '</h3><p>' + esc(fact ?? '') + '</p><small>' +
        esc(entry.createdAt) + ' · ' + esc(entry.source ?? '来源未知') + '</small>' +
        (entry.type === 'correction' ? '<p>原来的理解：' + esc(entry.oldUnderstanding ?? '未记录') +
          '</p><p>这次保存的理解：' + esc(entry.currentUnderstanding ?? '未记录') + '</p>' : '') +
        (r ? '<p>关联练习：' + esc(r.practiceId) + '</p>' : '') +
        (entry.feeling ? '<p>补充／修正感受：' + esc(entry.feeling) + '</p>' : '') +
        (entry.explanation ? '<p>' + esc(entry.explanation) + '</p>' : '') +
        (pathEditing === i ? '<label for="path-feeling">补充／修正感受（仅合成演示文字）</label><textarea id="path-feeling" maxlength="1000">' +
          esc(pathFeeling) + '</textarea><label for="path-text">关联说明</label><textarea id="path-text" maxlength="1000">' +
          esc(explanation) + '</textarea>' + button('path-save-' + i,'保存说明') + button('path-cancel','取消')
          : button('path-edit-' + i,'编辑说明')) + button('path-remove-' + i,'移除关联') + '</article>';
    }
    if (!state.entries.length) html += '<p>当前没有关联。</p>';
    return html + '</section>';
  }

  function bind(screen, selected) {
    const on = (id, fn) => { const el = by(id); if (el) el.onclick = fn; };
    const type = (id, fn) => { const el = by(id); if (el) el.oninput = e => fn(e.target.value); };
    const redraw = fn => () => { fn(); draw(); };
    if (screen === 'chat') {
      type('chat-input', v => { input = v; });
      type('candidate-text', v => { understanding = v; });
      on('chat-send', redraw(() => {
        candidate = input.trim() === CHAT_INPUT;
        editing = false;
        understanding = '';
        showNotice(candidate ? '' : '固定合成聊天未匹配，请使用页面的演示句，或离开。');
      }));
      on('candidate-edit', redraw(() => { editing = true; understanding = CANDIDATE; }));
      for (const id of ['candidate-reject','candidate-unsure','candidate-stop']) {
        on(id, redraw(() => { reset(); showNotice('已停止，本次候选未保存。'); }));
      }
      on('candidate-save', async () => {
        const result = journey.confirm(understanding);
        if (!result.ok) { showNotice('未保存。请检查输入或存储后重试。'); draw(); return; }
        reset();
        await openDetail(PATTERN_ID);
      });
    }
    if (screen !== 'detail' || selected !== PATTERN_ID) return;
    on('path-open', async () => {
      const viewGeneration = ++generation;
      pathEditing = null;
      await journey.path.open(active(), selected);
      if (viewGeneration === generation) draw();
    });
    if (practice) {
      on('practice-edit', redraw(() => practice.edit()));
      on('practice-cancel', redraw(() => practice.cancelEdit()));
      type('practice-cue', value => practice.draftText(value, by('practice-action').value));
      type('practice-action', value => practice.draftText(by('practice-cue').value, value));
      on('practice-save', redraw(() => practice.savePractice()));
      on('practice-pause', redraw(() => practice.pause()));
      on('record-open', redraw(() => practice.startRecord()));
      on('occurred-yes', redraw(() => practice.chooseOccurred(true)));
      on('occurred-no', redraw(() => practice.chooseOccurred(false)));
      on('action-agreed', redraw(() => practice.chooseAction('agreed')));
      on('action-other', redraw(() => practice.chooseAction('other')));
      on('action-none', redraw(() => practice.chooseAction('none')));
      for (const key of Object.keys(feelings)) on('feeling-' + key, redraw(() => practice.chooseFeeling(key)));
      type('record-note', v => practice.note(v));
      on('record-skip', redraw(() => practice.skip()));
      on('record-save', async () => {
        const viewGeneration = generation;
        if (practice.saveRecord() && journey.path.snapshot().status === 'ready') {
          await journey.path.open(active(), selected);
        }
        if (viewGeneration === generation) draw();
      });
    }
    type('path-text', v => { explanation = v; });
    type('path-feeling', v => { pathFeeling = v; });
    on('path-cancel', redraw(() => { pathEditing = null; explanation = pathFeeling = ''; }));
    journey.path.snapshot().entries.forEach((entry, i) => {
      on('path-edit-' + i, redraw(() => { pathEditing = i; explanation = entry.explanation ?? ''; pathFeeling = entry.feeling ?? ''; }));
      on('path-save-' + i, async () => {
        const viewGeneration = generation;
        const patch = { explanation };
        if (pathFeeling !== (entry.feeling ?? '')) patch.feeling = pathFeeling;
        const r = await journey.path.save(entry.entryId, patch, entry.version);
        if (viewGeneration !== generation) return;
        if (r?.ok) pathEditing = null;
        draw();
      });
      on('path-remove-' + i, async () => {
        if (!window.confirm('移除这项关联？')) return;
        const viewGeneration = generation;
        await journey.path.save(entry.entryId, { linked: false }, entry.version);
        if (viewGeneration !== generation) return;
        pathEditing = null;
        draw();
      });
    });
  }

  function open(accountId, patternId) {
    reset();
    try { practice = journey.openPractice(accountId, patternId); } catch { practice = undefined; }
  }

  return { reset, open, chat, detail, bind, pathView };
}
