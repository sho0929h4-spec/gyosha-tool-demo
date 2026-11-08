// js/estimate-logic.js — 見積書の規則（UMD: ブラウザは window.EstimateLogic / node は module.exports。tests/estimate-logic.test.js）。DOM に触らない
// 出典は docs/notes/2026-11-06-port-notes.md §1（freee-quote-builder の invoice.html・rate_store.py）。式・文言・定数はそのまま。
// 変えたところ: 行は2本の配列ではなく1行に原価と販売を持つ（移植メモ §1.8 の提案）。数量を直すと原価にも効く（§1.2 の「注意」を直した形）。
// 行の形: { description, detail, quantity, unit, cost_unit_price, cost_amount, unit_price, amount, manual, auto:'shokehi'|undefined, pct, postTax }
(function (root) {
  const CL = typeof module !== 'undefined' && module.exports ? require('./case-logic.js') : root.CaseLogic;
  const str = v => String(v == null ? '' : v).trim();
  const num = v => Number(v) || 0;
  const round = Math.round;
  const sum = (rows, f) => rows.reduce((a, r) => a + num(f(r)), 0);
  const fmt = n => Number(n).toLocaleString('en-US'); // 照合の文言の 3桁区切り（元の {n:,}）

  const emptyRow = () => ({ description: '', detail: '', quantity: 1, unit: '式', cost_unit_price: 0, cost_amount: 0, unit_price: 0, amount: 0 });
  // 原価＝その額の行（販売は applyProfit で作る）
  const costRow = (description, unit, price) => Object.assign(emptyRow(), { description, unit, cost_unit_price: num(price), cost_amount: num(price), unit_price: num(price), amount: num(price) });
  const unitPriceOf = r => (num(r.quantity) ? round(num(r.amount) / num(r.quantity)) : num(r.amount));
  // 欄を離れたとき: 単価×数量＝金額 にそろえる（原価側も同じ）
  function fixRow(row) {
    const q = num(row.quantity);
    if (!q) return Object.assign({}, row, { unit_price: num(row.amount), cost_unit_price: num(row.cost_amount) });
    const up = round(num(row.amount) / q), cup = round(num(row.cost_amount) / q);
    return Object.assign({}, row, { unit_price: up, amount: round(up * q), cost_unit_price: cup, cost_amount: round(cup * q) });
  }
  // 数量を直した: 単価を動かさず 金額＝単価×数量（原価も 原価単価×数量）。手で直していない行は販売単価を利益率で出し直す（manual は付けない）
  function setQuantity(row, q, pct) {
    const r = Object.assign({}, row, { quantity: q });
    if (r.auto) return r;
    r.cost_amount = round(num(r.cost_unit_price) * num(q));
    if (!r.manual && !r.postTax) r.unit_price = round(num(r.cost_unit_price) * (1 + num(pct) / 100));
    r.amount = round(num(r.unit_price) * num(q));
    return r;
  }
  // 紙面の上で1つの欄を直す（key = description|detail|quantity|unit|unit_price）。行は1つに原価と販売を持つので、文字はそのまま原価側にも効く（移植メモ §1.2）
  //   quantity は setQuantity と同じ。unit_price は手で直した扱い（manual）で 金額＝単価×数量（原価は触らない）。最後に諸経費の自動行を出し直す
  function setCell(rows, i, key, value, pct) {
    const out = rows.slice();
    const r = Object.assign({}, out[i]);
    if (key === 'quantity') out[i] = setQuantity(r, num(value), pct);
    else if (key === 'unit_price') { const up = round(num(value)); out[i] = Object.assign(r, { unit_price: up, amount: round(up * num(r.quantity)), manual: true }); }
    else if (['description', 'detail', 'unit'].includes(key)) out[i] = Object.assign(r, { [key]: String(value == null ? '' : value) });
    else throw new Error('直せない欄: ' + key);
    return recalcShokehi(out);
  }
  // 行を消す（0行になったら空の行を1つ）・この下に空の行を足す
  const removeLine = (rows, i) => { const out = rows.filter((_, j) => j !== i); return recalcShokehi(out.length ? out : [emptyRow()]); };
  const insertLineAfter = (rows, i) => rows.slice(0, i + 1).concat([emptyRow()], rows.slice(i + 1));
  // 諸経費の自動行: 自分・ほかの自動行・postTax を除いた販売額の合計 × pct/100。原価にも同じ額（粗利に効かない）
  function recalcShokehi(rows) {
    return rows.map((r, i) => {
      if (!r.auto) return r;
      const base = sum(rows.filter((x, j) => j !== i && !x.auto && !x.postTax), x => x.amount);
      const v = round(base * num(r.pct) / 100);
      return Object.assign({}, r, { unit_price: v, amount: v, cost_unit_price: v, cost_amount: v });
    });
  }
  // 利益率: 販売 = round(原価単価×倍率) × 数量。manual・自動行・値引き（postTax）は触らない
  function applyProfit(rows, pct) {
    const mul = 1 + num(pct) / 100;
    return recalcShokehi(rows.map(r => {
      if (r.manual || r.auto || r.postTax) return Object.assign({}, r);
      const up = round(num(r.cost_unit_price) * mul);
      return Object.assign({}, r, { unit_price: up, amount: round(num(r.quantity) * up) });
    }));
  }
  // よく使う明細（元のクイック追加）: 現場管理費 1日／交通費 1台（単価は入れない＝0。ユーザー決定 2026-11-08）／諸経費 合計×pct の自動行
  const QUICK = { genba: ['現場管理費', '日', 0], kotsu: ['交通費', '台', 0] };
  function quickAdd(kind, pct) {
    if (kind === 'shokehi') return Object.assign(emptyRow(), { description: '諸経費', auto: 'shokehi', pct: num(pct) });
    const q = QUICK[kind];
    return costRow(q[0], q[1], q[2]);
  }
  // 合計（紙と画面で同じ式）。値引き（postTax）は小計に入れず、税の後で引く
  function totals(rows, taxRate) {
    const subtotal = sum(rows.filter(r => !r.postTax), r => r.amount);
    const postTaxAdj = sum(rows.filter(r => r.postTax), r => r.amount);
    const tax = round(subtotal * num(taxRate));
    return { subtotal, postTaxAdj, tax, total: subtotal + tax + postTaxAdj };
  }
  // 税込合計を00に: 値引きの行が無ければ余りを値引きにして足す。あれば外す。result = 'added' | 'removed' | 'already'
  const isRoundRow = r => r.postTax && r.description === '値引き';
  function roundTo100(rows, taxRate) {
    if (rows.some(isRoundRow)) return { rows: rows.filter(r => !isRoundRow(r)), result: 'removed', r: 0 };
    const s = sum(rows, r => r.amount);
    const rem = (((s + round(s * num(taxRate))) % 100) + 100) % 100; // 合計がマイナスでも値引きはマイナスの額
    if (!rem) return { rows, result: 'already', r: 0 };
    return { rows: rows.concat([Object.assign(emptyRow(), { description: '値引き', unit_price: -rem, amount: -rem, cost_unit_price: -rem, cost_amount: -rem, postTax: true })]), result: 'added', r: rem };
  }
  // 紙に出す行（摘要・詳細・金額・単価のどれかがある）
  const isRealItem = r => !!(str(r.description) || str(r.detail) || num(r.amount) || num(r.unit_price));
  // 粗利（率は販売に対して）
  function gross(rows) {
    const cost = sum(rows, r => r.cost_amount), sell = sum(rows, r => r.amount);
    return { cost, sell, profit: sell - cost, rate: sell ? (sell - cost) / sell : 0 };
  }

  /* ---------- 備考 ---------- */
  const FIXED_NOTE = '工事における電気、水道などの提供をお願いいたします。';
  function notesText(d) {
    const out = [FIXED_NOTE];
    if (d.notes_koki) out.push('工期：' + (str(d.notes_koki_val) ? str(d.notes_koki_val) + '日間' : ''));
    if (d.notes_jikan) out.push('工事時間：' + str(d.notes_jikan_val));
    if (d.notes_nimotsu) out.push('荷物の移動依頼：' + str(d.notes_nimotsu_val));
    if (str(d.notes_extra)) out.push(d.notes_extra);
    return out.join('\n');
  }

  /* ---------- 定型 ---------- */
  const TMPL_SHOKEHI_PCT = 0.15;
  const tmpl = (label, ninku, kotsu) => {
    const s = round((ninku + kotsu) * TMPL_SHOKEHI_PCT);
    return { label, subjectSuffix: '調査費用', items: [
      { description: '調査人工', quantity: 1, unit: '人工', unit_price: ninku, amount: ninku },
      { description: '交通費', quantity: 1, unit: '式', unit_price: kotsu, amount: kotsu },
      { description: '諸経費', quantity: 1, unit: '式', unit_price: s, amount: s }] };
  };
  // 単価は入れない（0。ユーザー決定 2026-11-08: 相場は入れず空欄にして会社が自分で入れる。行の形だけ残す）
  const TEMPLATES = { chosa1: tmpl('調査①', 0, 0), chosa2: tmpl('調査②', 0, 0) };
  // ボタンに出す額（税抜の合計）
  const templateTotal = t => sum(t.items, i => i.amount);
  // 定型を入れる: 原価＝販売（同じ中身）・利益率 0・件名に「調査費用」が無ければ足す（会社の定型 { label, items } にも使う）
  function applyTemplate(data, t) {
    const d = Object.assign({}, data);
    const sub = str(d.subject);
    if (t.subjectSuffix && !sub.includes(t.subjectSuffix)) d.subject = sub ? sub + '　' + t.subjectSuffix : t.subjectSuffix;
    d.profit_pct = 0;
    d.lines = recalcShokehi(t.items.map(i => {
      const r = Object.assign(emptyRow(), i);
      return Object.assign(r, { cost_unit_price: num(r.unit_price), cost_amount: num(r.amount) });
    }));
    return d;
  }
  // 会社の定型に登録する中身（販売の額だけ。値引きの行は外す）
  const templateLines = rows => rows.filter(r => isRealItem(r) && !r.postTax).map(r => {
    const o = { description: r.description, detail: r.detail, quantity: r.quantity, unit: r.unit, unit_price: r.unit_price, amount: r.amount };
    if (r.auto) Object.assign(o, { auto: r.auto, pct: r.pct });
    return o;
  });

  /* ---------- 単価マスタ（rate_store.py の正規化と照合） ---------- */
  const Z2H = s => s.replace(/[０-９Ａ-Ｚａ-ｚ（）％]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const normKey = d => Z2H(String(d || '')).toLowerCase().replace(/[\s　・,，.。:：;；\-−ー_/／\\()（）[\]「」『』]/g, '');
  const UNIT_ALIAS = { m2: 'm2', 'm²': 'm2', '㎡': 'm2', '平米': 'm2', '平方メートル': 'm2', m3: 'm3', 'm³': 'm3', '立米': 'm3',
    '一式': '式', '式': '式', 'ヶ': '箇所', 'ヶ所': '箇所', 'か所': '箇所', 'カ所': '箇所', '個所': '箇所', '箇所': '箇所' };
  const normUnit = u => { const s = Z2H(String(u || '')).toLowerCase().replace(/[\s　/／・,，.。()（）]/g, ''); return Object.prototype.hasOwnProperty.call(UNIT_ALIAS, s) ? UNIT_ALIAS[s] : s; };
  const sameUnit = (a, b) => !normUnit(a) || !normUnit(b) || normUnit(a) === normUnit(b);
  const normProp = p => Z2H(String(p || '')).toLowerCase().replace(/現場|物件|場所|見積書/g, '')
    .replace(/[\s　・,，.。:：;；\-−ー_/／\\()（）[\]「」『』]/g, '');
  const roomNo = n => (n.match(/(\d{3,4})(?=号)/) || n.match(/\d{3,4}/) || [''])[0];
  function sameProperty(a, b) {
    const na = normProp(a), nb = normProp(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const ra = roomNo(na), rb = roomNo(nb);
    if (!ra || ra !== rb) return false;
    const ba = na.slice(0, na.indexOf(ra)), bb = nb.slice(0, nb.indexOf(rb));
    if (ba.length < 4 || bb.length < 4) return false;
    return ba.startsWith(bb) || bb.startsWith(ba);
  }
  const BLDG_CUT = /\d{3,4}|エントランス|屋上|共用|棟|階|床下|調査|工事|復旧|費用|緊急|対応|作業|交換|更新|漏水|被害|原状/;
  const buildingName = p => { const n = normProp(p); const m = n.match(BLDG_CUT); return (m ? n.slice(0, m.index) : n).trim(); };
  const sameBuilding = (a, b) => { const x = buildingName(a), y = buildingName(b); return x.length >= 4 && y.length >= 4 && x === y; };
  const isMoveCost = d => ['交通費', '車両', '駐車', '高速', '出張'].some(w => String(d || '').includes(w));
  // date が一番新しいもの。同じ日なら後から入れたもの（records は入れた順）
  const newest = rs => rs.reduce((best, r) => (!best || String(r.date || '') >= String(best.date || '') ? r : best), null);
  const top = rs => rs.reduce((best, r) => (!best || num(r.unit_price) > num(best.unit_price) ? r : best), null);
  const median = xs => { const a = xs.slice().sort((p, q) => p - q), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const itemPrice = it => num(it.unit_price) || (num(it.quantity) ? round(num(it.amount) / num(it.quantity)) : num(it.amount));

  // 摘要の候補（新しい機能）: normKey で前方一致 → key ごとに newest の販売（無ければ原価）1件
  function suggestDescriptions(records, typed, limit) {
    const k = normKey(typed);
    if (!k) return [];
    const groups = new Map();
    (records || []).forEach(r => { if (String(r.key || '').startsWith(k)) { if (!groups.has(r.key)) groups.set(r.key, []); groups.get(r.key).push(r); } });
    return Array.from(groups.values()).map(g => {
      const sells = g.filter(r => r.kind === 'sell');
      return newest(sells.length ? sells : g.filter(r => r.kind === 'cost'));
    }).filter(Boolean).sort((a, b) => (String(a.date || '') < String(b.date || '') ? 1 : String(a.date || '') > String(b.date || '') ? -1 : 0))
      .slice(0, limit || 8).map(r => ({ description: r.description, unit: r.unit || '', unit_price: num(r.unit_price) }));
  }

  // 照合（注意を出す）rate_store.check と同じ手順・文言。o = { vendor, property, client, kind }
  const OUTLIER = 0.15;
  function check(items, records, o) {
    const kind = o.kind || 'cost', prop = o.property || '', client = str(o.client);
    let recs = (records || []).slice();
    if (!recs.length) return [];
    const byClient = kind === 'sell' && !!client;
    if (byClient) { const ck = normKey(client); recs = recs.filter(r => normKey(r.client) === ck); if (!recs.length) return []; }
    const alerts = [];
    items.forEach((it, index) => {
      const desc = str(it.description);
      if (!desc) return;
      const qty = num(it.quantity), up = itemPrice(it);
      if (up <= 0 || desc.includes('値引') || desc.includes('端数調整')) return;
      const key = normKey(desc);
      let hist = recs.filter(r => r.key === key && r.kind === kind && sameUnit(r.unit, it.unit));
      if (!hist.length) return;
      const move = isMoveCost(desc);
      if (move) { hist = hist.filter(r => sameBuilding(r.property, prop)); if (!hist.length) return; }
      const sameProp = move ? hist : hist.filter(r => sameProperty(r.property, prop));
      const spp = sameProp.length ? num(newest(sameProp).unit_price) : null;
      const med = Math.floor(median(hist.map(r => num(r.unit_price))));
      const diff_pct = med ? round((up - med) / med * 100) : 0;
      const far = !!med && Math.abs(up - med) / med > OUTLIER;
      const medNote = `過去${hist.length}件の中央値 ${fmt(med)} より ${Math.abs(diff_pct)}% ${up > med ? '高い' : '安い'}`;
      let level = '', message = '', direction = '', impact = 0, best = 0, apply_price = 0, apply_label = '';
      if (byClient) {
        let ref, where;
        if (spp) { ref = spp; where = move ? '同じ建物' : '同じ現場'; }
        else { const latest = newest(hist); ref = num(latest.unit_price); where = `別の現場「${latest.property || ''}」`; }
        const t = top(hist);
        best = num(t.unit_price);
        const bestTxt = best > Math.max(ref, up) * (1 + OUTLIER) ? `過去に ${fmt(best)} で出しています（${t.date || ''} ${t.property || ''}）` : '';
        if (ref && ref !== up) {
          const gap = Math.abs(up - ref);
          level = gap / ref > OUTLIER ? 'warn' : 'info';
          direction = up < ref ? 'down' : 'up';
          impact = gap * Math.max(qty, 1);
          if (direction === 'down') { message = `${where}の前回 ${fmt(ref)} より ${fmt(gap)} 安い（今回 ${fmt(up)}）`; if (qty > 1) message += `／取りこぼし ${fmt(impact)}円`; }
          else message = `${where}の前回 ${fmt(ref)} より ${fmt(gap)} 高い（今回 ${fmt(up)}）／指摘リスク`;
          if (bestTxt) message += `／${bestTxt}`;
          apply_price = ref; apply_label = where;
        } else if (bestTxt) {
          level = 'info'; direction = 'down'; impact = (best - up) * Math.max(qty, 1);
          message = `${bestTxt}。今回は ${fmt(up)}`;
          apply_price = best; apply_label = '過去最高';
        }
      } else if (spp && spp !== up) {
        const gap = Math.abs(up - spp) / spp;
        level = far || gap > OUTLIER ? 'warn' : 'info';
        message = `${move ? '同じ建物' : '同じ物件'}の前回単価 ${fmt(spp)} と違います（今回 ${fmt(up)}）`;
        if (far) message += ` ／ ${medNote}`;
      } else if (far) {
        level = 'warn';
        message = `${medNote}（今回 ${fmt(up)}）`;
      }
      if (level) alerts.push({ index, description: desc, unit_price: up, median: med, diff_pct, count: hist.length, level, same_property_price: spp, direction, impact, best_price: best, apply_price, apply_label, message });
    });
    return alerts;
  }
  // 過去単価に合わせる（rate_store.suggest_prices）: 同じ管理会社の販売の記録から、同じ物件の newest、無ければ newest
  function suggestPrices(items, records, o) {
    const client = str(o.client), prop = o.property || '';
    if (!client) return [];
    const ck = normKey(client);
    const recs = (records || []).filter(r => r.kind === 'sell' && normKey(r.client) === ck);
    if (!recs.length) return [];
    const out = [];
    items.forEach((it, index) => {
      const desc = str(it.description);
      if (!desc) return;
      const key = normKey(desc);
      let hist = recs.filter(r => r.key === key && sameUnit(r.unit, it.unit));
      if (!hist.length) return;
      if (isMoveCost(desc)) { hist = hist.filter(r => sameBuilding(r.property, prop)); if (!hist.length) return; }
      const same = hist.filter(r => sameProperty(r.property, prop));
      const src = newest(same.length ? same : hist), t = top(hist);
      out.push({ index, price: num(src.unit_price), from: same.length ? 'same_prop' : 'same_client', prop: src.property || '', date: src.date || '',
        best_price: num(t.unit_price), best_prop: t.property || '', best_date: t.date || '' });
    });
    return out;
  }

  /* ---------- 単価マスタにためる・一覧（rate_store.add_records・summary） ---------- */
  // ためてよい行: 紙に出す行で、諸経費の自動行・postTax・値引・端数調整を外し、金額>0（kind='cost' は原価の金額）
  const isRateTrackable = (r, kind) => isRealItem(r) && !r.auto && !r.postTax && !/値引|端数調整/.test(String(r.description || ''))
    && num(kind === 'cost' ? r.cost_amount : r.amount) > 0;
  // 照合・登録に渡す形（番号は明細の番号のまま。ためない行は摘要を空にして飛ばさせる）。単価は 金額÷数量
  const rateView = (rows, kind) => rows.map(r => {
    if (!isRateTrackable(r, kind)) return { description: '' };
    const amount = num(kind === 'cost' ? r.cost_amount : r.amount);
    return { description: str(r.description), unit: str(r.unit), quantity: num(r.quantity), amount, unit_price: num(r.quantity) ? round(amount / num(r.quantity)) : amount };
  });
  // 足す記録と、先に消す記録（同じ source・kind・vendor・property）。そのうえで (vendor, property, key, kind, unit_price) が同じものは足さない
  // o = { kind, client, vendor, property, source }。販売は vendor を空にする
  function rateRows(view, o, existing) {
    const kind = o.kind, vendor = kind === 'cost' ? str(o.vendor).slice(0, 100) : '', property = str(o.property).slice(0, 200);
    const client = str(o.client).slice(0, 100), source = str(o.source).slice(0, 200);
    const old = (existing || []).filter(r => source && r.source === source && r.kind === kind && (r.vendor || '') === vendor && (r.property || '') === property);
    const sig = r => [r.vendor || '', r.property || '', r.key, r.kind, num(r.unit_price)].join('\0');
    const seen = new Set((existing || []).filter(r => !old.includes(r)).map(sig));
    const rows = [];
    view.forEach(it => {
      const desc = str(it.description).slice(0, 200);
      if (!desc) return;
      const qty = num(it.quantity), amt = num(it.amount);
      const up = round(num(it.unit_price)) || (qty ? round(amt / qty) : amt);
      if (!up || up < 0 || up > 1e9 || desc.includes('値引') || desc.includes('端数調整')) return;
      const key = normKey(desc).slice(0, 200);
      if (!key) return;
      const r = { kind, client, vendor, property, description: desc, key, unit: str(it.unit).slice(0, 20), quantity: round(qty * 100) / 100, unit_price: up, source, date: ymd(new Date()) }; // date は端末の日付（DB の既定 current_date は UTC で前日になることがある）
      if (seen.has(sig(r))) return;
      seen.add(sig(r));
      rows.push(r);
    });
    return { del: old.map(r => r.id), rows };
  }
  // 一覧: key ごとに 摘要（いちばん新しい表記）・単位・件数・中央値・最安・最高・最新・業者・物件。件数の多い順 → 摘要。kind が空なら全部
  function rateSummary(records, kind) {
    const groups = new Map();
    (records || []).filter(r => !kind || r.kind === kind).forEach(r => { if (!groups.has(r.key)) groups.set(r.key, []); groups.get(r.key).push(r); });
    const uniq = xs => Array.from(new Set(xs.filter(Boolean))).sort();
    return Array.from(groups, ([key, rs]) => {
      const prices = rs.map(r => num(r.unit_price)).sort((a, b) => a - b), latest = newest(rs);
      return { key, ids: rs.map(r => r.id), description: latest.description || '', unit: latest.unit || '', count: rs.length, min: prices[0], max: prices[prices.length - 1],
        median: Math.floor(median(prices)), latest: num(latest.unit_price), latest_date: latest.date || '', vendors: uniq(rs.map(r => r.vendor)), properties: uniq(rs.map(r => r.property)) };
    }).sort((a, b) => b.count - a.count || (a.description < b.description ? -1 : a.description > b.description ? 1 : 0));
  }
  // 値幅が中央値の30%を超える（赤字にする）
  const wideSpread = g => !!g.median && (g.max - g.min) / g.median > 0.3;

  /* ---------- 番号・日付・最初の中身 ---------- */
  const formatNumber = n => 'EST-' + String(num(n)).padStart(10, '0');
  // その地域の日付 'YYYY-MM-DD'（toISOString は UTC になって日付がずれる）
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  // 有効期限の既定は今日から1か月（ユーザー決定 2026-11-07。元のツールは14日）。翌月に同じ日が無ければ翌月の末日
  const defaultDue = today => {
    const end = new Date(today.getFullYear(), today.getMonth() + 2, 0).getDate();
    return ymd(new Date(today.getFullYear(), today.getMonth() + 1, Math.min(today.getDate(), end)));
  };
  // estimates.data の最初の形（宛先・件名は案件から、担当者は自分、会社は写し）
  function newData(caseRow, org, me, today) {
    const c = caseRow || {}, g = org || {};
    return { client: str(c.client_name), honorific: '御中', subject: CL.placeName(c), date: ymd(today), due: defaultDue(today),
      manager: str(me && me.display_name), profit_pct: 0, lines: [emptyRow()],
      notes_koki: false, notes_koki_val: 3, notes_jikan: false, notes_jikan_val: '', notes_nimotsu: false, notes_nimotsu_val: '', notes_extra: '',
      company: companyOf(g, me), tax_rate: num(g.tax_rate), pdf_at: null };
  }
  const companyOf = (g, me) => ({ name: str(g.name), registration_number: str(g.registration_number), address: str(g.address), tel: str(g.tel), manager: str(me && me.display_name) });

  const api = { emptyRow, costRow, unitPriceOf, fixRow, setQuantity, setCell, removeLine, insertLineAfter, recalcShokehi, applyProfit, quickAdd, totals, roundTo100, isRealItem, gross, FIXED_NOTE, notesText,
    TEMPLATES, templateTotal, applyTemplate, templateLines, Z2H, normKey, normUnit, sameUnit, normProp, roomNo, sameProperty, buildingName, sameBuilding, isMoveCost, newest,
    suggestDescriptions, check, suggestPrices, isRateTrackable, rateView, rateRows, rateSummary, wideSpread, formatNumber, ymd, defaultDue, newData, companyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EstimateLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
