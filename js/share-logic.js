// js/share-logic.js — 共有の文面・ファイル名・mailto・LINE の URL（UMD: window.ShareLogic / module.exports。tests/share-logic.test.js）
// 簡易版（業者ツール（簡易版）/js/share-logic.js と report-logic.js の buildMailto）を写して簡略化した。
//   件名: 「物件名 号室 書類名」（例「サンプルハイツ 302号室 調査報告書」）
//   本文（メール）: 宛名 → 挨拶「いつもお世話になっております。○○の○○です。」→ 用件「表題の件につきまして、○○を共有いたします。」→
//     結び「ご確認のほど、よろしくお願いいたします。」→ 署名（会社・自分・電話）
//   本文（LINE）: 宛名・署名なし。用件は「サンプルハイツ 302号室 調査報告書を共有いたします。」
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const CL = () => (inNode ? require('./case-logic.js') : root.CaseLogic);
  const str = v => String(v == null ? '' : v).trim();
  const VIA = { share: 'スマホの共有', mail: 'メール', line: 'LINE', download: 'ダウンロード' };
  const MAILTO_MAX = 8000;
  const SHORT_NOTE = '詳細は添付リンクをご確認ください。';

  // 宛名: 「みどり管理 山田様」／「みどり管理 ご担当者様」／「ご担当者様」
  function addressee(c) {
    const co = str(c && c.client_name), ct = str(c && c.client_contact);
    return [co, ct ? (/(様|御中|さん)$/.test(ct) ? ct : ct + '様') : 'ご担当者様'].filter(Boolean).join(' ');
  }
  // o: { docLabel, caseRow, org: { name, tel }, me: { name, tel }, short } → { subject, body }
  function message(o) {
    const doc = str(o.docLabel);
    const subject = [CL().placeName(o.caseRow || {}), doc].filter(Boolean).join(' ');
    const orgName = str(o.org && o.org.name), myName = str(o.me && o.me.name);
    const tel = str(o.me && o.me.tel) || str(o.org && o.org.tel);
    const who = orgName && myName ? `${orgName}の${myName}です。` : orgName || myName ? `${orgName || myName}です。` : '';
    const what = o.short ? `${subject}を共有いたします。` : `表題の件につきまして、${doc}を共有いたします。`;
    const main = ['いつもお世話になっております。' + who, '', what, 'ご確認のほど、よろしくお願いいたします。'];
    if (o.short) return { subject, body: main.join('\n') };
    const sign = [orgName, myName, tel ? 'TEL ' + tel : ''].filter(Boolean);
    const lines = [addressee(o.caseRow), '', ...main];
    if (sign.length) lines.push('', '――――――――――', ...sign);
    return { subject, body: lines.join('\n') };
  }
  // 受け取った人の保存名: 「サンプルハイツ302号室_調査報告書.pdf」（ファイル名に使えない文字と空白は除く）
  const fileName = (docLabel, c) => [CL().placeName(c || {}, ''), str(docLabel)].filter(Boolean).join('_').replace(/[\\/:*?"<>|\s]+/g, '') + '.pdf';
  // 本文に PDF のリンクの行を入れる: 「…共有いたします。」の行のすぐ下（その行が消されていれば最後）
  function withLink(body, link) {
    const l = str(link), b = String(body == null ? '' : body);
    if (!l) return b;
    const ls = b.split(/\r?\n/);
    const i = ls.findIndex(x => x.includes('共有いたします'));
    if (i < 0) return b.replace(/\s+$/, '') + '\n\n' + l;
    ls.splice(i + 1, 0, l);
    return ls.join('\n');
  }
  const encBody = b => encodeURIComponent(String(b).replace(/\r?\n/g, '\r\n'));
  function mailtoRaw(to, subject, body) {
    const addr = str(to).split(/\s*,\s*/).filter(Boolean).map(a => encodeURIComponent(a).replace(/%40/g, '@')).join(',');
    return `mailto:${addr}?subject=${encodeURIComponent(str(subject))}&body=${encBody(body)}`;
  }
  // mailto（長すぎるとメールアプリが開かないので、8000字を超えたら宛名＋「詳細は…」＋リンクに縮める）
  function buildMailto({ to, subject, body, link }) {
    const full = mailtoRaw(to, subject, withLink(body, link));
    if (full.length <= MAILTO_MAX) return { url: full, shortened: false };
    const first = String(body || '').split(/\r?\n/)[0];
    return { url: mailtoRaw(to, subject, [first, '', SHORT_NOTE, ...(str(link) ? ['', str(link)] : [])].join('\n')), shortened: true };
  }
  // LINE の共有 URL（ユーザーが「LINEで開く」を押したときだけ使う）
  const lineUrl = text => 'https://line.me/R/msg/text/?' + encodeURIComponent(String(text == null ? '' : text));
  const viaLabel = via => VIA[via] || '';

  const api = { VIA, addressee, message, fileName, withLink, buildMailto, lineUrl, viaLabel, MAILTO_MAX };
  if (inNode) module.exports = api;
  else root.ShareLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
