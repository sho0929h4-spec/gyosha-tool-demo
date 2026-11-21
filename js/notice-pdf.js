// js/notice-pdf.js — 工事掲示の紙面（A4縦1枚。css/notice.css）を組み、PDF（Blob）にする。window.NoticePdf = { build, fit, toBlob, sheetBlob }
// 紙面の組み方は元の工事掲示PDF作成 app.js の render・setSlot・renderBodyText・renderDetailValue（移植メモ §4.4・§4.5）、PDF は §4.8 を写した:
//   .capturing を付けて html2canvas scale 3 → jsPDF A4縦 addImage(PNG, 0,0,210,297, undefined, 'FAST')（'FAST' を付けないと約30MB）。
// build は画面（NoticeUi: 縮めて見せ、直接編集する）と PDF（縮めていない写しを画面の外で撮る）で同じものを使う。
// 依存: NoticeLogic・ReportPdf（step・fontsReady）・html2canvas 1.4.1・jsPDF 2.5.1
(function () {
  const NL = () => window.NoticeLogic;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // 自動の文を data-auto に持たせ、直接編集（overrides）があればそちらを出して data-edited="1"
  function slot(node, key, autoText, overrides, renderer) {
    node.setAttribute('data-edit', key);
    node.setAttribute('data-auto', autoText);
    const edited = has(overrides, key);
    const text = edited ? overrides[key] : autoText;
    if (renderer) renderer(node, text); else node.textContent = text;
    if (edited) node.setAttribute('data-edited', '1');
    return node;
  }
  // 空の行で段落、改行で行
  function renderBody(node, text) {
    node.textContent = '';
    String(text).split(/\n{2,}/).forEach(block => {
      const p = el('p');
      block.split('\n').forEach(t => { if (t.trim()) p.appendChild(el('span', 'body-line', t)); });
      if (p.childNodes.length) node.appendChild(p);
    });
  }
  // 題: 号室（「502号室」）の所だけ強調
  function renderSubject(node, text, room) {
    node.textContent = '';
    const parts = room ? String(text).split(room) : [String(text)];
    parts.forEach((t, i) => {
      if (i) node.appendChild(el('span', 'emph', room));
      if (t) node.appendChild(document.createTextNode(t));
    });
  }
  // 1行目が値、2行目からが ※注記
  function renderDetail(node, text) {
    node.textContent = '';
    const lines = String(text).split('\n').filter(t => t.trim());
    if (!lines.length) return;
    node.appendChild(el('span', 'body-line', lines[0]));
    if (lines.length > 1) {
      const w = el('div', 'detail-notes');
      lines.slice(1).forEach(n => w.appendChild(el('span', 'detail-note', n)));
      node.appendChild(w);
    }
  }

  // data（notices.data）→ { sheet, inner }。書き換えられる所には data-edit（contenteditable は画面の側で付ける）
  function build(data, org) {
    const d = data || {};
    const c = NL().compose(d, org);
    const ov = d.overrides || {};
    const sheet = el('div', 'sheet');
    const inner = el('div', 'sheet-inner');
    sheet.appendChild(inner);

    const top = el('div', 'sheet-top');
    const addr = el('div', 'sheet-addressee', c.addressee);
    addr.setAttribute('data-edit', 'addressee'); // 入力欄へ書き戻す所（overrides にしない）
    top.append(addr, slot(el('div', 'sheet-notice-date'), 'noticeDate', c.noticeDate, ov));
    inner.append(top,
      slot(el('div', 'sheet-greeting'), 'greeting', c.greeting, ov),
      slot(el('div', 'sheet-opening'), 'opening', c.opening, ov));
    const room = NL().normalizeRoom(d.roomNo);
    const subj = slot(el('div', 'sheet-subject'), 'subject', c.subject, ov, (n, t) => renderSubject(n, t, room));
    inner.append(subj,
      slot(el('div', 'sheet-body'), 'body', c.body.map(p => p.join('\n')).join('\n\n'), ov, renderBody),
      slot(el('div', 'sheet-closing'), 'closing', c.closing, ov),
      slot(el('div', 'sheet-ki'), 'ki', c.ki, ov));

    const det = el('div', 'sheet-details');
    c.details.forEach(r => {
      const row = el('div', 'detail-row');
      const l = slot(el('div', 'detail-label'), 'detailLabel.' + r.key, r.label, ov);
      const v = slot(el('div', 'detail-value'), 'detail.' + r.key, [r.value].concat(r.notes).join('\n'), ov, renderDetail);
      if (NL().EMPHASIS.includes(r.key)) { l.classList.add('emph'); v.classList.add('emph'); }
      row.append(l, v);
      det.appendChild(row);
    });
    det.querySelectorAll('.detail-note').forEach(n => n.classList.add('emph'));
    inner.appendChild(det);

    // お問い合わせ先: 会社名・住所・電話のどれかがあるときだけ
    const k = c.contact;
    if (k.company || k.address || k.tel) {
      const box = el('div', 'sheet-contact');
      box.appendChild(slot(el('p', 'contact-title'), 'contactTitle', k.title, ov));
      [['contactCompany', k.company], ['contactAddress', k.address], ['contactTel', k.tel]].forEach(([key, v]) => {
        if (!v) return;
        const n = el('span', 'contact-line', v);
        n.setAttribute('data-edit', key);
        box.appendChild(n);
      });
      inner.appendChild(box);
    }
    return { sheet, inner };
  }

  // 1ページに入るか（移植メモ §4.7）: --scale を 0.02 ずつ 0.8 まで下げる。sheet は画面に置いてあること（縮めて見せていてもよい）
  function fit(sheet) {
    const inner = sheet.firstChild;
    const cs = getComputedStyle(sheet);
    const avail = sheet.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    let scale = 1;
    inner.style.setProperty('--scale', '1');
    while (inner.scrollHeight > avail + 1 && scale > 0.8) {
      scale = Math.round((scale - 0.02) * 100) / 100;
      inner.style.setProperty('--scale', String(scale));
    }
    return { scale, overflow: inner.scrollHeight > avail + 1 };
  }

  // 紙面を画面の外で撮って PDF（Blob）にする（工事掲示・日報）。make() = 紙面（.sheet）を作る、onFit(fit の結果) で止めるときは throw
  async function sheetBlob(make, opts, onFit) {
    if (typeof window.html2canvas !== 'function' || !window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('PDFライブラリを読み込めませんでした。通信状況を確認して再読み込みしてください');
    }
    const step = (label, p) => window.ReportPdf.step(opts, label, p);
    if (typeof opts.onStep === 'function') opts.onStep('準備');
    const host = el('div', 'capturing');
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, { position: 'absolute', left: '-10000px', top: '0', width: '210mm', zIndex: '-1', pointerEvents: 'none' });
    document.body.appendChild(host);
    try {
      const sheet = make();
      host.appendChild(sheet);
      await step('文字の準備', window.ReportPdf.fontsReady());
      const r = fit(sheet);
      if (onFit) onFit(r);
      const canvas = await step('描画', window.html2canvas(sheet, { scale: 3, backgroundColor: '#ffffff', logging: false, useCORS: false, scrollX: 0, scrollY: 0 }));
      const png = canvas.toDataURL('image/png');
      canvas.width = canvas.height = 0;
      const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      doc.addImage(png, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
      if (typeof opts.onStep === 'function') opts.onStep('保存');
      const out = doc.output('blob');
      const blob = out.type === 'application/pdf' ? out : new Blob([out], { type: 'application/pdf' });
      if (typeof opts.onPages === 'function') opts.onPages([png]);
      return blob;
    } finally {
      host.remove();
    }
  }
  // PDF（Blob）。opts: { notice（notices の行）, org, onStep(段階), onPages(画像の dataURL の配列) }（onPages はプレビューの画像に使う）
  const toBlob = opts => { opts = opts || {}; return sheetBlob(() => build((opts.notice && opts.notice.data) || {}, opts.org).sheet, opts); };

  window.NoticePdf = { build, fit, toBlob, sheetBlob };
})();
