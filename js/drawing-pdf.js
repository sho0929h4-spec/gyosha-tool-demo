// js/drawing-pdf.js — 図面の PDF（A4。向きと置き場は DrawingLogic.fitPage）。window.DrawingPdf = { toBlob }。読むのは現場を見ていないオーナー
// html2canvas は使わず canvas に自分で描く: 全体図 → 印（割合を px に戻す。見た目は部位ごと＝床は薄い塗り・天井は斜線・壁は太いふち。図の上は丸数字だけ）→ 図の横に一覧（① 居室 天井 クロス 20㎡。入りきらなければ続きのページ）
// → 違う部位が重なる所があれば、部位ごとの小さい図（天井だけ・壁だけ・床だけ。下の図は薄くする）→ 下の帯 18mm（物件名 号室・日付・凡例）
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

  // 白ふちの文字
  function label(g, text, x, y, color, align, fontPx) {
    g.font = '700 ' + fontPx + 'px ' + FONT;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = fontPx / 4;
    g.strokeStyle = '#fff';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }
  // 丸数字（図の上・凡例の下の表で同じ番号）
  function badge(g, n, cx, cy, r, color) {
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = color; g.fill();
    g.lineWidth = r / 6; g.strokeStyle = '#fff'; g.stroke();
    g.font = '700 ' + r * 1.2 + 'px ' + FONT;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.fillText(String(n), cx, cy + r * 0.05);
  }
  // 今の道（path）の中に 45 度の斜線を引く（gap px おき）
  function hatch(g, box, gap, color, lineW) {
    g.save();
    g.clip();
    g.beginPath();
    for (let d = -box.h; d < box.w + gap; d += gap) { g.moveTo(box.x + d, box.y + box.h); g.lineTo(box.x + d + box.h, box.y); }
    g.strokeStyle = color; g.lineWidth = lineW; g.stroke();
    g.restore();
  }
  // 印を描く。map(p) は割合 → canvas の px。見た目は部位ごと（画面と同じ）: 床 = 薄い塗り、天井 = 斜線＋点線のふち、壁 = 太いふち（中は塗らない）。線の印は太い線
  // nums = Map(id → 番号。全体の並びの番号)、size = 図の大きさ px（丸数字が重ならない位置を決める）
  function drawMarks(g, marks, map, fontPx, lineW, nums, size) {
    const DL = window.DrawingLogic;
    const r = fontPx * 0.8, pos = DL.badgePos(marks, size, r), [ox, oy] = map({ x: 0, y: 0 });
    marks.forEach(m => {
      const color = DL.PARTS[m.part].color;
      if (m.type === 'text') { const [x, y] = map(m.points[0]); label(g, m.label, x, y, color, 'center', fontPx); return; }
      const look = m.type === 'line' ? 'edge' : DL.PARTS[m.part].look;
      const pts = (m.type === 'rect' ? (b => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }])(DL.bbox(m.points)) : m.points).map(map);
      const path = () => { g.beginPath(); pts.forEach(([x, y], i) => { if (i) g.lineTo(x, y); else g.moveTo(x, y); }); if (m.type !== 'line') g.closePath(); };
      g.lineJoin = 'round';
      g.strokeStyle = color;
      if (look === 'fill') {
        path(); g.globalAlpha = 0.2; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
        g.lineWidth = lineW; g.stroke();
      } else if (look === 'hatch') {
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        path();
        hatch(g, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, fontPx * 0.85, color, lineW * 0.8);
        path(); g.setLineDash([lineW * 3, lineW * 2]); g.lineWidth = lineW; g.stroke(); g.setLineDash([]);
      } else {
        path(); g.lineCap = 'round'; g.lineWidth = lineW * 2.5; g.stroke(); g.lineCap = 'butt';
      }
    });
    // 丸数字は最後にまとめて（範囲の線の下に隠れない）。文字は図の横の一覧に出す
    marks.forEach(m => { const p = pos.get(m.id); if (p) badge(g, nums.get(m.id), ox + p[0], oy + p[1], r, DL.PARTS[m.part].color); });
  }
  // 色の見本（凡例）: 部位の見た目と同じ
  function swatch(g, x, y, sq, part) {
    const DL = window.DrawingLogic, c = DL.PARTS[part].color, look = DL.PARTS[part].look, K = PX_MM;
    g.strokeStyle = c;
    if (look === 'fill') { g.globalAlpha = 0.25; g.fillStyle = c; g.fillRect(x, y, sq, sq); g.globalAlpha = 1; g.lineWidth = LINE_MM * K; g.strokeRect(x, y, sq, sq); }
    else if (look === 'hatch') { g.beginPath(); g.rect(x, y, sq, sq); hatch(g, { x, y, w: sq, h: sq }, sq / 3, c, LINE_MM * K * 0.7); g.lineWidth = LINE_MM * K; g.strokeRect(x, y, sq, sq); }
    else { g.lineWidth = LINE_MM * K * 2.5; g.strokeRect(x + LINE_MM * K, y + LINE_MM * K, sq - LINE_MM * K * 2, sq - LINE_MM * K * 2); }
  }

  // 下の帯: 1行目「物件名 号室 ・ 日付」、2行目 凡例（見本＋部位名＋材料ごとの数量の合計）
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
    let x = x0;
    const y = y0 + 13 * K, sq = 4 * K;
    legend.forEach(l => {
      swatch(g, x, y - sq / 2, sq, l.part);
      g.fillStyle = '#222';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = (3.6 * K) + 'px ' + FONT;
      const t = [l.label, l.total].filter(Boolean).join(' '); // 「床 CF 12.5㎡、フローリング 8㎡」
      const room = x0 + w - (x + sq + 1.5 * K);
      g.fillText(t, x + sq + 1.5 * K, y, Math.max(room, 10 * K)); // 入りきらない分は横に詰める（細かい数字は下の表にある）
      x += sq + 1.5 * K + Math.min(g.measureText(t).width, room) + 6 * K;
    });
  }
  // 図の横の一覧: 見出し「工事する所」＋番号の丸＋「居室 天井 クロス 20㎡」（長ければ2行。fit は DrawingLogic.sideRows）
  function drawSide(g, box, fit) {
    const DL = window.DrawingLogic, K = PX_MM, S = DL.SIDE, x0 = box.x * K, y0 = box.y * K, r = 1.9 * K;
    g.fillStyle = '#222';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '700 ' + (3.8 * K) + 'px ' + FONT;
    g.fillText('工事する所', x0, y0 + 2.5 * K, box.w * K);
    g.strokeStyle = '#999';
    g.lineWidth = 0.3 * K;
    g.beginPath(); g.moveTo(x0, y0 + 5.5 * K); g.lineTo(x0 + box.w * K, y0 + 5.5 * K); g.stroke();
    fit.forEach(f => {
      const y = y0 + f.y * K + S.line * K / 2;
      badge(g, f.row.n, x0 + r, y, r, DL.PARTS[f.row.part].color);
      g.fillStyle = '#222';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = (3.4 * K) + 'px ' + FONT;
      f.lines.forEach((t, i) => g.fillText(t, x0 + r * 2 + 1.5 * K, y + i * S.line * K, box.w * K - r * 2 - 1.5 * K));
    });
  }
  // 続きのページの表（2列。番号の丸＋「居室 床 CF 12.5㎡」）。rows を perCol 行ずつ左の列から
  function drawTable(g, box, rows, perCol) {
    const DL = window.DrawingLogic, K = PX_MM, colW = box.w * K / 2, rowH = DL.ROW * K, r = 1.9 * K;
    rows.forEach((row, i) => {
      const x = box.x * K + Math.floor(i / perCol) * colW, y = box.y * K + 1 * K + (i % perCol) * rowH + rowH / 2;
      badge(g, row.n, x + r, y, r, DL.PARTS[row.part].color);
      g.fillStyle = '#222';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = (3.4 * K) + 'px ' + FONT;
      g.fillText(DL.rowText(row), x + r * 2 + 2 * K, y, colW - r * 2 - 5 * K);
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
    const marks = DL.normalize(opts.drawing && opts.drawing.marks);
    const rows = DL.rows(marks), nums = new Map(rows.map(r => [r.id, r.n]));
    // 違う部位が重なる所があるときだけ、使っている部位ごとの小さい図を足す
    const L = DL.fitPage(img.naturalWidth, img.naturalHeight, DL.overlaps(marks) ? DL.legend(marks).map(l => l.part) : []);
    const side = DL.sideRows(rows, L.side.h);
    const K = PX_MM;
    const title = [window.CaseLogic.placeName(opts.caseRow || {}), window.ReportLogic.todayJa(new Date())].filter(Boolean).join(' ・ ');
    const c = document.createElement('canvas');
    c.width = Math.round(L.pageW * K);
    c.height = Math.round(L.pageH * K);
    const g = c.getContext('2d');
    const blank = () => { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); };
    blank();
    // 図と印を box（mm）に描く。fade = 下の図を薄くする（小さい図は印を目立たせる）
    const plan = (box, ms, fontMm, fade) => {
      const ix = box.x * K, iy = box.y * K, iw = box.w * K, ih = box.h * K;
      g.drawImage(img, ix, iy, iw, ih);
      if (fade) { g.globalAlpha = 0.45; g.fillStyle = '#fff'; g.fillRect(ix, iy, iw, ih); g.globalAlpha = 1; }
      g.save();
      g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
      drawMarks(g, ms, p => [ix + p.x * iw, iy + p.y * ih], fontMm * K, LINE_MM * K, nums, { w: iw, h: ih });
      g.restore();
      g.strokeStyle = '#bbb'; g.lineWidth = 0.2 * K; g.strokeRect(ix, iy, iw, ih);
    };
    plan(L.img, marks, FONT_MM, false);
    drawSide(g, L.side, side.fit);
    L.minis.forEach(m => {
      const P = DL.PARTS[m.part], sq = 3.4 * K;
      swatch(g, m.x * K, m.y * K + 0.8 * K, sq, m.part);
      g.fillStyle = '#222';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = '700 ' + (3.6 * K) + 'px ' + FONT;
      g.fillText(P.label + 'だけ', m.x * K + sq + 1.5 * K, m.y * K + 0.8 * K + sq / 2, m.w * K - sq - 1.5 * K);
      plan(m.img, marks.filter(x => x.part === m.part), FONT_MM * 0.9, true);
    });
    drawBand(g, L.band, title, DL.legend(marks));
    const pages = [c.toDataURL('image/jpeg', 0.92)];
    // 横の一覧に入りきらなかった行は、続きのページに表だけで出す（行を落とさない）
    const per = L.more.perCol * 2;
    for (let i = 0; i < side.rest.length; i += per) {
      blank();
      g.fillStyle = '#222';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = '700 ' + (4.2 * K) + 'px ' + FONT;
      g.fillText(title + ' ・ 範囲の一覧（続き）', DL.MARGIN * K, (DL.MARGIN + 5) * K, (L.pageW - DL.MARGIN * 2) * K);
      drawTable(g, { x: DL.MARGIN, y: DL.MARGIN + 12, w: L.pageW - DL.MARGIN * 2 }, side.rest.slice(i, i + per), L.more.perCol);
      pages.push(c.toDataURL('image/jpeg', 0.92));
    }
    c.width = c.height = 0;
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: L.orientation });
    pages.forEach((jpeg, i) => { if (i) doc.addPage('a4', L.orientation); doc.addImage(jpeg, 'JPEG', 0, 0, L.pageW, L.pageH, undefined, 'FAST'); });
    if (typeof opts.onStep === 'function') opts.onStep('保存');
    const out = doc.output('blob');
    const blob = out.type === 'application/pdf' ? out : new Blob([out], { type: 'application/pdf' });
    if (typeof opts.onPages === 'function') opts.onPages(pages);
    return blob;
  }

  window.DrawingPdf = { toBlob };
})();
