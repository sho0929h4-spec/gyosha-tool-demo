// js/drawing-logic.js — 図面の規則（UMD: ブラウザは window.DrawingLogic / node は module.exports。tests/drawing-logic.test.js）。DOM に触らない
// 印の形（drawings.marks）: [{ id, type: 'rect'|'poly'|'text', part: 'ceiling'|'wall'|'floor', points: [{ x, y }], label }]
//   points は図の幅・高さに対する 0〜1 の割合。四角は対角の2点、多角形は3点以上、文字は1点（label が中身）。
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const CL = () => (inNode ? require('./case-logic.js') : root.CaseLogic);
  const str = v => String(v == null ? '' : v).trim();
  const PARTS = { ceiling: { label: '天井', color: '#1e5bb8' }, wall: { label: '壁', color: '#d97b1c' }, floor: { label: '床', color: '#2e8b57' } };
  const ORDER = ['ceiling', 'wall', 'floor'];
  const MIN_POINTS = { rect: 2, poly: 3, text: 1 };
  const LABEL_MAX = 40;
  const TEXT_BOX = 24; // 文字の当たり判定（表示の px の正方形）
  const A4 = { w: 210, h: 297 }, MARGIN = 10, BAND = 18; // mm

  const fin = v => typeof v === 'number' && isFinite(v);
  const clamp01 = v => Math.min(1, Math.max(0, v));
  let seq = 0;
  const newMarkId = () => 'm' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

  // 壊れた印を落とす（形・部位が分からない・点が足りない・中身の無い文字）
  function normalize(marks) {
    return (Array.isArray(marks) ? marks : []).flatMap(m => {
      if (!m || !MIN_POINTS[m.type] || !PARTS[m.part] || !Array.isArray(m.points)) return [];
      const points = m.points.filter(p => p && fin(p.x) && fin(p.y)).map(p => ({ x: clamp01(p.x), y: clamp01(p.y) }));
      const label = str(m.label).slice(0, LABEL_MAX);
      if (points.length < MIN_POINTS[m.type] || (m.type === 'text' && !label)) return [];
      return [{ id: str(m.id) || newMarkId(), type: m.type, part: m.part, points: m.type === 'rect' ? points.slice(0, 2) : m.type === 'text' ? points.slice(0, 1) : points, label }];
    });
  }

  // 凡例: 使った部位だけ・天井→壁→床。count = 範囲（四角・多角形）の数、texts = 付けた文字（重ねない）
  function legend(marks) {
    const ms = normalize(marks);
    return ORDER.filter(p => ms.some(m => m.part === p)).map(p => {
      const own = ms.filter(m => m.part === p);
      return { part: p, label: PARTS[p].label, color: PARTS[p].color,
        count: own.filter(m => m.type !== 'text').length, texts: [...new Set(own.map(m => m.label).filter(Boolean))] };
    });
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
  // 押した所の印（文字を先に、あとは上に描いた順）。pt は割合、size は今の表示の大きさ px（文字の 24px の箱に使う）
  function hitTest(marks, pt, size) {
    const s = size || { w: 1000, h: 1000 };
    const ms = (Array.isArray(marks) ? marks : []).slice().reverse();
    const half = TEXT_BOX / 2;
    const t = ms.find(m => m.type === 'text' && m.points[0] && Math.abs((pt.x - m.points[0].x) * s.w) <= half && Math.abs((pt.y - m.points[0].y) * s.h) <= half);
    if (t) return t;
    return ms.find(m => {
      if (m.type === 'rect' && m.points.length >= 2) { const b = bbox(m.points); return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h; }
      return m.type === 'poly' && m.points.length >= 3 && inPoly(m.points, pt);
    }) || null;
  }

  // A4 の向き（横長の図は横）と、下に凡例の帯 18mm を取った残りに図を収める位置・大きさ（mm）
  function fitPage(imgW, imgH) {
    const land = imgW > imgH;
    const pageW = land ? A4.h : A4.w, pageH = land ? A4.w : A4.h;
    const aw = pageW - MARGIN * 2, ah = pageH - MARGIN * 2 - BAND;
    const k = Math.min(aw / (imgW || 1), ah / (imgH || 1));
    const w = (imgW || 1) * k, h = (imgH || 1) * k;
    return { orientation: land ? 'landscape' : 'portrait', pageW, pageH,
      img: { x: MARGIN + (aw - w) / 2, y: MARGIN + (ah - h) / 2, w, h },
      band: { x: MARGIN, y: pageH - MARGIN - BAND, w: aw, h: BAND } };
  }

  const safe = s => str(s).replace(/[\\/:*?"<>|]/g, '_').replace(/[\x00-\x1f]/g, '').replace(/\s+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  // 「図面_サンプルハイツ_302号室.pdf」（号室が無ければ付けない）
  const fileName = c => ['図面', safe(c && c.name), safe(CL().roomLabel(c && c.room))].filter(Boolean).join('_') + '.pdf';

  const api = { PARTS, ORDER, LABEL_MAX, TEXT_BOX, BAND, normalize, legend, bbox, inPoly, hitTest, fitPage, fileName, newMarkId };
  if (inNode) module.exports = api;
  else root.DrawingLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
