// js/drawing-ui.js — 10 図面: 取り込み（写真・画像・PDF の1ページ目）→ 部位（天井・壁・床）の色で範囲を描く（四角・多角形・文字）→ 下書き保存／PDFを作る → 共有
// 図は <img>、印は重ねた <svg>（viewBox = 図の px。点は 0〜1 の割合で drawings.marks に1.5秒で自動保存）。元の図はそのまま（drawings.image_path）。
// 写真の拡大・移動は @panzoom/panzoom（「写真を拡大」のときだけ bind。「描く」のときは destroy して pointer events で描く）。印を動かす・形を変えるのは道具「動かす」。規則は DrawingLogic。
const DrawingUi = (() => {
  const DL = DrawingLogic;
  const SAVE_MS = 1500, UNDO_MAX = 20, DRAG_PX = 6, MAX_EDGE = 2048;
  const NS = 'http://www.w3.org/2000/svg';
  const TOOLS = { rect: '四角', poly: '多角形', text: '文字', move: '動かす' };
  const HINT = {
    rect: '図の上をドラッグすると四角を描きます。印を押すと文字・部位・削除。',
    poly: '角を順に押して、最後に「閉じる」。範囲の上からも描けます（範囲を直すときは「四角」にして押す）。',
    text: '文字を置く所を押してください。文字を押すと直す・削除。',
    move: '印を押して選び、そのままドラッグで動かします。角の丸をドラッグすると形が変わります。もう一度押すと文字・部位・削除。',
    zoom: '二本指で写真を拡大・移動（パソコンはホイールとドラッグ）。描くときは「描く」に戻します。'
  };
  let st = null; // { row, caseRow, marks, hist, part, tool, mode, poly, drag, sel, imgW, imgH, pz, timer, saving, dirty, savedAt, err }

  async function create(caseRow) {
    const { data, error } = await sb.from('drawings').insert({ case_id: caseRow.id, marks: [] }).select().single();
    if (error) throw error;
    return data;
  }

  /* ---------- 保存（notice-ui と同じ形） ---------- */
  function setSub() {
    if (!st) return;
    const t = st.err ? '保存できませんでした（' + st.err + '）' : st.saving ? '保存中…' : st.savedAt ? '自動保存 ' + st.savedAt : '';
    $('dw-sub').textContent = [CaseLogic.placeName(st.caseRow), t].filter(Boolean).join(' ・ ');
    $('dw-sub').classList.toggle('err', !!st.err);
  }
  function changed() {
    if (!st) return;
    st.dirty = true;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { saveNow().catch(() => {}); }, SAVE_MS);
  }
  async function saveNow(extra) {
    if (!st) return;
    const s = st;
    clearTimeout(s.timer);
    if (extra) Object.assign(s.row, extra);
    while (s.saving) await s.saving.catch(() => {}); // 保存の途中なら終わるのを待つ（PDF が新しい印を読むように）
    if (!s.dirty && !extra) return;
    s.dirty = false;
    s.saving = (async () => {
      const { error } = await sb.from('drawings').update({ marks: s.marks, image_path: s.row.image_path }).eq('id', s.row.id);
      if (error) throw error;
    })();
    setSub();
    try {
      await s.saving;
      s.err = '';
      const n = new Date();
      s.savedAt = n.getHours() + ':' + String(n.getMinutes()).padStart(2, '0');
    } catch (e) {
      s.dirty = true;
      s.err = errText(e);
      throw e;
    } finally {
      s.saving = null;
      setSub();
    }
  }
  App.onLeave(async () => {
    if (!st) return;
    setMode('draw');
    if (st.dirty || st.saving) { try { await saveNow(); } catch (e) { toast('図面を保存できませんでした: ' + errText(e)); } }
  });

  // 印を変える前に呼ぶ（元に戻すは20回まで）
  function edit(fn) {
    st.hist.push(JSON.stringify(st.marks));
    if (st.hist.length > UNDO_MAX) st.hist.shift();
    fn();
    st.marks = DL.normalize(st.marks);
    renderMarks();
    changed();
  }

  /* ---------- 取り込み ---------- */
  async function pdfToJpeg(file) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: window.PDFJS_CMAPS, cMapPacked: true, isEvalSupported: false }).promise;
    try {
      const page = await doc.getPage(1);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: MAX_EDGE / Math.max(vp1.width, vp1.height) });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      c.width = c.height = 0;
      if (!blob) throw new Error('PDFを画像にできませんでした');
      return blob;
    } finally { doc.destroy(); }
  }
  async function importFile(file) {
    const s = st;
    const msg = $('dw-msg');
    msg.className = 'msg';
    msg.textContent = '図面を読み込み中…';
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      const blob = isPdf ? await pdfToJpeg(file) : await shrinkImage(file, MAX_EDGE, 'image/jpeg', 0.9);
      const path = ctx.org.id + '/drawings/' + s.row.id + '/' + newId() + '.jpg';
      const up = await sb.storage.from('drawings').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      if (st !== s) return;
      const old = s.row.image_path;
      await saveNow({ image_path: path });
      if (old) sb.storage.from('drawings').remove([old]);
      msg.textContent = '';
      await renderStage();
    } catch (e) {
      msg.className = 'msg err';
      msg.textContent = '図面を読み込めませんでした: ' + errText(e);
    }
  }

  /* ---------- 図と印 ---------- */
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  const px = p => [p.x * st.imgW, p.y * st.imgH];
  const shapeAttrs = (part, extra) => Object.assign({ fill: DL.PARTS[part].color, 'fill-opacity': '.35', stroke: DL.PARTS[part].color, 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }, extra);
  // 文字は表示で 14px くらい（図の px に直す）
  const fontPx = () => 14 * st.imgW / Math.max(1, $('dw-pz').offsetWidth);
  function textEl(x, y, text, part, anchor) {
    const t = svgEl('text', { x, y, fill: DL.PARTS[part].color, 'font-size': fontPx(), 'font-weight': '700', 'text-anchor': anchor || 'middle',
      'dominant-baseline': anchor ? 'hanging' : 'middle', stroke: '#fff', 'stroke-width': fontPx() / 4, 'paint-order': 'stroke', 'stroke-linejoin': 'round' });
    t.textContent = text;
    return t;
  }
  function renderMarks() {
    if (!st || !st.imgW) return;
    const svg = $('dw-svg');
    svg.replaceChildren();
    st.marks.forEach(m => {
      const g = svgEl('g', { 'data-id': m.id, 'data-part': m.part, 'data-type': m.type });
      if (m.type === 'text') {
        g.appendChild(textEl(...px(m.points[0]), m.label, m.part));
      } else {
        const shape = m.type === 'rect'
          ? (b => svgEl('rect', shapeAttrs(m.part, { x: b.x * st.imgW, y: b.y * st.imgH, width: b.w * st.imgW, height: b.h * st.imgH })))(DL.bbox(m.points))
          : svgEl('polygon', shapeAttrs(m.part, { points: m.points.map(p => px(p).join(',')).join(' ') }));
        g.appendChild(shape);
        if (m.label) { const b = DL.bbox(m.points); g.appendChild(textEl(b.x * st.imgW + fontPx() / 2, b.y * st.imgH + fontPx() / 2, m.label, m.part, 'start')); }
      }
      svg.appendChild(g);
    });
    // 「動かす」で選んだ印: 太い枠と取っ手
    const sel = st.tool === 'move' && st.sel ? st.marks.find(m => m.id === st.sel) : null;
    if (!sel) st.sel = null;
    if (sel) {
      svg.querySelector('g[data-id="' + sel.id + '"]').setAttribute('data-sel', '1');
      DL.handles(sel).forEach((h, i) => { const [x, y] = px(h); svg.appendChild(svgEl('circle', { class: 'dw-handle', 'data-handle': i, cx: x, cy: y, r: fontPx() * 0.6, fill: '#fff', stroke: DL.PARTS[sel.part].color, 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' })); });
    }
    renderSelBar(sel);
    // 描いている途中（四角のドラッグ・多角形の点）
    if (st.drag && st.drag.moved && st.tool === 'rect') {
      const b = DL.bbox([st.drag.p0, st.drag.p1]);
      svg.appendChild(svgEl('rect', shapeAttrs(st.part, { id: 'dw-draft-rect', x: b.x * st.imgW, y: b.y * st.imgH, width: b.w * st.imgW, height: b.h * st.imgH, 'stroke-dasharray': '6 4' })));
    }
    if (st.poly) {
      const c = DL.PARTS[st.part].color;
      svg.appendChild(svgEl('polyline', { points: st.poly.map(p => px(p).join(',')).join(' '), fill: 'none', stroke: c, 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '6 4' }));
      st.poly.forEach(p => { const [x, y] = px(p); svg.appendChild(svgEl('circle', { cx: x, cy: y, r: fontPx() / 3, fill: c })); });
    }
    renderLegend();
    renderPolyBar();
    $('dw-undo').disabled = !st.hist.length && !st.poly;
    $('dw-clear').disabled = !st.marks.length;
  }
  function renderLegend() {
    const box = $('dw-legend');
    box.replaceChildren();
    const l = DL.legend(st.marks);
    if (!l.length) { box.appendChild(mk('div', 'hint', '凡例（描いた部位が出ます。PDFにも出ます）')); return; }
    l.forEach(x => {
      const li = mk('div', 'dw-li');
      const sw = mk('span', 'dw-sw');
      sw.style.background = x.color;
      li.append(sw, mk('span', null, [x.label, x.count ? x.count + 'か所' : '', x.texts.join('・')].filter(Boolean).join(' ')));
      box.appendChild(li);
    });
  }
  function renderSelBar(sel) {
    const bar = $('dw-selbar');
    bar.hidden = !sel;
    if (sel) $('dw-sel-t').textContent = DL.PARTS[sel.part].label + 'の' + TOOLS[sel.type] + (sel.label ? '「' + sel.label + '」' : '') + ' を選んでいます';
  }
  function renderPolyBar() {
    const bar = $('dw-polybar');
    bar.hidden = !st.poly;
    if (!st.poly) return;
    $('dw-poly-t').textContent = '多角形 ' + st.poly.length + '点' + (st.poly.length < 3 ? '（3点から閉じられます）' : '');
    $('dw-poly-close').disabled = st.poly.length < 3;
  }

  async function renderStage() {
    if (st.pz) { st.pz.destroy(); st.pz = null; }
    const stage = $('dw-stage');
    const has = !!st.row.image_path;
    $('dw-empty').hidden = has;
    $('dw-editor').hidden = !has;
    stage.replaceChildren();
    st.imgW = st.imgH = 0;
    if (!has) return;
    const s = st;
    const url = await signedUrl(s.row.image_path, 'drawings');
    const wrap = mk('div', 'dw-pz');
    wrap.id = 'dw-pz';
    const img = mk('img');
    img.id = 'dw-img';
    img.alt = '図面';
    img.draggable = false;
    const svg = svgEl('svg', { id: 'dw-svg', 'aria-label': '書き込み', role: 'img', preserveAspectRatio: 'none' });
    wrap.append(img, svg);
    stage.appendChild(wrap);
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('図面の画像を読み込めませんでした')); img.src = url; });
    if (st !== s) return;
    s.imgW = img.naturalWidth;
    s.imgH = img.naturalHeight;
    svg.setAttribute('viewBox', '0 0 ' + s.imgW + ' ' + s.imgH);
    wireDraw(svg);
    if (typeof window.Panzoom === 'function') s.pz = window.Panzoom(wrap, { noBind: true, minScale: 1, maxScale: 6, cursor: '' });
    setMode('draw');
    renderMarks();
  }

  /* ---------- 描く ---------- */
  function ratioOf(e) {
    const r = $('dw-svg').getBoundingClientRect();
    return { p: { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }, size: { w: r.width, h: r.height } };
  }
  function wireDraw(svg) {
    // 指の数。2本目が来たら描きかけをやめ、全部離れるまで何もしない（二本指で描いてしまわない）
    const downs = new Set();
    let multi = false;
    const up = e => { downs.delete(e.pointerId); if (!downs.size) multi = false; };
    svg.addEventListener('pointerdown', e => {
      if (!st || st.mode !== 'draw' || e.button > 0) return;
      downs.add(e.pointerId);
      if (downs.size > 1) { multi = true; if (st.drag) { st.drag = null; renderMarks(); } return; }
      if (multi) return;
      e.preventDefault();
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* 取れなくても描ける */ }
      const { p, size } = ratioOf(e);
      st.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, p0: p, p1: p, moved: false };
      if (st.tool === 'move') {
        // 選んでいる印の取っ手 → 形を変える。印の上 → 選んで動かす。何も無い所 → 選択をやめる
        const sel = st.sel ? st.marks.find(m => m.id === st.sel) : null;
        const h = sel ? DL.hitHandle(sel, p, size) : -1;
        const hit = h >= 0 ? sel : DL.hitTest(st.marks, p, size);
        Object.assign(st.drag, { kind: h >= 0 ? 'handle' : hit ? 'move' : 'none', handle: h, again: !!hit && hit.id === st.sel, orig: hit ? JSON.parse(JSON.stringify(hit)) : null, snap: JSON.stringify(st.marks) });
        st.sel = hit ? hit.id : null;
        renderMarks();
      }
    });
    svg.addEventListener('pointermove', e => {
      const d = st && st.drag;
      if (!d || d.id !== e.pointerId) return;
      d.p1 = ratioOf(e).p;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) >= DRAG_PX) d.moved = true;
      if (!d.moved) return;
      if (st.tool === 'rect') renderMarks();
      if (st.tool === 'move' && d.orig) {
        const i = st.marks.findIndex(m => m.id === d.orig.id);
        if (i < 0) return;
        st.marks[i] = d.kind === 'handle' ? DL.moveHandle(d.orig, d.handle, d.p1) : DL.moveMark(d.orig, d.p1.x - d.p0.x, d.p1.y - d.p0.y);
        renderMarks();
      }
    });
    svg.addEventListener('pointerup', e => {
      up(e);
      const d = st && st.drag;
      if (!d || d.id !== e.pointerId) return;
      st.drag = null;
      const { p, size } = ratioOf(e);
      if (st.tool === 'move') {
        if (d.moved && d.orig) { st.hist.push(d.snap); if (st.hist.length > UNDO_MAX) st.hist.shift(); st.marks = DL.normalize(st.marks); renderMarks(); changed(); }
        else if (!d.moved && d.again && d.orig) markMenu(d.orig);
        return;
      }
      if (d.moved && st.tool === 'rect') {
        const b = DL.bbox([d.p0, p]);
        if (b.w * size.w >= DRAG_PX && b.h * size.h >= DRAG_PX) edit(() => st.marks.push({ id: DL.newMarkId(), type: 'rect', part: st.part, points: [d.p0, p], label: '' }));
        else renderMarks();
        return;
      }
      if (!d.moved) tapAt(p, size);
    });
    svg.addEventListener('pointercancel', e => { up(e); if (st && st.drag) { if (st.drag.snap && st.drag.moved) st.marks = JSON.parse(st.drag.snap); st.drag = null; renderMarks(); } });
  }
  async function tapAt(p, size) {
    if (st.poly) { st.poly.push(p); renderMarks(); return; }
    // 多角形・文字の道具では文字の印だけ押せる（範囲の上から別の部位を描けるように。範囲を直すのは「四角」の道具で）
    const hit = DL.hitTest(st.tool === 'rect' ? st.marks : st.marks.filter(m => m.type === 'text'), p, size);
    if (hit) { await markMenu(hit); return; }
    if (st.tool === 'poly') { st.poly = [p]; renderMarks(); return; }
    if (st.tool === 'text') {
      const s = st, part = st.part;
      const t = await askPopup('図の上に置く文字を入れてください（' + DL.LABEL_MAX + '字まで）。', { title: DL.PARTS[part].label + 'の文字', okLabel: '置く', id: 'dw-text-ask', input: { label: '文字', placeholder: '例: クロス張替' } });
      if (st !== s || !t) return;
      edit(() => st.marks.push({ id: DL.newMarkId(), type: 'text', part, points: [p], label: t }));
    }
  }
  // 印を押した: 文字を付ける（文字の印は文字を直す）／部位を変える／削除
  async function markMenu(m) {
    const s = st;
    const others = DL.ORDER.filter(k => k !== m.part);
    const r = await askPopup(DL.PARTS[m.part].label + 'の' + TOOLS[m.type] + 'です。', {
      title: '印', id: 'dw-mark-ask', okLabel: m.type === 'text' ? '文字を直す' : '文字を付ける',
      input: { label: '文字（例: クロス張替）', value: m.label, placeholder: '例: クロス張替' },
      more: others.map(k => ({ id: 'dw-mark-' + k, label: '部位を' + DL.PARTS[k].label + 'に変える', value: k })).concat([{ id: 'dw-mark-del', label: '削除', value: 'del', danger: true }])
    });
    if (st !== s || r == null) return;
    const i = st.marks.findIndex(x => x.id === m.id);
    if (i < 0) return;
    if (typeof r === 'object') {
      if (r.more === 'del') edit(() => st.marks.splice(i, 1));
      else edit(() => { st.marks[i].part = r.more; });
      return;
    }
    if (r === m.label || (m.type === 'text' && !r)) return; // 文字の印を空にするときは「削除」
    edit(() => { st.marks[i].label = r.slice(0, DL.LABEL_MAX); });
  }

  /* ---------- 上のボタン ---------- */
  function renderButtons() {
    document.querySelectorAll('#dw-parts .dw-part').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.part === st.part)));
    document.querySelectorAll('#dw-tools button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === st.tool)));
    document.querySelectorAll('#dw-mode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)));
    $('dw-hint').textContent = HINT[st.mode === 'move' ? 'zoom' : st.tool];
  }
  const wheel = e => { if (st && st.pz) st.pz.zoomWithWheel(e); };
  function setMode(mode) {
    if (!st) return;
    st.mode = mode;
    st.drag = null;
    const stage = $('dw-stage');
    stage.classList.toggle('move', mode === 'move');
    if (st.pz) {
      if (mode === 'move') { st.pz.bind(); stage.style.touchAction = 'none'; stage.addEventListener('wheel', wheel, { passive: false }); }
      else { st.pz.destroy(); stage.style.touchAction = ''; stage.removeEventListener('wheel', wheel); } // 描くときは図の外（灰色の所）でページを動かせる
    }
    renderButtons();
  }

  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $('dw-back').addEventListener('click', () => { if (st) location.hash = '#case/' + st.caseRow.id; });
    const pick = () => { const f = $('dw-file'); f.value = ''; f.click(); };
    $('dw-pick').addEventListener('click', pick);
    $('dw-pick2').addEventListener('click', pick);
    $('dw-file').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (st && f) importFile(f); });
    const parts = $('dw-parts');
    DL.ORDER.forEach(k => {
      const b = mk('button', 'dw-part');
      b.type = 'button';
      b.id = 'dw-part-' + k;
      b.dataset.part = k;
      b.style.setProperty('--c', DL.PARTS[k].color);
      const sw = mk('span', 'dw-sw');
      sw.style.background = DL.PARTS[k].color;
      b.append(sw, document.createTextNode(DL.PARTS[k].label));
      b.addEventListener('click', () => { if (!st) return; st.part = k; renderButtons(); renderMarks(); });
      parts.appendChild(b);
    });
    Object.entries(TOOLS).forEach(([k, label]) => {
      const b = dBtn(label, null, () => { if (!st) return; st.tool = k; st.poly = null; st.sel = null; setMode('draw'); renderMarks(); });
      b.id = 'dw-tool-' + k;
      b.dataset.tool = k;
      $('dw-tools').appendChild(b);
    });
    [['draw', '描く'], ['move', '写真を拡大']].forEach(([k, label]) => {
      const b = dBtn(label, null, () => { if (!st) return; setMode(k); renderMarks(); });
      b.id = 'dw-mode-' + k;
      b.dataset.mode = k;
      $('dw-mode').appendChild(b);
    });
    $('dw-undo').addEventListener('click', () => {
      if (!st) return;
      if (st.poly) { st.poly.pop(); if (!st.poly.length) st.poly = null; renderMarks(); return; } // 多角形の途中は最後の点だけ
      if (!st.hist.length) return;
      st.marks = JSON.parse(st.hist.pop());
      renderMarks();
      changed();
    });
    $('dw-clear').addEventListener('click', async () => {
      if (!st || !st.marks.length) return;
      const s = st;
      if (!(await askPopup('書き込みを全部消しますか？\n「元に戻す」で戻せます。図面の画像はそのままです。', { title: '全部消す', okLabel: '全部消す', danger: true, id: 'dw-clear-ask' })) || st !== s) return;
      st.poly = null;
      edit(() => { st.marks = []; });
    });
    $('dw-poly-close').addEventListener('click', () => {
      if (!st || !st.poly || st.poly.length < 3) return;
      const pts = st.poly;
      st.poly = null;
      edit(() => st.marks.push({ id: DL.newMarkId(), type: 'poly', part: st.part, points: pts, label: '' }));
    });
    $('dw-poly-cancel').addEventListener('click', () => { if (st) { st.poly = null; renderMarks(); } });
    $('dw-sel-menu').addEventListener('click', () => { const m = st && st.marks.find(x => x.id === st.sel); if (m) markMenu(m); });
    $('dw-sel-off').addEventListener('click', () => { if (st) { st.sel = null; renderMarks(); } });
    $('dw-draft').addEventListener('click', async () => {
      if (!st) return;
      $('dw-draft').disabled = true;
      try { st.dirty = true; await saveNow(); toast('下書きを保存しました'); location.hash = '#case/' + st.caseRow.id; }
      catch (e) { toast('保存できませんでした: ' + errText(e)); }
      finally { $('dw-draft').disabled = false; }
    });
    $('dw-pdf').addEventListener('click', async () => {
      if (!st) return;
      if (!st.row.image_path) { toast('先に図面を取り込んでください'); return; }
      $('dw-pdf').disabled = true;
      try { st.poly = null; await saveNow(); location.hash = '#doc/drawing/' + st.row.id; }
      catch (e) { toast('保存できませんでした: ' + errText(e)); }
      finally { $('dw-pdf').disabled = false; }
    });
  }

  async function show(id) {
    wire();
    if (st && st.pz) st.pz.destroy();
    st = null;
    $('dw-sub').textContent = '';
    $('dw-msg').textContent = '';
    $('dw-stage').replaceChildren();
    $('dw-empty').hidden = true;
    $('dw-editor').hidden = true;
    showScreen('drawing');
    const r = await sb.from('drawings').select('*').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) { toast('図面が見つかりませんでした'); location.replace('#cases'); return; }
    const caseRow = (await CasesApi.get(r.data.case_id)) || {};
    st = { row: r.data, caseRow, marks: DL.normalize(r.data.marks), hist: [], part: 'ceiling', tool: 'rect', mode: 'draw', poly: null, drag: null, sel: null,
      imgW: 0, imgH: 0, pz: null, timer: null, saving: null, dirty: false, savedAt: '', err: '' };
    setSub();
    renderButtons();
    try { await renderStage(); }
    catch (e) { $('dw-msg').className = 'msg err'; $('dw-msg').textContent = errText(e); }
  }
  return { create, show };
})();
