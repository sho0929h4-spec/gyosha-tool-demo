// js/estimate-import.js — 仕入見積（PDF・Excel）を明細の形にする（UMD: ブラウザは window.EstimateImport / node は module.exports。tests/estimate-import.test.js）。DOM に触らない
// 出典は docs/notes/2026-11-06-port-notes.md §1.8・§2・§3（freee-quote-builder の pdf_parser.py・excel_parser.py・invoice.html）。定数・正規表現・手順・文言はそのまま
// 結果: { items, subject, pdf_total, pdf_total_ex, notes, method, error?, image_pdf? }。method: pdfplumber（テーブル解析）／pdfplumber_layout（レイアウト解析）／regex（テキスト解析）／excel（Excel解析）／none
// pdf.js（loadPdfJs）と SheetJS（loadXlsx）は readFile の中でだけ使う。ほかは配列と文字の固まりだけを受け取る
(function (root) {
  'use strict';
  /* ---------- 共通の部品（§2.0） ---------- */
  const UNITS = '(?:人工|式|個|台|本|枚|セット|ヶ月|か月|ヵ月|回|人|箇所|ヶ所|件|組|冊|部|m|m2|m²|㎡|ｍ|㎝|cm|脚|面|棟|戸|ヵ所)';
  const NUM = '\\d{1,3}(?:,\\d{3})*'; // 3桁ごとの , が必要
  const SKIP_EXACT = new Set(['計', 'No', 'No.', '現場管理費合計']);
  const SKIP_SUBSTR = ['小計', '消費税', '請求金額', '見積金額', '合計', '内訳', '単価', '金額', '摘要', '数量', '明細金額',
    '税抜', '税込', '備考', '商品名', '品名', '総合計', '御見積金額', '請求合計', '税込合計', '税込金額'];
  const TOTAL_MARKS = ['合計', '小計', '総計', '消費税', '税込', '税抜', '請求金額', '見積金額', '御見積金額', '全体備考', '値引'];
  // 諸経費・一般管理費・管理費は外さない（業者の見積では1行の定額。外すと合計が合わない）
  const DESC_KEYS = ['商品名', '品名', '摘要', '名称', '項目', '工事名', '内容', '備考', '作業内容', '工種', '種別', '品目', '仕様', '工事内容', '材料名', 'サービス名', '明細', '説明', '詳細'];
  const AMT_KEYS = ['金額', '明細金額', '売上金額', '請求金額', '税抜金額', '小計金額'];
  const PRICE_KEYS = ['単価', '定価', '売価', '販売価格', '単位価格'];
  const QTY_KEYS = ['数量', '員数'];
  const UNIT_KEYS = ['単位'];
  const has = (s, keys) => keys.some(k => s.includes(k));
  const norm = s => (s || '').replace(/[ 　]/g, '').trim();
  const skip = d => {
    if (!d) return true;
    const n = norm(d);
    if (!n) return true;
    if (SKIP_EXACT.has(n) || ['no', 'no.'].includes(n.toLowerCase())) return true;
    return SKIP_SUBSTR.some(k => n.includes(k));
  };
  // 小数・マイナスは '' になる
  const cleanNum = s => {
    s = String(s == null ? '' : s);
    const m = s.match(/[¥￥]\s*([\d,]+)/);
    if (m) { const v = m[1].replace(/,/g, ''); if (/^\d+$/.test(v)) return v; }
    const t = s.replace(/[()¥￥,円]/g, '').trim();
    return /^\d+$/.test(t) ? t : '';
  };
  const QU_RE = new RegExp('^(\\d+)\\s*(' + UNITS + ')');
  const parseQtyUnit = c => { const m = String(c).trim().match(QU_RE); return m ? [+m[1], m[2]] : [1, '式']; };
  const LEAD = /^[\s　・•●■□\u25B6▸→⇒▼▽◆◇※◎○「」〔〕（）]+/; // 【】は残す（25B6 は再生の三角。字のままだと絵文字の検査に当たる）
  const stripLeading = s => s.replace(LEAD, '').trim();
  const row = (description, quantity, unit, unit_price, amount, detail) => ({ description, quantity, unit, unit_price, amount, detail: detail || '' });
  const isTotalRow = (cells, textCols) => cells.some((c, i) => !textCols.has(i) && norm(c) && TOTAL_MARKS.some(k => norm(c).includes(k)));

  /* ---------- Strategy 1 の表の読み方（§2.2）。Excel も同じものを使う ---------- */
  function parseTable(table, seen, dedup) {
    if (dedup === undefined) dedup = true;
    const S = c => String(c || '').trim(); // 元は str(c or "")（数の 0 は ''）
    const items = [];
    let dc = null, qc = null, uc = null, pc = null, ac = null, hi = null;
    for (let ri = 0; ri < table.length; ri++) {
      const cells = table[ri].map(S);
      const flat = cells.join(' ').replace(/[ 　]/g, '');
      if (has(flat, DESC_KEYS) && has(flat, AMT_KEYS)) {
        hi = ri;
        cells.forEach((c, ci) => {
          const n = c.replace(/[ 　]/g, '');
          if (dc === null && has(n, DESC_KEYS)) dc = ci;
          if (qc === null && has(n, QTY_KEYS)) qc = ci;
          if (uc === null && has(n, UNIT_KEYS)) uc = ci;
          if (pc === null && has(n, PRICE_KEYS)) pc = ci;
          if (ac === null && has(n, AMT_KEYS)) ac = ci;
        });
        break;
      }
    }
    if (hi === null || dc === null || ac === null) return [];
    // 「数量 単 価」が1つのセル（qty列＝price列）: 下の行を見て、qty列に数があり qty+1..amt-1 で最初に数がある列を price 列にする
    if (pc !== null && pc === qc && ac > qc + 1) {
      for (const dr of table.slice(hi + 1)) {
        const d = dr.map(S);
        if (qc < d.length && cleanNum(d[qc])) {
          for (let ci = qc + 1; ci < ac; ci++) if (ci < d.length && cleanNum(d[ci])) { pc = ci; break; }
        }
        if (pc !== qc) break;
      }
    }
    // 詳細の列: 見出しに DESC_KEYS を含み、決まった列のどれでもない列を全部。無くて desc 列が0なら、決まった列以外の最初の列を1本
    const hdr = table[hi].map(S);
    const keyCols = new Set([dc, qc, uc, pc, ac]);
    let detailCols = hdr.map((c, ci) => ci).filter(ci => !keyCols.has(ci) && has(norm(hdr[ci]), DESC_KEYS));
    if (!detailCols.length && dc === 0 && hdr.length > 1) {
      for (let ci = 1; ci < hdr.length; ci++) if (!keyCols.has(ci)) { detailCols = [ci]; break; }
    }
    const textCols = new Set([dc].concat(detailCols));
    const at = (cells, ci) => (ci !== null && ci < cells.length ? cells[ci] : '');
    for (const r of table.slice(hi + 1)) {
      const cells = r.map(S);
      if (isTotalRow(cells, textCols)) continue;
      const amt = +cleanNum(at(cells, ac)) || 0; // 0円の行も捨てない（見出し行・内訳行）
      let desc = stripLeading(at(cells, dc).replace(/\n/g, ' ').trim());
      const subs = [];
      detailCols.forEach(ci => {
        if (ci >= cells.length) return;
        const sub = stripLeading(cells[ci].replace(/\n/g, ' ').trim());
        if (sub && !cleanNum(sub) && !subs.includes(sub)) subs.push(sub);
      });
      const detail = subs.join(' ');
      if (!desc && !detail && amt) {
        for (let ci = 0; ci < cells.length; ci++) {
          if ([qc, uc, pc, ac].includes(ci)) continue;
          const c = cells[ci].replace(/\n/g, ' ').trim();
          if (c && !cleanNum(c)) { desc = c; break; }
        }
      }
      if (!desc && !detail) continue;
      if (desc && skip(desc)) continue;
      if (!desc && skip(detail)) continue;
      const up = pc !== null && pc < cells.length ? (+cleanNum(cells[pc]) || amt) : amt;
      let qty = 1, unit = '式';
      if (qc !== null && qc < cells.length) {
        const qr = cells[qc];
        if (uc !== null && uc < cells.length && uc !== qc) {
          const ur = cells[uc];
          const [q, u] = parseQtyUnit(qr + ur);
          if (q !== 1 || u !== '式') { qty = q; unit = u; } else if (/^\d+$/.test(qr)) { qty = +qr; unit = ur || '式'; }
        } else {
          [qty, unit] = parseQtyUnit(qr);
          if (qty === 1 && unit === '式' && /^\d+$/.test(qr.trim())) qty = +qr.trim();
        }
      }
      if (qty === 1 && unit === '式') {
        for (let ci = 0; ci < cells.length; ci++) {
          if (textCols.has(ci) || ci === pc || ci === ac) continue;
          const [q, u] = parseQtyUnit(cells[ci]);
          if (u !== '式' || q !== 1) { qty = q; unit = u; break; }
        }
      }
      // 数量を逆算して直す: 単価×数量≠金額 で、金額÷単価 が 0.25 刻みのきれいな数（0<q≤9999）ならそれを使う
      if (up > 0 && pc !== null && qty * up !== amt) {
        const q = amt / up, r4 = Math.round(q * 4) / 4;
        if (Math.abs(q - r4) < 0.001 && r4 > 0 && r4 <= 9999) qty = r4;
      }
      if (!dedup) { items.push(row(desc, qty, unit, up, amt, detail)); continue; } // Excel 用
      const key = desc + '\0' + detail + '\0' + amt;
      if (!seen.has(key)) { seen.add(key); items.push(row(desc, qty, unit, up, amt, detail)); }
    }
    return items;
  }

  /* ---------- pdf.js の文字を固まり・行・セルにする（§2.3・§2.6） ---------- */
  // getTextContent().items → {text, x0, x1, top, size}。回転した文字（transform の b/c が0でない）と空白だけの item は捨てる
  function pageItems(items, vpHeight) {
    return (items || []).filter(it => it && it.transform && String(it.str || '').trim() && !it.transform[1] && !it.transform[2]).map(it => {
      const t = it.transform, x0 = t[4];
      return { text: String(it.str), x0, x1: x0 + (Number(it.width) || 0), top: vpHeight - t[5] - (Number(it.height) || Math.hypot(t[2], t[3])),
        size: Math.hypot(t[0], t[1]) || Number(it.height) || 10 };
    });
  }
  // top で行に分ける: その行の最初の固まりの top から tol 以内なら同じ行。top → x の順に並べてから分け、行の中は x0 の順
  function toLines(ws, tol) {
    const out = [];
    let cur = null, y = 0;
    ws.slice().sort((a, b) => a.top - b.top || a.x0 - b.x0).forEach(w => {
      if (cur && Math.abs(w.top - y) <= tol) cur.push(w);
      else { cur = [w]; y = w.top; out.push(cur); }
    });
    return out.map(l => l.sort((a, b) => a.x0 - b.x0));
  }
  // extract_words(x_tolerance=5, y_tolerance=3) の代わり: 同じ行（top の差が3以下）で間が5以下の item をつなぐ。item の中の空白では分ける（位置は字数で割る）
  function pageWords(items, vpHeight) {
    const words = [];
    toLines(pageItems(items, vpHeight), 3).forEach(line => {
      let prev = null;
      line.forEach(it => {
        const cw = (it.x1 - it.x0) / (it.text.length || 1), re = /\S+/g;
        let m;
        while ((m = re.exec(it.text))) {
          const p = { text: m[0], x0: it.x0 + m.index * cw, x1: it.x0 + (m.index + m[0].length) * cw, top: it.top, size: it.size };
          // item の頭だけ前の固まりにつなげてよい（item の中の空白のあとは別の固まり）
          if (m.index === 0 && prev && p.x0 - prev.x1 <= 5) { prev.text += p.text; prev.x1 = p.x1; } else { words.push(p); prev = p; }
        }
        if (/\s$/.test(it.text)) prev = null;
      });
    });
    return words;
  }
  // pypdf.extract_text() の代わり: 行に分けて x の順に並べ、間が 0.25×字の大きさ を超えたら半角スペース
  function pageText(items, vpHeight) {
    return toLines(pageItems(items, vpHeight), 5).map(l => l.reduce((s, it, i) => s + (i && it.x0 - l[i - 1].x1 > 0.25 * it.size ? ' ' : '') + it.text, '')).join('\n');
  }
  // セルにまとめる: 隣の固まりとの間が10ptを超えたら別のセル。セルの text は空白なしでつなぐ
  function toCells(ws) {
    const cells = [];
    let cur = [ws[0]];
    const push = () => cells.push({ text: cur.map(c => c.text).join(''), x0: cur[0].x0, x1: cur[cur.length - 1].x1 });
    for (const w of ws.slice(1)) { if (w.x0 - cur[cur.length - 1].x1 > 10) { push(); cur = [w]; } else cur.push(w); }
    push();
    return cells;
  }

  /* ---------- Strategy 1: 見出しから列を決める（§2.2 の pdf.js 版） ---------- */
  // 見出しの固まりごとに x の範囲を決め、隣の列との境は中点。下の行は固まりの x の中心で列に振り分けて parseTable に渡す（seen は PDF 全体で1つ）
  // 表の終わりは合計の言葉（合計・総計）が出る行（その行も渡す。parseTable が落とす）か、次の見出し。ページの終わりでは終わらず、
  // 見出しの無いページは前のページの列の範囲で読む（移植メモ §2.7 の「黙って落とす」を直したもの）
  const isHead = cells => { const f = cells.map(c => c.text).join(' ').replace(/[ 　]/g, ''); return has(f, DESC_KEYS) && has(f, AMT_KEYS); };
  const END_RE = /合計|総計/;
  function assign(cells, hdr) {
    const out = hdr.map(() => []);
    cells.forEach(c => {
      const x = (c.x0 + c.x1) / 2;
      let k = hdr.length - 1;
      for (let j = 0; j < hdr.length - 1; j++) if (x < (hdr[j].x1 + hdr[j + 1].x0) / 2) { k = j; break; }
      out[k].push(c.text);
    });
    return out.map(a => a.join(' '));
  }
  function strategy1(pages) {
    const seen = new Set(), items = [];
    let hdr = null;
    pages.forEach(words => {
      const rows = toLines(words, 5).map(toCells);
      const headAt = from => { for (let k = from; k < rows.length; k++) if (isHead(rows[k])) return k; return -1; };
      let i = 0;
      const h0 = headAt(0);
      if (h0 >= 0) { hdr = rows[h0]; i = h0 + 1; } else if (!hdr) return;
      while (hdr) {
        const body = [];
        let next = -1, ended = false;
        for (; i < rows.length; i++) {
          if (isHead(rows[i])) { next = i; break; }
          body.push(rows[i]);
          if (END_RE.test(norm(rows[i].map(c => c.text).join('')))) { ended = true; i++; break; }
        }
        items.push(...parseTable([hdr.map(c => c.text)].concat(body.map(r => assign(r, hdr))), seen));
        if (next >= 0) { hdr = rows[next]; i = next + 1; continue; }
        if (!ended) break; // ページの終わり: 次のページへ続く
        hdr = null;
        const nh = headAt(i);
        if (nh >= 0) { hdr = rows[nh]; i = nh + 1; }
      }
    });
    return items;
  }

  /* ---------- Strategy 1.5: 位置で読む（§2.3） ---------- */
  const HEAD_WORDS = DESC_KEYS.concat(AMT_KEYS, PRICE_KEYS, QTY_KEYS);
  const cellNum = t => { const v = cleanNum(t); return v && +v > 0 ? +v : null; };
  const rightmost = xs => xs.reduce((a, b) => (b.c.x0 > a.c.x0 ? b : a));
  function layoutPage(words, seen) {
    if (!words.length) return [];
    const data = [];
    toLines(words, 5).map(toCells).forEach(cells => {
      const nums = [];
      cells.forEach((c, i) => { const v = cellNum(c.text); if (v !== null) nums.push({ i, c, v }); });
      if (nums.length >= 2 && nums.some(n => n.v >= 1000)) data.push({ cells, nums });
    });
    if (data.length < 2) return [];
    const xs = data.map(d => rightmost(d.nums.filter(n => n.v >= 1000)).c.x0).sort((a, b) => a - b);
    const med = xs[Math.floor(xs.length / 2)], lo = med - 45, hi = med + 60;
    const items = [];
    data.forEach(({ cells, nums }) => {
      let cand = nums.filter(n => n.v >= 1000 && n.c.x0 >= lo && n.c.x0 <= hi);
      if (!cand.length) cand = nums.filter(n => n.v >= 1000);
      if (!cand.length) return;
      const A = rightmost(cand), amt = A.v;
      let desc = '', di = -1;
      for (let i = 0; i < cells.length; i++) {
        if (i === A.i || cellNum(cells[i].text) !== null) continue;
        const text = cells[i].text.trim();
        if (has(text.replace(/[ 　]/g, ''), HEAD_WORDS)) { desc = ''; break; } // 見出しの行
        if (text && text.length >= 2 && !skip(text)) { desc = text; di = i; break; }
      }
      if (!desc) return;
      const other = nums.filter(n => n.i !== A.i);
      let up = amt, qty = 1, unit = '式';
      if (other.length === 1) {
        const v = other[0].v;
        if (v >= 100) up = v; else if (v >= 1 && v <= 99) qty = v;
      } else if (other.length >= 2) {
        const sn = other.slice().sort((a, b) => a.v - b.v), big = sn[sn.length - 1].v;
        if (sn[0].v >= 1 && sn[0].v <= 99) { qty = sn[0].v; up = big >= 100 ? big : amt; } else up = big;
      }
      for (let i = 0; i < cells.length; i++) {
        if (i === A.i || i === di) continue;
        const m = cells[i].text.trim().match(QU_RE);
        if (m) { qty = +m[1]; unit = m[2]; break; }
      }
      const key = desc + '\0' + amt;
      if (!seen.has(key)) { seen.add(key); items.push(row(desc, qty, unit, up, amt)); }
    });
    return items;
  }
  function strategy15(pages) {
    const seen = new Set();
    return pages.reduce((a, w) => a.concat(layoutPage(w, seen)), []);
  }

  /* ---------- Strategy 2: 文字と正規表現（§2.4） ---------- */
  const PA = new RegExp(`^(.+?)\\s+(${NUM})\\s+(${NUM})(\\d+)\\s+(${UNITS})\\s*$`); // 摘要 単価 金額+数量 単位（freee: "808,7521 式"）
  const PB = new RegExp(`^(.+?)\\s+(\\d+)\\s*(${UNITS})\\s+(${NUM})\\s+(${NUM})\\s*$`); // 摘要 数量単位 単価 金額
  const PD = new RegExp(`^(.+?)\\s+\\((${NUM})\\)\\s*$`); // 摘要 (金額)
  const PE = new RegExp(`^(.+?)\\s+.+\\s+\\((${NUM})\\)\\s*$`); // 摘要 説明 (金額)
  const PC = new RegExp(`^(.+?)\\s+(${NUM})\\s+(${NUM})\\s*$`); // 摘要 単価 金額
  const n = s => +s.replace(/,/g, '');
  function regexLine(line) {
    let m = line.match(PA);
    if (m) { const d = m[1].trim(); if (skip(d)) return null; const amt = n(m[3]); return amt > 0 ? row(d, +m[4], m[5], n(m[2]), amt) : null; }
    m = line.match(PB);
    if (m) { const d = m[1].trim(); if (skip(d)) return null; const amt = n(m[5]); return amt > 0 ? row(d, +m[2], m[3], n(m[4]), amt) : null; }
    for (const re of [PD, PE]) {
      m = line.match(re);
      if (m) { const d = m[1].trim(); if (skip(d) || d.length < 2) return null; const amt = n(m[2]); return amt > 0 ? row(d, 1, '式', amt, amt) : null; }
    }
    m = line.match(PC);
    if (m) { const d = m[1].trim(); if (skip(d) || d.length < 2) return null; const up = n(m[2]), amt = n(m[3]); return up > 0 && amt > 0 ? row(d, 1, '式', up, amt) : null; }
    return null;
  }
  function strategy2(text) {
    const seen = new Set(), items = [];
    String(text || '').split('\n').forEach(l => {
      l = l.trim();
      if (!l || l.length < 2) return;
      const it = regexLine(l);
      if (!it) return;
      const key = it.description + '\0' + it.amount;
      if (!seen.has(key)) { seen.add(key); items.push(it); }
    });
    return items;
  }

  /* ---------- 件名・備考・合計（§2.5） ---------- */
  const SUBJECT_RE = /(?:件名|工事件名|工事名称|工事名|物件名|案件名|現場名|工事場所)[　 ：:：]?\s*(.+)/;
  const BUILDING_KW = ['マンション', 'ビル', 'ハイツ', 'コーポ', 'レジデンス', 'パレス', 'ハイム', 'テラス', 'コート', 'タワー', 'アパート', 'ハウス',
    'ヴィラ', 'メゾン', 'プラザ', 'ガーデン', 'パーク', 'ステーション', 'スクエア', 'シティ', 'ホーム', 'フォート', 'パレ', 'ヒルズ', 'リバー',
    'グランド', '号室', '号棟', '号館', '邸', '荘', '館', 'DOOR', 'COURT'];
  const COMPANY_KW = ['株式会社', '有限会社', '（株）', '(株)', '（有）', '(有)', 'TEL', 'FAX', 'e-Mail', 'E-mail', 'Mail', '@', 'TAX', 'No.', 'Phone', 'Address', '御中', '様', 'http'];
  const ADDR_RE = /〒\s*\d|[都道府県][^\s　]{0,8}[市区郡][^\s　]{0,8}|\d+\s*丁目|\d+\s*番地?/;
  const cleanSub = s => s.replace(/^[\s　：:：]+/, '').trim();
  function extractSubject(text) {
    const lines = String(text || '').split('\n');
    let label = '';
    for (const line of lines) {
      const m = line.trim().match(SUBJECT_RE);
      if (m) { const v = cleanSub(m[1]); if (v.length >= 3 && !skip(v)) { label = v; break; } }
    }
    const addr = s => !has(s, BUILDING_KW) && ADDR_RE.test(s);
    if (!label || addr(label)) {
      for (const line of lines.slice(0, 20)) {
        const s = line.trim();
        if (s.length < 4 || s.length > 60 || has(s, COMPANY_KW) || ADDR_RE.test(s) || !has(s, BUILDING_KW)) continue;
        const c = cleanSub(s);
        if (c.length >= 4 && !skip(c)) return c;
      }
    }
    return label;
  }
  const NLABEL = /(?:備考欄?|備　考|特記事項|注意事項)[　 ]*[：:：]?[　 ]*/;
  const NSKIP = /(?:小計|合計|消費税|単価|金額|数量|単位|見積|請求|摘要|項目|品名|合　計|小　計|見　積|積　書|請　求|御　中|株式会社|有限会社|〒\d)/;
  const NHEAD = ['数量', '単価', '金額', '単位', '項目', '品名', '摘要', '工事内容', '工事詳細', '工事名', '内容', '詳細'];
  const numOnly = s => /^\d+$/.test(s.replace(/[,¥￥]/g, ''));
  function extractNotes(text) {
    const lines = String(text || '').split('\n'), out = [];
    lines.forEach((line, i) => {
      const s = line.trim(), m = s.match(NLABEL);
      if (!m) return;
      if (NHEAD.filter(k => norm(s).includes(k)).length >= 2) return; // 表の見出し
      const inline = s.slice(m.index + m[0].length).trim();
      if (inline && inline.length >= 2 && !NSKIP.test(inline) && !numOnly(inline)) { out.push(inline); return; }
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const nx = lines[j].trim();
        if (!nx) continue;
        if (NSKIP.test(nx)) break;
        if (numOnly(nx) || nx.length < 2) continue;
        out.push(nx);
        break;
      }
    });
    if (!out.length) {
      const SUB = /小[　 ]?計|合[　 ]?計/, END = /[。ます。です。ください。ございます。下さい。]/; // 元のまま（この中のどれか1文字で当たる）
      lines.forEach((line, i) => {
        if (!SUB.test(line.trim())) return;
        for (let back = 1; back < 5; back++) {
          const j = i - back;
          if (j < 0) break;
          const p = lines[j].trim();
          if (!p) continue;
          if (NSKIP.test(p) || numOnly(p) || /\d$/.test(p)) break; // 数字で終わる行は明細（元の規則に足した1つの歯止め。「下地調整 1 式 5000 5000」を備考に入れない）
          if (END.test(p) && !out.includes(p)) out.push(p);
          break;
        }
      });
    }
    return out.filter((r, i) => out.indexOf(r) === i).join('　').slice(0, 300);
  }
  const pyRound = x => { const f = Math.floor(x), d = x - f; return d > 0.5 || (d === 0.5 && f % 2 === 1) ? f + 1 : f; };
  // (税抜本体, 税込合計): 「本体＋税＝税込」が成り立つ3つ組を探す。言葉は読まない
  function extractTotals(text) {
    const nums = new Set();
    (String(text || '').match(/\d{1,3}(?:,\d{3})+|\d{4,}/g) || []).forEach(s => { const v = +s.replace(/,/g, ''); if (v >= 1000 && v <= 1e10) nums.add(v); });
    let best = [0, 0];
    nums.forEach(ex => {
      [0.10, 0.08].forEach(r => {
        new Set([Math.floor(ex * r), pyRound(ex * r)]).forEach(tax => {
          const inc = ex + tax;
          if (nums.has(tax) && nums.has(inc) && inc > best[1]) best = [ex, inc];
        });
      });
    });
    return best;
  }
  function extractPdfTotal(text) {
    const vals = [];
    const t = String(text || '');
    for (const m of t.matchAll(/[¥￥]\s*([\d,]+)/g)) { const v = +m[1].replace(/,/g, ''); if (v >= 1000) vals.push(v); }
    for (const m of t.matchAll(/\((\d{1,3}(?:,\d{3})+)\)/g)) { const v = +m[1].replace(/,/g, ''); if (v >= 1000) vals.push(v); }
    return vals.length ? Math.max(...vals) : 0;
  }
  // サマリー行を消す: 金額>0 の行の後ろを足して自分の金額と同じになり（4行以上）、なったらその行を消す
  function dedupSummary(items) {
    const idx = [];
    items.forEach((it, j) => { if (it.amount > 0) idx.push(j); });
    if (idx.length < 3) return items;
    const amounts = idx.map(j => items[j].amount), rm = new Set();
    amounts.forEach((target, i) => {
      if (rm.has(i)) return;
      let s = 0;
      for (let end = i + 1; end < amounts.length; end++) {
        s += amounts[end];
        if (s === target && end - i >= 4) { rm.add(i); break; }
        if (s > target) break;
      }
    });
    const drop = new Set(Array.from(rm, i => idx[i]));
    return items.filter((it, j) => !drop.has(j));
  }

  /* ---------- 全体の順番（§2.1・§3） ---------- */
  const IMAGE_MSG = 'これは画像PDF（スキャン）です。文字の入ったPDFかExcelを選んでください。';
  // pages: [{ items: getTextContent().items, height: viewport の高さ, rotate }]。回転したページ（rotate が0でない）は読まない
  function parsePdfPages(pages) {
    const use = pages.filter(p => !(p.rotate % 360));
    const words = use.map(p => pageWords(p.items, p.height));
    const text = use.map(p => pageText(p.items, p.height)).join('\n');
    const subject = extractSubject(text), notes = extractNotes(text);
    const [ex, inc] = extractTotals(text);
    const base = { subject, pdf_total: inc || extractPdfTotal(text), pdf_total_ex: ex, notes };
    for (const [fn, method] of [[() => strategy1(words), 'pdfplumber'], [() => strategy15(words), 'pdfplumber_layout'], [() => strategy2(text), 'regex']]) {
      const items = fn();
      if (items.length) return Object.assign({ items: dedupSummary(items) }, base, { method });
    }
    const anyText = pages.some(p => (p.items || []).some(it => String(it.str || '').trim()));
    if (!anyText) return Object.assign({ items: [] }, base, { method: 'none', image_pdf: true, error: IMAGE_MSG });
    return Object.assign({ items: [] }, base, { method: 'none', error: '明細を抽出できませんでした' });
  }
  // grids: シートごとの2次元配列（sheet_to_json(header:1, raw:true, defval:'')）
  const rowText = r => r.map(c => String(c).trim()).join('');
  const isHeaderRow = r => { const f = rowText(r).replace(/[ 　]/g, ''); return has(f, DESC_KEYS) && has(f, AMT_KEYS); };
  function splitPages(grid) {
    const pages = [];
    let cur = [], started = false;
    grid.forEach(r => {
      if (isHeaderRow(r)) { if (cur.length) pages.push(cur); cur = [r]; started = true; return; }
      if (started) cur.push(r);
    });
    if (cur.length) pages.push(cur);
    return pages.length ? pages : [grid];
  }
  const pageHas = (rows, kws) => rows.some(r => kws.some(k => rowText(r).includes(k)));
  const TOTAL_KW = ['御見積金額', 'お見積金額', '見積金額', '請求金額', '総合計', '合計', '税込', '金額合計', '総額'];
  const xlNum = c => {
    if (typeof c === 'boolean') return 0;
    if (typeof c === 'number') return Number.isInteger(c) ? c : 0;
    const s = String(c).replace(/[,¥￥円]/g, '').trim();
    return /^\d+$/.test(s) ? +s : 0;
  };
  const excelTotal = grid => grid.reduce((best, r) => (TOTAL_KW.some(k => r.map(String).join('').includes(k)) ? Math.max(best, ...r.map(xlNum)) : best), 0);
  const GRAND = ['総合計', '総　合計'];
  function parseGrids(sheets) {
    const grids = sheets.map(g => g.filter(r => r.some(c => String(c).trim()))).filter(g => g.length);
    const lines = [];
    let gridTotal = 0, pages = [];
    grids.forEach(g => {
      g.forEach(r => lines.push(r.map(c => String(c).trim()).filter(Boolean).join(' ')));
      gridTotal = Math.max(gridTotal, excelTotal(g));
      pages = pages.concat(splitPages(g));
    });
    const summary = pages.filter(p => pageHas(p, GRAND));
    const detail = pages.filter(p => !pageHas(p, GRAND) && pageHas(p, ['合計']));
    const use = summary.length && detail.length ? pages.filter(p => !pageHas(p, GRAND)) : pages; // 区分ごとの見積でサマリーを二重に数えない
    const seen = new Set();
    const items = use.reduce((a, p) => a.concat(parseTable(p, seen, false)), []); // 同じ行が続いても消さない
    const text = lines.join('\n');
    const base = { subject: extractSubject(text), pdf_total: extractPdfTotal(text) || gridTotal, pdf_total_ex: 0, notes: extractNotes(text) };
    if (items.length) return Object.assign({ items: dedupSummary(items) }, base, { method: 'excel' });
    return Object.assign({ items: [] }, base, { method: 'none', error: '明細を抽出できませんでした（摘要・金額のヘッダー行が見つかりません）' });
  }

  /* ---------- 読み込みのあと（§1.8） ---------- */
  function cleanDesc(s) {
    return String(s || '')
      .replace(LEAD, '')
      .replace(/^[0-9０-９]{1,3}[.．、)）:：]?[\s　]+/, '')
      .replace(/^[0-9０-９]{1,3}[.．、)）][\s　]*(?![0-9０-９])/, '')
      .replace(/[\s　]+/g, ' ')
      .trim();
  }
  // 摘要の先頭の通し番号を、行全体を見て消す（3行以上・6割以上が数字で始まる・最初が0か1・増え続ける・取ると空になる行が無い。小数が1行でもあれば触らない）
  function stripRowNumbers(items) {
    if (!items || items.length < 3) return items;
    let dec = false;
    const parsed = items.map(it => {
      const m = String(it.description || '').replace(/^[\s　]+/, '').match(/^([0-9０-９]{1,3})([.．、)）:：]?)([\s　]*)(.+)$/);
      if (!m) return null;
      if ((m[2] === '.' || m[2] === '．') && !m[3] && /^[0-9０-９]/.test(m[4])) { dec = true; return null; }
      return { n: parseInt(m[1].replace(/[０-９]/g, c => '０１２３４５６７８９'.indexOf(c)), 10), rest: m[4].trim() };
    });
    if (dec) return items;
    const hit = parsed.filter(Boolean);
    if (hit.length < Math.max(3, Math.ceil(items.length * 0.6))) return items;
    if (hit[0].n > 1) return items;
    for (let i = 1; i < hit.length; i++) if (hit[i].n <= hit[i - 1].n) return items;
    if (hit.some(h => !h.rest)) return items;
    return items.map((it, i) => (parsed[i] ? Object.assign({}, it, { description: parsed[i].rest }) : it));
  }
  // 単価＝金額÷数量（金額が無ければ単価×数量で出す）
  function normAmt(it) {
    const q = Number(it.quantity) || 0, up0 = Number(it.unit_price) || 0;
    let amt = Number(it.amount) || 0;
    if (!amt && up0 && q) amt = Math.round(up0 * q);
    return { amount: amt, unit_price: q ? Math.round(amt / q) : amt };
  }
  // 読み取った行を明細の前の形に: stripRowNumbers → cleanDesc → normAmt
  const prepare = items => stripRowNumbers(items).map(it => Object.assign({}, it, { description: cleanDesc(it.description) }, normAmt(it)));

  const yen = v => '¥' + Number(v || 0).toLocaleString('ja-JP');
  // 合計と突き合わせる。null（出さない）か { ok, text, gap, rows: [[ラベル, 値]] }
  function verifyParse(items, pdfTotal, totalEx) {
    pdfTotal = Number(pdfTotal) || 0;
    totalEx = Number(totalEx) || 0;
    const ref = totalEx || pdfTotal;
    if (!ref || !items || !items.length) return null;
    const sub = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const subWithTax = sub + Math.round(sub * 0.1);
    const matchExcl = Math.abs(sub - ref) <= 1 || Math.abs(sub - pdfTotal) <= 1;
    const matchIncl = Math.abs(subWithTax - pdfTotal) <= 1;
    if (matchExcl || matchIncl) {
      const shown = matchExcl ? sub : subWithTax, orig = matchExcl ? (Math.abs(sub - ref) <= 1 ? ref : pdfTotal) : pdfTotal;
      return { ok: true, gap: 0, text: '✓ 読み取り検証OK — 抽出' + (matchExcl ? '税抜小計' : '税込合計') + ' ' + yen(shown) + ' ＝ 原本金額 ' + yen(orig) };
    }
    const gap = (totalEx || Math.round(pdfTotal / 1.1)) - sub;
    return { ok: false, gap, text: '読み取りとPDFの合計が合いません（' + Math.abs(gap).toLocaleString('ja-JP') + '円 ' + (gap > 0 ? '不足' : '超過') + '）',
      rows: [['PDF記載の本体（税抜）', totalEx ? yen(totalEx) : '—'], ['読み取った明細の合計', yen(sub)], ['差額', yen(gap)]] };
  }
  const gapRow = gap => ({ description: '読取差額', detail: 'PDFの本体額に合わせるための調整行', quantity: 1, unit: '式', unit_price: gap, amount: gap });
  const METHOD_LABEL = { pdfplumber: 'テーブル解析', pdfplumber_layout: 'レイアウト解析', regex: 'テキスト解析', excel: 'Excel解析' };

  /* ---------- ファイルを読む（ブラウザだけ） ---------- */
  const extOf = name => (String(name || '').toLowerCase().match(/\.(pdf|xlsx|xlsm|xls)$/) || [])[1] || '';
  async function readFile(file) {
    const ext = extOf(file.name), buf = await file.arrayBuffer();
    if (ext === 'pdf') {
      const pdfjs = await root.loadPdfJs();
      // isEvalSupported:false = フォントの中のスクリプトを動かさない（他社の PDF を読むため）
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), cMapUrl: root.PDFJS_CMAPS, cMapPacked: true, isEvalSupported: false }).promise;
      try {
        const pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          pages.push({ items: (await page.getTextContent()).items, height: vp.height, rotate: page.rotate || 0 });
        }
        return parsePdfPages(pages);
      } finally { doc.destroy(); }
    }
    const XLSX = await root.loadXlsx();
    const wb = XLSX.read(buf, { type: 'array' });
    return parseGrids(wb.SheetNames.map(nm => XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, defval: '' })));
  }

  const api = { UNITS, NUM, norm, skip, cleanNum, parseQtyUnit, stripLeading, isTotalRow, parseTable, pageItems, pageWords, pageText, toLines, toCells,
    strategy1, strategy15, strategy2, PA, PB, PC, PD, PE, extractSubject, extractNotes, extractTotals, extractPdfTotal, dedupSummary,
    parsePdfPages, parseGrids, cleanDesc, stripRowNumbers, normAmt, prepare, verifyParse, gapRow, METHOD_LABEL, IMAGE_MSG, extOf, readFile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EstimateImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
