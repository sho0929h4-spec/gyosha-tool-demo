// js/invoice-pdf.js — 請求書の PDF。紙面は見積書と同じ（EstimatePdf.build に paper を渡して、題・右上の欄・表の列・合計・下の枠だけ差し替える）。window.InvoicePdf = { toBlob, view }
// 中身は invoices.data（出したときの写し。会社の設定を後で変えても請求書は変わらない）。出す前の下見（番号・発行者がまだ無い）は org から読む
// 載せるもの（インボイスの形）: 発行者の名前と登録番号・請求日・宛先・明細（見積ごとに1行）・税率ごとの額と消費税・合計・支払期限・振込先
// UMD: view（紙面に渡す形を作る所）は node でも読める（tests/pipeline-logic.test.js）。依存: PipelineLogic・EstimatePdf
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const PL = inNode ? require('./pipeline-logic.js') : root.PipelineLogic;
  const fmt = n => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const pct = r => Math.round(r * 1000) / 10 + '%';
  const md = s => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? +m[1] + '/' + +m[2] : ''; };

  // { estimate, paper }（EstimatePdf.build に渡す形）。inv = invoices の行（出す前は { data } だけ）、org = 会社の設定（出す前の発行者）
  function view(inv, org) {
    const d = inv.data || {}, is = d.issuer || org || {};
    const lines = (Array.isArray(d.lines) ? d.lines : []).map(l => ({ description: l.title, amount: l.net, work: md(l.work), number: l.number || '' }));
    if (d.post) lines.push({ description: '値引き', amount: d.post, work: '', number: '' }); // 税の後の値引きは最後の行に（合計が紙の上で合う）
    const taxes = Array.isArray(d.taxes) ? d.taxes : [];
    const t0 = taxes[0] || { rate: 0, net: 0, tax: 0 };
    // 内訳: 1つ目の税率は見積書と同じ2行。2つ目からは小さい字で1行ずつ足し、枠を上に広げる
    //   shortcut: 税率は3つまで（枠の上の空きが 19pt）、4つ以上の税率が1枚に混ざるようになったら内訳を次のページに出す
    const bd = [{ cls: 'r1', cells: ['内訳', pct(t0.rate) + '対象(税抜)', fmt(t0.net) + '円'] }, { cls: 'r2', cells: ['', pct(t0.rate) + '消費税', fmt(t0.tax) + '円'] }]
      .concat(taxes.slice(1).map(t => ({ cls: 'r3', cells: ['', pct(t.rate) + '対象(税抜)・消費税', fmt(t.net) + '円・' + fmt(t.tax) + '円'] })));
    return {
      estimate: { number: inv.number || '', data: { client: d.to || inv.client_name || '', honorific: '御中', subject: PL.invoiceSubject(d), company: { name: is.name || '' }, lines } },
      paper: {
        title: '請求書', greeting: '下記の通りご請求申し上げます。', totalLabel: 'ご請求金額', noLabel: '請求書番号',
        meta: [['請求日', d.issue], ['請求書番号', inv.number || '発行時に付きます'], ['お支払期限', d.due], ['登録番号', is.registration_number]],
        co: [is.address, is.tel ? 'TEL ' + is.tel : ''].filter(Boolean),
        totals: { subtotal: taxes.reduce((a, t) => a + t.net, 0), tax: taxes.reduce((a, t) => a + t.tax, 0), total: d.total },
        widths: [262.5, 50, 111, 86.7], head: ['摘要', '工事日', '見積番号', '明細金額'],
        cells(r, el) {
          const c = el('td', 'c-desc');
          if (!r) return [c, el('td'), el('td'), el('td', 'c-amt')];
          c.appendChild(el('div', 'fit', r.description));
          return [c, el('td', null, r.work), el('td', null, r.number), el('td', 'c-amt', fmt(r.amount))];
        },
        bd, bdUp: Math.max(0, taxes.length - 1) * 8,
        notesLabel: 'お振込先', notes: String(is.bank || ''),
        stamp: inv.void_at ? '取り消し' : ''
      }
    };
  }
  if (inNode) { module.exports = { view }; return; }

  // opts: { invoice（invoices の行。出す前の下見は { data }）, org, sealUrl, onStep(段階), onPages(画像の dataURL の配列) } → Promise<Blob>
  const toBlob = opts => root.EstimatePdf.toBlob(Object.assign({}, opts, view((opts || {}).invoice || {}, (opts || {}).org)));
  root.InvoicePdf = { toBlob, view };
})(typeof window !== 'undefined' ? window : globalThis);
