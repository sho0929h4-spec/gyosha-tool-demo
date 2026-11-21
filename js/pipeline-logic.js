// js/pipeline-logic.js — 見積の一覧・フェーズ・集計の規則（UMD: ブラウザは window.PipelineLogic / node は module.exports。tests/pipeline-logic.test.js）。DOM に触らない
// フェーズ: 提案中（作った時点）・発注あり・失注・請求中・入金確認必要・入金。表（estimate_phases）に持つのは proposal / ordered / lost / billing / paid（行が無い系列は「提案中」）
//   自動で進む（DB の trigger）: 案件に工事日 → 発注あり／工事の報告書を共有かダウンロード → 請求中／請求書を入金済みに → 入金。失注だけ手で選ぶ
//   「入金確認必要」（confirm）は表に持たない: 請求中で、その見積が載っている請求書の支払期限を過ぎても入金済みになっていないものを、そう見せる
// これから請求するもの = 請求中で、まだ請求書に載っていない見積。請求先（元請）× 締めの回ごとにまとめる。締めの回は 工事日（終わりの日。無ければ始まりの日）と元請の締め日（clients.closing_day。31・未設定は月末）から
// 月で絞る: 見積を作った日ではなく、案件の 工事日（無ければ調査日。どちらも無ければ見積を作った日）の月（工事をしても見積を作るのがずれることがあるため）
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const EL = () => (inNode ? require('./estimate-logic.js') : root.EstimateLogic);
  const TL = () => (inNode ? require('./teikei-logic.js') : root.TeikeiLogic);
  const CL = () => (inNode ? require('./case-logic.js') : root.CaseLogic);
  const PHASES = [['proposal', '提案中'], ['ordered', '発注あり'], ['lost', '失注'], ['billing', '請求中'], ['confirm', '入金確認必要'], ['paid', '入金済']];
  const KEYS = PHASES.map(p => p[0]);
  const STORED = ['proposal', 'ordered', 'lost', 'billing', 'paid']; // 表に入る値（confirm は画面が見せるだけ）
  const MONEY = ['billing', 'confirm', 'paid'];                      // お金のフェーズ（動かせるのは管理者だけ）
  const OLD = { scheduling: 'ordered', waiting: 'ordered' };         // 前のフェーズ（工事日調整・工事待ち）は「発注あり」として読む
  const phaseOf = k => (KEYS.includes(k) ? k : OLD[k] || 'proposal');
  const phaseLabel = k => PHASES.find(p => p[0] === phaseOf(k))[1];
  // 見積の一覧に出すフェーズ: お金のフェーズ（請求中・入金確認必要・入金済）は「請求へ」の1つにまとめる（中身は請求の画面 BillingUi で見る）
  const EST_PHASES = [['proposal', '提案中'], ['ordered', '発注あり'], ['lost', '失注'], ['billed', '請求へ']];
  const estPhase = i => (MONEY.includes(i.phase) ? 'billed' : i.phase);
  // 請求の画面の状態: 請求中（請求書がまだ）→ 入金待ち（請求書を出した）→ 入金確認必要（支払期限を過ぎた）→ 入金済
  const BILL = { billing: '請求中', wait: '入金待ち', confirm: '入金確認必要', paid: '入金済' };
  const billState = i => (i.phase === 'billing' && i.invoice ? 'wait' : i.phase);
  // 締め日の選択肢（元請の登録）。31 = 月末
  const CLOSING = [[null, '未設定（月末で集計）'], [5, '5日'], [10, '10日'], [15, '15日'], [20, '20日'], [25, '25日'], [31, '月末']];
  const MODES = [['monthly', '締め日ごとに1枚にまとめる'], ['each', '見積1件ごとに1枚']];

  // 系列ごとに一番新しい版だけ（新しく作った順）
  function latest(rows) {
    const m = new Map();
    (rows || []).forEach(r => { const o = m.get(r.series_id); if (!o || r.version > o.version) m.set(r.series_id, r); });
    return [...m.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  // 額の内訳: { net 税抜, rate 税率（0.1）, post 税の後の値引き（負の数。通常見積だけ）, total 税込（紙面と同じ式）}。壊れた中身は全部 0
  function parts(row) {
    try {
      const d = (row && row.data) || {};
      if (row.kind === 'teikei') { const t = TL().totals(d); return fin({ net: t.net, rate: (Number(d.taxRate) || 0) / 100, post: 0, total: t.total }); }
      const rate = Number(d.tax_rate) || 0, t = EL().totals(d.lines || [], rate);
      return fin({ net: t.subtotal, rate, post: t.postTaxAdj, total: t.total });
    } catch (e) { return { net: 0, rate: 0, post: 0, total: 0 }; }
  }
  const fin = o => (Object.values(o).every(Number.isFinite) ? o : { net: 0, rate: 0, post: 0, total: 0 });
  const amount = row => parts(row).total;
  // 締めの回: 工事日 'YYYY-MM-DD' と締め日（1〜31。31・無しは月末）→ { key: '2026-11-20', label: '11/20締め' }。工事日が無ければ null
  function period(ymd, closingDay) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return null;
    let y = +m[1], mo = +m[2];
    const d = +m[3], c = closingDay >= 1 && closingDay <= 30 ? closingDay : 31;
    const last = (yy, mm) => new Date(yy, mm, 0).getDate();
    if (d > Math.min(c, last(y, mo))) { mo++; if (mo > 12) { mo = 1; y++; } }
    const day = Math.min(c, last(y, mo));
    return { key: y + '-' + String(mo).padStart(2, '0') + '-' + String(day).padStart(2, '0'), label: mo + '/' + day + '締め' };
  }
  // 何月分: 締めの回の月（20日締めなら 10/21〜11/20 の工事が「2026年11月分」）。請求書に載せる名前は「2026年11月分（11/20締め）」
  const periodMonth = p => (p ? p.key.slice(0, 7) : '');
  const bun = m => (monthJa(m) ? monthJa(m) + '分' : '');
  const periodBun = p => (p ? bun(periodMonth(p)) + '（' + p.label + '）' : '');
  // 一覧の行: 系列ごとに1行。cases・clients・phases・invoices は配列（行）。today = 'YYYY-MM-DD'（支払期限を過ぎたかを見る日。無ければ見ない）
  // 件名（通常見積は subject、定型見積は表紙の題）
  const subjectOf = r => { const d = (r && r.data) || {}; return String((r.kind === 'teikei' ? d.cover && d.cover.title : d.subject) || '').trim(); };
  function items(estimates, cases, phases, clients, invoices, today) {
    // 系列 → その見積が載っている、取り消していない請求書
    const inv = new Map();
    (invoices || []).filter(i => !i.void_at).forEach(i => (((i.data || {}).lines) || []).forEach(l => inv.set(l.series_id, i)));
    // 請求に使う版: その系列で、出した（issued）版。下書きの新しい版があっても、相手に出した版の額で請求する（出した版が無い系列は請求できない）
    const issued = new Map();
    (estimates || []).forEach(r => { if (r.status === 'issued') issued.set(r.series_id, r); });
    const cm = new Map((cases || []).map(c => [c.id, c])), pm = new Map((phases || []).map(p => [p.series_id, p.phase])), km = new Map((clients || []).map(k => [k.id, k]));
    return latest(estimates).map(r => {
      const c = cm.get(r.case_id) || {}, k = km.get(c.client_id) || null;
      const work = c.work_end || c.work_start || '';
      // 月で絞る日: 工事日 → 調査日 → 見積を作った日（どれも日本の日付の YYYY-MM-DD に）
      const jst = v => (v ? CL().jstYmd(v) : '');
      const when = work ? { by: '工事', ymd: work } : c.survey_at ? { by: '調査', ymd: jst(c.survey_at) } : { by: '作成', ymd: jst(r.created_at) };
      const subject = subjectOf(r), b = issued.get(r.series_id) || null;
      const bill = b ? { id: b.id, number: b.number || '', version: b.version, subject: subjectOf(b), parts: parts(b) } : null;
      // 請求中で、請求書の支払期限を過ぎても入金済みになっていない → 入金確認必要
      const p0 = phaseOf(pm.get(r.series_id)), stored = p0 === 'confirm' ? 'billing' : p0, iv = inv.get(r.series_id) || null;
      const due = iv && iv.data ? String(iv.data.due || '') : '';
      const late = stored === 'billing' && iv && !iv.paid_at && today && due && due < today;
      return { id: r.id, series_id: r.series_id, case_id: r.case_id, kind: r.kind === 'teikei' ? 'teikei' : 'normal', number: r.number || '', version: r.version, draft: r.status === 'draft',
        place: CL().placeName(c), subject, client: String(c.client_name || '').trim(), client_id: c.client_id || null, phase: late ? 'confirm' : stored, stored, invoice: iv ? { id: iv.id, number: iv.number, due, paid: !!iv.paid_at } : null, amount: amount(r), bill,
        unbilled: !late && stored === 'billing' && !iv, when, month: when.ymd.slice(0, 7),
        work, period: period(work, k && k.closing_day), mode: k && k.invoice_mode === 'each' ? 'each' : 'monthly', created_at: r.created_at };
    });
  }
  // フェーズごとの件数と合計: { proposal: { count, total }, ... }
  function counts(list) {
    const out = Object.fromEntries(KEYS.map(k => [k, { count: 0, total: 0 }]));
    (list || []).forEach(i => { out[i.phase].count++; out[i.phase].total += i.amount; });
    return out;
  }
  // 集計: これから請求するもの（請求中で、まだ請求書に載っていない見積）を 請求先 × 締めの回 ごとに。工事日の無いものは「工事日が未定」。並びは締めの回（未定は最後）→ 請求先
  //   today = 'YYYY-MM-DD' を渡すと、締め日が来ているまとまりに late = true（請求書を作る時期）
  function summary(list, today) {
    const m = new Map();
    (list || []).filter(i => i.unbilled).forEach(i => {
      const key = (i.period ? i.period.key : '9999') + '|' + (i.client || '');
      const g = m.get(key) || { key, client: i.client || '（元請なし）', period: i.period ? i.period.label : '工事日が未定', month: periodMonth(i.period), bun: periodBun(i.period), count: 0, total: 0,
        client_id: i.client_id, mode: i.mode, items: [], billable: false, late: !!(today && i.period && i.period.key <= today) };
      g.count++; g.total += i.bill ? i.bill.parts.total : i.amount; g.items.push(i);
      if (i.client && i.period && i.bill) g.billable = true; // 請求書を作れるのは、元請と工事日があって、出した見積があるものだけ
      m.set(key, g);
    });
    return [...m.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
  // 請求の画面: お金のフェーズの見積を 何月分 × 請求先 ごとのカードに。工事日が無いもの（何月分か決まらない）は month = ''
  //   カード: { key, month, client, client_id, closing（「11/20締め」）, count, total, state, items, unbilled（請求書を作るまとまり。無ければ null）, invoices: [{ id, number, due, paid, state, count, total }] }
  //   state は一番手前のもの: 請求中（請求書がまだの見積がある）→ 入金確認必要 → 入金待ち → 入金済。並びは 月の新しい順 → 請求先
  function billing(list, today) {
    const groups = summary(list, today), m = new Map(), ORDER = ['billing', 'confirm', 'wait', 'paid'];
    (list || []).filter(i => MONEY.includes(i.phase)).forEach(i => {
      const month = periodMonth(i.period), key = month + '|' + (i.client || '');
      const c = m.get(key) || { key, month, client: i.client || '（元請なし）', client_id: i.client_id, closing: i.period ? i.period.label : '', count: 0, total: 0, state: 'paid', items: [], unbilled: null, invoices: [] };
      const amt = i.bill ? i.bill.parts.total : i.amount, s = billState(i);
      c.count++; c.total += amt; c.items.push(i);
      if (ORDER.indexOf(s) < ORDER.indexOf(c.state)) c.state = s;
      if (i.unbilled) c.unbilled = c.unbilled || groups.find(g => g.items.includes(i)) || null;
      if (i.invoice) {
        let v = c.invoices.find(x => x.id === i.invoice.id);
        if (!v) c.invoices.push(v = Object.assign({ state: s, count: 0, total: 0 }, i.invoice));
        v.count++; v.total += amt;
      }
      m.set(key, c);
    });
    return [...m.values()].sort((a, b) => (a.month !== b.month ? (a.month < b.month ? 1 : -1) : a.client < b.client ? -1 : a.client > b.client ? 1 : 0));
  }
  /* ---------- 請求書 ---------- */
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  // 支払期限の最初の値: 発行日の翌月末
  function dueDefault(issue) {
    const m = /^(\d{4})-(\d{2})-/.exec(String(issue || ''));
    return m ? ymd(new Date(+m[1], +m[2] + 1, 0)) : '';
  }
  const dateJa = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? +m[1] + '年' + +m[2] + '月' + +m[3] + '日' : ''; };
  // 請求書の中身（invoices.data）。sel = 一覧の行（items の結果）、o = { client, period（締めの回の名前。無ければ ''）, issue, due, org }
  //   明細は見積ごとに1行（税抜。出した版の額）。消費税は税率ごとに合計してから1回だけ丸める（インボイスの決まり。見積ごとの税を足すのとは数円ずれることがある）。税の後の値引きはそのまま引く
  //   ここで作るのは「送る中身」と画面の下見。発行者・宛先・税・合計は、出すときにサーバ（invoice_issue）が同じ式で入れ直す
  function invoiceData(sel, o) {
    const lines = (sel || []).filter(i => i.bill).map(i => ({ series_id: i.series_id, estimate_id: i.bill.id, title: (i.bill.subject || i.place || '（案件なし）').slice(0, 120), number: String(i.bill.number || '').slice(0, 40),
      work: /^\d{4}-\d{2}-\d{2}$/.test(i.work) ? i.work : '', net: i.bill.parts.net, rate: i.bill.parts.rate, post: i.bill.parts.post }));
    const rates = [...new Set(lines.map(l => l.rate))].sort((a, b) => b - a);
    const taxes = rates.map(rate => { const net = lines.filter(l => l.rate === rate).reduce((a, l) => a + l.net, 0); return { rate, net, tax: Math.round(net * rate) }; });
    const post = lines.reduce((a, l) => a + l.post, 0);
    return { issue: o.issue, due: o.due || '', period: String(o.period || '').slice(0, 40), to: String(o.client || '').trim(), lines, taxes, post,
      total: taxes.reduce((a, t) => a + t.net + t.tax, 0) + post };
  }
  // 出す前の注意（出せる。注意だけ）。org = 会社の設定（発行者はサーバがここから入れる）
  function invoiceNotes(data, org) {
    const out = [], g = org || {};
    if (!g.registration_number) out.push('登録番号（インボイス）が未入力です（設定 → 会社の情報）');
    if (!g.bank) out.push('振込先が未入力です（設定 → 会社の情報）');
    if (!data.due) out.push('支払期限が未入力です');
    return out;
  }
  const invoiceState = r => (r.void_at ? '取り消し' : r.paid_at ? '入金済' : '入金待ち');
  // 何月分（請求書の data.period の頭の「2026年11月分」。前の形「11/20締め」には無い）
  const invoiceBun = r => (/^\d+年\d+月分/.exec(String(((r && r.data) || {}).period || '')) || [''])[0];
  // 紙面の件名: 「2026年11月分 工事代金（11/20締め・3件）」。前の形の請求書は「11/20締め分 工事代金（3件）」
  function invoiceSubject(d) {
    const p = String((d && d.period) || ''), n = ((d && d.lines) || []).length + '件', x = /^(\d+年\d+月分)（(.+)）$/.exec(p);
    return x ? x[1] + ' 工事代金（' + x[2] + '・' + n + '）' : (p ? p + '分 ' : '') + '工事代金（' + n + '）';
  }
  const invoiceFile = r => ['請求書', String(r.client_name || ''), invoiceBun(r), String(r.number || '')].filter(Boolean).join('_').replace(/[\\/:*?"<>|\s]+/g, '') + '.pdf';

  // 一覧にある月（新しい順。'YYYY-MM'）と、その表示（「2026年11月」）
  const months = list => [...new Set((list || []).map(i => i.month).filter(Boolean))].sort().reverse();
  const monthJa = m => { const x = /^(\d{4})-(\d{2})$/.exec(String(m || '')); return x ? +x[1] + '年' + +x[2] + '月' : ''; };
  // 請求書を作れない理由（作れるなら ''）。行の「請求書を作る」の代わりに出す
  const billBlock = i => (!i.client ? '請求書を作るには、案件に元請を入れてください' : !i.period ? '請求書を作るには、案件に工事日を入れてください'
    : !i.bill ? '請求書を作るには、見積を共有かダウンロードしてください（相手に出した額で請求します）' : '');
  const yen = n => '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');

  const api = { PHASES, EST_PHASES, estPhase, BILL, billState, periodMonth, bun, periodBun, billing, invoiceBun, invoiceSubject, STORED, MONEY, CLOSING, MODES, billBlock, months, monthJa, phaseOf, phaseLabel, latest, parts, amount, period, items, counts, summary, yen, ymd, dueDefault, dateJa, invoiceData, invoiceNotes, invoiceState, invoiceFile };
  if (inNode) module.exports = api;
  else root.PipelineLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
