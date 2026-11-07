// js/case-ui.js — 04 案件画面: 4つのツール（報告書・見積書・工事掲示・図面）＋この案件の書類（種類の札・名前・作成日・送付の状態）
const CaseUi = (() => {
  let cur = null, wired = false;
  const KIND = { report: '報告書', estimate: '見積書', notice: '工事掲示', drawing: '図面' };
  // 下書き（PDF を作ったことがない）は続きから編集、PDF を作ったものはプレビューと共有へ。
  // 図面には data（pdf_at）が無いので、送付・ダウンロードの記録（戻したものも）があれば PDF を作ったものとする
  const made = (type, row, shares) => (type === 'drawing' ? shares.some(s => s.doc_type === type && s.doc_id === row.id) : !!(row.data && row.data.pdf_at));

  function wire() {
    if (wired) return;
    wired = true;
    $('tool-report').addEventListener('click', async () => {
      if (!cur) return;
      $('tool-report').disabled = true;
      try { location.hash = '#report/' + (await ReportUi.create(cur)).id; }
      catch (e) { $('case-msg').textContent = '報告書を作れませんでした: ' + errText(e); }
      finally { $('tool-report').disabled = false; }
    });
    $('tool-estimate').addEventListener('click', async () => {
      if (!cur) return;
      $('tool-estimate').disabled = true;
      try { location.hash = '#estimate/' + (await EstimatesApi.createDraft(cur)).id; }
      catch (e) { $('case-msg').textContent = '見積書を作れませんでした: ' + errText(e); }
      finally { $('tool-estimate').disabled = false; }
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
  async function show(id) {
    wire();
    showScreen('case');
    $('case-msg').textContent = '';
    $('case-docs').replaceChildren();
    const c = await CasesApi.get(id);
    if (!c) { toast('案件が見つかりませんでした'); location.replace('#cases'); return; }
    cur = c;
    $('case-title').textContent = CaseLogic.placeName(c);
    $('case-sub').textContent = [CaseLogic.clientLine(c), c.address].filter(Boolean).join(' ・ ');
    $('case-edit').href = '#case/' + c.id + '/edit';
    $('case-memo').hidden = !c.memo;
    $('case-memo-t').textContent = c.memo || '';
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
  return { show, current: () => cur };
})();
