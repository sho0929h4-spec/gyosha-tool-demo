// js/daily-pdf.js — 日報の紙面（A4縦1枚。工事掲示と同じ .sheet。文字は端末のゴシック）を組み、PDF（Blob）にする。window.DailyPdf = { build, toBlob }
//   撮り方・1ページに入れる決まり（--scale を 0.8 まで下げる）は NoticePdf と同じ（NoticePdf.sheetBlob・fit）
// 依存: DailyLogic・NoticePdf
(function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const TOO_LONG = '申し送りが長すぎて1ページに収まりません';

  // data（daily_reports の行）→ { sheet, inner }
  function build(data, org) {
    const d = data || {};
    const sheet = el('div', 'sheet daily');
    const inner = el('div', 'sheet-inner');
    sheet.appendChild(inner);
    inner.append(el('div', 'dr-org', (org && org.name) || ''), el('div', 'dr-title', '日報'));
    const table = el('table', 'dr-table');
    const row = (label, td) => { const tr = el('tr'); tr.append(el('th', null, label), td); table.appendChild(tr); };
    row('日付', el('td', null, window.DailyLogic.dateJa(d.date)));
    row('担当者', el('td', null, d.author || ''));
    const sites = el('td');
    (Array.isArray(d.sites) ? d.sites : []).forEach(s => sites.appendChild(el('div', null, s.label || '')));
    row('対応現場', sites);
    row('申し送り', el('td', 'dr-notes', d.notes || ''));
    inner.appendChild(table);
    return { sheet, inner };
  }

  // opts: { daily（daily_reports の行）, org, onStep, onPages }。1ページに収まらなければ作らずに失敗
  const toBlob = opts => window.NoticePdf.sheetBlob(() => build(opts && opts.daily, opts && opts.org).sheet, opts || {},
    r => { if (r.overflow) throw new Error(TOO_LONG); });

  window.DailyPdf = { build, toBlob, TOO_LONG };
})();
