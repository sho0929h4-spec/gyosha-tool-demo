// js/daily-logic.js — 日報の規則（UMD: ブラウザは window.DailyLogic / node は module.exports。tests/daily-logic.test.js）。DOM に触らない
//   daily_reports の行: { date: 'YYYY-MM-DD', author, sites: [{ case_id, label }]（選んだ順）, notes }
(function (root) {
  const str = v => String(v == null ? '' : v).trim();
  const p2 = n => String(n).padStart(2, '0');
  const WD = '日月火水木金土';
  const parse = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(ymd)); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  // today = 端末の Date（端末の日付で決める）、me = memberships の行
  const newData = (today, me) => ({ date: today.getFullYear() + '-' + p2(today.getMonth() + 1) + '-' + p2(today.getDate()), author: str(me && me.display_name), sites: [], notes: '' });
  // 紙面を見る前の確かめ: 通れば ''
  const validate = d => (!parse(d && d.date) ? '日付を入れてください' : !(Array.isArray(d.sites) && d.sites.length) ? '対応現場を1つ以上選んでください' : '');
  // 「11/7（土）」
  const md = ymd => { const d = parse(ymd); return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）` : ''; };
  // 「2026年11月7日（土）」
  const dateJa = ymd => { const d = parse(ymd); return d ? `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WD[d.getUTCDay()]}）` : ''; };
  // 「日報 11/7（土） 山田」（担当者が空なら無し）
  const title = d => ['日報', md(d && d.date), str(d && d.author)].filter(Boolean).join(' ');
  const safe = s => str(s).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, '_');
  // 日報_2026-11-07_山田.pdf
  const fileName = d => ['日報', safe(d && d.date), safe(d && d.author)].filter(Boolean).join('_') + '.pdf';

  const api = { newData, validate, md, dateJa, title, fileName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DailyLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
