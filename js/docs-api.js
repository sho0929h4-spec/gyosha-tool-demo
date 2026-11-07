// js/docs-api.js — 案件の書類（報告書・見積書・工事掲示・図面）と送付の記録（doc_shares）の読み書き
const DocsApi = (() => {
  const ok = r => { if (r.error) throw r.error; return r.data; };
  const VIA = { share: 'スマホの共有', mail: 'メール', line: 'LINE', download: 'ダウンロード' };
  return {
    VIA,
    reports: async caseId => ok(await sb.from('reports').select('*').eq('case_id', caseId).order('created_at', { ascending: false })),
    estimates: async caseId => ok(await sb.from('estimates').select('*').eq('case_id', caseId).order('created_at', { ascending: false })),
    notices: async caseId => ok(await sb.from('notices').select('*').eq('case_id', caseId).order('created_at', { ascending: false })),
    drawings: async caseId => ok(await sb.from('drawings').select('*').eq('case_id', caseId).order('created_at', { ascending: false })),
    shares: async caseId => ok(await sb.from('doc_shares').select('*').eq('case_id', caseId).order('sent_at', { ascending: false })),
    sharesOf: async (type, id) => ok(await sb.from('doc_shares').select('*').eq('doc_type', type).eq('doc_id', id).order('sent_at', { ascending: false })),
    // 今効いている一番新しい記録（「送っていないに戻す」をしたものは除く）。送った記録があればダウンロードより先に出す
    last(shares, type, id) {
      const live = (shares || []).filter(s => s.doc_type === type && s.doc_id === id && !s.undone_at);
      return live.find(s => s.via !== 'download') || live[0] || null;
    },
    // 「送付済み 11/5 15:20（LINE）」「ダウンロード済み」「未送付」
    statusText(s) {
      if (!s) return '未送付';
      if (s.via === 'download') return 'ダウンロード済み';
      return '送付済み ' + CaseLogic.mdhm(s.sent_at) + '（' + (VIA[s.via] || s.via) + '）';
    },
    record: async (caseId, type, id, via, pdfPath) => ok(await sb.from('doc_shares').insert({ case_id: caseId, doc_type: type, doc_id: id, via, pdf_path: pdfPath || null }).select().single()),
    // 送っていないに戻す（その書類の今効いている記録を全部外す。ダウンロードの記録も）
    undoAll: async (type, id) => ok(await sb.from('doc_shares').update({ undone_at: new Date().toISOString() }).eq('doc_type', type).eq('doc_id', id).is('undone_at', null)),
    // 公開PDF（public-pdfs/{org}/{推測できない uuid}/{type}.pdf）を置いて URL を返す（Storage のキーは英数字だけにする）
    async publicPdf(type, blob) {
      const path = ctx.org.id + '/' + newId() + '/' + type + '.pdf';
      const up = await sb.storage.from('public-pdfs').upload(path, blob, { contentType: 'application/pdf' });
      if (up.error) throw up.error;
      const url = sb.storage.from('public-pdfs').getPublicUrl(path).data.publicUrl;
      if (!url) throw new Error('PDFのリンクを作れませんでした');
      return { path, url };
    },
    // 書類の名前（案件画面の一覧・プレビュー・共有の文面）。見積書は「見積書 EST-… 第N版」、番号がまだなら「見積書（下書き）」。工事掲示は「工事掲示 302号室」、図面は「図面」
    title: (type, row) => (type === 'report' ? ReportLogic.docLabel(row.work_type, row.data)
      : type === 'estimate' ? (row.number ? '見積書 ' + row.number + ' 第' + row.version + '版' : '見積書（下書き）')
      : type === 'notice' ? NoticeLogic.docLabel(row.data) : type === 'drawing' ? '図面' : '書類')
  };
})();
