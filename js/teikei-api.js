// js/teikei-api.js — 定型見積（被害復旧工事）の単価表（teikei_rates。会社に1行）の読み書き。行が無ければ標準（js/teikei-default-rates.js）
const TeikeiApi = (() => {
  const ok = r => { if (r.error) throw r.error; return r.data; };
  const T = 'teikei_rates';
  const mine = async () => ok(await sb.from(T).select('*').eq('org_id', ctx.org.id).maybeSingle());
  return {
    // 会社の単価表。無い（または中身が空の）ときは標準の写しに isDefault: true を付けて返す
    async rates() {
      const row = await mine();
      if (row && row.data && Array.isArray(row.data.sets)) return row.data;
      return Object.assign(JSON.parse(JSON.stringify(TEIKEI_DEFAULT_RATES)), { isDefault: true });
    },
    async saveRates(data) {
      const body = Object.assign({}, data);
      delete body.isDefault;
      const row = await mine();
      if (row) return ok(await sb.from(T).update({ data: body }).eq('id', row.id));
      return ok(await sb.from(T).insert({ data: body }).select().single());
    },
    // 標準に戻す（会社の行を消す）
    resetRates: async () => ok(await sb.from(T).delete().eq('org_id', ctx.org.id))
  };
})();
