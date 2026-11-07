// js/estimate-pdf.js — 見積書の紙面（A4・pt）を組み、PDF（Blob）にする。window.EstimatePdf = { toBlob, build, shrink, pagesOf, sealSplit, sealSvg, fileName }
// 寸法・文言・縮め方は移植メモ §1.9・§1.10（freee-quote-builder の invoice.html 395-515行の .pd-* と renderPaper・shrinkOverflow・hankoSvg）をそのまま写した。
// 作り方は report-pdf.js と同じ: createElement + textContent（innerHTML を使わない）・画面の外に縮めていない写しを置いて1ページずつ html2canvas → jsPDF・
//   進みの表示（opts.onStep）と段階ごとの30秒の見切り（ReportPdf.step）。罫線と社印は SVG を画像（data URL）にして置く。
// 変えたところ: 書体は端末の標準（IPA Pゴシック 6.2MB は読み込まない。字の幅が違うので縮める結果は元と少し変わる）。郵便番号・住所1・2 は住所1つ。
//   消費税の率は estimates.data.tax_rate（元は 10% で固定）。社印は orgs.seal_path の画像があればそれ、無ければ社名から作る。
// UMD: 純粋な部分（pagesOf・sealSplit・sealSvg・fileName）は node でも読める（tests/estimate-pdf.test.js）
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const EL = inNode ? require('./estimate-logic.js') : root.EstimateLogic;
  const str = v => String(v == null ? '' : v).trim();
  const num = v => Number(v) || 0;

  /* ---------- ページの分け方（INV:1979-1983） ---------- */
  const ROWS_P1 = 17, ROWS_CONT = 31;
  // 実データのある行だけを、1ページ目17行・2ページ目から31行ずつに分ける。行が0でも1ページ。keep は空でも出す行の番号（紙面の上で選んだ行）
  function pagesOf(lines, keep) {
    const items = (lines || []).filter((r, i) => EL.isRealItem(r) || i === keep);
    const out = [items.slice(0, ROWS_P1)];
    for (let i = ROWS_P1; i < items.length; i += ROWS_CONT) out.push(items.slice(i, i + ROWS_CONT));
    return out;
  }

  /* ---------- 社印（INV:1771-1817） ---------- */
  const HOJIN = ['株式会社', '有限会社', '合同会社', '合資会社', '合名会社', '一般社団法人', '一般財団法人', '医療法人', '社会福祉法人', '同族会社'];
  // 右の列から読む: 前株は right=法人格、後株は left=法人格、法人格なしは真ん中で（奇数は右を長く）
  function sealSplit(name) {
    const s = String(name || '').replace(/\s/g, '');
    if (!s) return { right: '', left: '' };
    for (const h of HOJIN) {
      if (s.startsWith(h)) return { right: h, left: s.slice(h.length) };
      if (s.endsWith(h)) return { right: s.slice(0, -h.length), left: h };
    }
    const n = Math.ceil(s.length / 2);
    return { right: s.slice(0, n), left: s.slice(n) };
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // 1列: 枠の内側 y=7〜91 を字数で等分（字は1マスの0.9倍・21まで）。上限で余った分は上下中央へ。約物は0.8倍
  function sealCol(chars, x) {
    const n = chars.length;
    if (!n) return '';
    const stepY = Math.min(84 / n, 21 / 0.9), size = stepY * 0.9, top = 7 + (84 - stepY * n) / 2;
    return chars.map((c, i) => `<text x="${x}" y="${(top + stepY * (i + 1)).toFixed(1)}" font-size="${(/[・･.,\-ー–—]/.test(c) ? size * 0.8 : size).toFixed(1)}">${esc(c)}</text>`).join('');
  }
  function sealSvg(name) {
    const { right, left } = sealSplit(name);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 100 100">' +
      '<rect x="5" y="5" width="90" height="90" rx="7" fill="none" stroke="#c2202a" stroke-width="4"/>' +
      `<g fill="#c2202a" font-family="'Hiragino Mincho ProN','Hiragino Mincho Pro','Yu Mincho',serif" font-weight="700" text-anchor="middle">` +
      sealCol(Array.from(left), 35) + sealCol(Array.from(right), 71) + '</g></svg>';
  }

  /* ---------- ファイル名（INV:2322） ---------- */
  const fileName = subject => { const s = str(subject).replace(/[\\/:*?"<>|\r\n\t]+/g, ''); return s ? '見積書_' + s + '.pdf' : '見積書.pdf'; };

  const api = { ROWS_P1, ROWS_CONT, pagesOf, sealSplit, sealSvg, fileName };
  if (inNode) { module.exports = api; return; }

  /* ========== ここから下はブラウザだけ ========== */
  const SCALE = 3; // 0.27pt の罫線が約1px になる（移植メモ §5.9）
  const PX = 96 / 72;
  const PAGE_W = 595.28, PAGE_H = 841.89, L = 42.5, R = 552.7, ROW = 18;
  const fmt = n => Math.round(num(n)).toLocaleString('ja-JP');
  const svgUrl = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);

  const CSS = `
.pd-page,.pd-page *{box-sizing:border-box;font-weight:400;}
.pd-page{position:relative;width:595.28pt;height:841.89pt;background:#fff;color:#000;font-family:"IPAPGothic","Hiragino Sans","Yu Gothic",sans-serif;font-size:9pt;line-height:1;overflow:hidden;text-align:left;}
.pd-page>*{position:absolute;}
.pd-page table{border-collapse:collapse;table-layout:fixed;}
.pd-page td,.pd-page th{padding:0;border:0;vertical-align:middle;background:transparent;text-align:center;}
.pd-rules{left:0;top:0;width:595.28pt;height:841.89pt;display:block;}
.pd-title{left:0;right:0;top:42.5pt;text-align:center;font-size:16pt;}
.pd-client{left:42.5pt;top:100pt;font-size:14pt;white-space:nowrap;}
.pd-client .hon{margin-left:3.8pt;}
.pd-meta{left:360pt;top:101pt;width:192.7pt;}
.pd-meta td{height:16pt;vertical-align:top;white-space:nowrap;text-align:left;}
.pd-meta td.v{text-align:right;}
.pd-co-name{left:360pt;top:190pt;width:192.7pt;font-size:12pt;}
.pd-co-body{left:360pt;top:208.45pt;width:192.7pt;line-height:12.7pt;}
.pd-hanko{left:493pt;top:190pt;width:60pt;height:60pt;display:block;}
.pd-greeting{left:42.5pt;top:237pt;}
.pd-subject-l{left:42.5pt;top:255pt;font-size:12pt;}
.pd-subject-v{left:78.5pt;top:255pt;width:258pt;height:28pt;font-size:12pt;line-height:14pt;overflow:hidden;overflow-wrap:anywhere;word-break:break-all;}
.pd-summary{left:42.5pt;top:287.6pt;width:294pt;}
.pd-summary th{height:18pt;}
.pd-summary td{height:25.3pt;text-align:right;padding-right:4pt;}
.pd-summary td.total{font-size:16pt;}
.pd-items{left:42.5pt;top:353.6pt;width:510.2pt;}
.pd-items.cont{top:101.6pt;}
.pd-items th,.pd-items td{height:18pt;padding:0 4pt;white-space:nowrap;overflow:hidden;}
.pd-items td.c-desc{text-align:left;}
.pd-items td.c-desc .fit{overflow:hidden;white-space:nowrap;}
.pd-items td.c-desc.two .fit{line-height:10pt;}
.pd-items td.c-desc.two .fit-sub{line-height:7.5pt;font-size:6.5pt;color:#444;overflow:hidden;white-space:nowrap;}
.pd-items td.c-desc .fit-sub.only{font-size:6.5pt;color:#444;overflow:hidden;white-space:nowrap;}
.pd-items td.c-qty{text-align:right;padding-right:18pt;}
.pd-items td.c-price,.pd-items td.c-amt{text-align:right;}
.pd-bd{left:336.5pt;top:696.9pt;width:216.2pt;}
.pd-bd td{vertical-align:top;padding-top:4pt;text-align:left;}
.pd-bd .r1 td{height:16pt;}
.pd-bd .r2 td{height:14.4pt;font-size:6pt;}
.pd-bd td.num{text-align:right;padding-right:4.7pt;}
.pd-notes{left:42.5pt;top:737.3pt;width:510.2pt;height:62pt;padding:4pt 16pt;overflow:hidden;}
.pd-notes-b{margin-top:3pt;height:42pt;line-height:12.9pt;white-space:pre-wrap;overflow:hidden;}
.pd-pageno{left:0;right:0;top:812pt;text-align:center;}
.pd-run-l{left:42.5pt;top:42.5pt;width:290pt;white-space:nowrap;overflow:hidden;}
.pd-run-r{left:342.5pt;top:42.5pt;width:210.2pt;text-align:right;white-space:nowrap;}
.pd-page .sel{outline:1.5pt solid #7aa7e8;outline-offset:-1pt;background:rgba(30,91,184,.08);}
.capturing [data-line],.capturing [data-field]{outline:none;background:transparent;}
`;
  function injectCss() {
    if (document.getElementById('pd-style')) return;
    const s = document.createElement('style');
    s.id = 'pd-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = String(text);
    return e;
  }
  function img(cls, src, fallback) {
    const i = document.createElement('img');
    i.className = cls;
    i.alt = '';
    if (/^https?:/i.test(src)) i.crossOrigin = 'anonymous'; // html2canvas useCORS 用
    if (fallback) i.dataset.fallback = fallback;
    i.src = src;
    return i;
  }
  // 表: widths は pt。head は見出しの文字の配列（無ければ null）、rows は [[td, …], …]（td は el('td', …)）
  function table(cls, widths, head, rows) {
    const t = el('table', cls);
    const cg = el('colgroup');
    widths.forEach(w => { const c = el('col'); c.style.width = w + 'pt'; cg.appendChild(c); });
    t.appendChild(cg);
    if (head) { const th = el('thead'), tr = el('tr'); head.forEach(h => tr.appendChild(el('th', null, h))); th.appendChild(tr); t.appendChild(th); }
    const tb = el('tbody');
    rows.forEach(r => { const tr = el('tr', r.cls); r.cells.forEach(c => tr.appendChild(c)); tb.appendChild(tr); });
    t.appendChild(tb);
    return t;
  }

  // 罫線（INV:1985-2004）: 線の中心に置いた rect の塗り。各部品は四辺＋縦線 vs＋横線 hs。viewBox は紙の pt
  function rules(parts) {
    const out = [];
    const box = (x, y, w, h) => out.push(`<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${w.toFixed(3)}" height="${h.toFixed(3)}"/>`);
    const H = (x0, x1, y, w) => box(x0 - w / 2, y - w / 2, x1 - x0 + w, w);
    const V = (x, y0, y1, w) => box(x - w / 2, y0 - w / 2, w, y1 - y0 + w);
    parts.forEach(p => {
      const w = p.w || 0.27;
      H(p.x0, p.x1, p.y0, w); H(p.x0, p.x1, p.y1, w);
      V(p.x0, p.y0, p.y1, w); V(p.x1, p.y0, p.y1, w);
      (p.vs || []).forEach(x => V(x, p.y0, p.y1, w));
      (p.hs || []).forEach(y => H(p.x0, p.x1, y, w));
    });
    // 画像の元の大きさを撮る倍率に合わせる（小さいまま描いて引き伸ばすと細い線がぼける）
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(PAGE_W * PX * SCALE).toFixed(1)}" height="${(PAGE_H * PX * SCALE).toFixed(1)}" viewBox="0 0 ${PAGE_W} ${PAGE_H}"><g fill="#000">${out.join('')}</g></svg>`;
    return img('pd-rules', svgUrl(svg));
  }
  const itemRules = (top, n) => {
    const hs = [];
    for (let k = 1; k <= n; k++) hs.push(top + ROW * k);
    return { x0: L, x1: R, y0: top, y1: top + ROW * (n + 1), vs: [336.5, 398.0, 466.0], hs };
  };

  // 明細の1行。金額と単価が両方0の行は摘要だけ（INV:2040-2054）
  function itemCells(r) {
    const d = el('td', 'c-desc');
    if (!r) return [d, el('td', 'c-qty'), el('td', 'c-price'), el('td', 'c-amt')];
    const main = str(r.description), sub = str(r.detail);
    if (main) {
      d.appendChild(el('div', 'fit', main));
      if (sub) { d.classList.add('two'); d.appendChild(el('div', 'fit-sub', sub)); }
    } else d.appendChild(el('div', 'fit-sub only', sub));
    const zero = !num(r.amount) && !num(r.unit_price);
    return [d, el('td', 'c-qty', zero ? '' : String(r.quantity == null ? '' : r.quantity) + ' ' + str(r.unit)),
      el('td', 'c-price', zero ? '' : fmt(EL.unitPriceOf(r))), el('td', 'c-amt', zero ? '' : fmt(r.amount))];
  }
  // lineNo(r) は画面用（forScreen）のときだけ: 行の番号を data-line に（空いている行は new）、各セルに data-cell
  const CELLS = ['description', 'quantity', 'unit_price', 'amount'];
  function itemsTable(rows, cap, cont, lineNo) {
    const body = [];
    for (let k = 0; k < cap; k++) body.push({ cells: itemCells(rows[k]) });
    const t = table('pd-items' + (cont ? ' cont' : ''), [294, 61.5, 68, 86.7], ['摘要', '数量', '単価', '明細金額'], body);
    if (lineNo) t.querySelectorAll('tbody tr').forEach((tr, k) => {
      tr.dataset.line = rows[k] ? lineNo(rows[k]) : 'new';
      tr.querySelectorAll('td').forEach((td, j) => { td.dataset.cell = CELLS[j]; });
    });
    return t;
  }

  // 紙面（.pd-page の配列。画面に置く前の DOM）。o: { estimate: estimates の行, org, sealUrl, forScreen, keep }
  //   forScreen: 紙面の上で直す画面（EstimateSheetUi）用に data-line・data-cell・data-field の印を付ける（見た目は変えない）。keep は空でも出す行の番号
  function build(o) {
    injectCss();
    const est = o.estimate || {}, d = est.data || {}, c = d.company || {};
    const lines = d.lines || [];
    const chunks = pagesOf(lines, o.forScreen ? o.keep : undefined);
    const mark = (e, f) => { if (o.forScreen) e.dataset.field = f; return e; };
    const N = chunks.length;
    const rate = num(d.tax_rate);
    const t = EL.totals(d.lines || [], rate);
    const pct = Math.round(rate * 1000) / 10 + '%';
    const subject = str(d.subject), invNo = str(est.number);
    const td = (cls, text) => el('td', cls, text);
    return chunks.map((rows, i) => {
      const first = i === 0, last = i === N - 1;
      const page = el('div', 'pd-page');
      const parts = [];
      if (first) parts.push({ x0: L, x1: 336.5, y0: 287.6, y1: 330.9, vs: [128.5, 202.0], hs: [305.6] }); // 合計
      parts.push(itemRules(first ? 353.6 : 101.6, first ? ROWS_P1 : ROWS_CONT));
      if (last) {
        parts.push({ x0: 336.5, x1: R, y0: 696.9, y1: 727.3 }); // 内訳
        parts.push({ x0: L, x1: R, y0: 737.3, y1: 799.3, w: 0.45 }); // 備考
      }
      page.appendChild(rules(parts));
      if (first) {
        page.appendChild(el('div', 'pd-title', '見積書'));
        const cl = el('div', 'pd-client');
        cl.append(el('span', null, str(d.client) || '　'), el('span', 'hon', str(d.honorific) || '御中'));
        page.appendChild(mark(cl, 'client'));
        page.appendChild(table('pd-meta', [96.35, 96.35], null,
          [['見積日', d.date], ['見積書番号', invNo], ['有効期限', d.due], ['登録番号', c.registration_number]].map(([k, v]) => ({ cells: [td(null, k), td('v', str(v))] }))));
        page.appendChild(el('div', 'pd-co-name', str(c.name)));
        const co = el('div', 'pd-co-body');
        co.append(el('div', null, '営業担当：' + (str(d.manager) || str(c.manager))), el('div', null, str(c.address)), el('div', null, str(c.tel)));
        page.appendChild(co);
        const seal = svgUrl(sealSvg(c.name));
        if (str(o.sealUrl)) page.appendChild(img('pd-hanko', str(o.sealUrl), seal));
        else if (str(c.name)) page.appendChild(img('pd-hanko', seal));
        page.appendChild(el('div', 'pd-greeting', '下記の通りお見積り申し上げます。'));
        page.appendChild(el('div', 'pd-subject-l', '件名'));
        page.appendChild(mark(el('div', 'pd-subject-v', subject || '　'), 'subject'));
        page.appendChild(mark(table('pd-summary', [86, 73.5, 134.5], ['小計', '消費税', '見積金額'],
          [{ cells: [td(null, fmt(t.subtotal) + '円'), td(null, fmt(t.tax) + '円'), td('total', fmt(t.total) + '円')] }]), 'totals'));
      } else {
        page.appendChild(el('div', 'pd-run-l', '件名　' + subject));
        page.appendChild(el('div', 'pd-run-r', '見積書番号　' + invNo));
      }
      page.appendChild(itemsTable(rows, first ? ROWS_P1 : ROWS_CONT, !first, o.forScreen ? r => String(lines.indexOf(r)) : null));
      if (last) {
        page.appendChild(table('pd-bd', [34.5, 100, 81.7], null, [
          { cls: 'r1', cells: [td(null, '内訳'), td(null, pct + '対象(税抜)'), td('num', fmt(t.subtotal) + '円')] },
          { cls: 'r2', cells: [td(null, ''), td(null, pct + '消費税'), td('num', fmt(t.tax) + '円')] }]));
        const nt = el('div', 'pd-notes');
        nt.append(el('div', null, '備考'), mark(el('div', 'pd-notes-b', EL.notesText(d)), 'notes_extra'));
        page.appendChild(nt);
      }
      page.appendChild(el('div', 'pd-pageno', (i + 1) + ' / ' + N));
      return page;
    });
  }

  // あふれたら縮める（INV:2158-2205。切り捨てはしない）。画面に置き、書体の準備ができてから呼ぶ。同じ文字の結果はとっておく
  const fitCache = new Map();
  function shrinkLine(e, key, from, min) {
    if (!e.textContent) return;
    if (fitCache.has(key)) { e.style.fontSize = fitCache.get(key); return; }
    let fs = from;
    e.style.fontSize = '';
    while (e.scrollWidth > e.clientWidth && fs > min) { fs -= 0.25; e.style.fontSize = fs + 'pt'; }
    fitCache.set(key, e.style.fontSize);
  }
  function shrink(page) {
    page.querySelectorAll('.pd-items .fit').forEach(e => shrinkLine(e, e.textContent, 9, 5.5));
    page.querySelectorAll('.pd-items .fit-sub').forEach(e => shrinkLine(e, 'sub:' + e.textContent, 6.5, 4));
    page.querySelectorAll('.pd-subject-v').forEach(e => {
      let fs = 12, lh = 14;
      while (e.scrollHeight > e.clientHeight && fs > 7) { fs -= 0.5; lh -= 0.5; e.style.fontSize = fs + 'pt'; e.style.lineHeight = lh + 'pt'; }
    });
    // 備考: 先に行送りを字の1.15倍まで詰め、それでも入らなければ字を小さくする
    page.querySelectorAll('.pd-notes-b').forEach(e => {
      let fs = 9, lh = 12.9;
      while (e.scrollHeight > e.clientHeight && lh > fs * 1.15) { lh = Math.max(fs * 1.15, lh - 0.3); e.style.lineHeight = lh + 'pt'; }
      while (e.scrollHeight > e.clientHeight && fs > 5.5) { fs -= 0.5; lh = fs * 1.15; e.style.fontSize = fs + 'pt'; e.style.lineHeight = lh + 'pt'; }
    });
  }

  // 画像（罫線・社印）の読み込み待ち。社印の画像が読めなければ社名から作った印に替える
  const loaded = i => new Promise(res => {
    if (i.complete) return res(!!i.naturalWidth);
    i.addEventListener('load', () => res(true), { once: true });
    i.addEventListener('error', () => res(false), { once: true });
  });
  async function waitImages(page) {
    for (const i of page.querySelectorAll('img')) {
      if (await loaded(i)) continue;
      if (i.dataset.fallback) { i.src = i.dataset.fallback; delete i.dataset.fallback; if (await loaded(i)) continue; }
      i.remove();
    }
    // 社印の画像は縦横の比を保って 60pt の枠の中央へ（html2canvas は object-fit を描かない）
    page.querySelectorAll('.pd-hanko').forEach(i => {
      const r = Math.min(60 / i.naturalWidth, 60 / i.naturalHeight), w = i.naturalWidth * r, h = i.naturalHeight * r;
      Object.assign(i.style, { width: w + 'pt', height: h + 'pt', left: 493 + (60 - w) / 2 + 'pt', top: 190 + (60 - h) / 2 + 'pt' });
    });
  }

  // PDF（Blob）。opts: { estimate, org, sealUrl, onStep(段階), onPages(jpegDataUrl の配列) }（onPages はプレビューの画像に使う）
  async function toBlob(opts) {
    opts = opts || {};
    if (typeof window.html2canvas !== 'function' || !window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('PDFライブラリを読み込めませんでした。通信状況を確認して再読み込みしてください');
    }
    const step = (label, p) => window.ReportPdf.step(opts, label, p);
    if (typeof opts.onStep === 'function') opts.onStep('準備');
    injectCss();
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.className = 'capturing';
    Object.assign(host.style, { position: 'absolute', left: '-10000px', top: '0', width: PAGE_W + 'pt', zIndex: '-1', pointerEvents: 'none' });
    document.body.appendChild(host);
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const jpgs = [];
    try {
      await step('文字の準備', window.ReportPdf.fontsReady());
      const pages = build(opts);
      for (let i = 0; i < pages.length; i++) {
        const no = i + 1;
        host.replaceChildren(pages[i]);
        await step(no + 'ページ目の画像の読み込み', waitImages(pages[i]));
        shrink(pages[i]);
        const canvas = await step(no + 'ページ目の描画', window.html2canvas(pages[i], { scale: SCALE, useCORS: true, allowTaint: false, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0 }));
        const jpg = canvas.toDataURL('image/jpeg', 0.92);
        canvas.width = canvas.height = 0;
        if (i) doc.addPage('a4', 'portrait');
        doc.addImage(jpg, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
        jpgs.push(jpg);
        host.replaceChildren();
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

  root.EstimatePdf = Object.assign(api, { build, shrink, toBlob });
})(typeof window !== 'undefined' ? window : globalThis);
