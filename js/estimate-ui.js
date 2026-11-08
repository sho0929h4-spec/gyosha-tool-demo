// js/estimate-ui.js — 07 見積書: 宛先・件名・日付・番号・担当・利益率 → 定型（明細が空のとき）→ 明細（1行＝カード。↑↓・複製・削除）→ 合計 → 備考 → 定型に登録／下書き保存／紙面を見る → 共有（#doc/estimate/{id} で紙面の上でも直せる）
// 規則・文言は EstimateLogic（移植メモ §1）。入力は 1.5秒で自動保存（estimates.data・number）。番号は「紙面を見る」で空のときだけ決める。
// 発行済み（issued）・古い版（superseded）は全部 disabled にして「新しい版を作って直す」だけ出す
// 単価マスタ（移植メモ §1.7）: 入力が止まって 600ms 後に販売を照合。開いたときは原価も（仕入見積を読み込んだ直後は、登録の前に照合した結果をもらう）。
//   「紙面を見る」で 販売 → 原価 の順に登録（source＝見積書番号）
const EstimateUi = (() => {
  const EL = EstimateLogic;
  const SAVE_MS = 1500, CHECK_MS = 600;
  const STATUS = { draft: '下書き', issued: '発行済み', superseded: '古い版' };
  let st = null; // { row, caseRow, d, ro, rates, templates, presets, sugg, refs, quickOpen, timer, saving, dirty, savedAt, err, sellAlerts, costAlerts, checkTimer }
  let pendingCost = null; // 読み込みの画面から: { id, alerts }
  const num = v => Number(v) || 0;
  const str = v => String(v == null ? '' : v).trim();
  const yen = n => num(n).toLocaleString('ja-JP');
  const taxRate = () => num(st.d.tax_rate);
  const L = i => st.d.lines[i];

  /* ---------- 保存（report-ui と同じ形） ---------- */
  function setSub() {
    if (!st) return;
    const t = st.err ? '保存できませんでした（' + st.err + '）' : st.saving ? '保存中…' : st.savedAt ? '自動保存 ' + st.savedAt : '';
    $('es-sub').textContent = [CaseLogic.placeName(st.caseRow), '第' + st.row.version + '版（' + (STATUS[st.row.status] || st.row.status) + '）', t].filter(Boolean).join(' ・ ');
    $('es-sub').classList.toggle('err', !!st.err);
  }
  function changed() {
    if (!st || st.ro) return;
    st.d.lines = EL.recalcShokehi(st.d.lines);
    refresh();
    st.dirty = true;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { saveNow().catch(() => {}); }, SAVE_MS);
    clearTimeout(st.checkTimer);
    st.checkTimer = setTimeout(sellCheck, CHECK_MS);
  }
  async function saveNow(extra) {
    if (!st || st.ro) return;
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
  App.onLeave(async () => { if (st && (st.dirty || st.saving)) { try { await saveNow(); } catch (e) { toast('見積書を保存できませんでした: ' + errText(e)); } } });

  /* ---------- 部品 ---------- */
  const card = (title, id) => { const c = mk('div', 'card'); if (id) c.id = id; if (title) c.appendChild(mk('div', 'card-t', title)); return c; };
  function field(labelText, control, hint) {
    const f = mk('div', 'ff');
    const l = mk('label', null, labelText);
    if (control.id) l.htmlFor = control.id;
    f.appendChild(l);
    if (hint) f.appendChild(mk('span', 'hint', hint));
    f.appendChild(control);
    return f;
  }
  function ctl(tag, id, type, value, attrs, onInput) {
    const e = document.createElement(tag);
    if (type) e.type = type;
    e.id = id;
    Object.assign(e, attrs || {});
    if (type === 'checkbox') e.checked = !!value; else e.value = value == null ? '' : value;
    e.addEventListener(type === 'checkbox' ? 'change' : 'input', ev => onInput(type === 'checkbox' ? e.checked : e.value, ev));
    return e;
  }
  // st.d[key] に入れる欄（数の欄は数で入れる）
  const dataInput = (id, type, key, attrs) => ctl(type === 'textarea' ? 'textarea' : 'input', id, type === 'textarea' ? null : type, st.d[key], attrs,
    v => { st.d[key] = type === 'number' ? num(v) : v; changed(); });
  const NUM = { inputMode: 'decimal', step: 'any' };

  /* ---------- 画面 ---------- */
  function render() {
    const body = $('es-body');
    const y = window.scrollY;
    body.replaceChildren();
    st.refs = [];

    // 宛先・件名
    const head = card('宛先・件名（案件から自動）', 'es-head');
    const to = mk('div', 'grid2 es-to');
    const hon = document.createElement('select');
    hon.id = 'es-hon';
    ['御中', '様'].forEach(v => hon.appendChild(new Option(v, v)));
    hon.value = st.d.honorific || '御中';
    hon.addEventListener('change', () => { st.d.honorific = hon.value; changed(); });
    to.append(field('宛先（元請）', dataInput('es-client', 'text', 'client', { maxLength: 100 })), field('敬称', hon));
    head.appendChild(to);
    head.appendChild(field('件名', dataInput('es-subject', 'text', 'subject', { maxLength: 200 })));
    const g = mk('div', 'grid2');
    g.append(field('見積日', dataInput('es-date', 'date', 'date')), field('有効期限', dataInput('es-due', 'date', 'due')));
    head.appendChild(g);
    const no = mk('div', 'ff');
    no.append(mk('span', 'lbl', '見積書番号'), mk('div', st.row.number ? 'es-no' : 'es-no hint', st.row.number || 'PDFを作ったときに決まります'));
    no.lastChild.id = 'es-number';
    head.appendChild(no);
    const g2 = mk('div', 'grid2');
    const profit = ctl('input', 'es-profit', 'number', st.d.profit_pct, { min: 0, max: 500, step: 1, inputMode: 'numeric' }, v => {
      st.d.profit_pct = Math.min(500, Math.max(0, num(v)));
      st.d.lines = EL.applyProfit(st.d.lines, st.d.profit_pct);
      changed();
    });
    profit.addEventListener('change', () => { profit.value = st.d.profit_pct; });
    g2.append(field('担当者名', dataInput('es-manager', 'text', 'manager', { maxLength: 60 })), field('利益率（%）', profit));
    head.appendChild(g2);
    const mul = mk('div', 'hint');
    mul.id = 'es-mul';
    head.appendChild(mul);
    body.appendChild(head);

    // 定型（明細が空のとき）
    const tc = card('明細が空のとき: 定型から入れる', 'es-tpl');
    const tg = mk('div', 'tpl-grid');
    const tpls = Object.values(EL.TEMPLATES).concat(st.templates.map(t => ({ label: t.name, items: Array.isArray(t.lines) ? t.lines : [] })));
    tpls.forEach(t => tg.appendChild(dBtn(t.label + ' ¥' + yen(EL.templateTotal(t)), 'btn ghost sm es-tpl-btn', () => useTemplate(t))));
    tc.appendChild(tg);
    body.appendChild(tc);
    const imp = dBtn('仕入見積を読み込む →', 'btn ghost sm', () => { location.hash = '#estimate/' + st.row.id + '/import'; });
    imp.id = 'es-import';
    body.appendChild(imp);

    // 明細
    const lc = card('明細', 'es-lines');
    st.d.lines.forEach((r, i) => lc.appendChild(lineCard(r, i)));
    const dl = document.createElement('datalist');
    dl.id = 'es-sugg';
    lc.appendChild(dl);
    const acts = mk('div', 'row');
    const add = dBtn('＋ 行を足す', 'btn ghost sm', () => {
      st.d.lines.push(EL.emptyRow());
      render();
      changed();
      $('es-desc-' + (st.d.lines.length - 1)).focus();
    });
    add.id = 'es-add';
    const qo = dBtn('よく使う明細から', 'btn ghost sm', () => { st.quickOpen = !st.quickOpen; render(); });
    qo.id = 'es-quick-open';
    qo.setAttribute('aria-expanded', String(!!st.quickOpen));
    acts.append(add, qo);
    lc.appendChild(acts);
    if (st.quickOpen) lc.appendChild(quickPanel());
    const r100 = dBtn('税込合計を00に', 'btn ghost sm', () => {
      const res = EL.roundTo100(st.d.lines, taxRate());
      if (res.result === 'already') { toast('税込合計はすでに100円単位です'); return; }
      st.d.lines = res.rows;
      render();
      changed();
    });
    r100.id = 'es-round';
    const sp = dBtn('過去単価に合わせる', 'btn ghost sm', matchPast);
    sp.id = 'es-past';
    const acts2 = mk('div', 'row');
    acts2.append(r100, sp);
    lc.appendChild(acts2);
    lc.appendChild(mk('div', 'hint', '摘要を打つと単価マスタから候補が出ます。選ぶと単位と単価が入ります'));
    body.appendChild(lc);
    body.appendChild(card(null, 'es-check'));

    // 合計
    const sc = card('合計', 'es-totals');
    [['小計', 'es-t-sub'], ['', 'es-t-tax'], ['税込から引く値引き', 'es-t-adj'], ['見積金額', 'es-t-total']].forEach(([label, id]) => {
      const rw = mk('div', 'sum-row' + (id === 'es-t-total' ? ' big' : ''));
      rw.id = id + '-row';
      rw.append(mk('span', null, label), mk('span', null, ''));
      rw.lastChild.id = id;
      sc.appendChild(rw);
    });
    const gr = mk('div', 'hint');
    gr.id = 'es-gross';
    sc.appendChild(gr);
    body.appendChild(sc);

    // 備考
    const nc = card('備考', 'es-notes');
    nc.appendChild(mk('div', 'card-d', EL.FIXED_NOTE + '（必ず入ります）'));
    const koki = mk('div', 'opt-row');
    const kv = ctl('input', 'es-koki-val', 'number', st.d.notes_koki_val, { min: 1, step: 1, inputMode: 'numeric' }, v => { st.d.notes_koki_val = Math.max(1, Math.round(num(v))); changed(); });
    kv.addEventListener('change', () => { kv.value = st.d.notes_koki_val; }); // 1未満にしない
    kv.setAttribute('aria-label', '工期（日数）');
    const step = k => dBtn(k > 0 ? '＋' : '−', 'step-btn', () => { st.d.notes_koki_val = Math.max(1, num(st.d.notes_koki_val) + k); kv.value = st.d.notes_koki_val; changed(); });
    koki.append(checkLabel('es-koki', 'notes_koki', '工期'), step(-1), kv, step(1), mk('span', null, '日間'));
    koki.children[1].setAttribute('aria-label', '工期を1日減らす');
    koki.children[3].setAttribute('aria-label', '工期を1日増やす');
    nc.appendChild(koki);
    [['es-jikan', 'notes_jikan', '工事時間', '例 9:00〜17:00'], ['es-nimotsu', 'notes_nimotsu', '荷物の移動依頼', '例 洗面所の物を出しておいてください']].forEach(([id, key, label, ph]) => {
      nc.appendChild(checkLabel(id, key, label));
      const v = dataInput(id + '-val', 'text', key + '_val', { maxLength: 100, placeholder: ph });
      v.setAttribute('aria-label', label);
      nc.appendChild(v);
    });
    nc.appendChild(field('その他（自由記入）', dataInput('es-extra', 'textarea', 'notes_extra', { rows: 3, maxLength: 1000 })));
    body.appendChild(nc);

    // 定型に登録
    const rc = card(null, 'es-reg');
    const regOpen = dBtn('この明細を定型に登録', 'btn ghost sm', () => { box.hidden = !box.hidden; regOpen.setAttribute('aria-expanded', String(!box.hidden)); if (!box.hidden) nameIn.focus(); });
    regOpen.id = 'es-reg-open';
    regOpen.setAttribute('aria-expanded', 'false');
    const box = mk('div', 'ff');
    box.hidden = true;
    const nameIn = ctl('input', 'es-reg-name', 'text', '', { maxLength: 60, placeholder: '例：調査（人工＋交通費）' }, () => {});
    const regMsg = mk('div', 'msg');
    regMsg.id = 'es-reg-msg';
    const regSave = dBtn('定型に登録する', 'btn sm', async () => {
      const name = nameIn.value.trim();
      const lines = EL.templateLines(st.d.lines);
      regMsg.className = 'msg err';
      if (!name) { regMsg.textContent = '定型の名前を入れてください'; return; }
      if (!lines.length) { regMsg.textContent = '明細が空です'; return; }
      regSave.disabled = true;
      try {
        st.templates.push(await EstimatesApi.addTemplate(name, lines));
        toast('定型「' + name + '」に登録しました');
        render();
      } catch (e) { regMsg.textContent = '登録できませんでした: ' + errText(e); }
      finally { regSave.disabled = false; }
    });
    regSave.id = 'es-reg-save';
    box.append(field('定型の名前', nameIn), regSave, regMsg);
    rc.append(regOpen, box);
    body.appendChild(rc);

    if (st.ro) {
      body.querySelectorAll('input, select, textarea, button').forEach(e => { e.disabled = true; });
      body.insertBefore(mk('div', 'notes', 'この版は' + (STATUS[st.row.status] || '') + 'です。直すときは下の「新しい版を作って直す」を押してください（この版はそのまま残ります）'), body.firstChild);
    }
    $('es-draft').hidden = $('es-pdf').hidden = st.ro;
    $('es-newver').hidden = !st.ro;
    refresh();
    renderCheck();
    window.scrollTo(0, y);
  }
  function checkLabel(id, key, text) {
    const l = mk('label', 'check');
    l.append(ctl('input', id, 'checkbox', st.d[key], null, v => { st.d[key] = v; changed(); }), document.createTextNode(text));
    return l;
  }

  // 1行＝カード: 摘要＋詳細／数量・単位・金額／単価と原価の表示／↑↓・複製・削除
  function lineCard(r, i) {
    const c = mk('div', 'ln');
    c.id = 'es-line-' + i;
    if (r.auto) c.appendChild(mk('div', 'hint', '諸経費の自動行（値引きと自動行を除いた合計 × ' + num(r.pct) + '%）'));
    if (r.postTax) c.appendChild(mk('div', 'hint', '税込から引く値引き（小計に入りません）'));
    const amt = ctl('input', 'es-amt-' + i, 'number', r.amount, Object.assign({ readOnly: !!r.auto }, NUM), v => {
      L(i).amount = num(v);
      L(i).unit_price = EL.unitPriceOf(L(i));
      L(i).manual = true;
      changed();
    });
    amt.addEventListener('change', () => { if (r.auto) return; st.d.lines[i] = EL.fixRow(L(i)); amt.value = L(i).amount; changed(); });
    const unit = ctl('input', 'es-unit-' + i, 'text', r.unit, { maxLength: 20 }, v => { L(i).unit = v; changed(); });
    const desc = ctl('input', 'es-desc-' + i, 'text', r.description, { maxLength: 200, placeholder: '摘要（例：クロス張替）', autocomplete: 'off' }, (v, ev) => {
      L(i).description = v;
      fillSugg(v);
      // datalist から選んだとき（打っている途中は inputType が insertText）: 単位と単価を入れ、金額＝単価×数量
      const picked = !L(i).auto && (!ev.inputType || ev.inputType === 'insertReplacementText') && st.sugg.find(s => s.description === v);
      if (picked) {
        const row = L(i);
        if (picked.unit) row.unit = picked.unit;
        row.unit_price = picked.unit_price;
        row.amount = Math.round(picked.unit_price * num(row.quantity));
        row.manual = true;
        unit.value = row.unit;
        amt.value = row.amount;
      }
      changed();
    });
    desc.setAttribute('list', 'es-sugg');
    desc.setAttribute('aria-label', (i + 1) + '行目の摘要');
    desc.addEventListener('focus', () => fillSugg(desc.value));
    const detail = ctl('input', 'es-detail-' + i, 'text', r.detail, { maxLength: 200, placeholder: '詳細（任意）' }, v => { L(i).detail = v; changed(); });
    detail.setAttribute('aria-label', (i + 1) + '行目の詳細');
    const qty = ctl('input', 'es-qty-' + i, 'number', r.quantity, Object.assign({ readOnly: !!r.auto }, NUM), v => {
      st.d.lines[i] = EL.setQuantity(L(i), num(v), st.d.profit_pct);
      changed();
    });
    const g = mk('div', 'grid3');
    g.append(field('数量', qty), field('単位', unit), field('金額', amt));
    const info = mk('div', 'hint');
    info.id = 'es-info-' + i;
    const acts = mk('div', 'ln-acts');
    const n = st.d.lines.length;
    const up = dBtn('↑', 'btn ghost sm', () => swap(i, -1));
    up.setAttribute('aria-label', (i + 1) + '行目を上へ');
    up.disabled = i === 0;
    const down = dBtn('↓', 'btn ghost sm', () => swap(i, 1));
    down.setAttribute('aria-label', (i + 1) + '行目を下へ');
    down.disabled = i === n - 1;
    const dup = dBtn('複製', 'btn ghost sm', () => { st.d.lines.splice(i + 1, 0, JSON.parse(JSON.stringify(L(i)))); render(); changed(); });
    const del = dBtn('削除', 'btn ghost sm', async () => {
      if (EL.isRealItem(L(i)) && !(await askPopup('この行（' + (L(i).description || '摘要なし') + '）を消しますか？', { title: '行を消す', okLabel: '消す', danger: true, id: 'es-del-ask' }))) return;
      st.d.lines.splice(i, 1);
      if (!st.d.lines.length) st.d.lines.push(EL.emptyRow());
      render();
      changed();
    });
    del.id = 'es-del-' + i;
    acts.append(up, down, dup, del);
    c.append(desc, detail, g, info);
    if (r._applied) {
      const back = dBtn('元の額に戻す（' + yen(r._applied.amount) + '）', 'btn ghost sm', () => {
        const a = L(i)._applied;
        Object.assign(L(i), { unit_price: a.price, amount: a.amount, manual: a.manual });
        delete L(i)._applied;
        render();
        changed();
        sellCheck();
      });
      back.id = 'es-revert-' + i;
      c.appendChild(back);
    }
    c.appendChild(acts);
    st.refs[i] = { amt, info };
    return c;
  }
  function swap(i, k) {
    const a = st.d.lines;
    [a[i], a[i + k]] = [a[i + k], a[i]];
    render();
    changed();
  }
  function fillSugg(v) {
    st.sugg = EL.suggestDescriptions(st.rates, v);
    $('es-sugg').replaceChildren(...st.sugg.map(s => {
      const o = document.createElement('option');
      o.value = s.description;
      o.label = (s.unit ? s.unit + ' ・ ' : '') + '¥' + yen(s.unit_price);
      return o;
    }));
  }
  // よく使う明細: 現場管理費・交通費・諸経費（合計×%）＋会社の estimate_presets。原価として入れ、利益率で販売を作る
  function quickPanel() {
    const p = mk('div', 'quick');
    p.id = 'es-quick';
    const put = row => {
      st.d.lines = EL.applyProfit(st.d.lines.filter(EL.isRealItem).concat([row]), st.d.profit_pct);
      render();
      changed();
    };
    p.appendChild(dBtn('現場管理費／日', 'btn ghost sm', () => put(EL.quickAdd('genba'))));
    p.appendChild(dBtn('交通費／台', 'btn ghost sm', () => put(EL.quickAdd('kotsu'))));
    const sk = mk('div', 'opt-row');
    const pct = ctl('input', 'es-shokehi-pct', 'number', st.shokehiPct, { min: 0, max: 100, step: 1, inputMode: 'numeric' }, v => { st.shokehiPct = v; });
    pct.setAttribute('aria-label', '諸経費の%');
    sk.append(mk('span', null, '諸経費 合計×'), pct, mk('span', null, '%'), dBtn('足す', 'btn ghost sm', () => {
      if (!(num(st.shokehiPct) > 0)) { toast('諸経費の%を入力してください'); return; }
      put(EL.quickAdd('shokehi', num(st.shokehiPct)));
    }));
    p.appendChild(sk);
    st.presets.forEach(pr => p.appendChild(dBtn(pr.text + ' ¥' + yen(pr.price) + (pr.unit ? '／' + pr.unit : ''), 'btn ghost sm', () => put(EL.costRow(pr.text, pr.unit || '式', num(pr.price))))));
    if (!st.presets.length) p.appendChild(mk('div', 'hint', '会社のよく使う明細は 設定 → 見積書 で足せます'));
    return p;
  }
  // 値だけ書き換える（打っている欄はそのまま）
  function refresh() {
    if (!st) return;
    st.refs.forEach((rf, i) => {
      const r = L(i);
      if (!r) return;
      if (document.activeElement !== rf.amt) rf.amt.value = r.amount;
      rf.info.textContent = '@' + yen(EL.unitPriceOf(r)) + ' × ' + num(r.quantity) + (r.unit || '') + (num(r.cost_amount) ? ' ・ 原価 ' + yen(r.cost_amount) : '');
    });
    const t = EL.totals(st.d.lines, taxRate());
    $('es-t-sub').textContent = yen(t.subtotal);
    $('es-t-tax-row').firstChild.textContent = '消費税 ' + Math.round(taxRate() * 1000) / 10 + '%';
    $('es-t-tax').textContent = yen(t.tax);
    $('es-t-adj-row').hidden = !t.postTaxAdj;
    $('es-t-adj').textContent = yen(t.postTaxAdj);
    $('es-t-total').textContent = yen(t.total);
    const gr = EL.gross(st.d.lines);
    $('es-gross').textContent = '原価 ' + yen(gr.cost) + ' ・ 粗利 ' + yen(gr.profit) + '（' + Math.round(gr.rate * 1000) / 10 + '%）';
    $('es-mul').textContent = '販売 ＝ 原価 × ' + (1 + num(st.d.profit_pct) / 100).toFixed(2) + '（手で直した行はそのまま）';
    $('es-tpl').hidden = st.d.lines.some(EL.isRealItem);
  }
  /* ---------- 単価マスタ: 照合・過去単価に合わせる・登録 ---------- */
  const prop = () => CaseLogic.placeName(st.caseRow) || str(st.d.subject);
  const costCheck = () => EL.check(EL.rateView(st.d.lines, 'cost'), st.rates, { vendor: st.d.vendor || '', property: prop(), client: str(st.d.client), kind: 'cost' });
  function sellCheck() {
    if (!st) return;
    clearTimeout(st.checkTimer);
    st.sellAlerts = EL.check(EL.rateView(st.d.lines, 'sell'), st.rates, { property: prop(), client: str(st.d.client), kind: 'sell' });
    renderCheck();
  }
  // 要確認（warn）が先 → impact の大きい順。販売で当てる額があるものは押すと単価が変わる（INV:2827-2961）
  function renderCheck() {
    const box = $('es-check');
    if (!box || !st) return;
    box.replaceChildren();
    const rows = st.costAlerts.map(a => Object.assign({ side: '原価' }, a)).concat(st.sellAlerts.map(a => Object.assign({ side: '販売' }, a)));
    const noClient = !str(st.d.client) && st.d.lines.some(r => EL.isRateTrackable(r, 'sell'));
    box.hidden = st.ro || (!rows.length && !noClient);
    if (box.hidden) return;
    rows.sort((a, b) => (a.level === 'warn' ? 0 : 1) - (b.level === 'warn' ? 0 : 1) || (b.impact || 0) - (a.impact || 0));
    const nWarn = rows.filter(r => r.level === 'warn').length;
    const loss = rows.filter(r => r.side === '販売' && r.direction === 'down').reduce((s, r) => s + (r.impact || 0), 0);
    if (noClient) box.appendChild(mk('div', 'rc-off', 'クライアント名が未入力です。いまは全社の中央値と比べているだけで、この管理会社に前回いくらで出したかとは照合していません。\n過去単価は管理会社ごとに揃えます。宛名を入れると前回単価との照合が動きます。'));
    if (rows.length) box.appendChild(mk('div', 'card-t', '過去単価との照合 — ' + rows.length + '件' + (nWarn ? '（うち要確認 ' + nWarn + '件）' : '') + (loss ? '（取りこぼし合計 ' + yen(loss) + '円）' : '')));
    const canApply = a => a.side === '販売' && a.apply_price > 0 && a.apply_price !== a.unit_price;
    const second = a => canApply(a) && a.best_price > 0 && a.best_price !== a.apply_price && a.best_price !== a.unit_price;
    rows.forEach((a, k) => {
      const c = mk('div', 'rc' + (a.level === 'warn' ? ' warn' : ''));
      c.id = 'es-rc-' + k;
      const t = mk('div', 'rc-t');
      t.append(mk('span', 'rc-lv', a.level === 'warn' ? '要確認' : '参考'),
        document.createTextNode(a.description + ' [' + a.side + ']' + (a.direction === 'down' ? ' ↓取りこぼし' : a.direction === 'up' ? ' ↑指摘リスク' : '')));
      c.append(t, mk('div', null, a.message));
      if (canApply(a)) {
        const b = dBtn('タップで ' + yen(a.apply_price) + ' にする ' + a.apply_label, 'btn ghost sm', () => applyAlert(a, a.apply_price));
        b.id = 'es-rc-apply-' + k;
        c.appendChild(b);
        if (second(a)) {
          const b2 = dBtn(yen(a.best_price) + ' にする', 'btn ghost sm', () => applyAlert(a, a.best_price));
          b2.id = 'es-rc-best-' + k;
          c.appendChild(b2);
        }
      }
      box.appendChild(c);
    });
  }
  function applyAlert(a, price) {
    const r = L(a.index);
    // 照合のあとに行が変わっていたら当てない（別の行の単価を書き換えないように）
    if (!r || str(r.description) !== a.description || EL.unitPriceOf(r) !== a.unit_price) { toast('明細が変わっています。照合し直します。'); sellCheck(); return; }
    if (price === EL.unitPriceOf(r)) return;
    if (!r._applied) r._applied = { price: EL.unitPriceOf(r), amount: r.amount, manual: !!r.manual }; // 戻り先は最初に当てる前の額
    Object.assign(r, { unit_price: price, amount: Math.round(num(r.quantity) * price) || price, manual: true });
    render();
    changed();
    sellCheck();
  }
  // 過去単価に合わせる（INV:2968-3030）: 同じ管理会社の販売の記録から。いまと違う行を一覧にして確かめ、OK なら全部 manual で当てる
  async function matchPast() {
    const client = str(st.d.client);
    if (!client) { toast('クライアント名を入力してください。過去単価は管理会社ごとに揃えます。'); return; }
    const view = EL.rateView(st.d.lines, 'sell');
    const sug = EL.suggestPrices(view, st.rates, { client, property: prop() });
    if (!sug.length) { toast('「' + client + '」宛の過去見積に一致する項目はありませんでした。'); return; }
    const hits = sug.filter(x => x.price && x.price !== view[x.index].unit_price);
    if (!hits.length) { toast('「' + client + '」の過去単価と既に一致しています。'); return; }
    const note = h => {
      const src = h.from === 'same_prop' ? '[同じ現場 ' + h.date + ']' : '[別の現場「' + h.prop + '」' + h.date + ']';
      return h.best_price > h.price ? src + ' ※過去最高 ' + yen(h.best_price) + '（' + h.best_date + '）' : src;
    };
    const list = hits.slice(0, 12).map(h => '・' + view[h.index].description + '　' + yen(view[h.index].unit_price) + ' → ' + yen(h.price) + '　' + note(h)).join('\n')
      + (hits.length > 12 ? '\n…ほか' + (hits.length - 12) + '件' : '');
    if (!(await askPopup('「' + client + '」への過去単価に合わせます（' + hits.length + '件）。\n\n' + list, { title: '過去単価に合わせる', okLabel: '合わせる', id: 'es-past-ask' }))) return;
    hits.forEach(h => { const r = L(h.index); Object.assign(r, { unit_price: h.price, amount: Math.round(num(r.quantity) * h.price) || h.price, manual: true }); });
    render();
    changed();
    sellCheck();
  }
  // PDFを作ったとき: 販売（source＝見積書番号）→ 原価（同じ source）。失敗しても PDF は作る
  async function registerRates() {
    const o = { client: str(st.d.client), vendor: st.d.vendor || '', property: prop(), source: st.row.number };
    try {
      for (const kind of ['sell', 'cost']) await EstimatesApi.registerRates(EL.rateView(st.d.lines, kind), Object.assign({ kind }, o), st.rates);
    } catch (e) { toast('単価マスタに登録できませんでした: ' + errText(e)); }
  }

  async function useTemplate(t) {
    if (st.d.lines.some(EL.isRealItem) && !(await askPopup('現在の明細を「' + t.label + '」のテンプレートで上書きしますか？', { title: '定型を入れる', okLabel: '上書きする', id: 'es-tpl-ask' }))) return;
    st.d = EL.applyTemplate(st.d, t);
    render();
    changed();
  }

  /* ---------- 開く・ボタン ---------- */
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $('es-back').addEventListener('click', () => { if (st) location.hash = '#case/' + st.caseRow.id; });
    $('es-draft').addEventListener('click', async () => {
      if (!st) return;
      $('es-draft').disabled = true;
      try { st.dirty = true; await saveNow(); toast('下書きを保存しました'); location.hash = '#case/' + st.caseRow.id; }
      catch (e) { toast('保存できませんでした: ' + errText(e)); }
      finally { $('es-draft').disabled = false; }
    });
    $('es-pdf').addEventListener('click', async () => {
      if (!st) return;
      $('es-pdf').disabled = true;
      try {
        if (!st.row.number) st.row.number = await EstimatesApi.nextNumber();
        await saveNow({ pdf_at: new Date().toISOString() });
        await registerRates();
        location.hash = '#doc/estimate/' + st.row.id;
      } catch (e) { toast('保存できませんでした: ' + errText(e)); }
      finally { $('es-pdf').disabled = false; }
    });
    $('es-newver').addEventListener('click', async () => {
      if (!st) return;
      $('es-newver').disabled = true;
      try { location.hash = '#estimate/' + (await EstimatesApi.createDraft(st.caseRow, st.row)).id; }
      catch (e) { toast('新しい版を作れませんでした: ' + errText(e)); }
      finally { $('es-newver').disabled = false; }
    });
  }
  async function show(id) {
    wire();
    st = null;
    $('es-body').replaceChildren(mk('div', 'empty', '読み込み中…'));
    $('es-sub').textContent = '';
    ['es-draft', 'es-pdf', 'es-newver'].forEach(b => { $(b).hidden = true; });
    showScreen('estimate');
    const row = await EstimatesApi.get(id);
    if (!row) { toast('見積書が見つかりませんでした'); location.replace('#cases'); return; }
    if (row.kind === 'teikei') { location.replace('#teikei/' + id); return; }
    const [caseRow, templates, presets, rates] = await Promise.all([CasesApi.get(row.case_id), EstimatesApi.templates(), EstimatesApi.presets(), EstimatesApi.rates()]);
    const ro = row.status !== 'draft';
    const d = Object.assign(EL.newData(caseRow, ctx.org, ctx.membership, new Date()), row.data || {});
    // 下書きは会社の今の設定（会社の写し・消費税率）で作る。出した版は当時のまま
    if (!ro) Object.assign(d, { company: EL.companyOf(ctx.org, ctx.membership), tax_rate: num(ctx.org.tax_rate) });
    if (!Array.isArray(d.lines) || !d.lines.length) d.lines = [EL.emptyRow()];
    st = { row, caseRow: caseRow || {}, d, ro, rates, templates, presets, sugg: [], refs: [], quickOpen: false, shokehiPct: 0, // 諸経費の%は入れない（0。ユーザー決定 2026-11-08）
     
      timer: null, saving: null, dirty: false, savedAt: '', err: '', sellAlerts: [], costAlerts: [], checkTimer: null };
    if (!ro) {
      st.sellAlerts = EL.check(EL.rateView(d.lines, 'sell'), rates, { property: prop(), client: str(d.client), kind: 'sell' });
      st.costAlerts = pendingCost && pendingCost.id === id ? pendingCost.alerts : costCheck();
    }
    pendingCost = null;
    setSub();
    render();
  }
  const setCostAlerts = (id, alerts) => { pendingCost = { id, alerts }; };
  return { show, setCostAlerts };
})();
