// js/billing-ui.js — 請求（#billing・#billing/YYYY-MM。下のタブ「請求」）: 請求先（元請）ごとに、何月分で請求に上がっているかを見る
// 見積の一覧（PipelineUi）から、請求と入金の部分をここに移した。出るのはお金のフェーズの見積だけ（工事の報告書を共有かダウンロードすると自動で上がる）
// 月ごと: ‹ 2026年11月分 › と、請求先ごとのカード（請求中 → 入金待ち → 入金確認必要 → 入金済。請求書を作る・請求書を見る・入金済みにする は管理者）
// 請求先ごとの表: 縦が請求先、横がその月までの3か月。マスを押すとその月のカードへ。規則は PipelineLogic.billing
const BillingUi = (() => {
  const PL = PipelineLogic;
  let st = null; // { cards, view: 'month' | 'table', month: 'YYYY-MM', today }

  const addMonth = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const md = s => String(s || '').slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/');
  function pill(state) {
    const p = mk('span', 'bl-pill', PL.BILL[state]);
    p.dataset.s = state;
    return p;
  }
  const fail = e => { $('bl-msg').textContent = '変えられませんでした: ' + errText(e); };

  function card(c, admin) {
    const box = mk('div', 'pl-row bl-card');
    box.id = 'bl-card-' + (c.month || 'none') + '-' + (c.client_id || 'x');
    box.dataset.s = c.state;
    const top = mk('div', 'pl-top'), main = mk('div', 'pl-main');
    main.append(mk('div', 'pl-t', c.client), mk('div', 'pl-s', [c.month ? PL.bun(c.month) : '工事日が未定', c.closing, c.count + '件'].filter(Boolean).join(' ・ ')));
    top.append(main, pill(c.state));
    box.appendChild(top);
    c.items.forEach(i => {
      const r = mk('div', 'bl-item');
      r.append(mk('span', null, [i.place || '（案件なし）', i.work ? '工事 ' + md(i.work) : '', PL.billState(i) !== c.state ? PL.BILL[PL.billState(i)] : ''].filter(Boolean).join(' ・ ')), mk('span', null, PL.yen(i.bill ? i.bill.parts.total : i.amount)));
      box.appendChild(r);
    });
    const tot = mk('div', 'bl-item total');
    tot.append(mk('span', null, (c.month ? PL.bun(c.month) : '') + 'の合計（税込）'), mk('span', null, PL.yen(c.total)));
    box.appendChild(tot);
    const act = mk('div', 'pl-act');
    // 請求書がまだの見積がある → 請求書を作る（管理者）。作れないときは理由
    if (c.unbilled || c.items.some(i => i.unbilled)) {
      const g = c.unbilled, first = c.items.find(i => i.unbilled);
      if (!admin) act.appendChild(mk('span', 'hint', '請求書は管理者が作ります'));
      else if (g && g.billable) {
        const b = dBtn('請求書を作る ›', 'btn sm', () => InvoiceUi.start(g));
        b.id = 'bl-new-' + (c.month || 'none') + '-' + (c.client_id || 'x');
        act.appendChild(b);
        if (g.late) act.appendChild(mk('span', 'hint pl-late', '締め日が来ています'));
      } else act.appendChild(mk('span', 'hint', PL.billBlock(first) || '請求書を作れません'));
    }
    // 出した請求書 → 見る・入金済みにする（管理者）
    c.invoices.forEach(v => {
      const a = mk('a', 'btn ghost sm', '請求書 ' + v.number + ' ›');
      a.href = '#doc/invoice/' + v.id;
      a.id = 'bl-view-' + v.number;
      act.appendChild(a);
      if (admin && !v.paid) {
        const p = dBtn('入金済みにする', 'btn sm', async () => {
          const s = st;
          p.disabled = true;
          try { await PipelineApi.mark(v.id, 'paid'); toast('入金済みにしました'); if (st === s) await reload(); }
          catch (e) { p.disabled = false; fail(e); }
        });
        p.id = 'bl-paid-' + v.number;
        act.appendChild(p);
      }
      if (!v.paid && v.due) act.appendChild(mk('span', 'hint' + (v.state === 'confirm' ? ' pl-late' : ''), '支払期限 ' + md(v.due) + (v.state === 'confirm' ? ' を過ぎています。入金を確かめてください' : '')));
    });
    if (act.childNodes.length) box.appendChild(act);
    return box;
  }

  function renderMonth(host, admin) {
    const cards = st.cards.filter(c => c.month === st.month);
    const n = k => cards.filter(c => c.state === k).length;
    const sum = mk('div', 'card');
    sum.id = 'bl-sum';
    sum.append(mk('div', 'bl-sum', cards.length + '社 ・ ' + cards.reduce((a, c) => a + c.count, 0) + '件 ・ ' + PL.yen(cards.reduce((a, c) => a + c.total, 0)) + '（税込）'),
      mk('div', 'hint', cards.length ? ['billing', 'wait', 'confirm', 'paid'].filter(n).map(k => PL.BILL[k] + ' ' + n(k) + '社').join(' ／ ')
        : 'この月分で請求に上がっているものはありません。工事の報告書を共有かダウンロードすると、その案件の見積が自動でここに上がります'));
    host.appendChild(sum);
    cards.forEach(c => host.appendChild(card(c, admin)));
  }
  function renderTable(host) {
    const months = [addMonth(st.month, -2), addMonth(st.month, -1), st.month];
    const dated = st.cards.filter(c => c.month);
    const clients = [...new Map(dated.map(c => [c.client_id || c.client, c.client])).entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    if (!clients.length) { host.appendChild(mk('div', 'empty', 'まだ請求に上がっているものはありません')); return; }
    const t = mk('table', 'bl-table'), hr = mk('tr');
    t.id = 'bl-table';
    hr.append(mk('th', null, '請求先'), ...months.map(m => mk('th', null, +m.slice(5) + '月分')));
    t.appendChild(hr);
    clients.forEach(([key, name]) => {
      const tr = mk('tr');
      tr.appendChild(mk('td', null, name));
      months.forEach(m => {
        const td = mk('td'), c = dated.find(x => x.month === m && (x.client_id || x.client) === key);
        if (!c) td.textContent = '—';
        else {
          const b = mk('button', 'bl-cell');
          b.type = 'button';
          b.setAttribute('aria-label', name + ' ' + PL.bun(m) + ' ' + PL.BILL[c.state] + ' ' + PL.yen(c.total));
          b.append(pill(c.state), mk('span', null, PL.yen(c.total)));
          b.addEventListener('click', () => { st.view = 'month'; st.month = m; render(); const e = document.getElementById('bl-card-' + m + '-' + (c.client_id || 'x')); if (e) e.scrollIntoView({ block: 'center' }); });
          td.appendChild(b);
        }
        tr.appendChild(td);
      });
      t.appendChild(tr);
    });
    host.append(t, mk('div', 'hint', 'マスを押すと、その請求先・その月分の中身が開きます。赤い「入金確認必要」は、支払期限を過ぎても入金済みになっていないものです'));
  }
  function render() {
    const admin = ctx.membership.role === 'admin';
    $('bl-v-month').setAttribute('aria-pressed', String(st.view === 'month'));
    $('bl-v-table').setAttribute('aria-pressed', String(st.view === 'table'));
    $('bl-month-t').textContent = PL.bun(st.month) + (st.view === 'table' ? ' まで' : '');
    const host = $('bl-body');
    host.replaceChildren();
    if (st.view === 'table') renderTable(host); else renderMonth(host, admin);
    // 工事日が未定（何月分か決まらない）は、どの月を見ていても下に出す
    st.cards.filter(c => !c.month).forEach(c => host.appendChild(card(c, admin)));
    if (!admin) host.appendChild(mk('div', 'hint', '請求書を作る・入金済みにするのは管理者です（一覧とプレビューは見られます）'));
  }

  async function reload() {
    const s = st;
    const d = await PipelineApi.load();
    if (st !== s) return;
    s.today = CaseLogic.jstYmd(Date.now());
    s.cards = PL.billing(PL.items(d.estimates, d.cases, d.phases, d.clients, d.invoices, s.today), s.today);
    // 最初に開く月: 指定の月 → 今月（何かあれば）→ 請求中のある一番古い月（やることがある所）→ 一番新しい月 → 今月
    if (!s.month) {
      const now = s.today.slice(0, 7), has = s.cards.filter(c => c.month), todo = has.filter(c => c.state === 'billing').map(c => c.month).sort();
      s.month = has.some(c => c.month === now) ? now : todo[0] || (has[0] && has[0].month) || now;
    }
    render();
  }
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $('bl-prev').addEventListener('click', () => { if (st && st.month) { st.month = addMonth(st.month, -1); render(); } });
    $('bl-next').addEventListener('click', () => { if (st && st.month) { st.month = addMonth(st.month, 1); render(); } });
    $('bl-v-month').addEventListener('click', () => { if (st && st.month) { st.view = 'month'; render(); } });
    $('bl-v-table').addEventListener('click', () => { if (st && st.month) { st.view = 'table'; render(); } });
  }
  async function show(month) {
    wire();
    st = null;
    showScreen('billing');
    renderTabs();
    $('bl-msg').textContent = '';
    $('bl-body').replaceChildren();
    $('bl-month-t').textContent = '';
    st = { cards: [], view: 'month', month: month || '', today: '' };
    try { await reload(); }
    catch (e) { $('bl-msg').textContent = '請求を読み込めませんでした: ' + errText(e); }
  }
  return { show };
})();
