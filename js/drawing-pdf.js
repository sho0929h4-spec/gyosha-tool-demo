// js/drawing-pdf.js — 図面の PDF（A4 1枚。向きは DrawingLogic.fitPage）。window.DrawingPdf = { toBlob }
// html2canvas は使わず canvas に自分で描く: 図 → 印（割合を px に戻し、半透明の塗り＋線）→ 下の帯 18mm（物件名 号室・日付・凡例の色の四角＋部位名）
// → jsPDF addImage(JPEG, 'FAST')。依存: DrawingLogic・CaseLogic・ReportLogic（todayJa）・ReportPdf（step: 段階ごとの30秒の見切り）・jsPDF 2.5.1
(function () {
  const PX_MM = 8;              // canvas の細かさ（1mm = 8px。A4 横で 2376x1680）
  const LINE_MM = 0.53;         // 線 2px 相当
  const FONT_MM = 3.7;          // 文字 14px 相当
  const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif';

  async function loadImg(url) {
    // fetch して blob の URL にする（別の所の画像でも canvas が汚れない）
    const r = await fetch(url);
    if (!r.ok) throw new Error('図面の画像を読み込めませんでした');
    const u = URL.createObjectURL(await r.blob());
    try {
      return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('図面の画像を読み込めませんでした')); i.src = u; });
    } finally { setTimeout(() => URL.revokeObjectURL(u), 0); }
  }

  // 印を描く。map(p) は割合 → canvas の px
  function drawMarks(g, marks, map, fontPx, lineW) {
    const DL = window.DrawingLogic;
    const label = (text, x, y, color, align) => {
      g.font = '700 ' + fontPx + 'px ' + FONT;
      g.textAlign = align;
      g.textBaseline = align === 'center' ? 'middle' : 'top';
      g.lineJoin = 'round';
      g.lineWidth = fontPx / 4;
      g.strokeStyle = '#fff';
      g.strokeText(text, x, y);
      g.fillStyle = color;
      g.fillText(text, x, y);
    };
    marks.forEach(m => {
      const color = DL.PARTS[m.part].color;
      if (m.type === 'text') { const [x, y] = map(m.points[0]); label(m.label, x, y, color, 'center'); return; }
      const pts = m.type === 'rect' ? (b => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }])(DL.bbox(m.points)) : m.points;
      g.beginPath();
      pts.forEach((p, i) => { const [x, y] = map(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
      g.globalAlpha = 0.35;
      g.fillStyle = color;
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = lineW;
      g.lineJoin = 'miter';
      g.strokeStyle = color;
      g.stroke();
      const t = DL.markText(m);
      if (t) { const b = DL.bbox(m.points); const [x, y] = map({ x: b.x, y: b.y }); label(t, x + fontPx / 2, y + fontPx / 2, color, 'left'); }
    });
  }

  // 下の帯: 1行目「物件名 号室 ・ 日付」、2行目 凡例（色の四角＋部位名＋数量の合計）
  function drawBand(g, band, title, legend) {
    const K = PX_MM;
    const x0 = band.x * K, y0 = band.y * K, w = band.w * K;
    g.strokeStyle = '#999';
    g.lineWidth = 0.3 * K;
    g.beginPath(); g.moveTo(x0, y0 + 1 * K); g.lineTo(x0 + w, y0 + 1 * K); g.stroke();
    g.fillStyle = '#222';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '700 ' + (4.2 * K) + 'px ' + FONT;
    g.fillText(title, x0, y0 + 6 * K, w);
    g.font = (3.6 * K) + 'px ' + FONT;
    let x = x0;
    const y = y0 + 13 * K, sq = 4 * K;
    legend.forEach(l => {
      g.globalAlpha = 0.35; g.fillStyle = l.color; g.fillRect(x, y - sq / 2, sq, sq);
      g.globalAlpha = 1; g.strokeStyle = l.color; g.lineWidth = LINE_MM * K; g.strokeRect(x, y - sq / 2, sq, sq);
      g.fillStyle = '#222';
      const t = [l.label, l.total].filter(Boolean).join(' '); // 「天井 12.5㎡・3か所」（範囲に入れた数量の合計）
      g.fillText(t, x + sq + 1.5 * K, y);
      x += sq + 1.5 * K + g.measureText(t).width + 6 * K;
    });
  }

  // opts: { drawing（drawings の行）, imgUrl, caseRow, org, onStep(段階), onPages(画像の dataURL の配列) } → Promise<Blob>
  async function toBlob(opts) {
    opts = opts || {};
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDFライブラリを読み込めませんでした。通信状況を確認して再読み込みしてください');
    if (!opts.imgUrl) throw new Error('図面の画像がありません。先に図面を取り込んでください');
    const DL = window.DrawingLogic;
    const step = (label, p) => window.ReportPdf.step(opts, label, p);
    if (typeof opts.onStep === 'function') opts.onStep('準備');
    const img = await step('図面の読み込み', loadImg(opts.imgUrl));
    await step('文字の準備', window.ReportPdf.fontsReady());
    if (typeof opts.onStep === 'function') opts.onStep('描画');
    const L = DL.fitPage(img.naturalWidth, img.naturalHeight);
    const K = PX_MM;
    const c = document.createElement('canvas');
    c.width = Math.round(L.pageW * K);
    c.height = Math.round(L.pageH * K);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    const ix = L.img.x * K, iy = L.img.y * K, iw = L.img.w * K, ih = L.img.h * K;
    g.drawImage(img, ix, iy, iw, ih);
    const marks = DL.normalize(opts.drawing && opts.drawing.marks);
    g.save();
    g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
    drawMarks(g, marks, p => [ix + p.x * iw, iy + p.y * ih], FONT_MM * K, LINE_MM * K);
    g.restore();
    drawBand(g, L.band, [window.CaseLogic.placeName(opts.caseRow || {}), window.ReportLogic.todayJa(new Date())].filter(Boolean).join(' ・ '), DL.legend(marks));
    const jpeg = c.toDataURL('image/jpeg', 0.92);
    c.width = c.height = 0;
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: L.orientation });
    doc.addImage(jpeg, 'JPEG', 0, 0, L.pageW, L.pageH, undefined, 'FAST');
    if (typeof opts.onStep === 'function') opts.onStep('保存');
    const out = doc.output('blob');
    const blob = out.type === 'application/pdf' ? out : new Blob([out], { type: 'application/pdf' });
    if (typeof opts.onPages === 'function') opts.onPages([jpeg]);
    return blob;
  }

  window.DrawingPdf = { toBlob };
})();
