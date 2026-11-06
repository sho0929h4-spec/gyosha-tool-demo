// js/case-logic.js — 案件の名前の表示と検索の一致（UMD: ブラウザは window.CaseLogic / node は module.exports。tests/cases.test.js）
(function (root) {
  const str = v => String(v == null ? '' : v).trim();
  // '302' → '302号室'（数字・英字で終わるときだけ「号室」を付ける。'管理室' はそのまま）
  const roomLabel = room => { const r = str(room); return !r ? '' : /[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(r) ? r + '号室' : r; };
  // 「サンプルハイツ 302号室」
  const placeName = (c, sep) => [str(c && c.name), roomLabel(c && c.room)].filter(Boolean).join(sep == null ? ' ' : sep);
  // 全角・半角、大文字・小文字をそろえる
  const norm = s => String(s == null ? '' : s).normalize('NFKC').toLowerCase();
  // 物件名・号室で探す: 空白で区切った言葉が全部入っていれば一致（「サンプル 302」「サンプルハイツ302」「３０２」）
  function matches(c, q) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = norm([str(c && c.name), str(c && c.room), roomLabel(c && c.room)].join(' '));
    const flat = hay.replace(/\s+/g, '');
    return words.every(w => hay.includes(w) || flat.includes(w));
  }
  // 宛名の行: 「みどり管理 山田様」（担当者名に様・御中・さんが付いていればそのまま）
  function clientLine(c) {
    const co = str(c && c.client_name), ct = str(c && c.client_contact);
    return [co, ct ? (/(様|御中|さん)$/.test(ct) ? ct : ct + '様') : ''].filter(Boolean).join(' ');
  }
  // 日時の表示（日本時間）: 'M/D' / 'M/D H:MM'
  function parts(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return p;
  }
  const md = iso => { const p = parts(iso); return p ? `${p.month}/${p.day}` : ''; };
  const mdhm = iso => { const p = parts(iso); return p ? `${p.month}/${p.day} ${Number(p.hour)}:${p.minute}` : ''; };

  const api = { roomLabel, placeName, matches, clientLine, md, mdhm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CaseLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
