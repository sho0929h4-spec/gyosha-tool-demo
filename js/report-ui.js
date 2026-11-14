// js/report-ui.js — 06 報告書: 作業区分 → 基本情報（物件名・号室は案件から）→ 区分ごとの欄 → 写真（撮影/アルバム・区分・印つけ）→ チェックリスト → 確認 → 下書き保存／紙面を見る
// 項目・文言・規則は ReportLogic（report-tool の MODES）。入力は 1.5秒で自動保存（reports.work_type / data / photos）。写真は Storage photos（{org}/reports/{報告書}/{uuid}.jpg）
const ReportUi = (() => {
  const RL = ReportLogic;
  const SAVE_MS = 1500;
  let st = null; // { row, caseRow, noticeMade（同じ案件に PDF を作った工事掲示がある）, mode, d, photos, urls, timer, saving, dirty, savedAt, err }

  async function create(caseRow) {
    const { data, error } = await sb.from('reports').insert({ case_id: caseRow.id, work_type: 'investigate', data: RL.newData(caseRow, new Date()), photos: [] }).select().single();
    if (error) throw error;
    return data;
  }

  /* ---------- 保存 ---------- */
  function setSub() {
    if (!st) return;
    const place = CaseLogic.placeName(st.caseRow);
    const t = st.err ? '保存できませんでした（' + st.err + '）' : st.saving ? '保存中…' : st.savedAt ? '自動保存 ' + st.savedAt : '';
    $('rp-sub').textContent = [place, t].filter(Boolean).join(' ・ ');
    $('rp-sub').classList.toggle('err', !!st.err);
  }
  function changed() {
    if (!st) return;
    st.dirty = true;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { saveNow().catch(() => {}); }, SAVE_MS);
    renderNotes();
  }
  async function saveNow(extra) {
    if (!st) return;
    const s = st;
    clearTimeout(s.timer);
    if (extra) Object.assign(s.d, extra);
    if (!s.dirty && !extra) return;
    while (s.saving) await s.saving.catch(() => {});
    s.dirty = false;
    s.saving = (async () => {
      const { error } = await sb.from('reports').update({ work_type: s.mode, data: s.d, photos: s.photos }).eq('id', s.row.id);
      if (error) throw error;
    })();
    setSub();
    try {
      await s.saving;
      s.err = '';
      const n = new Date();
      s.savedAt = n.getHours() + ':' + String(n.getMinutes()).padStart(2, '0');
    } catch (e) {
      s.dirty = true; // 次の入力・ボタンでもう一度
      s.err = errText(e);
      throw e;
    } finally {
      s.saving = null;
      setSub();
    }
  }
  App.onLeave(async () => { if (st && (st.dirty || st.saving)) { try { await saveNow(); } catch (e) { toast('報告書を保存できませんでした: ' + errText(e)); } } });

  /* ---------- 部品 ---------- */
  const card = (title, id) => { const c = mk('div', 'card'); if (id) c.id = id; if (title) c.appendChild(mk('div', 'card-t', title)); return c; };
  function field(labelText, control, opts) {
    const o = opts || {};
    const f = mk('div', 'ff');
    const l = mk('label', null, labelText);
    if (o.req) l.appendChild(mk('span', 'req', '必須'));
    if (control.id) l.htmlFor = control.id;
    f.appendChild(l);
    if (o.hint) f.appendChild(mk('span', 'hint', o.hint));
    f.appendChild(o.wrap || control);
    return f;
  }
  function input(id, type, key, attrs) {
    const e = document.createElement('input');
    e.type = type;
    e.id = id;
    e.value = st.d[key] || '';
    Object.assign(e, attrs || {});
    e.addEventListener('input', () => { st.d[key] = e.value; changed(); });
    return e;
  }
  function area(id, key, rows, ph) {
    const e = document.createElement('textarea');
    e.id = id;
    e.rows = rows;
    e.value = st.d[key] || '';
    if (ph) e.placeholder = ph;
    e.addEventListener('input', () => { st.d[key] = e.value; changed(); });
    return e;
  }
  // options: [[値, 表示]]。rerender: 選び直したら欄の出し入れが変わる
  function select(id, key, options, rerender) {
    const e = document.createElement('select');
    e.id = id;
    [['', '— 選択してください —'], ...options].forEach(([v, t]) => e.appendChild(new Option(t, v)));
    if (st.d[key] && !options.some(([v]) => v === st.d[key])) e.appendChild(new Option(st.d[key], st.d[key])); // 紙面（report-sheet-ui）で自由に書いた値も出す
    e.value = st.d[key] || '';
    e.addEventListener('change', () => { st.d[key] = e.value; changed(); if (rerender) render(); });
    return e;
  }
  // 押すと ✓ のチップ。list = st.d の配列のキー、または { get, set }（places のような入れ子の配列）
  function chip(text, list, val, onToggle) {
    const b = mk('button', 'chip');
    b.type = 'button';
    b.append(mk('span', 'chip-box', '✓'), mk('span', null, text));
    const get = () => (typeof list === 'string' ? st.d[list] : list.get()) || [];
    const set = a => (typeof list === 'string' ? (st.d[list] = a) : list.set(a));
    const on = () => get().includes(val);
    b.setAttribute('aria-pressed', String(on()));
    b.addEventListener('click', () => {
      const a = get().filter(x => x !== val);
      if (!on()) a.push(val);
      set(a);
      b.setAttribute('aria-pressed', String(on()));
      changed();
      if (onToggle) onToggle(on());
    });
    return b;
  }
  /* ---------- 項目の設定（歯車。会社で1つ = orgs.report_items。会社の人なら誰でも直せて、全員の画面に効く） ---------- */
  function gear(id, name, key) {
    const b = mk('button', 'gear');
    b.type = 'button';
    b.id = id;
    b.setAttribute('aria-label', name + 'の項目を設定');
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.3 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z');
    svg.appendChild(p);
    b.appendChild(svg);
    b.addEventListener('click', () => editItems(name, key));
    return b;
  }
  // ポップアップ（× と「キャンセル」でだけ閉じる）。保存 = 会社の項目として残し（rpc set_report_items）、画面を作り直す（書きかけの報告書はそのまま）
  function editItems(name, key) {
    let list = RL.listOf(key).slice();
    const bg = mk('div', 'modal-bg');
    const dlg = mk('div', 'modal');
    dlg.id = 'rp-items-pop';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-label', name + 'の設定');
    const close = () => bg.remove();
    const hd = mk('div', 'modal-hd');
    const x = dBtn('×', 'modal-x', close);
    x.id = 'rp-items-x';
    x.setAttribute('aria-label', '閉じる');
    hd.append(mk('h3', null, name + 'の設定'), x);
    const rows = mk('div', 'ie-list');
    rows.id = 'rp-items-list';
    const msg = mk('div', 'msg');
    msg.id = 'rp-items-msg';
    const draw = () => {
      rows.replaceChildren();
      if (!list.length) rows.appendChild(mk('div', 'hint', '項目がありません。下で足してください'));
      list.forEach((it, i) => {
        const r = mk('div', 'ie-row');
        const move = (label, to) => { const b = dBtn(label, 'btn ghost sm', () => { list.splice(to, 0, list.splice(i, 1)[0]); draw(); }); b.disabled = to < 0 || to >= list.length; b.setAttribute('aria-label', it + 'を' + label); return b; };
        const del = dBtn('消す', 'btn ghost sm', () => { list.splice(i, 1); draw(); });
        del.setAttribute('aria-label', it + 'を消す');
        r.append(mk('span', 'ie-name', it), move('上へ', i - 1), move('下へ', i + 1), del);
        rows.appendChild(r);
      });
    };
    const add = mk('input');
    add.type = 'text';
    add.id = 'rp-items-new';
    add.maxLength = RL.ITEM_MAX;
    add.placeholder = '足す項目の名前';
    add.setAttribute('aria-label', '足す項目の名前');
    const addBtn = dBtn('追加', 'btn ghost sm', () => {
      const next = RL.cleanCustom({ [key]: list.concat([add.value]) })[key]; // 空・同じ名前・使えない名前（その他 など）は入らない
      if (next.length === list.length) { msg.className = 'msg err'; msg.textContent = !add.value.trim() ? '名前を入れてください' : list.length >= RL.ITEMS_MAX ? '項目は ' + RL.ITEMS_MAX + ' 個までです' : 'その名前は使えません（同じ名前があるか、自由記載と重なります）'; return; }
      list = next; add.value = ''; msg.textContent = ''; draw();
    });
    addBtn.id = 'rp-items-add';
    const addRow = mk('div', 'ie-add');
    addRow.append(add, addBtn);
    const reset = dBtn('最初の項目に戻す', 'btn ghost sm', () => { list = RL.DEFAULT_LISTS[key].slice(); msg.textContent = ''; draw(); });
    reset.id = 'rp-items-reset';
    const act = mk('div', 'modal-act');
    const no = dBtn('キャンセル', 'btn ghost', close);
    no.id = 'rp-items-no';
    const save = dBtn('保存', 'btn', async () => {
      save.disabled = true;
      try {
        const items = RL.cleanCustom(ctx.org.report_items);
        if (list.join('\n') === RL.DEFAULT_LISTS[key].join('\n')) delete items[key]; else items[key] = list;
        const { data, error } = await sb.rpc('set_report_items', { p_items: items });
        if (error) throw error;
        ctx.org.report_items = data;
        RL.setCustom(data);
        close();
        render();
        toast('項目を保存しました');
      } catch (e) { msg.className = 'msg err'; msg.textContent = '保存できませんでした: ' + errText(e); save.disabled = false; }
    });
    save.id = 'rp-items-save';
    act.append(no, save);
    dlg.append(hd, mk('p', 'hint', '会社の全員の画面に効きます。消しても、前に作った報告書のチェックは残ります。'), rows, addRow, msg, reset, act);
    bg.appendChild(dlg);
    document.body.appendChild(bg);
    draw();
  }
  const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  /* ---------- 画面 ---------- */
  function render() {
    const cfg = RL.MODES[st.mode];
    const body = $('rp-body');
    const y = window.scrollY;
    body.replaceChildren();

    // 作業区分
    body.appendChild(mk('div', 'lbl', '作業区分（選ぶと下の項目が変わる）'));
    const seg = mk('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', '作業区分');
    Object.keys(RL.MODES).forEach(m => {
      const b = dBtn(RL.MODE_LABEL[m], '', () => { if (st.mode === m) return; st.mode = m; changed(); render(); });
      b.id = 'rp-mode-' + m;
      b.setAttribute('aria-pressed', String(st.mode === m));
      seg.appendChild(b);
    });
    body.appendChild(seg);
    // その他のときだけ、区分の名前（点検・立会いなど）を自由に書く
    if (st.mode === 'other') {
      body.appendChild(field('作業区分の名前', input('rp-worklabel', 'text', 'workLabel', { maxLength: 10, placeholder: '例：点検、立会い' }), { hint: '報告書の題と「作業内容」に出ます（10文字まで）' }));
    }

    // 基本情報
    const basic = card('基本情報（案件から自動）');
    const g = mk('div', 'grid2');
    g.append(
      field('物件名', input('rp-prop', 'text', 'prop', { maxLength: 100 })),
      field('号室', input('rp-room', 'text', 'room', { maxLength: 40 })),
      field('作業日', input('rp-date', 'date', 'workDate')),
      field('案件No', input('rp-caseno', 'text', 'caseNo', { maxLength: 40, placeholder: '案件No（任意）' }))
    );
    basic.appendChild(g);
    [['rp-ts', 'ts', '作業開始時間'], ['rp-te', 'te', '作業終了時間']].forEach(([id, key, label]) => {
      const inp = input(id, 'time', key);
      const row = mk('div', 'time-row');
      const now = dBtn('現在時刻', '', () => { inp.value = nowHM(); st.d[key] = inp.value; changed(); });
      now.id = id + '-now';
      row.append(inp, now);
      basic.appendChild(field(label, inp, { wrap: row }));
    });
    body.appendChild(basic);

    // 作業実施項目 / 施工範囲
    if (cfg.checkGroups.length) {
      const c = card(cfg.checkCardTitle, 'rp-items');
      c.querySelector('.card-t').append(mk('span', 'hint', '（押すと✓）'), gear('rp-items-gear', '作業実施項目', cfg.checkGroups[0].list));
      RL.groups(st.mode, st.d).forEach((grp, gi) => {
        if (grp.title) c.appendChild(mk('div', 'grp-t', grp.title));
        const chips = mk('div', 'chips');
        // 場所を選べる項目（排水テスト・その他）: 押すと下に場所のチップが出る
        const placeRows = [];
        const placeRow = (item, id) => {
          if (!(grp.placeItems || []).includes(item)) return null;
          const row = mk('div', 'place-row');
          row.id = id;
          row.hidden = !(st.d.items || []).includes(item);
          row.appendChild(mk('div', 'grp-t', item + 'の場所'));
          const pc = mk('div', 'chips');
          st.d.places = st.d.places || {};
          const bind = { get: () => st.d.places[item], set: a => { st.d.places[item] = a; } };
          RL.RESTORE_PLACES.forEach(p => pc.appendChild(chip(p, bind, p)));
          row.appendChild(pc);
          placeRows.push(row);
          return row;
        };
        grp.items.forEach((i, ii) => {
          const row = placeRow(i, `rp-place-${gi}-${ii}`);
          chips.appendChild(chip(i, 'items', i, row ? on => { row.hidden = !on; } : null));
        });
        if (grp.free) {
          const row = placeRow(grp.freePrefix, `rp-place-${gi}-free`);
          const free = document.createElement('input');
          free.type = 'text';
          free.id = 'rp-free-' + gi;
          free.placeholder = '自由記載';
          free.maxLength = 100;
          free.setAttribute('aria-label', (grp.title || '') + '自由記載');
          st.d.free = st.d.free || {};
          free.value = st.d.free[grp.freePrefix] || '';
          free.hidden = !(st.d.items || []).includes(grp.freePrefix);
          free.addEventListener('input', () => { st.d.free[grp.freePrefix] = free.value; changed(); });
          chips.appendChild(chip('自由記載', 'items', grp.freePrefix, on => { if (row) row.hidden = !on; free.hidden = !on; if (on) free.focus(); }));
          c.append(chips, ...placeRows, free);
        } else c.append(chips, ...placeRows);
      });
      body.appendChild(c);
    }

    // 作業内容（区分ごとの欄）
    const ct = card(cfg.contentCardTitle, 'rp-content');
    // 漏水調査（f1Last）は作業実施内容を一番下（次の必要な対応の上）に出す
    const f1 = field(cfg.f1Label, area('rp-f1', 'f1', 5, cfg.f1ph), { req: cfg.f1Req, hint: RL.HINT.f1 });
    if (!cfg.f1Last) ct.appendChild(f1);
    if (cfg.showLeak) {
      ct.appendChild(field('漏水の状況', select('rp-leak', 'leak', RL.LEAK.map(v => [v, v]), true)));
      if (String(st.d.leak || '').startsWith('漏れている')) {
        ct.appendChild(field('漏水時の対応', select('rp-leakaction', 'leakAction', RL.LEAK_ACTION, true)));
        if (st.d.leakAction === '元栓閉め') ct.appendChild(field('元栓を閉めた号室', input('rp-leakroom', 'text', 'leakRoom', { placeholder: '号室（例：605）', maxLength: 20 })));
      }
    }
    if (cfg.showAfter) {
      ct.appendChild(field('対応後の状況', select('rp-after', 'afterStatusSel', RL.AFTER_STATUS.map(v => [v, v]))));
      const note = area('rp-afternote', 'afterNote', 2, '補足（任意・自由記載）');
      note.setAttribute('aria-label', '対応後の状況の補足');
      ct.appendChild(note);
    }
    if (cfg.showNote) ct.appendChild(field('申し送り', area('rp-note', 'note', 3, cfg.noteph)));
    if (cfg.showF2) ct.appendChild(field('原因', area('rp-f2', 'f2', 2), { hint: RL.HINT.f2 }));
    if (cfg.showReason) ct.appendChild(field('原因と判断した理由', area('rp-reason', 'reason', 2), { hint: RL.HINT.reason }));
    if (cfg.f1Last) ct.appendChild(f1);
    if (cfg.showF4) ct.appendChild(field('次の必要な対応', area('rp-f4', 'f4', 2), { hint: RL.HINT.f4 }));
    body.appendChild(ct);

    // 写真
    const pc = card('写真（作業前／作業中／作業後）', 'rp-photos');
    pc.appendChild(mk('div', 'hint', '撮っておく写真: ' + cfg.ctxPhotoLabel + '。写真を押すと丸・矢印・四角・文字の印つけ'));
    const add = mk('div', 'add-row');
    [['rp-cam', '撮影', true], ['rp-album', 'アルバムから', false]].forEach(([id, label, cam]) => {
      const f = document.createElement('input');
      f.type = 'file';
      f.accept = 'image/*';
      f.id = id;
      f.hidden = true;
      if (cam) f.setAttribute('capture', 'environment'); else f.multiple = true;
      f.addEventListener('change', () => { const fs = Array.from(f.files || []); f.value = ''; addPhotos(fs); });
      add.append(f, dBtn(label, 'btn ghost sm', () => f.click()));
    });
    pc.appendChild(add);
    const pmsg = mk('div', 'msg');
    pmsg.id = 'rp-photo-msg';
    pc.appendChild(pmsg);
    const grid = mk('div', 'photos');
    grid.id = 'rp-photo-list';
    pc.appendChild(grid);
    body.appendChild(pc);
    renderPhotos();

    // チェックリスト
    const cl = card('チェックリスト', 'rp-checklist');
    cl.querySelector('.card-t').append(gear('rp-checklist-gear', 'チェックリスト', 'check'));
    const wl = mk('div', 'chips col');
    RL.workItems(st.mode, st.noticeMade, st.d).forEach(i => wl.appendChild(chip(i, 'workChecklist', i)));
    cl.appendChild(wl);
    body.appendChild(cl);

    const notes = mk('div', 'notes');
    notes.id = 'rp-notes';
    notes.setAttribute('role', 'status');
    body.appendChild(notes);
    renderNotes();
    window.scrollTo(0, y);
  }
  function renderNotes() {
    const box = $('rp-notes');
    if (!box || !st) return;
    const list = RL.validate(st.d, st.mode, st.photos.length);
    box.hidden = !list.length;
    box.replaceChildren(mk('div', null, '確認（PDFは作れます）'));
    const ul = mk('ul');
    list.forEach(t => ul.appendChild(mk('li', null, t)));
    box.appendChild(ul);
  }

  /* ---------- 写真 ---------- */
  async function urlOf(p) {
    if (!st.urls[p.path]) st.urls[p.path] = await signedUrl(p.path);
    return st.urls[p.path];
  }
  function renderPhotos() {
    const grid = $('rp-photo-list');
    if (!grid) return;
    grid.replaceChildren();
    st.photos.forEach((p, i) => {
      const box = mk('div', 'ph');
      const imgBtn = mk('button', 'ph-img');
      imgBtn.type = 'button';
      imgBtn.setAttribute('aria-label', '写真 ' + (i + 1) + ' に印をつける');
      const img = mk('img');
      img.alt = '写真 ' + (i + 1);
      urlOf(p).then(u => (window.PhotoMarkEditor ? PhotoMarkEditor.thumbSrc(u, p.marks) : u)).then(u => { img.src = u; })
        .catch(e => { img.alt = '写真を読み込めませんでした: ' + errText(e); });
      imgBtn.appendChild(img);
      imgBtn.addEventListener('click', () => openMarks(i));
      const b = mk('div', 'ph-b');
      b.appendChild(mk('div', 'ph-no', 'No.' + (i + 1) + ((p.marks || []).length ? ' ・ 印 ' + p.marks.length : '')));
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', '写真 ' + (i + 1) + ' の区分');
      sel.className = 'rp-phase';
      Object.entries(RL.PHASES).forEach(([k, v]) => sel.appendChild(new Option(v, k)));
      sel.value = p.phase || '';
      sel.addEventListener('change', () => { p.phase = sel.value; changed(); });
      const cap = document.createElement('input');
      cap.type = 'text';
      cap.maxLength = 60;
      cap.className = 'rp-cap';
      cap.placeholder = '説明（例：玄関から居室方向を撮影）';
      cap.setAttribute('aria-label', '写真 ' + (i + 1) + ' の説明');
      cap.value = p.caption || '';
      cap.addEventListener('input', () => { p.caption = cap.value; changed(); });
      const acts = mk('div', 'ph-acts');
      acts.append(dBtn('印つけ', 'btn ghost sm rp-mark', () => openMarks(i)), dBtn('削除', 'btn ghost sm rp-del', () => delPhoto(i)));
      b.append(sel, cap, acts);
      box.append(imgBtn, b);
      grid.appendChild(box);
    });
    renderNotes();
  }
  async function addPhotos(files) {
    const s = st;
    const msg = $('rp-photo-msg');
    for (let k = 0; k < files.length; k++) {
      msg.className = 'msg';
      msg.textContent = '写真を保存中…（' + (k + 1) + '/' + files.length + '）';
      try {
        const blob = await shrinkImage(files[k], 1200, 'image/jpeg', 0.7); // 1200px・0.7（無料枠に収める。docs/notes/2026-11-08-production-roadmap.md）
        const path = ctx.org.id + '/reports/' + s.row.id + '/' + newId() + '.jpg';
        await Files.upload(path, blob, 'image/jpeg', 'photo');
        if (st !== s) return;
        s.photos.push({ path, phase: '', caption: '', marks: [] });
        s.dirty = true;
        await saveNow();
        renderPhotos();
      } catch (e) {
        msg.className = 'msg err';
        msg.textContent = '写真を保存できませんでした: ' + errText(e);
        return;
      }
    }
    msg.textContent = '';
  }
  async function delPhoto(i) {
    if (!(await askPopup('この写真（No.' + (i + 1) + '）を消しますか？\n付けた印も消えます。', { title: '写真を消す', okLabel: '消す', danger: true, id: 'photo-del-ask' }))) return;
    const [p] = st.photos.splice(i, 1);
    st.dirty = true;
    try { await saveNow(); } catch (e) { st.photos.splice(i, 0, p); renderPhotos(); toast('消せませんでした: ' + errText(e)); return; }
    Files.remove(p.path);
    renderPhotos();
  }
  async function openMarks(i) {
    const p = st.photos[i];
    let src;
    try { src = await urlOf(p); } catch (e) { toast('写真を読み込めませんでした: ' + errText(e)); return; }
    const same = st.photos.filter(x => (x.phase || '') === (p.phase || ''));
    const label = RL.PHASES[p.phase] && p.phase ? RL.PHASES[p.phase] : '写真';
    PhotoMarkEditor.open({
      src, marks: p.marks, title: label + ' ' + (same.indexOf(p) + 1) + '/' + same.length,
      onSave: async marks => {
        const before = p.marks;
        p.marks = marks;
        st.dirty = true;
        try { await saveNow(); } catch (e) { p.marks = before; throw e; }
        renderPhotos();
      }
    });
  }

  /* ---------- 開く・ボタン ---------- */
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $('rp-back').addEventListener('click', () => { if (st) location.hash = '#case/' + st.caseRow.id; });
    $('rp-draft').addEventListener('click', async () => {
      if (!st) return;
      $('rp-draft').disabled = true;
      try { st.dirty = true; await saveNow(); toast('下書きを保存しました'); location.hash = '#case/' + st.caseRow.id; }
      catch (e) { toast('保存できませんでした: ' + errText(e)); }
      finally { $('rp-draft').disabled = false; }
    });
    $('rp-pdf').addEventListener('click', async () => {
      if (!st) return;
      $('rp-pdf').disabled = true;
      try { await saveNow({ pdf_at: new Date().toISOString() }); location.hash = '#doc/report/' + st.row.id; }
      catch (e) { toast('保存できませんでした: ' + errText(e)); }
      finally { $('rp-pdf').disabled = false; }
    });
  }
  async function show(id) {
    wire();
    st = null;
    $('rp-body').replaceChildren(mk('div', 'empty', '読み込み中…'));
    showScreen('report');
    const r = await sb.from('reports').select('*').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) { toast('報告書が見つかりませんでした'); location.replace('#cases'); return; }
    // 報告書の項目（会社で1つ）は開くたびに読み直す（ほかの人が歯車で変えたかもしれない。読めなければ今のまま）
    const [caseRow, notices, items] = await Promise.all([CasesApi.get(r.data.case_id), DocsApi.notices(r.data.case_id).catch(() => []),
      sb.from('orgs').select('report_items').eq('id', ctx.org.id).maybeSingle()]);
    if (items.data) { ctx.org.report_items = items.data.report_items; RL.setCustom(items.data.report_items); }
    st = { row: r.data, caseRow: caseRow || {}, noticeMade: notices.some(n => n.data && n.data.pdf_at), mode: RL.modeOf(r.data.work_type), d: Object.assign(RL.newData(caseRow), r.data.data || {}),
      photos: Array.isArray(r.data.photos) ? r.data.photos : [], urls: {}, timer: null, saving: null, dirty: false, savedAt: '', err: '' };
    setSub();
    render();
  }
  return { create, show };
})();
