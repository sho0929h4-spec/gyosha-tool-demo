// js/invoice-ui.js — 請求書（作る・入金の印・取り消しは管理者だけ。一般の人は一覧とプレビューを見るだけ）: 作る画面（#invoice/new。請求の画面 BillingUi の「請求書を作る」から）と、出した請求書の一覧（#invoices。入金済みの印・取り消し）
// 作る: 紙面の下見（見積書と同じ形。InvoicePdf）を見ながら、載せる見積・請求日・お支払期限を直す → 確かめて発行（番号が付き、中身は直せない）→ プレビューと共有へ
//   下見は画面の中だけ（出すまで何も保存しない・何も送らない）。元請が「見積1件ごとに1枚」なら、選んだ見積それぞれに1枚ずつ出して請求の画面へ（下見は1枚目）
const InvoiceUi = (() => {
  const PL = PipelineLogic;
  let draft = null; // 請求の画面から渡されるまとまり（PipelineLogic.summary の1つ）{ client, client_id, period, bun, mode, items }
  let st = null;    // 作る画面: { g, on: Set(series_id) }

  const start = g => { draft = g; location.hash = '#invoice/new'; };
  const picked = () => st.g.items.filter(i => i.bill && st.on.has(i.series_id));
  const dataOf = sel => PL.invoiceData(sel, { client: st.g.client, period: st.g.bun || st.g.period, issue: $('iv-issue').value, due: $('iv-due').value });

  function renderNew() {
    const host = $('iv-items');
    host.replaceChildren();
    st.g.items.forEach(i => {
      const l = mk('label', 'check iv-item');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'iv-on-' + i.series_id;
      cb.checked = !!i.bill && st.on.has(i.series_id);
      cb.disabled = !i.bill; // 出した（共有かダウンロードをした）版が無い見積は請求できない
      cb.addEventListener('change', () => { if (cb.checked) st.on.add(i.series_id); else st.on.delete(i.series_id); renderTotal(); });
      const t = mk('span', 'iv-item-t');
      const b = i.bill;
      t.append(mk('span', null, (b && b.subject) || i.place || '（案件なし）'), mk('span', 'hint', b
        ? [b.number + ' 第' + b.version + '版', i.work ? '工事日 ' + i.work.slice(5).replace('-', '/') : '', PL.phaseLabel(i.phase), i.draft ? '新しい下書きがありますが、出した版の額で請求します' : ''].filter(Boolean).join(' ・ ')
        : 'まだ出していない見積です。見積を共有かダウンロードすると請求できます'));
      l.append(cb, t, mk('span', 'iv-item-y', PL.yen(b ? b.parts.total : i.amount)));
      host.appendChild(l);
    });
    renderTotal();
  }
  // 紙面の下見: いまの中身で作り直す（作っている間に変わったら、終わってからもう一度）
  let painting = false, again = false;
  async function paint() {
    if (painting) { again = true; return; }
    const s = st, sel = picked(), each = s.g.mode === 'each', host = $('iv-paper'), pg = $('iv-progress');
    if (!sel.length) { host.replaceChildren(); pg.textContent = '載せる見積を1つ以上選ぶと、ここに紙面が出ます'; return; }
    painting = true;
    pg.textContent = '紙面を作っています…';
    try {
      let pages = [];
      const sealUrl = ctx.org.seal_path ? await signedUrl(ctx.org.seal_path).catch(() => '') : '';
      await InvoicePdf.toBlob({ invoice: { client_name: s.g.client, data: dataOf(each ? sel.slice(0, 1) : sel) }, org: ctx.org, sealUrl, onPages: p => { pages = p; } });
      if (st !== s) return;
      host.replaceChildren(...pages.map((src, i) => { const im = new Image(); im.className = 'dv-page'; im.alt = '請求書の下見 ' + (i + 1) + 'ページ目'; im.src = src; return im; }));
      pg.textContent = each && sel.length > 1 ? '1枚目の下見です（全部で ' + sel.length + ' 枚）' : '';
    } catch (e) { if (st === s) pg.textContent = '紙面を作れませんでした: ' + errText(e); }
    finally { painting = false; if (again) { again = false; if (st === s) paint(); } }
  }
  function renderTotal() {
    const sel = picked(), d = dataOf(sel), each = st.g.mode === 'each';
    paint();
    const box = $('iv-total');
    box.replaceChildren();
    d.taxes.forEach(t => box.appendChild(mk('div', null, Math.round(t.rate * 1000) / 10 + '%対象 ' + PL.yen(t.net) + '　消費税 ' + PL.yen(t.tax))));
    if (d.post) box.appendChild(mk('div', null, '値引き ' + PL.yen(d.post)));
    box.appendChild(mk('div', 'iv-total-y', (each ? sel.length + '枚の合計 ' : 'ご請求金額 ') + PL.yen(d.total) + '（税込）'));
    const notes = PL.invoiceNotes(d, ctx.org);
    $('iv-notes').replaceChildren(...notes.map(n => mk('div', null, '・' + n)));
    $('iv-notes').hidden = !notes.length;
    $('iv-mode').textContent = each ? 'この元請は「見積1件ごとに1枚」です。選んだ ' + sel.length + ' 件それぞれに請求書を作ります（設定 → 元請 で変えられます）' : '選んだ見積を1枚の請求書にまとめます（設定 → 元請 で変えられます）';
    $('iv-issue-btn').disabled = !sel.length;
    $('iv-issue-btn').textContent = each && sel.length > 1 ? '請求書を ' + sel.length + ' 枚発行する' : '請求書を発行する';
  }
  async function issue() {
    const s = st, sel = picked(), each = s.g.mode === 'each';
    if (!sel.length) return;
    if (!$('iv-issue').value) { $('iv-msg').textContent = '発行日を入れてください'; return; }
    const d = dataOf(sel);
    if (!(await askPopup(s.g.client + ' 御中\n' + (each ? sel.length + '枚・合計 ' : '') + PL.yen(d.total) + '（税込）\n\n発行すると番号が付き、中身は直せません（取り消しはできます）。請求の画面で「入金待ち」になります。', { title: '請求書を発行', okLabel: '発行する', id: 'iv-ask' })) || st !== s) return;
    $('iv-issue-btn').disabled = true;
    $('iv-msg').textContent = '';
    try {
      // 1件ごとの元請は1枚ずつ（途中で失敗したら、出せた分は一覧に残る。残りはもう一度）
      const groups = each ? sel.map(i => [i]) : [sel];
      let last = null;
      for (const g of groups) last = await PipelineApi.issue(s.g.client_id, s.g.client, dataOf(g));
      draft = null;
      toast(groups.length > 1 ? '請求書を ' + groups.length + ' 枚発行しました' : '請求書 ' + last.number + ' を発行しました');
      location.hash = groups.length > 1 ? '#billing' : '#doc/invoice/' + last.id;
    } catch (e) { $('iv-msg').textContent = '発行できませんでした: ' + errText(e) + '（出せた分は「請求書の一覧」にあります）'; $('iv-issue-btn').disabled = false; }
  }
  // 振込先が直近 30 日に変わっていたら知らせる（心当たりが無ければ出す前に気づける）。記録が読めなくても請求書は作れる
  async function bankNote() {
    const s = st, box = $('iv-bank');
    box.hidden = true;
    try {
      // 変わった列に bank がある記録だけをサーバで絞る（ほかの記録がいくら増えても、知らせは消えない）
      const r = await sb.from('audit_log').select('at,detail').eq('action', 'org_updated').contains('detail', { cols: ['bank'] }).order('at', { ascending: false }).limit(1);
      const hit = (r.data || [])[0];
      if (st !== s || !hit || Date.now() - new Date(hit.at).getTime() > 30 * 86400000) return;
      box.textContent = '振込先が ' + CaseLogic.md(hit.at) + ' に変わっています。心当たりが無ければ発行せず、設定 → 操作の記録 を確かめてください。いまの振込先: ' + (ctx.org.bank || '（なし）');
      box.hidden = false;
    } catch (e) { /* 知らせだけなので黙る */ }
  }
  function showNew() {
    wire();
    if (!draft || !draft.items || !draft.items.length || ctx.membership.role !== 'admin') { location.replace('#billing'); return; } // 開き直したとき・管理者でない人は請求の画面へ
    st = { g: draft, on: new Set(draft.items.filter(i => i.bill).map(i => i.series_id)) };
    showScreen('invoice');
    $('iv-sub').textContent = st.g.client + ' ・ ' + (st.g.bun || st.g.period);
    $('iv-paper').replaceChildren();
    $('iv-to').textContent = st.g.client + ' 御中';
    $('iv-period').textContent = st.g.bun || st.g.period + '分';
    $('iv-issue').value = PL.ymd(new Date());
    $('iv-due').value = PL.dueDefault($('iv-issue').value);
    $('iv-msg').textContent = '';
    renderNew();
    bankNote();
  }

  /* ---------- 一覧 ---------- */
  async function list() {
    wire();
    showScreen('invoices');
    const host = $('ivs-list'), msg = $('ivs-msg');
    host.replaceChildren();
    msg.textContent = '';
    let rows;
    try { rows = await PipelineApi.invoices(); }
    catch (e) { msg.textContent = '請求書を読み込めませんでした: ' + errText(e); return; }
    if (!rows.length) {
      host.appendChild(mk('div', 'empty', 'まだ請求書はありません。工事の報告書を共有すると見積が請求に上がり、画面下の「請求」に「請求書を作る」が出ます'));
      const go = mk('a', 'btn', '請求の画面へ');
      go.href = '#billing';
      go.id = 'ivs-go';
      host.appendChild(go);
      return;
    }
    rows.forEach(r => {
      const d = r.data || {}, state = PL.invoiceState(r);
      const row = mk('div', 'pl-row iv-row');
      row.dataset.state = state;
      const a = mk('a', 'pl-main');
      a.href = '#doc/invoice/' + r.id;
      a.id = 'ivs-open-' + r.number;
      a.append(mk('div', 'pl-t', r.number + '　' + r.client_name), mk('div', 'pl-s', ['発行 ' + PL.dateJa(d.issue), d.period ? d.period + '分' : '', (d.lines || []).length + '件', d.due ? '期限 ' + PL.dateJa(d.due) : ''].filter(Boolean).join(' ・ ')),
        mk('div', 'pl-y', PL.yen(d.total) + '（税込）　' + state + (r.paid_at && !r.void_at ? ' ' + CaseLogic.md(r.paid_at) : '')));
      row.appendChild(a);
      if (!r.void_at && ctx.membership.role === 'admin') { // 入金の印・取り消しは管理者だけ
        const act = mk('div', 'iv-act');
        const mark = async (what, done) => {
          try { await PipelineApi.mark(r.id, what); toast(done); list(); }
          catch (e) { msg.textContent = '変えられませんでした: ' + errText(e); }
        };
        const paid = dBtn(r.paid_at ? '入金済みを外す' : '入金済みにする', 'btn ghost sm', () => mark(r.paid_at ? 'unpaid' : 'paid', r.paid_at ? '入金待ちに戻しました' : '入金済みにしました'));
        paid.id = 'ivs-paid-' + r.number;
        const vd = dBtn('取り消す', 'btn ghost sm danger', async () => {
          if (await askPopup(r.number + '（' + r.client_name + '・' + PL.yen(d.total) + '）を取り消しますか？\n番号は欠番になり、元に戻せません。見積は「請求中」（請求書がまだ）に戻り、もう一度請求書を作れます。送った相手には別に連絡してください。', { title: '請求書を取り消す', okLabel: '取り消す', danger: true, id: 'ivs-void-ask' })) mark('void', r.number + ' を取り消しました');
        });
        vd.id = 'ivs-void-' + r.number;
        act.append(paid, vd);
        row.appendChild(act);
      }
      host.appendChild(row);
    });
  }
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $('iv-issue-btn').addEventListener('click', issue);
    $('iv-issue').addEventListener('change', () => { if (st) { $('iv-due').value = PL.dueDefault($('iv-issue').value); renderTotal(); } });
    $('iv-due').addEventListener('change', () => { if (st) renderTotal(); });
    $('iv-paper').addEventListener('click', () => $('iv-edit').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  return { start, showNew, list };
})();
