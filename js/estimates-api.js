// js/estimates-api.js — 見積書（estimates）・定型（estimate_templates）・よく使う明細（estimate_presets）・単価マスタ（rate_master）の読み書き
//   版: 同じ series_id で version を上げる（番号は同じ）。出した版（issued）は直せないので、直すときは createDraft(caseRow, row) で新しい版を作る
const EstimatesApi = (() => {
  const ok = r => { if (r.error) throw r.error; return r.data; };
  const EL = EstimateLogic;
  return {
    get: async id => ok(await sb.from('estimates').select('*').eq('id', id).maybeSingle()),
    // 新しい系列（series_id は DB の既定値）か、fromRow の系列の次の版（同じ番号・同じ種類・中身の写し。見積日と有効期限は今日から）
    //   kind: 'normal'（通常見積）| 'teikei'（定型見積。中身は TeikeiLogic.newData・単価表は会社のもの）。作ったあとは変えない
    async createDraft(caseRow, fromRow, kind) {
      const today = new Date();
      if (!fromRow) {
        const k = kind === 'teikei' ? 'teikei' : 'normal';
        const data = k === 'teikei' ? TeikeiLogic.newData(caseRow, await TeikeiApi.rates(), today) : EL.newData(caseRow, ctx.org, ctx.membership, today);
        return ok(await sb.from('estimates').insert({ case_id: caseRow.id, kind: k, data }).select().single());
      }
      const last = ok(await sb.from('estimates').select('version').eq('series_id', fromRow.series_id).order('version', { ascending: false }).limit(1));
      const data = JSON.parse(JSON.stringify(fromRow.data || {}));
      const k = fromRow.kind === 'teikei' ? 'teikei' : 'normal';
      if (k === 'teikei') Object.assign(data.cover = data.cover || {}, { date: EL.ymd(today), exp: EL.defaultDue(today) });
      else Object.assign(data, { date: EL.ymd(today), due: EL.defaultDue(today) });
      data.pdf_at = null;
      return ok(await sb.from('estimates').insert({ case_id: fromRow.case_id, series_id: fromRow.series_id, version: (last[0] ? last[0].version : fromRow.version) + 1,
        number: fromRow.number || '', kind: k, data }).select().single());
    },
    save: async (id, patch) => ok(await sb.from('estimates').update(patch).eq('id', id)),
    // 出した（共有・ダウンロード）: この版を issued、同じ系列のそれより前の issued を superseded（DB の関数で。画面から status は直せない）
    issue: async row => ok(await sb.rpc('estimate_issue', { p_id: row.id })),
    nextNumber: async () => EL.formatNumber(ok(await sb.rpc('estimate_next_number'))),
    templates: async () => ok(await sb.from('estimate_templates').select('*').order('sort').order('created_at')),
    addTemplate: async (name, lines) => ok(await sb.from('estimate_templates').insert({ name, lines }).select().single()),
    delTemplate: async id => ok(await sb.from('estimate_templates').delete().eq('id', id)),
    presets: async () => ok(await sb.from('estimate_presets').select('*').order('sort').order('created_at')),
    addPreset: async (text, unit, price) => ok(await sb.from('estimate_presets').insert({ text, unit, price }).select().single()),
    delPreset: async id => ok(await sb.from('estimate_presets').delete().eq('id', id)),
    // 単価マスタは入れた順（EstimateLogic.newest は同じ日なら後のものを新しいとみる）
    // shortcut: 全件を読む。記録が数千件を超えたら key の前方一致で絞って読む
    rates: async () => ok(await sb.from('rate_master').select('*').order('created_at')),
    delRates: async ids => (ids.length ? ok(await sb.from('rate_master').delete().in('id', ids)) : null),
    // 単価マスタにためる（EstimateLogic.rateRows: 同じ source の古い記録を先に消し、同じ単価は足さない）。足した件数を返す
    //   view = EstimateLogic.rateView(lines, kind)、o = { kind, client, vendor, property, source }、existing = 今の記録（rates() の結果）
    async registerRates(view, o, existing) {
      const r = EL.rateRows(view, o, existing);
      if (r.del.length) ok(await sb.from('rate_master').delete().in('id', r.del));
      if (r.rows.length) ok(await sb.from('rate_master').insert(r.rows));
      return r.rows.length;
    }
  };
})();
