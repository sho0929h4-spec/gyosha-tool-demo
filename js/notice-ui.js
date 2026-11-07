// js/notice-ui.js — 09 工事掲示: 入力（移植メモ §4.1）→ A4 プレビュー（縮めて見せる・その場で書き換え §4.5・1ページに入るか §4.7）→ 別の号室に複製／下書き保存／PDFを作る → 共有
// 規則・文言は NoticeLogic、紙面は NoticePdf.build（PDF と同じもの）。入力は 1.5秒で自動保存（notices.data。形は移植メモ §4.9）。
// 必須（物件名・号室・工事名称）は PDF を作るときだけ確かめる。元の confirm は askPopup にした。
const NoticeUi = (() => {
  const NL = NoticeLogic;
  const SAVE_MS = 1500;
  const REQ_ID = { propertyName: 'nt-prop', roomNo: 'nt-room', workName: 'nt-name' };
  let st = null; // { row, caseRow, d, overflow, skip, timer, saving, dirty, savedAt, err }

  async function create(caseRow) {
    const { data, error } = await sb.from('notices').insert({ case_id: caseRow.id, data: NL.newData(caseRow, new Date(), ctx.org) }).select().single();
    if (error) throw error;
    return data;
  }

  /* ---------- 保存（report-ui と同じ形） ---------- */
  function setSub() {
    if (!st) return;
    const t = st.err ? '保存できませんでした（' + st.err + '）' : st.saving ? '保存中…' : st.savedAt ? '自動保存 ' + st.savedAt : '';
    $('nt-sub').textContent = [CaseLogic.placeName({ name: st.d.propertyName, room: st.d.roomNo }), t].filter(Boolean).join(' ・ ');
    $('nt-sub').classList.toggle('err', !!st.err);
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
    if (extra) Object.assign(s.d, extra);
    if (!s.dirty && !extra) return;
    while (s.saving) await s.saving.catch(() => {});
    s.dirty = false;
    s.saving = (async () => {
      const { error } = await sb.from('notices').update({ data: s.d }).eq('id', s.row.id);
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
  App.onLeave(async () => { if (st && (st.dirty || st.saving)) { try { await saveNow(); } catch (e) { toast('工事掲示を保存できませんでした: ' + errText(e)); } } });

  // 入力が変わった: 紙面を描き直して保存を待つ
  const upd = () => { renderSheet(); changed(); };

  /* ---------- 部品 ---------- */
  const card = (title, id) => { const c = mk('div', 'card'); if (id) c.id = id; if (title) c.appendChild(mk('div', 'card-t', title)); return c; };
  function field(labelText, control, o) {
    o = o || {};
    const f = mk('div', 'ff');
    const l = mk('label', null, labelText);
    if (o.req) l.appendChild(mk('span', 'req', '必須'));
    if (control.id) l.htmlFor = control.id;
    f.appendChild(l);
    if (o.hint) f.appendChild(mk('span', 'hint', o.hint));
    f.appendChild(o.wrap || control);
    return f;
  }
  // st.d[key] に入れる欄（get・set を渡せば入れ子の値にも使う）
  function input(id, type, key, attrs, onSet) {
    const e = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') e.type = type;
    e.id = id;
    Object.assign(e, attrs || {});
    e.value = st.d[key] == null ? '' : st.d[key];
    e.addEventListener('input', () => {
      if (e.classList.contains('invalid')) { e.classList.remove('invalid'); if (!$('nt-body').querySelector('.invalid')) $('nt-msg').textContent = ''; }
      st.d[key] = e.value;
      if (onSet) onSet(e.value);
      upd();
    });
    return e;
  }
  function check(id, text, get, set) {
    const l = mk('label', 'check');
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.id = id;
    c.checked = !!get();
    c.addEventListener('change', () => { set(c.checked); upd(); });
    l.append(c, document.createTextNode(text));
    return l;
  }
  const range = (a, b) => { const r = mk('div', 'nt-range'); r.append(a, mk('span', null, '〜'), b); return r; };

  /* ---------- 入力 ---------- */
  function renderForm() {
    const body = $('nt-body');
    body.replaceChildren();
    const d = st.d;

    const basic = card('物件・工事（案件から自動。書き換え可）', 'nt-basic');
    const msg = mk('div', 'msg err');
    msg.id = 'nt-msg';
    msg.setAttribute('role', 'alert');
    const addr = input('nt-addressee', 'text', 'addressee', { maxLength: 100 }, v => { d.addresseeEdited = !!v.trim(); });
    addr.value = NL.compose(d).addressee;
    const prop = input('nt-prop', 'text', 'propertyName', { maxLength: 100 }, () => { if (!d.addresseeEdited) addr.value = NL.autoAddressee(d); });
    const addrBack = dBtn('自動生成に戻す', 'btn ghost sm', () => { d.addresseeEdited = false; d.addressee = ''; addr.value = NL.autoAddressee(d); upd(); });
    addrBack.id = 'nt-addr-auto';
    const g = mk('div', 'grid2');
    g.append(field('物件名', prop, { req: true }), field('号室', input('nt-room', 'text', 'roomNo', { maxLength: 40, placeholder: '302' }), { req: true }));
    basic.append(msg, g, field('宛名', addr, { hint: '物件名から自動。手で書くとそのまま使います' }), addrBack,
      field('工事名称', input('nt-name', 'text', 'workName', { maxLength: 100 }), { req: true }));
    body.appendChild(basic);

    // 日付
    const dc = card('日付・時間', 'nt-dates');
    const ny = input('nt-ny', 'number', 'noticeYear', { min: 2000, max: 2100, inputMode: 'numeric' });
    ny.setAttribute('aria-label', '通知日の年');
    const nm = document.createElement('select');
    nm.id = 'nt-nm';
    nm.setAttribute('aria-label', '通知日の月');
    for (let m = 1; m <= 12; m++) nm.appendChild(new Option(m + '月', String(m)));
    nm.value = String(d.noticeMonth || '');
    nm.addEventListener('change', () => { d.noticeMonth = nm.value; upd(); });
    const nd = input('nt-nd', 'number', 'noticeDay', { min: 1, max: 31, inputMode: 'numeric', placeholder: '日' });
    nd.setAttribute('aria-label', '通知日の日');
    nd.hidden = !!d.noticeKichijitsu;
    const d3 = mk('div', 'nt-date3');
    d3.append(ny, nm, nd);
    dc.appendChild(field('通知日（右上）', ny, { wrap: d3 }));
    dc.appendChild(check('nt-nk', '吉日', () => d.noticeKichijitsu, v => { d.noticeKichijitsu = v; nd.hidden = v; }));
    const wd = input('nt-wd', 'date', 'workDate'), wde = input('nt-wde', 'date', 'workDateEnd');
    wde.setAttribute('aria-label', '工事日の終わり');
    dc.appendChild(field('工事日', wd, { wrap: range(wd, wde) }));
    dc.appendChild(check('nt-wtbd', '未定', () => d.workDateTbd, v => { d.workDateTbd = v; }));
    const ts = input('nt-ts', 'time', 'timeStart'), te = input('nt-te', 'time', 'timeEnd');
    te.setAttribute('aria-label', '作業時間の終わり');
    dc.appendChild(field('作業時間', ts, { wrap: range(ts, te) }));
    dc.appendChild(check('nt-tp', '（予定）を付ける', () => d.timePlanned, v => { d.timePlanned = v; }));
    body.appendChild(dc);

    // 工事の内容（選んだときだけ出す欄は、外しても中身を消さない）
    const wc = card('工事の内容（選ぶと文面に入る）', 'nt-types');
    d.workTypes = d.workTypes || {};
    NL.WORK_TYPES.forEach(w => {
      let extra = null;
      wc.appendChild(check('nt-wt-' + w.key, w.label, () => d.workTypes[w.key], v => { d.workTypes[w.key] = v; if (extra) extra.hidden = !v; }));
      if (w.extra) {
        extra = field(w.extra.label, input('nt-x-' + w.extra.key, 'text', w.extra.key, { maxLength: 100, placeholder: w.extra.placeholder }));
        extra.hidden = !d.workTypes[w.key];
        wc.appendChild(extra);
      }
    });
    wc.appendChild(field('その他のお知らせ', input('nt-othernotice', 'textarea', 'otherNotice', { rows: 4, maxLength: 1000 }), { hint: '1行ずつ本文の第1段落の終わりに入ります' }));
    body.appendChild(wc);

    // お問い合わせ先
    const cc = card('お問い合わせ先（会社の設定から。書き換え可）', 'nt-contact');
    cc.append(field('会社名', input('nt-cc', 'text', 'contactCompany', { maxLength: 100 })),
      field('住所（2行まで）', input('nt-ca', 'textarea', 'contactAddress', { rows: 2, maxLength: 200 })),
      field('電話番号', input('nt-ct', 'tel', 'contactTel', { maxLength: 40 })));
    body.appendChild(cc);

    // プレビュー
    const pc = card('プレビュー（A4縦・1ページ）', 'nt-preview');
    pc.appendChild(mk('div', 'hint', '文字を押すとその場で書き換えられます。空にすると自動の文に戻ります。二本指で拡大できます。'));
    const fitMsg = mk('div', 'nt-fit');
    fitMsg.id = 'nt-fit';
    fitMsg.setAttribute('role', 'status');
    const pv = mk('div', 'nt-pv');
    pv.id = 'nt-pv';
    const outer = mk('div', 'nt-outer');
    const scaler = mk('div', 'nt-scaler');
    scaler.id = 'nt-scaler';
    outer.appendChild(scaler);
    pv.appendChild(outer);
    const edits = mk('div', 'nt-edits');
    edits.id = 'nt-edits';
    pc.append(fitMsg, pv, edits);
    body.appendChild(pc);
    wireEditing(scaler);
    renderSheet();
  }

  /* ---------- プレビュー（紙面）と直接編集 ---------- */
  const ov = () => (st.d.overrides = st.d.overrides || {});
  function renderSheet() {
    const scaler = $('nt-scaler');
    if (!st || !scaler) return;
    const { sheet } = NoticePdf.build(st.d, ctx.org);
    sheet.id = 'nt-sheet';
    sheet.querySelectorAll('[data-edit]').forEach(n => {
      n.setAttribute('contenteditable', 'plaintext-only');
      if (n.contentEditable !== 'plaintext-only') n.setAttribute('contenteditable', 'true');
      n.setAttribute('tabindex', '-1');
      n.setAttribute('spellcheck', 'false');
    });
    scaler.replaceChildren(sheet);
    // 画面から消えた所（作業時間を消したときなど）の書き換えは捨てる
    const before = Object.keys(ov()).length;
    st.d.overrides = NL.pruneOverrides(ov(), Array.from(sheet.querySelectorAll('[data-edit]'), n => n.getAttribute('data-edit')));
    if (Object.keys(st.d.overrides).length !== before) changed();
    refit();
    renderEdits();
    scale();
  }
  // 縮めて見せる（組み方は等倍のまま）
  function scale() {
    const pv = $('nt-pv'), sheet = $('nt-sheet');
    if (!pv || !sheet || !sheet.offsetWidth) return;
    const cs = getComputedStyle(pv);
    const s = Math.min(1, (pv.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / sheet.offsetWidth);
    const scaler = sheet.parentNode, outer = scaler.parentNode;
    scaler.style.transform = 'scale(' + s + ')';
    outer.style.width = sheet.offsetWidth * s + 'px';
    outer.style.height = sheet.offsetHeight * s + 'px';
  }
  function refit() {
    const sheet = $('nt-sheet');
    if (!sheet) return;
    const r = NoticePdf.fit(sheet);
    st.overflow = r.overflow;
    const m = $('nt-fit');
    m.className = 'nt-fit' + (r.overflow ? ' warn' : '');
    m.textContent = r.overflow ? '内容が長すぎて1ページに収まりません' : r.scale < 1 ? '文字サイズ ' + Math.round(r.scale * 100) + '% に自動調整' : '';
  }
  // 「直接編集 Nか所」・全部を元に戻す・所ごとに自動の文に戻す（スマホのキーボードには Esc が無いため）
  function renderEdits() {
    const box = $('nt-edits');
    if (!box) return;
    const keys = Object.keys(ov());
    // 同じ所なら作り直さない（入力中の所から指を離して押したとき、focusout の描き直しでボタンが消えて押せなくなるため）
    const sig = keys.join('\n');
    if (box.dataset.keys === sig && box.firstChild) return;
    box.dataset.keys = sig;
    box.replaceChildren();
    box.hidden = !keys.length;
    if (!keys.length) return;
    const n = mk('div', 'nt-fit', '直接編集 ' + keys.length + 'か所');
    n.id = 'nt-edits-n';
    const all = dBtn('直接編集を元に戻す', 'btn ghost sm', async () => {
      if (!(await askPopup('プレビューで直接書き換えた内容をすべて自動の文章に戻します。\nよろしいですか？', { title: '直接編集を元に戻す', okLabel: '元に戻す', id: 'nt-reset-ask' }))) return;
      st.d.overrides = {};
      upd();
      toast('直接編集した内容を元に戻しました。');
    });
    all.id = 'nt-edits-reset';
    box.append(n, all);
    keys.forEach((k, i) => {
      const b = dBtn(NL.slotName(k) + 'を自動の文に戻す', 'btn ghost sm', () => { delete ov()[k]; upd(); });
      b.id = 'nt-revert-' + i;
      box.appendChild(b);
    });
  }
  // 画面の文字を読む: 書き戻すキーは入力欄へ、ほかは overrides（空か自動の文と同じなら自動に戻す）。変わったら true
  function capture(node) {
    if (!node.isConnected) return false;
    const key = node.getAttribute('data-edit');
    const text = NL.readSlot(key, node.innerText);
    if (NL.WRITE_BACK.includes(key)) {
      if (st.d[key] === text && (key !== 'addressee' || st.d.addresseeEdited === !!text)) return false;
      st.d[key] = text;
      if (key === 'addressee') {
        st.d.addresseeEdited = !!text;
        $('nt-addressee').value = text || NL.autoAddressee(st.d);
      } else $({ contactCompany: 'nt-cc', contactAddress: 'nt-ca', contactTel: 'nt-ct' }[key]).value = text;
      return true;
    }
    const before = ov()[key];
    if (!text || text === node.getAttribute('data-auto')) delete ov()[key];
    else ov()[key] = text;
    return ov()[key] !== before;
  }
  function wireEditing(box) {
    const slotOf = t => (t && t.closest ? t.closest('[data-edit]') : null);
    // 打っている間は読むだけ（組み直すとカーソルが飛ぶ）
    box.addEventListener('input', e => {
      const node = slotOf(e.target);
      if (!node) return;
      capture(node);
      if (!NL.WRITE_BACK.includes(node.getAttribute('data-edit'))) node.setAttribute('data-edited', '1');
      renderEdits();
      refit();
      changed();
    });
    // 離れたら読んで全体を描き直す（Esc で戻した直後は読まない）
    box.addEventListener('focusout', e => {
      const node = slotOf(e.target);
      if (!node) return;
      let ch = true;
      if (st.skip) st.skip = false; else ch = capture(node);
      renderSheet();
      if (ch) changed(); // 何も変えずに離れたときは保存しない
    });
    box.addEventListener('keydown', e => {
      const node = slotOf(e.target);
      if (!node) return;
      const key = node.getAttribute('data-edit');
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !NL.isMultiline(key)) { e.preventDefault(); node.blur(); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (NL.WRITE_BACK.includes(key)) { node.blur(); return; }
        delete ov()[key];
        st.skip = true;
        node.blur();
        if (st.skip) { st.skip = false; upd(); } // blur が起きなかったとき
      }
    });
    // 書式付きで貼り付けても文字だけ入れる
    box.addEventListener('paste', e => {
      if (!slotOf(e.target)) return;
      e.preventDefault();
      document.execCommand('insertText', false, String((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\r\n?/g, '\n'));
    });
  }

  /* ---------- ボタン ---------- */
  function checkRequired() {
    const v = NL.validate(st.d);
    Object.values(REQ_ID).forEach(id => $(id).classList.remove('invalid'));
    v.missing.forEach(k => $(REQ_ID[k]).classList.add('invalid'));
    $('nt-msg').textContent = v.text;
    if (v.missing.length) {
      const f = $(REQ_ID[v.missing[0]]);
      f.scrollIntoView({ block: 'center' });
      f.focus({ preventScroll: true });
    }
    return !v.missing.length;
  }
  async function duplicate() {
    const room = await askPopup('新しい掲示の号室を入れてください。\n入力した内容を写します。プレビューの直接編集は写しません。', { title: '別の号室に複製', okLabel: '複製する', id: 'nt-dup-ask', input: { label: '号室', placeholder: '例：303' } });
    if (room == null) return;
    if (!room) { toast('号室を入れてください'); return; }
    try { await saveNow(); } catch (e) { toast('保存できませんでした: ' + errText(e)); return; }
    const data = Object.assign(JSON.parse(JSON.stringify(st.d)), { roomNo: room, overrides: {} });
    delete data.pdf_at;
    const { data: row, error } = await sb.from('notices').insert({ case_id: st.row.case_id, data }).select().single();
    if (error) { toast('複製できませんでした: ' + errText(error)); return; }
    toast(NL.normalizeRoom(room) + 'の掲示を作りました');
    location.hash = '#notice/' + row.id;
  }

  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $('nt-back').addEventListener('click', () => { if (st) location.hash = '#case/' + st.caseRow.id; });
    $('nt-to-pv').addEventListener('click', () => { const p = $('nt-preview'); if (p) p.scrollIntoView({ block: 'start' }); });
    window.addEventListener('resize', () => { if (st && $('screen-notice').classList.contains('active')) scale(); });
    $('nt-dup').addEventListener('click', async () => {
      if (!st) return;
      $('nt-dup').disabled = true;
      try { await duplicate(); } finally { $('nt-dup').disabled = false; }
    });
    $('nt-draft').addEventListener('click', async () => {
      if (!st) return;
      $('nt-draft').disabled = true;
      try { st.dirty = true; await saveNow(); toast('下書きを保存しました'); location.hash = '#case/' + st.caseRow.id; }
      catch (e) { toast('保存できませんでした: ' + errText(e)); }
      finally { $('nt-draft').disabled = false; }
    });
    $('nt-pdf').addEventListener('click', async () => {
      if (!st) return;
      if (!checkRequired()) return;
      refit();
      if (st.overflow && !(await askPopup('内容が長すぎて1ページに収まりません。このままPDFを出力しますか？', { title: '1ページに収まりません', okLabel: 'このまま作る', id: 'nt-over-ask' }))) return;
      $('nt-pdf').disabled = true;
      try { await saveNow({ pdf_at: new Date().toISOString() }); location.hash = '#doc/notice/' + st.row.id; }
      catch (e) { toast('保存できませんでした: ' + errText(e)); }
      finally { $('nt-pdf').disabled = false; }
    });
  }
  async function show(id) {
    wire();
    st = null;
    $('nt-body').replaceChildren(mk('div', 'empty', '読み込み中…'));
    $('nt-sub').textContent = '';
    showScreen('notice');
    const r = await sb.from('notices').select('*').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) { toast('工事掲示が見つかりませんでした'); location.replace('#cases'); return; }
    const caseRow = await CasesApi.get(r.data.case_id);
    st = { row: r.data, caseRow: caseRow || {}, d: Object.assign(NL.newData(caseRow, new Date(), ctx.org), r.data.data || {}),
      overflow: false, skip: false, timer: null, saving: null, dirty: false, savedAt: '', err: '' };
    setSub();
    renderForm();
  }
  return { create, show };
})();
