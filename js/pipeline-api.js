// js/pipeline-api.js — 見積の一覧（全案件・案件ごと）とフェーズ（estimate_phases）・元請の締め日（clients）の読み書き
const PipelineApi = (() => {
  const ok = r => { if (r.error) throw r.error; return r.data; };
  // 全部読む（1回 1000 行までなので、id の順に 1000 行ずつ）
  async function all(table, filter) {
    const out = [];
    for (let i = 0; ; i += 1000) {
      let q = sb.from(table).select('*');
      if (filter) q = filter(q);
      const page = ok(await q.order('id').range(i, i + 999));
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }
  return {
    // 一覧に要るもの（全案件。案件ごとの一覧も、請求書は同じ請求先・締めの回の見積をまとめるので全部読んで画面で絞る）
    async load() {
      const [estimates, cases, phases, clients, invoices] = await Promise.all([all('estimates'), all('cases'), all('estimate_phases'), all('clients'), all('invoices')]);
      return { estimates, cases, phases, clients, invoices };
    },
    count: async caseId => ok(await sb.from('estimates').select('id').eq('case_id', caseId).limit(1)).length,
    // フェーズを変える（系列に1行。無ければ足す）
    async setPhase(seriesId, phase) {
      const row = ok(await sb.from('estimate_phases').select('id').eq('series_id', seriesId).maybeSingle());
      if (row) ok(await sb.from('estimate_phases').update({ phase }).eq('id', row.id).select().single());
      else ok(await sb.from('estimate_phases').insert({ series_id: seriesId, phase }).select().single());
    },
    // 請求書（足す・印は DB の関数。番号は会社ごとの連番で、出したら中身は直せない）
    invoices: async () => (await all('invoices')).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    issue: async (clientId, name, data) => ok(await sb.rpc('invoice_issue', { p_client: clientId || null, p_name: name, p_data: data })),
    mark: async (id, what) => ok(await sb.rpc('invoice_mark', { p_id: id, p_what: what })),
    clients: async () => ok(await sb.from('clients').select('*').order('name')),
    saveClient: async (id, patch) => ok(await sb.from('clients').update(patch).eq('id', id).select().single())
  };
})();
