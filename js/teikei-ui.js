// js/teikei-ui.js — 定型見積（被害復旧工事）の入力 #teikei/{id}: ① 案件 → ② 工事を足す（部位ごとの折りたたみ）→ ③ 明細（グループごとのカード）→ 一般管理費 → 合計 → メモ。下の帯に総合計と「紙面を見る → 共有」
// 規則は TeikeiLogic（試作 被害復旧工事_見積試作.html から写した）。画面は縦に並べる（試作の左右2段・ドラッグは使わない）。入力は 1.5秒で自動保存（estimates.data・number。07 と同じ形）
// 組み立てが変わる操作（足す・消す・並べ替え・養生率・1階・プリセット）は全部描き直す。打っている間は数字だけ書き換える（recalc。打っている欄には触らない）
// 発行済み・古い版は直せないので #doc/estimate/{id} へ
const TeikeiUi = (() => {
  const TL = TeikeiLogic;
  const SAVE_MS = 1500;
  const STATUS = { draft: '下書き', issued: '発行済み', superseded: '古い版' };
  let st = null; // { row, caseRow, d, rates, open:Set(部位), refs, timer, saving, dirty, savedAt, err }
  const yen = n => (Number(n) || 0).toLocaleString('ja-JP');
  const vs = v => (v == null ? '' : String(v));
  const amt = r => (r.qty || 0) * (r.price || 0);

  /* ---------- 保存（07 と同じ形） ---------- */
  function setSub() {
    if (!st) return;
    const t = st.err ? '保存できませんでした（' + st.err + '）' : st.saving ? '保存中…' : st.savedAt ? '自動保存 ' + st.savedAt : '';
    $('tk-sub').textContent = [CaseLogic.placeName(st.caseRow), '第' + st.row.version + '版（' + (STATUS[st.row.status] || st.row.status) + '）', t].filter(Boolean).join(' ・ ');
    $('tk-sub').classList.toggle('err', !!st.err);
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
    s.saving = EstimatesApi.save(s.row.id, { data: s.d, number: s.row.number || '' });
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
  App.onLeave(async () => { if (st && (st.dirty || st.saving)) { try { await saveNow(); } catch (e) { toast('定型見積を保存できませんでした: ' + errText(e)); } } });

  // 中身が変わった: 明細・行が変わったら一般管理費のプリセットも追従（手で選んだ・手入力ありなら TeikeiLogic が何もしない）
  const upd = () => { TL.syncPreset(st.d, st.rates); recalc(); changed(); };
  const rebuild = () => { TL.syncPreset(st.d, st.rates); render(); changed(); };

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
    f.appendChild(control);
    return f;
  }
  function inp(id, type, value, attrs, onInput, ev) {
    const e = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') e.type = type;
    e.id = id;
    Object.assign(e, attrs || {});
    e.value = vs(value);
    e.addEventListener(ev || 'input', () => onInput(e.value));
    return e;
  }
  const NUMI = { inputMode: 'numeric', autocomplete: 'off' }, DECI = { inputMode: 'decimal', autocomplete: 'off' };
  const iconBtn = (text, label, id, onClick) => { const b = dBtn(text, 'icon-btn', onClick); b.id = id; b.setAttribute('aria-label', label); return b; };
  // 打っている欄は書き換えない
  const put = (el, v) => { if (el && document.activeElement !== el) el.value = vs(v); };

  /* ---------- 画面 ---------- */
  function render() {
    const body = $('tk-body'), d = st.d, rates = st.rates;
    const y = window.scrollY;
    body.replaceChildren();
    st.refs = { groups: [], keihi: [] };

    // ① 案件
    const cc = card('① 案件', 'tk-case');
    const place = mk('div', 'tk-place', CaseLogic.placeName(st.caseRow) || '（物件名なし）');
    place.id = 'tk-place';
    cc.appendChild(place);
    cc.appendChild(field('宛名（請求先）', inp('tk-to', 'text', d.cover.to, { maxLength: 100, placeholder: '例：○○405号室入居者' }, v => { d.cover.to = v; upd(); }),
      { req: true, hint: '工事の部屋と請求先が違うことがあるので自動では入れません' }));
    const days = inp('tk-days', 'text', d.days, NUMI, v => { TL.setDays(d, v); upd(); });
    const dw = mk('div', 'opt-row tk-days');
    dw.append(days, mk('span', null, '日'));
    const fd = field('工事日数', dw, { req: true });
    fd.firstChild.htmlFor = 'tk-days';
    const g1 = mk('div', 'grid2');
    g1.append(fd, field('着工日', inp('tk-start', 'date', d.cover.start, null, v => { d.cover.start = v; TL.syncCover(d, st.caseRow); upd(); })));
    cc.appendChild(g1);
    const end = inp('tk-end', 'date', d.cover.end, null, v => {
      d.covManual.end = !!v; // 空にしたら自動に戻す
      if (v) d.cover.end = v; else TL.syncCover(d, st.caseRow);
      upd();
    });
    st.refs.end = end;
    cc.appendChild(field('完工日', end, { hint: '着工日＋工事日数から自動。手で直せます（空にすると自動に戻ります）' }));
    // 工事名称（自動。「直す」で入力に変わる）
    const tf = mk('div', 'ff');
    tf.appendChild(mk('span', 'lbl', '工事名称'));
    if (d.covManual.title) {
      const ti = inp('tk-title-in', 'text', d.cover.title, { maxLength: 200 }, v => { d.cover.title = v; upd(); });
      ti.setAttribute('aria-label', '工事名称');
      // 空のまま離れたら自動に戻す
      ti.addEventListener('change', () => { if (!ti.value.trim()) { d.covManual.title = false; TL.syncCover(d, st.caseRow); rebuild(); } });
      tf.appendChild(ti);
    } else {
      const row = mk('div', 'set-li');
      const t = mk('span', null, d.cover.title || '（物件名から自動）');
      t.id = 'tk-title';
      const b = dBtn('直す', 'btn ghost sm', () => { d.covManual.title = true; render(); $('tk-title-in').focus(); });
      b.id = 'tk-title-edit';
      row.append(t, b);
      tf.appendChild(row);
    }
    cc.appendChild(tf);
    cc.appendChild(field('工事場所', inp('tk-site', 'text', d.cover.place, { maxLength: 200 }, v => { d.cover.place = v; upd(); })));
    cc.appendChild(field('取引方法', inp('tk-pay', 'text', d.cover.pay, { maxLength: 100 }, v => { d.cover.pay = v; upd(); })));
    const g2 = mk('div', 'grid2');
    g2.append(field('見積有効期限', inp('tk-exp', 'date', d.cover.exp, null, v => { d.cover.exp = v; upd(); })),
      field('見積日', inp('tk-date', 'date', d.cover.date, null, v => { d.cover.date = v; upd(); })));
    cc.appendChild(g2);
    body.appendChild(cc);

    // ② 工事を足す
    const ac = card('② 工事を足す', 'tk-add');
    const parts = mk('div', 'tk-parts');
    TL.partsOf(rates).forEach(p => {
      const det = document.createElement('details');
      det.open = st.open.has(p.part);
      det.addEventListener('toggle', () => { if (det.open) st.open.add(p.part); else st.open.delete(p.part); });
      det.appendChild(mk('summary', null, p.part));
      const box = mk('div', 'tk-sets');
      p.sets.forEach(s => {
        const n = d.groups.filter(g => g.setId === s.id).length;
        const b = dBtn('', 'btn ghost sm tk-set', () => addSet(s));
        b.dataset.set = s.id;
        b.append(mk('span', 'tk-set-t', '＋ ' + s.work),
          mk('small', null, s.items.length + '行 ・ 既定 ' + yen(TL.setDefaultTotal(s)) + '円' + (s.items.some(i => i.qty_input) ? '・数量入力あり' : '') + (n ? ' ・ 追加済 ' + n : '')));
        box.appendChild(b);
      });
      det.appendChild(box);
      parts.appendChild(det);
    });
    ac.appendChild(parts);
    const free = dBtn('＋ 単価表に無い行を足す', 'btn ghost sm', () => { TL.addFreeSet(d); rebuild(); flash(d.groups.length - 1); });
    free.id = 'tk-add-free';
    ac.appendChild(free);
    const dl = document.createElement('datalist');
    dl.id = 'tk-parts';
    TL.partsOf(rates).forEach(p => dl.appendChild(new Option(p.part, p.part)));
    ac.appendChild(dl);
    body.appendChild(ac);

    // ③ 明細
    const lc = card('③ 明細', 'tk-lines');
    if (!d.groups.length) lc.appendChild(mk('div', 'empty', '② から工事を足してください'));
    d.groups.forEach((g, gi) => lc.appendChild(groupCard(g, gi)));
    body.appendChild(lc);

    // 一般管理費
    body.appendChild(keihiCard());

    // 合計
    const sc = card('合計', 'tk-totals');
    const g3 = mk('div', 'grid2');
    // 空・読めない値は入れない（前の値のまま。赤枠）。離れたら今の値に戻す
    const pct = (id, key) => {
      const e = inp(id, 'text', d[key], DECI, v => {
        const n = TL.numOr(v, null);
        e.classList.toggle('tk-need', n == null);
        if (n == null) return;
        d[key] = n;
        upd();
      });
      e.addEventListener('change', () => { e.value = vs(d[key]); e.classList.remove('tk-need'); });
      return e;
    };
    g3.append(field('諸経費（%）', pct('tk-misc', 'miscRate')), field('消費税（%）', pct('tk-tax', 'taxRate')));
    sc.appendChild(g3);
    [['工事費', 'work'], ['一般管理費', 'ksub'], ['諸経費', 'misc'], ['税抜', 'net'], ['消費税', 'tax'], ['総合計', 'total']].forEach(([label, k]) => {
      const rw = mk('div', 'sum-row' + (k === 'total' ? ' big' : ''));
      rw.append(mk('span', null, label), mk('span', null, ''));
      rw.lastChild.id = 'tk-t-' + k;
      sc.appendChild(rw);
    });
    body.appendChild(sc);

    // メモ
    const mc = card('メモ（紙には出ません）', 'tk-memo-card');
    const memo = inp('tk-memo', 'textarea', d.memo, { rows: 3, maxLength: 2000, placeholder: '工事範囲・立会い・入居者対応など' }, v => { d.memo = v; changed(); });
    memo.setAttribute('aria-label', 'メモ');
    mc.appendChild(memo);
    body.appendChild(mc);

    const msg = mk('div', 'msg err');
    msg.id = 'tk-msg';
    msg.setAttribute('role', 'alert');
    body.appendChild(msg);

    recalc();
    window.scrollTo(0, y);
  }

  function groupCard(g, gi) {
    const d = st.d, rates = st.rates;
    const m = TL.masterSet(rates, g.setId), o = m && m.options;
    const c = mk('div', 'tk-g');
    c.id = 'tk-g-' + gi;
    c.dataset.gid = g.gid;
    const part = inp('tk-part-' + gi, 'text', g.part, { maxLength: 60, autocomplete: 'off' }, v => { TL.setGroup(d, gi, 'part', v); upd(); });
    part.setAttribute('list', 'tk-parts');
    part.setAttribute('aria-label', '部位');
    c.appendChild(part);
    if (g.free) {
      const w = inp('tk-work-' + gi, 'text', g.work, { maxLength: 100 }, v => { TL.setGroup(d, gi, 'work', v); upd(); });
      w.setAttribute('aria-label', '工事名');
      c.appendChild(w);
    } else c.appendChild(mk('div', 'tk-work', g.work));
    const bar = mk('div', 'tk-gbar');
    const sum = mk('span', 'tk-gsum');
    sum.id = 'tk-gsum-' + gi;
    const n = d.groups.length;
    const up = iconBtn('▲', 'このグループを上へ', 'tk-up-' + gi, () => { TL.moveGroup(d, gi, -1); rebuild(); });
    up.disabled = gi === 0;
    const down = iconBtn('▼', 'このグループを下へ', 'tk-down-' + gi, () => { TL.moveGroup(d, gi, 1); rebuild(); });
    down.disabled = gi === n - 1;
    bar.append(sum, up, down);
    // 必ず入れるセットの最後の1つは消せない（TeikeiLogic.removeGroup と同じ決まり）
    const fixed = o && o.default_add && d.groups.filter(x => x.setId === g.setId).length <= 1;
    if (!fixed) bar.appendChild(iconBtn('×', 'このグループを消す', 'tk-del-' + gi, async () => {
      if (!(await askPopup('「' + (g.work || '追加項目') + '」（' + (g.part || '部位なし') + '）を消しますか？', { title: '工事を消す', okLabel: '消す', danger: true, id: 'tk-del-ask' }))) return;
      if (TL.removeGroup(d, g.gid, rates)) rebuild();
    }));
    c.appendChild(bar);
    if (o && o.rate_presets) {
      const rr = mk('div', 'opt-row');
      const seg = mk('div', 'seg tk-rate-seg');
      o.rate_presets.forEach(v => {
        const b = dBtn(v + '%', null, () => setRate(gi, v));
        b.id = 'tk-rate-' + gi + '-' + v;
        b.setAttribute('aria-pressed', String(g.rate === v));
        seg.appendChild(b);
      });
      // 空・読めない値は今の率に戻すだけ（確かめも出さない）
      const ri = inp('tk-rate-' + gi, 'text', g.rate, DECI, v => { if (TL.numOr(v, null) == null) ri.value = vs(g.rate); else setRate(gi, v); }, 'change');
      ri.className = 'tk-rate-in';
      ri.setAttribute('aria-label', (o.rate_label || '養生率') + '（%）');
      rr.append(seg, ri, mk('span', null, '%'));
      c.append(mk('div', 'lbl', o.rate_label || '養生率'), rr);
    }
    if (o && o.floor1_omit && o.floor1_omit.length) {
      const l = mk('label', 'check');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'tk-floor1-' + gi;
      cb.checked = TL.floor1On(g, rates);
      cb.addEventListener('change', () => setFloor1(gi, cb.checked, cb));
      l.append(cb, document.createTextNode(o.floor1_label || '1階'));
      c.appendChild(l);
    }
    const refs = { sum, lines: [] };
    st.refs.groups[gi] = refs;
    g.items.forEach((it, ri) => c.appendChild(lineCard(g, gi, it, ri, refs)));
    if (g.free) {
      const add = dBtn('＋ 行を足す', 'btn ghost sm', () => { TL.addFreeLine(d, gi); rebuild(); $('tk-name-' + gi + '-' + (g.items.length - 1)).focus(); });
      add.id = 'tk-ladd-' + gi;
      c.appendChild(add);
    }
    return c;
  }

  function lineCard(g, gi, it, ri, refs) {
    const d = st.d, k = gi + '-' + ri;
    const c = mk('div', 'ln');
    c.id = 'tk-l-' + k;
    const set = f => v => { TL.setLine(d, gi, ri, f, v); upd(); };
    const name = inp('tk-name-' + k, 'text', it.name, { maxLength: 100, placeholder: '名称' }, set('name'));
    name.setAttribute('aria-label', '名称');
    const spec = inp('tk-spec-' + k, 'text', it.spec, { maxLength: 200, placeholder: '材質・寸法' }, set('spec'));
    spec.setAttribute('aria-label', '材質・寸法');
    const qty = inp('tk-qty-' + k, 'text', it.qty, DECI, set('qty'));
    const unit = inp('tk-unit-' + k, 'text', it.unit, { maxLength: 20 }, set('unit'));
    const price = inp('tk-price-' + k, 'text', it.price, NUMI, set('price'));
    const g3 = mk('div', 'grid3');
    const qf = field('数量', qty);
    const need = mk('span', 'req', '※数量');
    need.id = 'tk-need-' + k;
    qf.firstChild.appendChild(need);
    g3.append(qf, field('単位', unit), field('単価', price));
    const am = mk('div', 'tk-amt');
    am.id = 'tk-amt-' + k;
    c.append(name, spec, g3, am);
    if (g.free) {
      const del = dBtn('消す', 'btn ghost sm', () => { TL.removeLine(d, gi, ri); rebuild(); });
      del.id = 'tk-ldel-' + k;
      c.appendChild(del);
    }
    refs.lines[ri] = { c, qty, price, need, am };
    return c;
  }

  function keihiCard() {
    const d = st.d, rates = st.rates, ks = TL.keihiSet(rates);
    const kc = card('一般管理費', 'tk-keihi');
    const seg = mk('div', 'seg tk-seg4');
    seg.id = 'tk-preset';
    [{ key: 'auto', label: '自動' }].concat(ks.presets || []).forEach(p => {
      const b = dBtn(p.label, null, () => setPreset(p.key));
      b.id = 'tk-preset-' + p.key;
      b.dataset.key = p.key;
      seg.appendChild(b);
    });
    const now = mk('div', 'hint');
    now.id = 'tk-k-now';
    kc.append(seg, now);
    d.keihi.forEach((r, i) => {
      const c = mk('div', 'ln');
      c.id = 'tk-k-' + i;
      c.appendChild(mk('div', 'tk-work', r.name + (r.spec ? '（' + r.spec + '）' : '')));
      const qty = inp('tk-kqty-' + i, 'text', r.qty, DECI, v => { TL.setKeihi(d, i, 'qty', v); upd(); });
      const unit = inp('tk-kunit-' + i, 'text', r.unit, { maxLength: 20 }, v => { TL.setKeihi(d, i, 'unit', v); upd(); });
      const price = inp('tk-kprice-' + i, 'text', r.price, NUMI, v => { TL.setKeihi(d, i, 'price', v); upd(); });
      const g3 = mk('div', 'grid3');
      g3.append(field('数量', qty), field('単位', unit), field('単価', price));
      const orig = mk('div', 'hint');
      orig.id = 'tk-korig-' + i;
      const am = mk('div', 'tk-amt');
      am.id = 'tk-kamt-' + i;
      c.append(g3, orig, am);
      kc.appendChild(c);
      st.refs.keihi[i] = { c, qty, unit, price, orig, am };
    });
    const sum = mk('div', 'sum-row big');
    sum.append(mk('span', null, '一般管理費 合計'), mk('span', null, ''));
    sum.lastChild.id = 'tk-ksum';
    kc.appendChild(sum);
    const reset = dBtn('標準に戻す', 'btn ghost sm', () => { TL.resetKeihi(d, rates); upd(); });
    reset.id = 'tk-k-reset';
    kc.appendChild(reset);
    return kc;
  }

  // 数字だけ書き換える（打っている欄はそのまま）
  function recalc() {
    if (!st || !st.refs) return;
    const d = st.d, rates = st.rates;
    put(st.refs.end, d.cover.end);
    put($('tk-days'), d.days);
    d.groups.forEach((g, gi) => {
      const rf = st.refs.groups[gi];
      if (!rf) return;
      rf.sum.textContent = '小計 ' + yen(g.items.reduce((a, it) => a + amt(it), 0)) + '円';
      g.items.forEach((it, ri) => {
        const l = rf.lines[ri];
        if (!l) return;
        put(l.qty, it.qty);
        put(l.price, it.price);
        const miss = it.need && it.qty == null;
        l.qty.classList.toggle('tk-need', miss);
        l.need.hidden = !miss;
        l.c.classList.toggle('tk-ed', TL.lineEdited(it));
        l.am.textContent = '金額 ' + yen(amt(it)) + '円';
      });
    });
    const ks = TL.keihiSet(rates), pr = (ks.presets || []).find(p => p.key === d.preset);
    $('tk-preset').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(d.presetManual ? b.dataset.key === d.preset : b.dataset.key === 'auto')));
    $('tk-k-now').textContent = '今: ' + (pr ? pr.label + '（×' + pr.coef + '）' : d.preset) + (d.presetManual ? '' : '（明細から自動）') + ' ・ 工事日数 ' + (d.days == null ? '未入力' : d.days + '日');
    d.keihi.forEach((r, i) => {
      const k = st.refs.keihi[i];
      if (!k) return;
      put(k.qty, r.qty);
      put(k.unit, r.unit);
      put(k.price, r.price);
      k.orig.textContent = r.price0 !== r.base ? '元 ' + yen(r.base) + '円' : '';
      k.c.classList.toggle('tk-ed', r.price !== r.price0 || r.qty !== r.qty0 || r.unit !== r.unit0);
      k.am.textContent = '金額 ' + yen(amt(r)) + '円';
    });
    const t = TL.totals(d);
    $('tk-ksum').textContent = yen(t.ksub) + '円';
    ['work', 'ksub', 'misc', 'net', 'tax', 'total'].forEach(k => { $('tk-t-' + k).textContent = yen(t[k]) + '円'; });
    $('tk-foot-total').textContent = '¥' + yen(t.total);
  }

  /* ---------- 操作 ---------- */
  function flash(gi) {
    const el = $('tk-g-' + gi);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('tk-flash');
    setTimeout(() => el.classList.remove('tk-flash'), 1000);
  }
  function addSet(s) {
    TL.addSet(st.d, s);
    rebuild();
    flash(st.d.groups.length - 1);
  }
  async function setRate(gi, v) {
    const d = st.d, rates = st.rates;
    let r = TL.setRate(d, gi, v, rates);
    if (r && r.needConfirm) {
      const n = Math.max(0, TL.numOr(v, 100));
      if (!(await askPopup('養生率を ' + n + '% にすると、このセットで手入力した単価は率の値に戻ります。進めますか？', { title: '養生率', okLabel: '進める', id: 'tk-rate-ask' }))) { render(); return; }
      r = TL.setRate(d, gi, v, rates, { force: true });
    }
    rebuild();
  }
  async function setFloor1(gi, on, cb) {
    const d = st.d, g = d.groups[gi], o = TL.masterSet(st.rates, g.setId).options;
    // 外す行を手で直していたら確かめる（外すと消える）
    const lost = on && g.items.some(it => (o.floor1_omit || []).includes(it.name) && (TL.lineEdited(it) || it.qty !== it.qty0));
    if (lost && !(await askPopup('外す行（' + o.floor1_omit.join('・') + '）に手入力があります。外すとその手入力は消えます。進めますか？', { title: '1階', okLabel: '進める', id: 'tk-floor1-ask' }))) { cb.checked = false; return; }
    TL.setFloor1(d, gi, on, st.rates);
    rebuild();
  }
  async function setPreset(key) {
    const d = st.d, rates = st.rates;
    if (key === (d.presetManual ? d.preset : 'auto')) return; // 今のを押し直しても手入力は消さない
    if (TL.keihiEdited(d) && !(await askPopup('一般管理費に手入力があります。プリセットを切り替えると、その手入力は初期値に戻ります。進めますか？', { title: '一般管理費', okLabel: '進める', id: 'tk-preset-ask' }))) return;
    d.presetManual = key !== 'auto';
    d.preset = key === 'auto' ? TL.autoPresetKey(d, rates) : key;
    TL.applyPreset(d, rates);
    render();
    changed();
  }
  async function toPaper() {
    const msgs = TL.validate(st.d);
    const msg = $('tk-msg');
    msg.textContent = msgs.join('\n');
    if (msgs.length) { msg.scrollIntoView({ block: 'center' }); return; }
    if (!st.row.number) st.row.number = await EstimatesApi.nextNumber();
    await saveNow({ pdf_at: new Date().toISOString() });
    location.hash = '#doc/estimate/' + st.row.id;
  }

  /* ---------- 開く ---------- */
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $('tk-back').addEventListener('click', () => { if (st) location.hash = '#case/' + st.caseRow.id; });
    $('tk-pdf').addEventListener('click', async () => {
      if (!st) return;
      $('tk-pdf').disabled = true;
      try { await toPaper(); }
      catch (e) { toast('保存できませんでした: ' + errText(e)); }
      finally { $('tk-pdf').disabled = false; }
    });
  }
  async function show(id) {
    wire();
    st = null;
    $('tk-body').replaceChildren(mk('div', 'empty', '読み込み中…'));
    $('tk-sub').textContent = '';
    $('tk-foot-total').textContent = '';
    showScreen('teikei');
    const row = await EstimatesApi.get(id);
    if (!row) { toast('見積書が見つかりませんでした'); location.replace('#cases'); return; }
    if (row.kind !== 'teikei') { location.replace('#estimate/' + id); return; }
    if (row.status !== 'draft') { location.replace('#doc/estimate/' + id); return; }
    const [caseRow, rates] = await Promise.all([CasesApi.get(row.case_id), TeikeiApi.rates()]);
    const d = row.data && Array.isArray(row.data.groups) ? row.data : TL.newData(caseRow, rates, new Date());
    TL.syncCover(d, caseRow);
    st = { row, caseRow: caseRow || {}, d, rates, open: new Set(['廊下被害復旧', '居室被害復旧']), refs: null, timer: null, saving: null, dirty: false, savedAt: '', err: '' };
    setSub();
    render();
  }
  return { show };
})();
