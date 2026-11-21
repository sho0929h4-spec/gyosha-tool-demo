// js/daily-ui.js — 日報: #daily（一覧・＋ 新しい日報・下のタブ）と #daily/{id}（入力。1.5秒で自動保存・紙面を見る → 共有・削除）
// 規則は DailyLogic、読み書きは DailyApi、紙面は DailyPdf（プレビューは #doc/daily/{id}）。保存の形は notice-ui と同じ
const DailyUi = (() => {
  const SAVE_MS = 1500;
  let st = null; // { row, d, cases, q, timer, saving, dirty, savedAt, err }
  let wired = false;

  /* ---------- 一覧 ---------- */
  async function list() {
    wire();
    st = null;
    showScreen('dailies');
    const host = $('dls-list');
    host.replaceChildren(mk('div', 'empty', '読み込み中…'));
    $('dls-msg').textContent = '';
    let rows = [], shares = [];
    try { [rows, shares] = await Promise.all([DailyApi.list(), DailyApi.shares()]); }
    catch (e) { $('dls-msg').textContent = '日報を読み込めませんでした: ' + errText(e); host.replaceChildren(); return; }
    host.replaceChildren();
    if (!rows.length) { host.appendChild(mk('div', 'empty', 'まだ日報がありません。下の「＋ 新しい日報」から作ってください')); return; }
    rows.forEach(r => {
      const a = mk('a', 'item');
      a.href = '#daily/' + r.id;
      a.appendChild(mk('div', 'item-t', [DailyLogic.md(r.date), r.author].filter(Boolean).join(' ')));
      const n = Array.isArray(r.sites) ? r.sites.length : 0;
      a.appendChild(mk('div', 'item-s', '現場 ' + n + '件 ・ ' + DocsApi.statusText(DocsApi.last(shares, 'daily', r.id))));
      host.appendChild(a);
    });
    host.appendChild(mk('div', 'empty', '日付の新しい順'));
  }
  async function createNew() {
    $('dls-new').disabled = true;
    try { location.hash = '#daily/' + (await DailyApi.create(DailyLogic.newData(new Date(), ctx.membership))).id; }
    catch (e) { toast('日報を作れませんでした: ' + errText(e)); }
    finally { $('dls-new').disabled = false; }
  }

  /* ---------- 保存（notice-ui と同じ形） ---------- */
  function setSub() {
    if (!st) return;
    const t = st.err ? '保存できませんでした（' + st.err + '）' : st.saving ? '保存中…' : st.savedAt ? '自動保存 ' + st.savedAt : '';
    $('dl-sub').textContent = t;
    $('dl-sub').classList.toggle('err', !!st.err);
  }
  function changed() {
    if (!st) return;
    st.dirty = true;
    $('dl-msg').textContent = '';
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { saveNow().catch(() => {}); }, SAVE_MS);
  }
  async function saveNow() {
    if (!st) return;
    const s = st;
    clearTimeout(s.timer);
    while (s.saving) await s.saving.catch(() => {}); // 保存中なら終わるまで待つ（紙面を見る前に古い行を読まない）
    if (!s.dirty) return;
    s.dirty = false;
    const row = Object.assign({}, s.d);
    if (!row.date) delete row.date; // 日付は空にできない（DB は not null）。空のあいだは前の日付のまま
    s.saving = DailyApi.save(s.row.id, row);
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
  App.onLeave(async () => { if (st && (st.dirty || st.saving)) { try { await saveNow(); } catch (e) { toast('日報を保存できませんでした: ' + errText(e)); } } });

  /* ---------- 入力 ---------- */
  function field(labelText, control, hint) {
    const f = mk('div', 'ff');
    const l = mk('label', null, labelText);
    l.htmlFor = control.id;
    f.appendChild(l);
    if (hint) f.appendChild(mk('span', 'hint', hint));
    f.appendChild(control);
    return f;
  }
  function input(id, type, key, attrs) {
    const e = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') e.type = type;
    e.id = id;
    Object.assign(e, attrs || {});
    e.value = st.d[key] || '';
    e.addEventListener('input', () => { st.d[key] = e.value; changed(); });
    return e;
  }
  // 対応現場: 案件（新しい順）＋もう一覧に無い選んだ現場。物件名・号室で絞る
  function renderSites() {
    const box = $('dl-sites');
    const picked = new Map(st.d.sites.map(s => [s.case_id, s]));
    const known = new Set(st.cases.map(c => c.id));
    const items = st.d.sites.filter(s => !known.has(s.case_id)).map(s => ({ id: s.case_id, label: s.label, sub: '', hit: CaseLogic.matches({ name: s.label }, st.q) }))
      .concat(st.cases.map(c => ({ id: c.id, label: CaseLogic.placeName(c) || '（物件名なし）', sub: c.client_name || '', hit: CaseLogic.matches(c, st.q) })));
    box.replaceChildren();
    items.filter(i => i.hit).forEach(i => {
      const l = mk('label', 'check');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = picked.has(i.id);
      c.dataset.caseId = i.id;
      c.addEventListener('change', () => {
        st.d.sites = c.checked ? st.d.sites.concat({ case_id: i.id, label: i.label }) : st.d.sites.filter(s => s.case_id !== i.id);
        $('dl-sites-n').textContent = '選んだ現場 ' + st.d.sites.length + '件';
        changed();
      });
      const t = mk('span', 'dl-site', i.label);
      if (i.sub) t.appendChild(mk('span', 'hint', ' ' + i.sub));
      l.append(c, t);
      box.appendChild(l);
    });
    if (!box.children.length) box.appendChild(mk('div', 'empty', st.cases.length ? '見つかりませんでした' : '案件がありません'));
  }
  function renderForm() {
    const body = $('dl-body');
    body.replaceChildren();
    const msg = mk('div', 'msg err');
    msg.id = 'dl-msg';
    msg.setAttribute('role', 'alert');
    const basic = mk('div', 'card');
    basic.append(msg, field('日付', input('dl-date', 'date', 'date')), field('担当者', input('dl-author', 'text', 'author', { maxLength: 60 })));
    const sc = mk('div', 'card');
    sc.id = 'dl-sites-card';
    const q = document.createElement('input');
    q.type = 'search';
    q.id = 'dl-q';
    q.placeholder = '物件名・号室で探す';
    q.setAttribute('aria-label', '物件名・号室で探す');
    q.value = st.q;
    q.addEventListener('input', () => { st.q = q.value; renderSites(); });
    const n = mk('div', 'hint', '選んだ現場 ' + st.d.sites.length + '件');
    n.id = 'dl-sites-n';
    const box = mk('div', 'dl-sites');
    box.id = 'dl-sites';
    sc.append(mk('div', 'card-t', '対応現場'), n, q, box);
    const nc = mk('div', 'card');
    nc.appendChild(field('申し送り', input('dl-notes', 'textarea', 'notes', { rows: 6, maxLength: 4000 }), '4000字まで'));
    const del = dBtn('この日報を削除', 'btn ghost sm danger', remove);
    del.id = 'dl-del';
    body.append(basic, sc, nc, del);
    renderSites();
  }

  /* ---------- ボタン ---------- */
  async function toPreview() {
    if (!st) return;
    const v = DailyLogic.validate(st.d);
    if (v) { $('dl-msg').textContent = v; $('dl-msg').scrollIntoView({ block: 'center' }); return; }
    $('dl-pv').disabled = true;
    try { await saveNow(); location.hash = '#doc/daily/' + st.row.id; }
    catch (e) { toast('保存できませんでした: ' + errText(e)); }
    finally { $('dl-pv').disabled = false; }
  }
  async function remove() {
    if (!st) return;
    if (!(await askPopup('この日報を削除しますか？\n元に戻せません。', { title: '日報を削除', okLabel: '削除する', danger: true, id: 'dl-del-ask' }))) return;
    const s = st;
    clearTimeout(s.timer);
    try { await DailyApi.remove(s.row.id); } catch (e) { toast('削除できませんでした: ' + errText(e)); return; }
    st = null; // 消したものを離れるときに保存しない
    toast('日報を削除しました');
    location.hash = '#daily';
  }
  function wire() {
    if (wired) return;
    wired = true;
    $('dls-new').addEventListener('click', createNew);
    $('dl-pv').addEventListener('click', toPreview);
  }
  async function show(id) {
    wire();
    st = null;
    $('dl-body').replaceChildren(mk('div', 'empty', '読み込み中…'));
    $('dl-sub').textContent = '';
    showScreen('daily');
    const [row, cases] = await Promise.all([DailyApi.get(id), CasesApi.list()]);
    if (!row) { toast('日報が見つかりませんでした'); location.replace('#daily'); return; }
    st = { row, d: { date: row.date || '', author: row.author || '', sites: Array.isArray(row.sites) ? row.sites : [], notes: row.notes || '' },
      cases, q: '', timer: null, saving: null, dirty: false, savedAt: '', err: '' };
    renderForm();
  }
  return { list, show };
})();
