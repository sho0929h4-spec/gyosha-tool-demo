// js/teikei-pdf.js — 定型見積（被害復旧工事）の紙面（A4 横。css/teikei.css）を組み、PDF（Blob）にする。window.TeikeiPdf = { plan, build, toBlob }
// 紙面は試作 被害復旧工事_見積試作.html の coverSheet・coBlock・summarySheet・detailSheet・sheetRow・blankRow・totalRow・tableHead・chunk・buildPreview を DOM で組み直した（innerHTML は使わない）
// 数字は TeikeiLogic.totals / pages のものを並べるだけ（紙面で計算しない。行の金額＝数量×単価だけは試作の sheetRow と同じく出す）
// PDF は試作の savePdf と同じ: 1枚ずつ html2canvas（scale 2）→ JPEG .92 → jsPDF A4 横 addImage(..., 'FAST')。撮影台は画面外・等倍
// plan は DOM に触らない（node: module.exports。tests/teikei-pdf.test.js）
(function (root) {
  const TL = () => (typeof module !== 'undefined' && module.exports ? require('./teikei-logic.js') : root.TeikeiLogic);
  const ROWS_PER_PAGE = 19; // 明細19行＋合計1行＝実物と同じ20行。足りない分は空行
  const pad4 = n => String(n).padStart(4, '0');
  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o.length ? o : [[]]; };

  // ページの割り付け: 表紙 → 総括表（0001）→ 部位ごとの内訳書（19行ずつ。合計は最後の1枚だけ）→ 一般管理費
  function plan(d) {
    const t = TL().totals(d), parts = TL().pages(d);
    let no = 1;
    const sum = parts.map(p => ({ name: p.name, spec: '', qty: 1, unit: '式', price: p.total, note: '' }));
    sum.push({ name: '諸経費', spec: '保険料、機械損料など', qty: 1, unit: '式', price: t.misc, note: d.miscRate + '％' });
    const out = [{ kind: 'cover', totals: t }, { kind: 'summary', rows: sum, totalLabel: '総合計', total: t.net, foot: '被害復旧工事　0001 －（ ' + pad4(no++) + ' ）' }];
    parts.forEach(p => {
      const cs = chunk(p.rows, ROWS_PER_PAGE);
      cs.forEach((rows, i) => out.push({ kind: 'detail', rows, totalLabel: i === cs.length - 1 ? '合計' : null, total: p.total, foot: p.name + '　0001 －（ ' + pad4(no++) + ' ）' }));
    });
    return out;
  }

  /* ---------- 紙面（DOM） ---------- */
  const yen = n => Math.round(n).toLocaleString('ja-JP');
  const money = n => '¥' + yen(n || 0);
  const ymd = s => { if (!s) return ''; const [y, m, dd] = String(s).split('-'); return y + '/' + m + '/' + dd; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const td = (text, cls) => el('td', cls, text == null ? '' : String(text));
  function sheet(children) {
    const s = el('div', 'tk-sheet'), f = el('div', 'frame');
    f.append(...children);
    s.appendChild(f);
    return s;
  }
  // 名称/材質・寸法/数量/単位/単価/金額/備考 の1行。No. 欄は実物の見積書でも空のまま
  function sheetRow(r) {
    const a = r.qty == null || r.price == null ? '' : yen((r.qty || 0) * (r.price || 0));
    const tr = el('tr');
    tr.append(td('', 'ctr'), td(r.name), td(r.spec), td(r.qty, 'num'), td(r.unit, 'ctr'), td(r.price == null || r.price === '' ? '' : yen(r.price), 'num'), td(a, 'num'), td(r.note || ''));
    return tr;
  }
  const blankRow = () => { const tr = el('tr'); for (let i = 0; i < 8; i++) tr.appendChild(td('')); return tr; };
  function totalRow(label, total) {
    const tr = el('tr');
    tr.append(td(''), td(label), td(''), td(''), td(''), td(''), td(yen(total), 'num'), td(''));
    return tr;
  }
  function table(p) {
    const tb = el('table'), cg = el('colgroup'), th = el('thead'), hr = el('tr'), body = el('tbody');
    ['c-no', 'c-nm', 'c-sp', 'c-qt', 'c-un', 'c-pr', 'c-am', 'c-nt'].forEach(c => cg.appendChild(el('col', c)));
    ['No.', '名称', '材質・寸法', '数量', '単位', '単価', '金額', '備考'].forEach(h => hr.appendChild(el('th', null, h)));
    th.appendChild(hr);
    p.rows.forEach(r => body.appendChild(sheetRow(r)));
    for (let i = p.rows.length; i < ROWS_PER_PAGE; i++) body.appendChild(blankRow());
    if (p.totalLabel) body.appendChild(totalRow(p.totalLabel, p.total));
    tb.append(cg, th, body);
    return tb;
  }
  const detailSheet = p => sheet([el('div', 'dt-h1', '見積内訳書'), table(p), el('div', 'dt-foot gothic', p.foot)]);
  // 右下の発行元＝会社の設定。空の項目は行ごと出さない（郵便番号・FAX・担当者は持っていないので出さない）
  function coBlock(org) {
    const o = org || {};
    const lines = [o.address || '', o.tel ? 'TEL : ' + o.tel : '', o.email ? 'E-mail : ' + o.email : '', o.registration_number ? '登録番号 : ' + o.registration_number : ''].filter(Boolean);
    const b = el('div', 'cv-co'), ad = el('div', 'ad');
    lines.forEach((l, i) => { if (i) ad.appendChild(el('br')); ad.appendChild(document.createTextNode(l)); });
    b.append(el('div', 'nm', o.name || ''), ad);
    return b;
  }
  function coverSheet(d, t, org) {
    const c = d.cover || {};
    const row = (k, v) => { const r = el('div', 'r'); r.append(el('span', 'k', k), el('span', 'v', v || '')); return r; };
    const lead = el('div', 'cv-lead gothic');
    lead.append('下記の通り、お見積申し上げます。', el('br'), '何卒ご用命のほどよろしくお願いいたします。');
    const amt = el('div', 'cv-amt');
    amt.append(el('span', 'lb', '御見積金額'), el('span', 'vl', money(t.total)));
    const sub = el('div', 'cv-sub gothic');
    [['見積代金', t.net], ['消費税', t.tax]].forEach(([k, v]) => { const r = el('div'); r.append(el('span', null, k), el('span', 'vl', money(v))); sub.appendChild(r); });
    const kikan = el('div', 'r kikan'), kv = el('span', 'v');
    kv.append('着工日　' + ymd(c.start), el('br'), '完工日　' + ymd(c.end));
    kikan.append(el('span', 'k', '工期'), kv);
    const box = el('div', 'cv-box gothic');
    box.append(row('工事名称', c.title), row('工事場所', c.place), kikan, row('取引方法', c.pay), row('見積有効期限', ymd(c.exp)));
    return sheet([el('div', 'cv-date gothic', ymd(c.date) || ' '), el('div', 'cv-h1', '御見積書'), el('div', 'cv-to', c.to || ''), el('div', 'cv-sama', '様'),
      lead, amt, sub, box, coBlock(org)]);
  }
  // .tk-sheet の配列（表紙・総括表・内訳書…・一般管理費）
  const build = (d, caseRow, org) => plan(d).map(p => (p.kind === 'cover' ? coverSheet(d, p.totals, org) : detailSheet(p)));

  async function toBlob(opts) {
    opts = opts || {};
    if (typeof root.html2canvas !== 'function' || !root.jspdf || !root.jspdf.jsPDF) {
      throw new Error('PDFライブラリを読み込めませんでした。通信状況を確認して再読み込みしてください');
    }
    const step = (label, p) => root.ReportPdf.step(opts, label, p);
    if (typeof opts.onStep === 'function') opts.onStep('準備');
    // 撮影台: 画面外に等倍（transform を掛けると撮影寸法がずれる。hidden だと寸法ゼロで撮れない）
    const host = el('div');
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, { position: 'fixed', left: '-30000px', top: '0', width: '1140px', zIndex: '-1', pointerEvents: 'none', background: '#fff' });
    document.body.appendChild(host);
    const doc = new root.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
    const jpgs = [];
    try {
      const sheets = build((opts.estimate && opts.estimate.data) || {}, opts.caseRow, opts.org);
      await step('文字の準備', root.ReportPdf.fontsReady());
      for (let i = 0; i < sheets.length; i++) {
        host.replaceChildren(sheets[i]);
        const canvas = await step((i + 1) + 'ページ目の描画', root.html2canvas(sheets[i], { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: false, scrollX: 0, scrollY: 0 }));
        const jpg = canvas.toDataURL('image/jpeg', 0.92);
        canvas.width = canvas.height = 0;
        if (i) doc.addPage('a4', 'landscape');
        doc.addImage(jpg, 'JPEG', 0, 0, 297, 210, undefined, 'FAST'); // 'FAST' を付けないと無圧縮で 30MB
        jpgs.push(jpg);
      }
      if (typeof opts.onStep === 'function') opts.onStep('保存');
      const out = doc.output('blob');
      const blob = out.type === 'application/pdf' ? out : new Blob([out], { type: 'application/pdf' });
      if (typeof opts.onPages === 'function') opts.onPages(jpgs);
      return blob;
    } finally {
      host.remove();
    }
  }

  const api = { ROWS_PER_PAGE, plan, build, toBlob };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TeikeiPdf = api;
})(typeof window !== 'undefined' ? window : globalThis);
