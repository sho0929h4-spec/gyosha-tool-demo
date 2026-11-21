// js/pipeline-ui.js — 見積の一覧: 全案件（#estimates。下のタブ「見積」）と案件ごと（#case/{id}/estimates。案件の「見積書」ボタンから）
// 系列ごとに1行（一番新しい版）。フェーズは自動で進む（工事日 → 発注あり／工事の報告書を共有 → 請求へ）。失注は手で選ぶ。
// 上で 月（工事日。無ければ調査日・作成日）とフェーズで絞る（件数つき）。
// 請求と入金（請求書を作る・入金済みにする・集計）はここには出さない。請求に上がった見積は「請求へ」の札と、請求の画面（BillingUi #billing）への道だけ。規則は PipelineLogic
const PipelineUi = (() => {
  const PL = PipelineLogic;
  let st = null; // { caseId, caseRow, all（全案件の行）, list（この画面に出す行）, filter（フェーズ）, month（'YYYY-MM' か ''）, today }

  function render() {
    const admin = ctx.membership.role === 'admin';
    // 月で絞る（工事日の月。無ければ調査日・作成日の月）
    const ms = PL.months(st.list), msel = $('pl-month');
    if (st.month && !ms.includes(st.month)) st.month = '';
    msel.replaceChildren(new Option('すべての月', ''), ...ms.map(m => new Option(PL.monthJa(m), m)));
    msel.value = st.month;
    const inMonth = st.list.filter(i => !st.month || i.month === st.month);
    // フェーズで絞る
    const chips = $('pl-filter');
    chips.replaceChildren();
    [['', 'すべて', inMonth.length]].concat(PL.EST_PHASES.map(([k, label]) => [k, label, inMonth.filter(i => PL.estPhase(i) === k).length])).forEach(([k, label, n]) => {
      const b = mk('button', 'chip');
      b.type = 'button';
      b.id = 'pl-f-' + (k || 'all');
      b.textContent = label + ' ' + n;
      b.setAttribute('aria-pressed', String(st.filter === k));
      b.addEventListener('click', () => { st.filter = k; render(); });
      chips.appendChild(b);
    });
    // 一覧
    const host = $('pl-list');
    host.replaceChildren();
    const rows = inMonth.filter(i => !st.filter || PL.estPhase(i) === st.filter);
    if (!rows.length) host.appendChild(mk('div', 'empty', st.list.length ? 'この月・このフェーズの見積はありません' : st.caseId ? 'まだ見積はありません。下の「＋ 新しい見積」から作ってください' : 'まだ見積はありません。案件の画面の「見積書」から作ってください'));
    rows.forEach(i => {
      const row = mk('div', 'pl-row');
      const ph = PL.estPhase(i), billed = ph === 'billed';
      row.dataset.phase = ph;
      const top = mk('div', 'pl-top');
      const a = mk('a', 'pl-main');
      a.href = i.draft ? (i.kind === 'teikei' ? '#teikei/' : '#estimate/') + i.id : '#doc/estimate/' + i.id;
      a.id = 'pl-open-' + i.series_id;
      const name = (i.kind === 'teikei' ? '定型見積書' : '見積書') + (i.draft && !i.number ? '（下書き）' : ' ' + i.number + ' 第' + i.version + '版' + (i.draft ? '（下書き）' : ''));
      a.appendChild(mk('div', 'pl-t', st.caseId ? name : (i.place || '（案件なし）')));
      a.appendChild(mk('div', 'pl-s', [st.caseId ? '' : name, st.caseId ? '' : i.client, i.when.by + ' ' + i.when.ymd.slice(5).replace('-', '/'), i.period ? i.period.label : ''].filter(Boolean).join(' ・ ')));
      a.appendChild(mk('div', 'pl-y', PL.yen(i.amount) + '（税込）'));
      // フェーズ: 提案中・発注あり・失注 から選ぶ。請求に上がったもの（請求へ）は選べない札。請求書がまだの間だけ、管理者が手で戻せる（間違えて上げたとき。DB も同じ決まり）
      // 請求書を出した見積・管理者でない人には、選べない札だけ（選択肢を見せて迷わせない）
      let sel;
      if (billed && (!admin || i.invoice)) {
        sel = mk('span', 'pl-pill', '請求へ');
        sel.id = 'pl-phase-' + i.series_id;
      } else {
        sel = document.createElement('select');
        sel.id = 'pl-phase-' + i.series_id;
        sel.className = 'pl-phase';
        sel.dataset.phase = ph;
        sel.setAttribute('aria-label', (i.place || name) + ' のフェーズ');
        PL.EST_PHASES.forEach(([k, label]) => {
          if (k === 'billed' && !billed) return;
          const o = new Option(label, k);
          if (k === 'billed') o.disabled = true;
          sel.appendChild(o);
        });
        sel.value = ph;
        sel.addEventListener('change', async () => {
          const s = st, next = sel.value;
          sel.disabled = true;
          try { await PipelineApi.setPhase(i.series_id, next); if (st === s) { toast('「' + PL.phaseLabel(next) + '」にしました'); await reload(); } }
          catch (e) { sel.value = ph; sel.disabled = false; $('pl-msg').textContent = 'フェーズを変えられませんでした: ' + errText(e); }
        });
      }
      top.append(a, sel);
      row.appendChild(top);
      // 次にやること（行の下）
      const act = mk('div', 'pl-act');
      if (i.phase === 'proposal' || i.phase === 'ordered') {
        act.appendChild(mk('span', 'hint', i.phase === 'proposal' ? '案件に工事日を入れると、自動で「発注あり」になります' : '工事の報告書を共有かダウンロードすると、自動で「請求」に上がります'));
        // 自動を待たずに、この見積を選んで請求にあげる（管理者。報告書の「見積書を選んで請求にあげる」から来る所）
        if (admin) {
          const u = dBtn('請求にあげる', 'btn sm', async () => {
            const s = st;
            u.disabled = true;
            try { await PipelineApi.setPhase(i.series_id, 'billing'); if (st === s) { toast('請求に上げました'); await reload(); } }
            catch (e) { u.disabled = false; $('pl-msg').textContent = 'フェーズを変えられませんでした: ' + errText(e); }
          });
          u.id = 'pl-up-' + i.series_id;
          act.appendChild(u);
        }
      } else if (billed) {
        // 請求に上がった → 何月分かと、請求の画面への道だけ（請求書・入金はそちらで）
        const m = PL.periodMonth(i.period);
        act.appendChild(mk('span', 'hint', m ? PL.bun(m) + 'で請求に上がっています' : '請求に上がっています（工事日が未定）'));
        const v = mk('a', 'btn ghost sm', '請求で見る ›');
        v.href = '#billing' + (m ? '/' + m : '');
        v.id = 'pl-bill-' + i.series_id;
        act.appendChild(v);
      }
      if (act.childNodes.length) row.appendChild(act);
      host.appendChild(row);
    });
  }

  // 読み直して描く（フェーズ・請求書が変わったあと。絞り込みはそのまま）
  async function reload() {
    const s = st;
    const d = await PipelineApi.load();
    if (st !== s) return;
    s.today = CaseLogic.jstYmd(Date.now());
    s.all = PL.items(d.estimates, d.cases, d.phases, d.clients, d.invoices, s.today);
    s.list = s.caseId ? s.all.filter(i => i.case_id === s.caseId) : s.all;
    render();
  }
  async function show(caseId) {
    st = null;
    showScreen('estimates');
    renderTabs();
    $('pl-msg').textContent = '';
    $('pl-list').replaceChildren();
    $('pl-filter').replaceChildren();
    $('pl-back').hidden = !caseId;
    $('pl-new').hidden = !caseId;
    $('pl-title').textContent = '見積';
    $('pl-sub').textContent = '';
    const s = { caseId: caseId || null, caseRow: null, all: [], list: [], filter: '', month: '', today: '' };
    try {
      if (caseId) {
        s.caseRow = await CasesApi.get(caseId);
        if (!s.caseRow) { toast('案件が見つかりませんでした'); location.replace('#cases'); return; }
        $('pl-sub').textContent = CaseLogic.placeName(s.caseRow);
        $('pl-back').href = '#case/' + caseId;
      }
      st = s;
      await reload();
    } catch (e) { $('pl-msg').textContent = '見積を読み込めませんでした: ' + errText(e); }
  }
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $('pl-new').addEventListener('click', () => { if (st && st.caseRow) CaseUi.newEstimate(st.caseRow, $('pl-new'), $('pl-msg')); });
    $('pl-month').addEventListener('change', () => { if (st) { st.month = $('pl-month').value; render(); } });
  }
  return { show: id => { wire(); return show(id); } };
})();
