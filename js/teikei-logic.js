// js/teikei-logic.js — 定型見積（被害復旧工事）の規則（UMD: ブラウザは window.TeikeiLogic / node は module.exports。tests/teikei-logic.test.js）。DOM に触らない
// 出所は試作 /Users/s/Desktop/被害復旧工事_見積試作.html の lineFrom・addSet・setRate・setFloor1・initKeihi・autoPresetKey・applyPreset・setDays・recalc・previewParts など。決まりはそのまま
// 変えたところ: 状態は estimates.data（d）で受け取り、その場で直して返す。単価表（rates）は引数で受け取る。査定（__CAPS__）・保存・会社情報は写さない
(function (root) {
  const EL = typeof module !== 'undefined' && module.exports ? require('./estimate-logic.js') : root.EstimateLogic;
  const str = v => String(v == null ? '' : v);
  // 全角の数字も読む。読めなければ d（試作の numOr）
  const numOr = (v, d) => { v = str(v).replace(/[０-９．，－]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)); const n = parseFloat(v.replace(/,/g, '')); return isNaN(n) ? d : n; };
  const amt = r => (r.qty || 0) * (r.price || 0);

  /* ---------- 単価表の読み方 ---------- */
  const sets = rates => (rates && rates.sets) || [];
  const keihiSet = rates => sets(rates).find(s => s.category === '共通費');
  const masterSet = (rates, setId) => (setId ? sets(rates).find(s => s.id === setId) || null : null);
  const setOpt = (g, rates) => { const m = masterSet(rates, g.setId); return (m && m.options) || null; };
  // 部位ごと（共通費を除く）。同じ部位の中は標準が先・オプションが後
  function partsOf(rates) {
    const xs = sets(rates).filter(s => s.category !== '共通費');
    const out = [], map = new Map();
    xs.filter(s => s.category === '標準').concat(xs.filter(s => s.category !== '標準')).forEach(s => {
      if (!map.has(s.part)) { map.set(s.part, []); out.push({ part: s.part, sets: map.get(s.part) }); }
      map.get(s.part).push(s);
    });
    return out;
  }
  // 単価表の既定の合計（数量入力・日数の行は数量1で数える）
  const setDefaultTotal = set => (set.items || []).reduce((a, i) => a + ((i.qty_input || i.qty_days) ? 1 : (i.qty == null ? 1 : i.qty)) * (i.price || 0), 0);

  /* ---------- 表紙 ---------- */
  const roomText = r => { r = str(r).trim(); return r ? (/号/.test(r) ? r : r + '号室') : ''; };
  const autoTitle = (p, r) => (p ? `${p}${roomText(r)} 被害復旧工事` : '');
  // 着工日を1日目と数える（3日なら +2日）
  function autoEnd(start, days) {
    if (!start || !(days > 0)) return '';
    const d = new Date(start + 'T00:00:00');
    if (isNaN(d)) return '';
    d.setDate(d.getDate() + Math.round(days) - 1);
    return EL.ymd(d);
  }
  // 人が打った欄（covManual）には流し込まない
  function syncCover(d, caseRow) {
    const c = caseRow || {};
    if (!d.covManual.title) d.cover.title = autoTitle(str(c.name).trim(), c.room);
    if (!d.covManual.end) d.cover.end = autoEnd(d.cover.start, d.days);
    return d;
  }

  /* ---------- 明細 ---------- */
  // 0 付きが初期値（率を掛けた後）、base が単価表そのもの、mi が単価表での並び順。qty_days の行は数量＝工事日数
  function lineFrom(i, mi, days) {
    const q = i.qty_days ? (days == null ? null : days) : (i.qty_input ? null : (i.qty == null ? 1 : i.qty));
    return { name: i.name, name0: i.name, spec: i.spec, spec0: i.spec, unit: i.unit, unit0: i.unit,
      price: i.price, price0: i.price, base: i.price, mi, qty: q, qty0: q, day: !!i.qty_days, need: !!i.qty_input, free: false };
  }
  function addSet(d, set) {
    d.groups.push({ gid: ++d.seq, setId: set.id, free: false, part: set.part, part0: set.part, work: set.work, work0: set.work,
      rate: set.options && set.options.rate_presets ? 100 : null, items: set.items.map((it, mi) => lineFrom(it, mi, d.days)) });
    return d;
  }
  // 必ず入れるセット（default_add）の最後の1つは消せない
  function removeGroup(d, gid, rates) {
    const g = d.groups.find(x => x.gid === gid);
    if (!g) return false;
    const o = setOpt(g, rates);
    if (o && o.default_add && d.groups.filter(x => x.setId === g.setId).length <= 1) return false;
    d.groups = d.groups.filter(x => x.gid !== gid);
    return true;
  }
  const freeLine = () => ({ name: '', name0: '', spec: '', spec0: '', unit: '式', unit0: '式', price: null, price0: null, qty: 1, need: false, free: true });
  function addFreeSet(d) { d.groups.push({ gid: ++d.seq, setId: null, free: true, part: 'その他', work: '追加項目', rate: null, items: [freeLine()] }); return d; }
  function addFreeLine(d, gi) { d.groups[gi].items.push(freeLine()); return d; }
  // 全部消すと行の足し口まで消えるので1行残す
  function removeLine(d, gi, ri) { const g = d.groups[gi]; g.items.splice(ri, 1); if (!g.items.length) g.items.push(freeLine()); return d; }
  function moveGroup(d, gi, dir) {
    const j = gi + dir;
    if (j < 0 || j >= d.groups.length || gi < 0 || gi >= d.groups.length) return d;
    const g = d.groups[gi]; d.groups[gi] = d.groups[j]; d.groups[j] = g;
    return d;
  }
  const TEXT_FIELDS = ['name', 'spec', 'unit'];
  function setLine(d, gi, ri, field, value) {
    const it = d.groups[gi].items[ri];
    if (TEXT_FIELDS.includes(field)) it[field] = str(value);
    else if (field === 'qty' || field === 'price') it[field] = numOr(value, null);
    else throw new Error('直せない欄: ' + field);
    return d;
  }
  function setGroup(d, gi, field, value) {
    if (field !== 'part' && field !== 'work') throw new Error('直せない欄: ' + field);
    d.groups[gi][field] = str(value);
    return d;
  }
  // 率は単価に掛ける（rate_exempt の行には掛けない）。手で直した単価があれば一度止める（opts.force で進める）
  function setRate(d, gi, rate, rates, opts) {
    const g = d.groups[gi], o = setOpt(g, rates);
    if (!o) return d;
    rate = Math.max(0, numOr(rate, 100));
    const ex = o.rate_exempt || [];
    const target = g.items.filter(it => !ex.includes(it.name));
    if (!(opts && opts.force) && target.some(it => it.price !== it.price0)) return { needConfirm: true };
    g.rate = rate;
    for (const it of target) { it.price0 = Math.round((it.base == null ? it.price0 : it.base) * rate / 100); it.price = it.price0; }
    return d;
  }
  // 1階＝外す行（エレベーター養生費）が無い状態。行の有無から決める
  const floor1On = (g, rates) => { const o = setOpt(g, rates); return !!o && (o.floor1_omit || []).some(n => !g.items.some(it => it.name === n)); };
  function setFloor1(d, gi, on, rates) {
    const g = d.groups[gi], o = setOpt(g, rates), m = masterSet(rates, g.setId);
    if (!o || !m) return d;
    const omit = o.floor1_omit || [];
    if (on) { g.items = g.items.filter(it => !omit.includes(it.name)); return d; }
    // 外した行を単価表の並び（mi）に戻す。率は今の率を掛ける
    const ex = o.rate_exempt || [];
    m.items.forEach((i, mi) => {
      if (!omit.includes(i.name) || g.items.some(it => it.name === i.name)) return;
      const it = lineFrom(i, mi, d.days);
      if (!ex.includes(i.name)) { it.price0 = Math.round(i.price * (g.rate == null ? 100 : g.rate) / 100); it.price = it.price0; }
      const at = g.items.findIndex(x => (x.mi == null ? Infinity : x.mi) > mi);
      g.items.splice(at < 0 ? g.items.length : at, 0, it);
    });
    return d;
  }
  // 単価表の初期値から動かされた行か（自由行は比べる相手がいないので false）
  const lineEdited = it => !it.free && (it.price !== it.price0 || it.unit !== it.unit0 || it.name !== it.name0 || it.spec !== it.spec0);
  // 率 100・単価表の値に戻す。自由行は戻す先が無いので触らない
  function resetLines(d) {
    for (const g of d.groups) {
      if (g.rate != null) g.rate = 100;
      for (const it of g.items) {
        if (it.free) continue;
        if (it.base != null) it.price0 = it.base;
        it.price = it.price0; it.unit = it.unit0; it.name = it.name0; it.spec = it.spec0;
      }
    }
    return d;
  }

  /* ---------- 一般管理費 ---------- */
  // 行を作るだけ。プリセットの値は呼ぶ側が applyPreset で入れる
  // days: 工事日数（null なら未入力）。日数の行の数量は days（単価表の 3 は使わない）。係数は applyPreset で掛ける
  function initKeihi(rates, days) {
    const k = keihiSet(rates), dl = k.day_linked || [];
    const dq = days == null ? null : days;
    return k.items.map(i => { const day = i.day_linked != null ? !!i.day_linked : dl.includes(i.name), q = day ? dq : i.qty;
      return { name: i.name, spec: i.spec, unit: i.unit, unit0: i.unit, base: i.price, baseQty: i.qty, day, price: i.price, price0: i.price, qty: q, qty0: q }; });
  }
  const coefOf = (d, rates) => { const p = (keihiSet(rates).presets || []).find(x => x.key === d.preset); return p && p.coef != null ? p.coef : 1; };
  // 今のプリセット・工事日数での既定値。日数の行は係数を掛けず数量＝日数
  const presetVals = (d, rates) => d.keihi.map(r => (r.day ? { price: r.base, qty: d.days == null ? null : d.days }
    : { price: Math.round(r.base * coefOf(d, rates)), qty: r.baseQty }));
  function applyPreset(d, rates) {
    presetVals(d, rates).forEach((v, i) => { const r = d.keihi[i]; r.price0 = v.price; r.qty0 = v.qty; r.price = v.price; r.qty = v.qty; r.unit = r.unit0; });
    return d;
  }
  // 廊下と居室側の両方→both、居室側だけ→room、それ以外→auto.otherwise。定型は単価表の部位（part0）、自由セットは今の部位で数える
  function autoPresetKey(d, rates) {
    const a = keihiSet(rates).auto;
    if (!a) return d.preset;
    let c = false, r = false;
    for (const g of d.groups) {
      const p = g.free ? (g.part || '（部位未設定）') : (g.part0 || '');
      if (a.corridor_parts.includes(p)) c = true;
      if (a.room_parts.includes(p)) r = true;
    }
    return c && r ? 'both' : (r ? 'room' : (a.otherwise || 'corridor'));
  }
  const keihiEdited = d => d.keihi.some(r => r.price !== r.price0 || r.qty !== r.qty0 || r.unit !== r.unit0);
  // 人がプリセットを選んだ（presetManual）・手入力があるときは自動で切り替えない
  function syncPreset(d, rates) {
    if (d.presetManual || keihiEdited(d)) return d;
    const k = autoPresetKey(d, rates);
    if (k !== d.preset) { d.preset = k; applyPreset(d, rates); }
    return d;
  }
  function setKeihi(d, i, field, value) {
    const r = d.keihi[i];
    if (field === 'unit') r.unit = str(value);
    else if (field === 'qty' || field === 'price') r[field] = numOr(value, null);
    else throw new Error('直せない欄: ' + field);
    return d;
  }
  const resetKeihi = (d, rates) => applyPreset(d, rates);
  // 空・0・負は未入力（null）。日数の行と、手で直していない日数の明細行を追従。完工日も（手で入れていなければ）
  function setDays(d, v) {
    const n = numOr(v, null);
    d.days = n == null || n <= 0 ? null : n;
    d.keihi.forEach(r => { if (r.day) { r.qty0 = d.days; r.qty = d.days; } });
    d.groups.forEach(g => g.items.forEach(it => { if (it.day && it.qty === it.qty0) { it.qty0 = d.days; it.qty = d.days; } }));
    if (!d.covManual.end) d.cover.end = autoEnd(d.cover.start, d.days);
    return d;
  }

  /* ---------- 最初の中身 ---------- */
  function newData(caseRow, rates, today) {
    const c = caseRow || {};
    const d = { cover: { date: EL.ymd(today), to: '', title: autoTitle(str(c.name).trim(), c.room), place: str(c.address), start: '', end: '', pay: '', exp: EL.defaultDue(today) },
      covManual: { title: false, end: false }, days: null, groups: [], keihi: initKeihi(rates, null), preset: 'corridor', presetManual: false,
      miscRate: 0, taxRate: 10, // 諸経費は 0%（ユーザー決定 2026-11-08。消費税は 10% のまま）
      memo: '', seq: 0, ratesVersion: (rates && rates.version) || '', pdf_at: null };
    sets(rates).forEach(s => { if (s.options && s.options.default_add) addSet(d, s); });
    d.preset = autoPresetKey(d, rates);
    return applyPreset(d, rates);
  }

  /* ---------- 合計・紙面 ---------- */
  const partOf = g => g.part || '（部位未設定）';
  function totals(d) {
    const parts = [], map = new Map();
    for (const g of d.groups) {
      const p = partOf(g);
      if (!map.has(p)) { map.set(p, { part: p, total: 0 }); parts.push(map.get(p)); }
      map.get(p).total += g.items.reduce((a, it) => a + amt(it), 0);
    }
    const work = parts.reduce((a, p) => a + p.total, 0), ksub = d.keihi.reduce((a, r) => a + amt(r), 0);
    const base = work + ksub, misc = Math.round(base * (d.miscRate || 0) / 100);
    const net = base + misc, tax = Math.round(net * (d.taxRate || 0) / 100);
    return { parts, work, ksub, misc, base, net, tax, total: net + tax };
  }
  // 内訳書のページ（部位名でまとめる。並び順は崩さない）。最後に一般管理費
  function pages(d) {
    const row = r => ({ name: r.name, spec: r.spec, qty: r.qty, unit: r.unit, price: r.price, note: '' });
    const order = [], map = new Map();
    for (const g of d.groups) {
      const p = partOf(g);
      if (!map.has(p)) { map.set(p, []); order.push(p); }
      g.items.forEach(it => map.get(p).push(it));
    }
    const out = order.map(name => ({ name, rows: map.get(name).map(row), total: map.get(name).reduce((a, r) => a + amt(r), 0) }));
    out.push({ name: '一般管理費', keihi: true, rows: d.keihi.map(row), total: d.keihi.reduce((a, r) => a + amt(r), 0) });
    return out;
  }
  // PDF を作る前に確かめること（宛名は案件から入れない: 工事の部屋と請求先が別になることがある）
  function validate(d) {
    const out = [];
    if (!str(d.cover && d.cover.to).trim()) out.push('宛名（請求先）を入れてください');
    if (d.days == null) out.push('工事日数を入れてください');
    if (!Number.isFinite(d.miscRate) || !Number.isFinite(d.taxRate)) out.push('諸経費・消費税の率を入れてください');
    d.groups.forEach(g => g.items.forEach(it => { if (it.need && it.qty == null) out.push('数量が未入力の行があります（' + (it.name || it.spec || g.work) + '）'); }));
    return out;
  }
  const safe = s => s.replace(/[\\/:*?"<>|]/g, '_').replace(/[\x00-\x1f]/g, '');
  const fileName = c => { const n = str(c && c.name).trim(); return safe(n ? `【被害復旧工事見積書】${n}${roomText(c.room)}` : '被害復旧工事費 見積書') + '.pdf'; };
  const docLabel = row => (row && row.number ? '定型見積書 ' + row.number + ' 第' + row.version + '版' : '定型見積書（下書き）');

  const api = { numOr, sets, keihiSet, masterSet, partsOf, setDefaultTotal, roomText, autoTitle, autoEnd, syncCover, lineFrom, addSet, removeGroup, addFreeSet, addFreeLine,
    removeLine, moveGroup, setLine, setGroup, setRate, floor1On, setFloor1, lineEdited, resetLines, initKeihi, presetVals, applyPreset, autoPresetKey, keihiEdited, syncPreset,
    setKeihi, resetKeihi, setDays, newData, totals, pages, validate, fileName, docLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TeikeiLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
