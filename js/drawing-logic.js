// js/drawing-logic.js — 図面の規則（UMD: ブラウザは window.DrawingLogic / node は module.exports。tests/drawing-logic.test.js）。DOM に触らない
// 印の形（drawings.marks）: [{ id, type: 'rect'|'poly'|'line'|'text', part: 'ceiling'|'wall'|'floor', points: [{ x, y }], label }]
//   points は図の幅・高さに対する 0〜1 の割合。四角は対角の2点、多角形は3点以上、線（壁沿いなど。閉じない折れ線）は2点以上、文字は1点（label が中身）。四角・多角形・線は数量 qty・単位 unit も持てる。
//   見た目（look）は部位ごとに変える（床と天井を重ねても読めるように。色だけに頼らない）: 床 = 薄い塗り、天井 = 斜線、壁 = ふちの太い線（中は塗らない）。
//   四角・多角形・線には並びの順に番号が付く（図の上は丸数字だけ。文字は画面では下の一覧、PDF では図の横の一覧に「① 居室 天井 クロス 20㎡」）。場所 place（居室・廊下など）も持てる。
//   PDF（読むのは現場を見ていないオーナー）: 全体図＋横に一覧。違う部位が重なる所があれば、部位ごとの小さい図（天井だけ・壁だけ・床だけ）を下に足す（fitPage・overlaps）。
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const CL = () => (inNode ? require('./case-logic.js') : root.CaseLogic);
  const str = v => String(v == null ? '' : v).trim();
  const PARTS = { ceiling: { label: '天井', color: '#1e5bb8', look: 'hatch' }, wall: { label: '壁', color: '#d97b1c', look: 'edge' }, floor: { label: '床', color: '#2e8b57', look: 'fill' } };
  const ORDER = ['ceiling', 'wall', 'floor'];
  const MIN_POINTS = { rect: 2, poly: 3, line: 2, text: 1 };
  const TYPE_LABEL = { rect: '四角', poly: '多角形', line: '線', text: '文字' };
  const LINE_HIT = 14; // 線の当たり判定（表示の px。線からこの距離まで）
  const LABEL_MAX = 40;
  const TEXT_BOX = 24; // 文字の当たり判定（表示の px の正方形）
  const PLACE_MAX = 20;
  const PLACES = ['居室', '廊下', 'キッチン', '洗面所', 'トイレ', '浴室', '玄関', '和室']; // 場所の候補（自由にも書ける）
  // mm。ROW = 続きのページの表の1行、SIDE = 図の横の一覧（幅・見出し・1行の高さ・行の間・1行に入る全角の字数）、GAP = 図と一覧・小さい図の間、MINI_CAP = 小さい図の見出し
  const A4 = { w: 210, h: 297 }, MARGIN = 10, BAND = 18, ROW = 5, GAP = 4, MINI_CAP = 6;
  const SIDE = { w: 64, head: 7, line: 4.6, pad: 1.8, units: 16 };

  const fin = v => typeof v === 'number' && isFinite(v);
  const clamp01 = v => Math.min(1, Math.max(0, v));
  let seq = 0;
  const newMarkId = () => 'm' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

  // 壊れた印を落とす（形・部位が分からない・点が足りない・中身の無い文字）
  function normalize(marks) {
    return (Array.isArray(marks) ? marks : []).flatMap(m => {
      if (!m || !MIN_POINTS[m.type] || !PARTS[m.part] || !Array.isArray(m.points)) return [];
      const points = m.points.filter(p => p && fin(p.x) && fin(p.y)).map(p => ({ x: clamp01(p.x), y: clamp01(p.y) }));
      const label = str(m.label).slice(0, LABEL_MAX), place = m.type === 'text' ? '' : str(m.place).slice(0, PLACE_MAX);
      if (points.length < MIN_POINTS[m.type] || (m.type === 'text' && !label)) return [];
      const qty = m.type === 'text' ? '' : cleanQty(m.qty);
      return [Object.assign({ id: str(m.id) || newMarkId(), type: m.type, part: m.part, points: m.type === 'rect' ? points.slice(0, 2) : m.type === 'text' ? points.slice(0, 1) : points, label },
        place ? { place } : {}, qty ? { qty, unit: UNITS.includes(m.unit) ? m.unit : UNITS[0] } : {})];
    });
  }

  // 範囲の数量（四角・多角形・線。文字の印には付けない）: qty = '12.5'（半角の数字。小数は2桁まで）、unit = UNITS のどれか。数量が無ければ両方持たない
  const UNITS = ['㎡', 'm', 'か所', '枚', '本', '式'];
  function cleanQty(v) {
    const t = str(v).replace(/[０-９．]/g, c => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0)));
    return /^\d{1,7}(\.\d{1,2})?$/.test(t) && Number(t) > 0 ? String(Number(t)) : '';
  }
  // 図の上・選んだ印の説明に出す文字: 「クロス張替 12.5㎡」
  const markText = m => [m.label, m.qty ? m.qty + m.unit : ''].filter(Boolean).join(' ');

  // 凡例: 使った部位だけ・天井→壁→床。count = 範囲（四角・多角形・線）の数、texts = 付けた文字のうち数量の無いもの（重ねない）、
  //   total = 数量の合計（材料ごと・単位ごと。「CF 12.5㎡、クロス 30㎡・3か所」。材料名の無い分は数字だけ）
  function legend(marks) {
    const ms = normalize(marks);
    const sum = list => UNITS.map(u => { const n = list.filter(m => m.unit === u).reduce((a, m) => a + Number(m.qty), 0); return n ? Math.round(n * 100) / 100 + u : ''; }).filter(Boolean).join('・');
    return ORDER.filter(p => ms.some(m => m.part === p)).map(p => {
      const own = ms.filter(m => m.part === p), withQty = own.filter(m => m.qty);
      const names = [...new Set(withQty.map(m => m.label))];
      return { part: p, label: PARTS[p].label, color: PARTS[p].color, look: PARTS[p].look,
        count: own.filter(m => m.type !== 'text').length, texts: [...new Set(own.map(m => m.label).filter(t => t && !names.includes(t)))],
        total: names.map(nm => [nm, sum(withQty.filter(m => m.label === nm))].filter(Boolean).join(' ')).join('、') };
    });
  }
  // 一覧の行（四角・多角形・線に並びの順の番号）: [{ n, id, part, type, place, label, qty, unit }]。図の上の丸数字・下の一覧・PDF の一覧で同じ番号を使う
  const rows = marks => normalize(marks).filter(m => m.type !== 'text').map((m, i) => ({ n: i + 1, id: m.id, part: m.part, type: m.type, place: m.place || '', label: m.label, qty: m.qty || '', unit: m.unit || '' }));
  // 一覧の1行の文字: 「居室 天井 クロス 20㎡」（場所 → 部位 → 材料 → 数量）
  const rowText = r => [r.place, PARTS[r.part].label, r.label, r.qty ? r.qty + r.unit : ''].filter(Boolean).join(' ');
  // 丸数字を置く所（割合の点）: 範囲は左上の角、線は最初の点
  const anchor = m => (m.type === 'line' ? { x: m.points[0].x, y: m.points[0].y } : (b => ({ x: b.x, y: b.y }))(bbox(m.points)));
  // 丸数字の中心（px）: Map(id → [cx, cy])。size = 図の大きさ px、r = 丸の半径 px。前に置いた丸と重なるときは右へずらす（同じ角から始まる天井・壁・床でも数字が読める）
  function badgePos(marks, size, r) {
    const out = new Map(), placed = [];
    (Array.isArray(marks) ? marks : []).filter(m => m.type !== 'text').forEach(m => {
      const a = anchor(m), inset = m.type === 'line' ? 0 : r * 1.2;
      let x = a.x * size.w + inset;
      const y = a.y * size.h + inset;
      while (placed.some(p => Math.hypot(p[0] - x, p[1] - y) < r * 2.2)) x += r * 2.3;
      placed.push([x, y]);
      out.set(m.id, [x, y]);
    });
    return out;
  }
  // 違う部位の範囲が重なっているか（四角で囲んだ大きさどうしで見る）。重なりがあれば PDF に部位ごとの小さい図を足す
  function overlaps(marks) {
    const ms = normalize(marks).filter(m => m.type !== 'text').map(m => ({ part: m.part, b: bbox(m.points) }));
    return ms.some((a, i) => ms.some((c, j) => j > i && a.part !== c.part
      && a.b.x <= c.b.x + c.b.w && c.b.x <= a.b.x + a.b.w && a.b.y <= c.b.y + c.b.h && c.b.y <= a.b.y + a.b.h));
  }
  // 一覧の文字を2行までに折る（units = 1行に入る全角の字数。半角は 0.55 字。3行目に行く分は2行目に続けて入れ、描く側が横に詰める）
  function wrap(text, units) {
    const t = str(text);
    let w = 0, i = 0;
    for (; i < t.length; i++) { w += t.charCodeAt(i) < 0x100 ? 0.55 : 1; if (w > units) break; }
    return i >= t.length ? [t] : [t.slice(0, i), t.slice(i)];
  }
  // 図の横の一覧に入る行（h = 一覧の高さ mm）: { fit: [{ row, lines, y（一覧の上からの mm） }], rest: 入りきらない行（続きのページへ） }
  function sideRows(rs, h) {
    const fit = [];
    let y = SIDE.head;
    for (let i = 0; i < rs.length; i++) {
      const lines = wrap(rowText(rs[i]), SIDE.units), rh = lines.length * SIDE.line + SIDE.pad;
      if (y + rh > h) return { fit, rest: rs.slice(i) };
      fit.push({ row: rs[i], lines, y });
      y += rh;
    }
    return { fit, rest: [] };
  }

  // 四角の範囲 { x, y, w, h }（割合）
  function bbox(points) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  // 射線法（点 p が多角形 pts の中か）
  function inPoly(pts, p) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  // 点 p と線分 a-b の距離（表示の px）
  function segDist(p, a, b, s) {
    const px = p.x * s.w, py = p.y * s.h, ax = a.x * s.w, ay = a.y * s.h, bx = b.x * s.w, by = b.y * s.h;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  }
  // 押した所の印（文字を先に、次に線、あとは上に描いた順）。pt は割合、size は今の表示の大きさ px（文字の 24px の箱と線の近さに使う）
  function hitTest(marks, pt, size) {
    const s = size || { w: 1000, h: 1000 };
    const ms = (Array.isArray(marks) ? marks : []).slice().reverse();
    const half = TEXT_BOX / 2;
    const t = ms.find(m => m.type === 'text' && m.points[0] && Math.abs((pt.x - m.points[0].x) * s.w) <= half && Math.abs((pt.y - m.points[0].y) * s.h) <= half);
    if (t) return t;
    const l = ms.find(m => m.type === 'line' && m.points.some((b, i) => i && segDist(pt, m.points[i - 1], b, s) <= LINE_HIT));
    if (l) return l;
    return ms.find(m => {
      if (m.type === 'rect' && m.points.length >= 2) { const b = bbox(m.points); return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h; }
      return m.type === 'poly' && m.points.length >= 3 && inPoly(m.points, pt);
    }) || null;
  }

  // 「動かす」の取っ手（割合の点）: 四角は4つの角（左上→右上→右下→左下）、多角形は角、文字はその点
  function handles(m) {
    if (m.type === 'rect') { const b = bbox(m.points); return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }]; }
    return m.points.map(p => ({ x: p.x, y: p.y }));
  }
  // 押した所の取っ手の番号（表示で radius px 以内）。無ければ -1
  function hitHandle(m, pt, size, radius) {
    const r = radius || 16;
    return handles(m).findIndex(h => Math.hypot((h.x - pt.x) * size.w, (h.y - pt.y) * size.h) <= r);
  }
  // 印ごと動かす（図からはみ出さない分だけ）
  function moveMark(m, dx, dy) {
    const b = bbox(m.points);
    dx = Math.min(1 - b.x - b.w, Math.max(-b.x, dx));
    dy = Math.min(1 - b.y - b.h, Math.max(-b.y, dy));
    const r6 = v => Math.round(v * 1e6) / 1e6; // 0.1+0.2 の端数を残さない
    return Object.assign({}, m, { points: m.points.map(p => ({ x: r6(p.x + dx), y: r6(p.y + dy) })) });
  }
  // 取っ手 i を p へ（四角はその角だけ動かして対角の2点に組み直す）
  function moveHandle(m, i, p) {
    const q = { x: clamp01(p.x), y: clamp01(p.y) };
    if (m.type !== 'rect') return Object.assign({}, m, { points: m.points.map((o, j) => (j === i ? q : o)) });
    const h = handles(m);
    const fixed = h[(i + 2) % 4]; // 対角はそのまま
    return Object.assign({}, m, { points: [{ x: Math.min(fixed.x, q.x), y: Math.min(fixed.y, q.y) }, { x: Math.max(fixed.x, q.x), y: Math.max(fixed.y, q.y) }] });
  }

  // A4 の向き（横長の図は横）と、置き場（mm）: 左に全体図・右に一覧（side）・下に凡例の帯 18mm。miniParts（部位の配列。重なりがあるとき）があれば、全体図の下に部位ごとの小さい図を横に並べる
  function fitPage(imgW, imgH, miniParts) {
    const land = imgW > imgH, iw = imgW || 1, ih = imgH || 1;
    const pageW = land ? A4.h : A4.w, pageH = land ? A4.w : A4.h;
    const parts = Array.isArray(miniParts) ? miniParts : [];
    const aw = pageW - MARGIN * 2, ah = pageH - MARGIN * 2 - BAND;
    const miniH = parts.length ? Math.round(ah * 0.36) : 0;
    const mainW = aw - SIDE.w - GAP, mainH = ah - miniH - (miniH ? GAP : 0);
    const k = Math.min(mainW / iw, mainH / ih), w = iw * k, h = ih * k;
    const cellW = parts.length ? (aw - GAP * (parts.length - 1)) / parts.length : 0;
    return { orientation: land ? 'landscape' : 'portrait', pageW, pageH,
      img: { x: MARGIN + (mainW - w) / 2, y: MARGIN + (mainH - h) / 2, w, h },
      side: { x: MARGIN + mainW + GAP, y: MARGIN, w: SIDE.w, h: mainH },
      minis: parts.map((part, i) => {
        const x = MARGIN + i * (cellW + GAP), y = MARGIN + mainH + GAP;
        const k2 = Math.min(cellW / iw, (miniH - MINI_CAP) / ih), w2 = iw * k2, h2 = ih * k2;
        return { part, x, y, w: cellW, h: miniH, img: { x: x + (cellW - w2) / 2, y: y + MINI_CAP, w: w2, h: h2 } };
      }),
      band: { x: MARGIN, y: pageH - MARGIN - BAND, w: aw, h: BAND },
      // 続きのページ（一覧に入りきらない行の表だけ）に載る行の数（上に見出し 12mm・2列）
      more: { perCol: Math.floor((pageH - MARGIN * 2 - 12) / ROW) } };
  }

  const safe = s => str(s).replace(/[\\/:*?"<>|]/g, '_').replace(/[\x00-\x1f]/g, '').replace(/\s+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  // 「図面_サンプルハイツ_302号室.pdf」（号室が無ければ付けない）
  const fileName = c => ['図面', safe(c && c.name), safe(CL().roomLabel(c && c.room))].filter(Boolean).join('_') + '.pdf';

  const api = { PARTS, ORDER, LABEL_MAX, PLACE_MAX, PLACES, TEXT_BOX, BAND, ROW, SIDE, MARGIN, TYPE_LABEL, normalize, legend, rows, rowText, anchor, badgePos, overlaps, wrap, sideRows, UNITS, cleanQty, markText, bbox, inPoly, hitTest, handles, hitHandle, moveMark, moveHandle, fitPage, fileName, newMarkId };
  if (inNode) module.exports = api;
  else root.DrawingLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
