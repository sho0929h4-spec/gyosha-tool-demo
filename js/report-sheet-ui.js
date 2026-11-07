// js/report-sheet-ui.js — 報告書を紙面（ReportPdf.buildPages の .rp-page）の上で直す部品。window.ReportSheetUi = { mount, unmount, flush, data, lock }
//   estimate-sheet-ui.js を写した: 紙面は縮めて見せるだけ。結果表の行・写真の枠を押すと画面の下の編集パネル（16px の欄）で直す。二本指の拡大は @panzoom/panzoom。
//   入力のたびに紙面を組み直し、1.5秒で reports（work_type・data・photos。report-ui の saveNow と同じ形）に自動保存。作業実施項目・チェックリスト・写真の追加と印は「編集に戻る」（06）で直す。
//   mount(host, st, opts): st = { row（reports の行）, caseRow, d（data）, photos, org, logoUrl, photoUrls（photos と同じ順の署名 URL）}、opts.onPages(ページ数)
const ReportSheetUi = (() => {
  const RL = ReportLogic;
  const SAVE_MS = 1500, DRAG_PX = 6, PAGE_PX = 595.28 * 96 / 72; // A4 の幅 793.7px
  let s = null;

  /* ---------- 保存（report-ui の saveNow と同じ形） ---------- */
  function setSave() {
    if (!s) return;
    s.saveEl.textContent = s.err ? '保存できませんでした（' + s.err + '）' : s.saving ? '保存中…' : s.savedAt ? '自動保存 ' + s.savedAt : '';
    s.saveEl.classList.toggle('err', !!s.err);
  }
  // cover=true: 文字の欄だけ直した → 表紙だけ組み直す（打つたびに写真の <img> を作り直さない）。null: 呼んだ側が組む。それ以外は全部
  function changed(cover) {
    if (cover !== null) {
      if (!cover) s.full = true;
      if (!s.raf) s.raf = requestAnimationFrame(() => { if (s) { const f = s.full; s.raf = 0; s.full = false; renderSheet(!f); } });
    }
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
    x.saving = (async () => {
      const { error } = await sb.from('reports').update({ work_type: RL.modeOf(x.row.work_type), data: x.d, photos: x.photos }).eq('id', x.row.id);
      if (error) throw error;
    })();
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
  App.onLeave(async () => { if (s && (s.dirty || s.saving)) { try { await flush(); } catch (e) { toast('報告書を保存できませんでした: ' + errText(e)); } } });

  /* ---------- 紙面 ---------- */
  const urls = () => s.photos.map(p => s.urls[p.path] || '');
  function renderSheet(coverOnly) {
    const y = window.scrollY;
    const one = coverOnly && s.scaler.firstChild;
    const pages = ReportPdf.buildPages({ report: Object.assign({}, s.row, { data: s.d, photos: one ? [] : s.photos }), org: s.org, logoUrl: s.logoUrl, photoUrls: urls(),
      createdDate: RL.todayJa(new Date(s.d.pdf_at || s.row.updated_at)), forScreen: true });
    if (one) s.scaler.firstChild.replaceWith(pages[0]);
    else { s.scaler.replaceChildren(...pages); marks(); }
    const sel = s.sel;
    if (sel && sel.field) s.scaler.querySelectorAll('[data-field="' + sel.field + '"]').forEach(e => e.classList.add('sel'));
    if (sel && sel.photo != null) s.scaler.querySelectorAll('[data-photo="' + sel.photo + '"]').forEach(e => e.classList.add('sel'));
    s.pzEl.style.height = s.scaler.offsetHeight * s.k + 'px';
    window.scrollTo(0, y);
    if (s.opts.onPages) s.opts.onPages(s.scaler.children.length);
  }
  // 印のある写真は合成した画像を見せる（一度合成したものは覚えておき、組み直しても作り直さない。失敗したら元の写真のまま）
  function marks() {
    const todo = [];
    s.scaler.querySelectorAll('.rp-cimg img').forEach(img => {
      if (!img._marks) return;
      const src = img.getAttribute('src'), done = s.composed[src];
      if (done) { img.src = done; img._marks = null; img.dataset.marked = '1'; } else todo.push([img, src]);
    });
    if (!todo.length) return;
    const x = s;
    ReportPdf.applyMarks(s.scaler).then(() => todo.forEach(([img, src]) => { if (img.dataset.marked) x.composed[src] = img.src; }));
  }
  function onTap(e) {
    if (!s) return;
    if (s.down && Math.hypot(e.clientX - s.down.x, e.clientY - s.down.y) >= DRAG_PX) return; // 拡大中に紙面を動かした指を離しただけ
    const ph = e.target.closest('[data-photo]');
    if (ph) { select({ photo: Number(ph.dataset.photo) }); return; }
    const f = e.target.closest('[data-field]');
    if (f) select({ field: f.dataset.field });
  }
  function select(sel) {
    s.sel = sel;
    renderSheet();
    renderPanel();
  }
  function close() {
    if (!s) return;
    s.sel = null;
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
    e.addEventListener(tag === 'select' ? 'change' : 'input', () => onInput(e.value));
    f.append(l, e);
    return f;
  }
  function selectEl(id, label, options, value, onChange) {
    const f = input(id, label, '', {}, onChange, 'select');
    const e = f.querySelector('select');
    options.forEach(([v, t]) => e.appendChild(new Option(t, v)));
    if (value && !options.some(([v]) => v === value)) e.appendChild(new Option(value, value)); // 06 の選択肢に無い値も消さない
    e.value = value || '';
    return f;
  }
  // 漏水の状況が「漏れている…」でないと漏水時の対応は紙面に出ない（leakActionText の決まり）ので、そのときは案内を出す
  const leakHidden = () => !RL.leakActionText(s.d) && !!String(s.d.leakAction || '').trim();
  const setD = key => v => { s.d = RL.setField(s.d, key, v); if (s.leakHint) s.leakHint.hidden = !leakHidden(); changed(true); };
  function resultPanel(body, hd, x) {
    const mode = RL.modeOf(s.row.work_type), cfg = RL.MODES[mode];
    hd.append(mk('div', 'card-t', cfg.rSection), x);
    cfg.rRows.forEach(r => {
      if (r.field === 'afterStatus') {
        body.append(selectEl('rs-sp-afterStatus', r.label, [['', '— 選択してください —'], ...RL.AFTER_STATUS.map(v => [v, v])], s.d.afterStatusSel, setD('afterStatusSel')),
          input('rs-sp-afterNote', r.label + 'の補足', s.d.afterNote, { rows: 2, maxLength: 1000 }, setD('afterNote'), 'textarea'));
      } else body.appendChild(input('rs-sp-' + r.field, r.label.replace(/　/g, ''), s.d[r.field], { rows: 2, maxLength: 2000 }, setD(r.field), 'textarea'));
      if (r.field === 'leakAction') {
        s.leakHint = mk('div', 'hint', '漏水の状況が「漏れている…」でないときは紙面に出ません');
        s.leakHint.id = 'rs-sp-leakhint';
        s.leakHint.hidden = !leakHidden();
        body.appendChild(s.leakHint);
      }
    });
  }
  function photoPanel(body, hd, x) {
    const i = s.sel.photo, p = s.photos[i], n = s.photos.length;
    hd.append(mk('div', 'card-t', '写真 No.' + (i + 1)), x);
    const setP = key => v => { s.photos = s.photos.map((q, k) => (k === i ? Object.assign({}, q, { [key]: v }) : q)); changed(); };
    body.append(selectEl('rs-sp-phase', '区分', Object.entries(RL.PHASES), p.phase || '', setP('phase')),
      input('rs-sp-cap', 'キャプション', p.caption, { maxLength: 60, autocomplete: 'off' }, setP('caption')));
    const nav = mk('div', 'grid2');
    const move = dir => () => { s.photos = RL.movePhoto(s.photos, i, dir); changed(null); select({ photo: i + dir }); };
    const prev = dBtn('前へ', 'btn ghost sm', move(-1));
    prev.id = 'rs-sp-prev';
    prev.disabled = i === 0;
    const next = dBtn('後へ', 'btn ghost sm', move(1));
    next.id = 'rs-sp-next';
    next.disabled = i >= n - 1;
    nav.append(prev, next);
    const del = dBtn('この写真を外す', 'btn ghost sm danger', async () => {
      if (!(await askPopup('この写真（No.' + (i + 1) + '）を外しますか？\n付けた印も消えます。', { title: '写真を外す', okLabel: '外す', danger: true, id: 'rs-sp-del-ask' }))) return;
      if (!s) return;
      const before = s.photos, gone = s.photos[i];
      s.photos = RL.removePhoto(s.photos, i);
      s.dirty = true;
      close();
      try { await flush(); } catch (e) { if (s) { s.photos = before; renderSheet(); } toast('外せませんでした: ' + errText(e)); return; }
      sb.storage.from('photos').remove([gone.path]); // 06 の削除と同じ（結果は待たない）
    });
    del.id = 'rs-sp-del';
    body.append(nav, del);
  }
  function renderPanel() {
    const p = s.panel;
    const hd = mk('div', 'es-sp-hd');
    const x = dBtn('×', 'modal-x', close);
    x.id = 'rs-sheet-x';
    x.setAttribute('aria-label', '閉じる');
    const body = mk('div', 'es-sp-b');
    const f = s.sel.field;
    s.leakHint = null;
    if (s.sel.photo != null) photoPanel(body, hd, x);
    else if (f === 'items' || f === 'checklist') {
      hd.append(mk('div', 'card-t', f === 'items' ? '作業実施項目' : 'チェックリスト'), x);
      body.appendChild(mk('div', 'hint', '作業実施項目・チェックリストは「編集に戻る」で直せます'));
      const back = dBtn('編集に戻る', 'btn ghost', () => { location.hash = '#report/' + s.row.id; });
      back.id = 'rs-sp-edit';
      body.appendChild(back);
    } else resultPanel(body, hd, x);
    p.replaceChildren(hd, body);
    p.hidden = false;
    s.host.style.paddingBottom = p.offsetHeight + 'px'; // パネルに隠れた所までめくれるように
    const on = s.scaler.querySelector('.sel');
    if (on) { const b = on.getBoundingClientRect().bottom, lim = innerHeight - p.offsetHeight - 8; if (b > lim) window.scrollBy(0, b - lim); }
    const fe = f && $(f === 'afterStatus' ? 'rs-sp-afterStatus' : 'rs-sp-' + f);
    if (fe) fe.focus({ preventScroll: true });
  }

  /* ---------- 組む・外す ---------- */
  function mount(host, st, opts) {
    unmount();
    ReportPdf.injectCss();
    const bar = mk('div', 'es-sheet-bar');
    const seg = mk('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', '紙面の大きさ');
    const fit = dBtn('全体', null, () => { if (s && s.pz) s.pz.reset(); });
    fit.id = 'rs-sheet-fit';
    const zoom = dBtn('拡大', null, () => { if (s && s.pz) s.pz.zoom(2); });
    zoom.id = 'rs-sheet-zoom';
    seg.append(fit, zoom);
    const saveEl = mk('div', 'hint');
    saveEl.id = 'rs-sheet-save';
    bar.append(seg, mk('div', 'hint', '結果の表や写真を押すと、下で直せます。二本指で拡大できます。'), saveEl);
    const stage = mk('div', 'es-stage');
    stage.id = 'rs-sheet';
    const pzEl = mk('div', 'es-pz');
    const scaler = mk('div', 'es-scale');
    pzEl.appendChild(scaler);
    stage.appendChild(pzEl);
    host.replaceChildren(bar, stage);
    const panel = mk('div', 'es-sheet-panel');
    panel.id = 'rs-sheet-panel';
    panel.hidden = true;
    (host.closest('.screen') || document.body).appendChild(panel);
    // shortcut: 縮める率は開いたときの幅で決める。回転で幅が変わったら次に開いたときに直る（estimate-sheet-ui と同じ）
    const k = Math.min(1, stage.clientWidth / PAGE_PX);
    scaler.style.transform = 'scale(' + k + ')';
    pzEl.style.width = PAGE_PX * k + 'px';
    const photos = Array.isArray(st.photos) ? st.photos : [];
    const u = {};
    photos.forEach((p, i) => { u[p.path] = (st.photoUrls || [])[i] || ''; });
    s = { host, row: st.row, caseRow: st.caseRow, d: st.d, photos, urls: u, composed: {}, org: st.org, logoUrl: st.logoUrl || '', raf: 0, full: false, leakHint: null, down: null, opts: opts || {}, sel: null, k, pz: null,
      stage, pzEl, scaler, panel, saveEl, timer: null, saving: null, dirty: false, savedAt: '', err: '' };
    renderSheet();
    if (typeof window.Panzoom === 'function') {
      s.pz = window.Panzoom(pzEl, { minScale: 1, maxScale: 4, panOnlyWhenZoomed: true, touchAction: 'pan-y', cursor: '' });
      pzEl.addEventListener('panzoomchange', ev => { const t = ev.detail.scale > 1 ? 'none' : 'pan-y'; pzEl.style.touchAction = stage.style.touchAction = t; });
    }
    stage.addEventListener('pointerdown', e => { if (s) s.down = { x: e.clientX, y: e.clientY }; }, true);
    stage.addEventListener('click', onTap);
  }
  // PDF を作っている間は直させない（送る PDF と紙面の中身をそろえる）
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
  const data = () => (s ? { d: s.d, photos: s.photos } : null);
  return { mount, unmount, flush, data, lock };
})();
