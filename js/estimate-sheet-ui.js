// js/estimate-sheet-ui.js — 見積書の下書きを紙面（EstimatePdf.build の .pd-page）の上で直す部品。window.EstimateSheetUi = { mount, unmount, flush, data, lock }
//   紙面は縮めて見せるだけ（字を直接打たせない: iPhone の contenteditable と transform の相性が悪い）。行・欄を押すと画面の下の編集パネル（16px の欄）で直す。
//   二本指の拡大・移動は @panzoom/panzoom（drawing-ui と同じ）。入力のたびに紙面を組み直し、1.5秒で estimates.data に自動保存（estimate-ui の saveNow と同じ形）。
//   mount(host, st, opts): st = { row, caseRow, d（estimates.data）, org, sealUrl }、opts.onPages(ページ数)。lock(true) の間は紙面もパネルも触れない（PDF を作って記録するまで）
const EstimateSheetUi = (() => {
  const EL = EstimateLogic;
  const SAVE_MS = 1500, DRAG_PX = 6, PAGE_PX = 595.28 * 96 / 72; // A4 の幅 793.7px
  const FIELDS = ['subject', 'client', 'notes_extra'];
  let s = null; // { host, row, caseRow, d, org, opts, sel, k, pz, stage, pzEl, scaler, panel, amt, saveEl, timer, saving, dirty, savedAt, err }
  const num = v => Number(v) || 0;
  const yen = n => Math.round(num(n)).toLocaleString('ja-JP');

  /* ---------- 保存（estimate-ui の saveNow と同じ形） ---------- */
  function setSave() {
    if (!s) return;
    s.saveEl.textContent = s.err ? '保存できませんでした（' + s.err + '）' : s.saving ? '保存中…' : s.savedAt ? '自動保存 ' + s.savedAt : '';
    s.saveEl.classList.toggle('err', !!s.err);
  }
  function changed() {
    // 紙面の組み直しは1コマに1回（打つたびに全部組むと重い）
    if (!s.raf) s.raf = requestAnimationFrame(() => { if (s) { s.raf = 0; renderSheet(); } });
    s.dirty = true;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => { flush().catch(() => {}); }, SAVE_MS);
  }
  async function flush() {
    if (!s) return;
    const x = s;
    clearTimeout(x.timer);
    while (x.saving) await x.saving.catch(() => {});
    if (!x.dirty) return;
    x.dirty = false;
    x.saving = EstimatesApi.save(x.row.id, { data: x.d, number: x.row.number || '' });
    setSave();
    try {
      await x.saving;
      x.err = '';
      const n = new Date();
      x.savedAt = n.getHours() + ':' + String(n.getMinutes()).padStart(2, '0');
    } catch (e) {
      x.dirty = true;
      x.err = errText(e);
      throw e;
    } finally {
      x.saving = null;
      if (s === x) setSave();
    }
  }
  App.onLeave(async () => { if (s && (s.dirty || s.saving)) { try { await flush(); } catch (e) { toast('見積書を保存できませんでした: ' + errText(e)); } } });

  /* ---------- 紙面 ---------- */
  function renderSheet() {
    const y = window.scrollY;
    const line = s.sel && s.sel.line != null ? s.sel.line : undefined;
    const pages = EstimatePdf.build({ estimate: Object.assign({}, s.row, { data: s.d }), org: s.org, sealUrl: s.sealUrl, forScreen: true, keep: line });
    s.scaler.replaceChildren(...pages);
    pages.forEach(EstimatePdf.shrink);
    if (line != null) s.scaler.querySelectorAll('[data-line="' + line + '"]').forEach(e => e.classList.add('sel'));
    if (s.sel && s.sel.field) s.scaler.querySelectorAll('[data-field="' + s.sel.field + '"]').forEach(e => e.classList.add('sel'));
    s.pzEl.style.height = s.scaler.offsetHeight * s.k + 'px';
    window.scrollTo(0, y);
    if (s.amt && line != null) s.amt.textContent = yen(s.d.lines[line].amount) + '円';
    if (s.opts.onPages) s.opts.onPages(pages.length);
  }
  function onTap(e) {
    if (!s) return;
    if (s.down && Math.hypot(e.clientX - s.down.x, e.clientY - s.down.y) >= DRAG_PX) return; // 拡大中に紙面を動かした指を離しただけ
    const tr = e.target.closest('[data-line]');
    if (tr) {
      let i = tr.dataset.line;
      if (i === 'new') {
        const last = s.d.lines.length - 1;
        if (EL.isRealItem(s.d.lines[last])) { s.d.lines = EL.insertLineAfter(s.d.lines, last); i = last + 1; } else i = last; // 最後が空の行ならそれを使う
      }
      const cell = e.target.closest('[data-cell]');
      select({ line: Number(i) }, cell && cell.dataset.cell);
      return;
    }
    const f = e.target.closest('[data-field]');
    if (f && FIELDS.includes(f.dataset.field)) select({ field: f.dataset.field });
  }
  function select(sel, focusCell) {
    s.sel = sel;
    renderSheet();
    renderPanel(focusCell);
  }
  function close() {
    if (!s) return;
    s.sel = null;
    s.amt = null;
    s.panel.hidden = true;
    s.host.style.paddingBottom = '';
    renderSheet();
  }

  /* ---------- 下の編集パネル（ポップアップではない。× だけで閉じる） ---------- */
  function input(id, label, value, attrs, onInput, tag) {
    const f = mk('div', 'ff');
    const l = mk('label', null, label);
    const e = document.createElement(tag || 'input');
    if (!tag) e.type = 'text';
    e.id = l.htmlFor = id;
    Object.assign(e, attrs || {});
    e.value = value == null ? '' : value;
    e.addEventListener('input', () => onInput(e.value));
    f.append(l, e);
    return f;
  }
  function renderPanel(focusCell) {
    const p = s.panel;
    const hd = mk('div', 'es-sp-hd');
    const x = dBtn('×', 'modal-x', close);
    x.id = 'es-sheet-x';
    x.setAttribute('aria-label', '閉じる');
    const body = mk('div', 'es-sp-b');
    s.amt = null;
    if (s.sel.line != null) {
      const i = s.sel.line, r = s.d.lines[i], n = s.d.lines.length;
      hd.append(mk('div', 'card-t', '明細 ' + (i + 1) + '行目'), x);
      const set = key => v => { s.d.lines = EL.setCell(s.d.lines, i, key, v, s.d.profit_pct); changed(); };
      const ro = { readOnly: !!r.auto };
      if (r.auto) body.appendChild(mk('div', 'hint', '諸経費の自動行（金額は自動で計算します）'));
      body.append(input('es-sp-desc', '摘要', r.description, { maxLength: 200, autocomplete: 'off' }, set('description')),
        input('es-sp-detail', '詳細', r.detail, { maxLength: 200, autocomplete: 'off' }, set('detail')));
      const g = mk('div', 'es-sp-nums');
      g.append(input('es-sp-qty', '数量', r.quantity, Object.assign({ inputMode: 'decimal' }, ro), set('quantity')),
        input('es-sp-unit', '単位', r.unit, { maxLength: 20 }, set('unit')),
        input('es-sp-price', '単価', EL.unitPriceOf(r), Object.assign({ inputMode: 'numeric' }, ro), set('unit_price')));
      const a = mk('div', 'ff');
      s.amt = mk('div', 'es-sp-amt', yen(r.amount) + '円');
      s.amt.id = 'es-sp-amt';
      a.append(mk('span', 'lbl', '金額'), s.amt);
      g.appendChild(a);
      body.appendChild(g);
      const nav = mk('div', 'grid2');
      const prev = dBtn('前の行', 'btn ghost sm', () => select({ line: i - 1 }));
      prev.id = 'es-sp-prev';
      prev.disabled = i === 0;
      const next = dBtn('次の行', 'btn ghost sm', () => select({ line: i + 1 }));
      next.id = 'es-sp-next';
      next.disabled = i >= n - 1;
      const add = dBtn('行を足す（この下に）', 'btn ghost sm', () => { s.d.lines = EL.insertLineAfter(s.d.lines, i); select({ line: i + 1 }, 'description'); changed(); });
      add.id = 'es-sp-add';
      const del = dBtn('この行を削除', 'btn ghost sm danger', async () => {
        const desc = String(s.d.lines[i].description || '').trim();
        if (!(await askPopup((desc ? '「' + desc + '」' : 'この行') + 'を削除しますか？', { title: '行を削除', okLabel: '削除', danger: true, id: 'es-sp-del-ask' }))) return;
        if (!s) return;
        s.d.lines = EL.removeLine(s.d.lines, i);
        s.sel = null;
        close();
        changed();
      });
      del.id = 'es-sp-del';
      nav.append(prev, next, add, del);
      body.appendChild(nav);
    } else {
      const f = s.sel.field;
      hd.append(mk('div', 'card-t', { subject: '件名', client: '宛名', notes_extra: '備考' }[f]), x);
      const set = key => v => { s.d[key] = v; changed(); };
      if (f === 'subject') body.appendChild(input('es-sp-subject', '件名', s.d.subject, { maxLength: 200 }, set('subject')));
      if (f === 'client') {
        const g = mk('div', 'grid2');
        const hon = mk('div', 'ff');
        const hl = mk('label', null, '敬称');
        const sel = document.createElement('select');
        sel.id = hl.htmlFor = 'es-sp-hon';
        ['御中', '様'].forEach(v => sel.appendChild(new Option(v, v)));
        sel.value = s.d.honorific || '御中';
        sel.addEventListener('change', () => set('honorific')(sel.value));
        hon.append(hl, sel);
        g.append(input('es-sp-client', '宛名', s.d.client, { maxLength: 100 }, set('client')), hon);
        body.appendChild(g);
      }
      if (f === 'notes_extra') {
        body.appendChild(input('es-sp-notes', '備考（自由記入）', s.d.notes_extra, { rows: 3, maxLength: 1000 }, set('notes_extra'), 'textarea'));
        body.appendChild(mk('div', 'hint', '決まった文（工期・工事時間など）は「編集に戻る」で直せます'));
      }
    }
    p.replaceChildren(hd, body);
    p.hidden = false;
    s.host.style.paddingBottom = p.offsetHeight + 'px'; // パネルに隠れた所までめくれるように
    // 選んだ所がパネルに隠れていたら、パネルの上に見えるまでめくる
    const on = s.scaler.querySelector('.sel');
    if (on) { const b = on.getBoundingClientRect().bottom, lim = innerHeight - p.offsetHeight - 8; if (b > lim) window.scrollBy(0, b - lim); }
    const fid = { description: 'es-sp-desc', quantity: 'es-sp-qty', unit_price: 'es-sp-price', subject: 'es-sp-subject', client: 'es-sp-client', notes_extra: 'es-sp-notes' }[focusCell || s.sel.field];
    const fe = fid && $(fid);
    if (fe && !fe.readOnly) fe.focus({ preventScroll: true });
  }

  /* ---------- 組む・外す ---------- */
  function mount(host, st, opts) {
    unmount();
    const bar = mk('div', 'es-sheet-bar');
    const seg = mk('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', '紙面の大きさ');
    const fit = dBtn('全体', null, () => { if (s && s.pz) s.pz.reset(); });
    fit.id = 'es-sheet-fit';
    const zoom = dBtn('拡大', null, () => { if (s && s.pz) s.pz.zoom(2); });
    zoom.id = 'es-sheet-zoom';
    seg.append(fit, zoom);
    const saveEl = mk('div', 'hint');
    saveEl.id = 'es-sheet-save';
    bar.append(seg, mk('div', 'hint', '紙面の行や欄を押すと、下で直せます。二本指で拡大できます。'), saveEl);
    const stage = mk('div', 'es-stage');
    stage.id = 'es-sheet';
    const pzEl = mk('div', 'es-pz');
    const scaler = mk('div', 'es-scale');
    pzEl.appendChild(scaler);
    stage.appendChild(pzEl);
    host.replaceChildren(bar, stage);
    const panel = mk('div', 'es-sheet-panel');
    panel.id = 'es-sheet-panel';
    panel.hidden = true;
    (host.closest('.screen') || document.body).appendChild(panel);
    // shortcut: 縮める率は開いたときの幅で決める。回転で幅が変わったら次に開いたときに直る（困るなら resize で mount し直す）
    const k = Math.min(1, stage.clientWidth / PAGE_PX);
    scaler.style.transform = 'scale(' + k + ')';
    pzEl.style.width = PAGE_PX * k + 'px';
    s = { host, row: st.row, caseRow: st.caseRow, d: st.d, org: st.org, sealUrl: st.sealUrl || '', raf: 0, down: null, opts: opts || {}, sel: null, k, pz: null, stage, pzEl, scaler, panel, amt: null, saveEl,
      timer: null, saving: null, dirty: false, savedAt: '', err: '' };
    if (!Array.isArray(s.d.lines) || !s.d.lines.length) s.d.lines = [EL.emptyRow()];
    renderSheet();
    // 二本指で拡大・移動（タップはそのまま通る）。拡大していないときは1本指で画面をめくれるよう pan-y
    if (typeof window.Panzoom === 'function') {
      s.pz = window.Panzoom(pzEl, { minScale: 1, maxScale: 4, panOnlyWhenZoomed: true, touchAction: 'pan-y', cursor: '' });
      pzEl.addEventListener('panzoomchange', ev => { const t = ev.detail.scale > 1 ? 'none' : 'pan-y'; pzEl.style.touchAction = stage.style.touchAction = t; });
    }
    stage.addEventListener('pointerdown', e => { if (s) s.down = { x: e.clientX, y: e.clientY }; }, true);
    stage.addEventListener('click', onTap);
  }
  // PDF を作って記録するまで直させない（送った PDF と発行済みの中身をそろえる）
  function lock(on) {
    if (s) s.stage.inert = s.panel.inert = !!on;
  }
  // shortcut: 保存の途中は待たない（画面を離れるときは App.onLeave、共有の前は flush で保存してから呼ぶ）
  function unmount() {
    if (!s) return;
    clearTimeout(s.timer);
    cancelAnimationFrame(s.raf);
    if (s.pz) s.pz.destroy();
    s.panel.remove();
    s.host.style.paddingBottom = '';
    s.host.replaceChildren();
    s = null;
  }
  const data = () => (s ? s.d : null);
  return { mount, unmount, flush, data, lock };
})();
