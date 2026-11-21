// js/case-ui.js — 04 案件画面: 上の帯の下に日程の行（調査・工事）・メモ（その場で書く・見出しのボタン・自動保存）・4つのツール（報告書・見積書・工事掲示・図面）＋この案件の書類（種類の札・名前・作成日・送付の状態）
const CaseUi = (() => {
  let cur = null, wired = false;
  const KIND = { report: '報告書', estimate: '見積書', notice: '工事掲示', drawing: '図面' };
  // 下書き（PDF を作ったことがない）は続きから編集、PDF を作ったものはプレビューと共有へ。
  // 図面には data（pdf_at）が無いので、送付・ダウンロードの記録（戻したものも）があれば PDF を作ったものとする
  const made = (type, row, shares) => (type === 'drawing' ? shares.some(s => s.doc_type === type && s.doc_id === row.id) : !!(row.data && row.data.pdf_at));

  /* ---------- メモ（その場で書く。1.5 秒で自動保存。cases.memo） ---------- */
  const SAVE_MS = 1500;
  let memo = null; // { id, timer, dirty, saving, savedAt, err }（今の案件の保存の状態）
  function memoSub() {
    const s = memo || {};
    $('case-memo-s').textContent = s.err ? '保存できませんでした（' + s.err + '）' : s.saving ? '保存中…' : s.savedAt ? '自動保存 ' + s.savedAt : '';
    $('case-memo-s').classList.toggle('err', !!s.err);
  }
  // 中身の行数に合わせて欄を伸ばす（欄の中でスクロールさせない）
  function memoFit() { const t = $('case-memo-t'); t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
  function memoChanged() {
    if (!memo) return;
    memo.dirty = true;
    clearTimeout(memo.timer);
    memo.timer = setTimeout(() => { memoSave().catch(() => {}); }, SAVE_MS);
    memoFit();
  }
  async function memoSave() {
    const s = memo;
    if (!s) return;
    clearTimeout(s.timer);
    if (!s.dirty) return;
    while (s.saving) await s.saving.catch(() => {});
    if (!s.dirty) return;
    s.dirty = false;
    const text = s.text; // 保存を始めた時の中身（書いている途中の続きは次の保存で）
    s.saving = CasesApi.update(s.id, { memo: text });
    memoSub();
    try {
      await s.saving;
      s.err = '';
      const n = new Date();
      s.savedAt = n.getHours() + ':' + String(n.getMinutes()).padStart(2, '0');
      if (cur && cur.id === s.id) cur.memo = text;
    } catch (e) {
      s.dirty = true; // 次の入力・画面を離れる時にもう一度
      s.err = errText(e);
      throw e;
    } finally {
      s.saving = null;
      if (memo === s) memoSub();
    }
  }
  App.onLeave(async () => { if (memo && (memo.dirty || memo.saving)) { try { await memoSave(); } catch (e) { toast('メモを保存できませんでした: ' + errText(e)); } } });

  function wire() {
    if (wired) return;
    wired = true;
    const ta = $('case-memo-t');
    ta.addEventListener('input', () => { if (memo) { memo.text = ta.value; memoChanged(); } });
    ta.addEventListener('blur', () => { memoSave().catch(() => {}); });
    CaseLogic.MEMO_HEADS.forEach((h, i) => {
      const b = dBtn('＋ ' + h, 'btn ghost sm', () => {
        if (!memo) return;
        const next = CaseLogic.memoAddHead(ta.value, h);
        if (next === ta.value) { toast('メモは ' + CaseLogic.MEMO_MAX + ' 字までです'); return; }
        ta.value = memo.text = next;
        memoChanged();
        ta.focus();
        ta.setSelectionRange(next.length, next.length);
      });
      b.id = 'case-memo-h' + i;
      $('case-memo-heads').appendChild(b);
    });
    $('tool-report').addEventListener('click', async () => {
      if (!cur) return;
      $('tool-report').disabled = true;
      try { location.hash = '#report/' + (await ReportUi.create(cur)).id; }
      catch (e) { $('case-msg').textContent = '報告書を作れませんでした: ' + errText(e); }
      finally { $('tool-report').disabled = false; }
    });
    // 見積書: この案件に見積があれば一覧（フェーズ・過去の見積）へ。まだ無ければすぐ作る
    $('tool-estimate').addEventListener('click', async () => {
      if (!cur) return;
      const c = cur;
      $('tool-estimate').disabled = true;
      try {
        if (await PipelineApi.count(c.id)) { location.hash = '#case/' + c.id + '/estimates'; return; }
      } catch (e) { $('case-msg').textContent = '見積を読み込めませんでした: ' + errText(e); return; }
      finally { $('tool-estimate').disabled = false; }
      newEstimate(c, $('tool-estimate'), $('case-msg'));
    });
    $('tool-notice').addEventListener('click', async () => {
      if (!cur) return;
      $('tool-notice').disabled = true;
      try { location.hash = '#notice/' + (await NoticeUi.create(cur)).id; }
      catch (e) { $('case-msg').textContent = '工事掲示を作れませんでした: ' + errText(e); }
      finally { $('tool-notice').disabled = false; }
    });
    $('tool-drawing').addEventListener('click', async () => {
      if (!cur) return;
      $('tool-drawing').disabled = true;
      try { location.hash = '#drawing/' + (await DrawingUi.create(cur)).id; }
      catch (e) { $('case-msg').textContent = '図面を作れませんでした: ' + errText(e); }
      finally { $('tool-drawing').disabled = false; }
    });
  }
  // 新しい見積を作る（案件の画面と、見積の一覧の「＋ 新しい見積」から）
  async function newEstimate(caseRow, btn, msg) {
    // 定型パターン（被害復旧工事）か通常か。× は何もしない
    const a = await askPopup('どちらの見積書を作りますか？', { title: '見積書', okLabel: '通常見積書作成', more: [{ id: 'est-kind-teikei', label: '定型パターン見積書作成', value: 'teikei' }], id: 'est-kind-ask' });
    if (!a) return;
    const teikei = a.more === 'teikei';
    btn.disabled = true;
    try { location.hash = (teikei ? '#teikei/' : '#estimate/') + (await EstimatesApi.createDraft(caseRow, null, teikei ? 'teikei' : undefined)).id; }
    catch (e) { msg.textContent = '見積書を作れませんでした: ' + errText(e); }
    finally { btn.disabled = false; }
  }
  async function show(id) {
    wire();
    showScreen('case');
    $('case-msg').textContent = '';
    $('case-docs').replaceChildren();
    memo = null; // 読み込むまで書かせない（前の案件のメモを今の案件に保存しない）
    $('case-memo-t').value = '';
    memoSub();
    const c = await CasesApi.get(id);
    if (!c) { toast('案件が見つかりませんでした'); location.replace('#cases'); return; }
    cur = c;
    $('case-title').textContent = CaseLogic.placeName(c);
    $('case-sub').textContent = [CaseLogic.clientLine(c), c.address].filter(Boolean).join(' ・ ');
    $('case-edit').href = '#case/' + c.id + '/edit';
    const when = CaseLogic.calLine(c);
    $('case-cal').hidden = !when;
    $('case-cal').textContent = when;
    memo = { id: c.id, text: c.memo || '', timer: null, dirty: false, saving: null, savedAt: '', err: '' };
    $('case-memo-t').value = memo.text;
    memoSub();
    memoFit();
    try {
      const [reports, estimates, notices, drawings, shares] = await Promise.all([DocsApi.reports(id), DocsApi.estimates(id), DocsApi.notices(id), DocsApi.drawings(id), DocsApi.shares(id)]);
      const docs = reports.map(r => ({ type: 'report', row: r })).concat(estimates.map(r => ({ type: 'estimate', row: r })), notices.map(r => ({ type: 'notice', row: r })), drawings.map(r => ({ type: 'drawing', row: r })))
        .sort((a, b) => (a.row.created_at < b.row.created_at ? 1 : -1));
      const host = $('case-docs');
      if (!docs.length) { host.appendChild(mk('div', 'empty', 'まだ書類はありません。上のボタンから作ってください')); return; }
      docs.forEach(({ type, row }) => {
        const a = mk('a', 'doc');
        const done = made(type, row, shares);
        a.href = '#' + (done ? 'doc/' : '') + type + '/' + row.id;
        a.appendChild(mk('span', 'doc-kind', KIND[type]));
        const m = mk('div', 'doc-m');
        m.appendChild(mk('div', 'doc-t', DocsApi.title(type, row)));
        const state = done ? DocsApi.statusText(DocsApi.last(shares, type, row.id)) : '下書き';
        m.appendChild(mk('div', 'doc-s', CaseLogic.md(row.created_at) + ' 作成 ・ ' + state));
        a.appendChild(m);
        a.appendChild(mk('span', 'chev', '›'));
        host.appendChild(a);
      });
      host.appendChild(mk('div', 'empty', '新しい順。押すとプレビューと共有へ。下書きは続きから編集。'));
    } catch (e) {
      $('case-msg').textContent = '書類を読み込めませんでした: ' + errText(e);
    }
  }
  return { show, current: () => cur, newEstimate };
})();
