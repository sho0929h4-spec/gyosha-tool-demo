// js/daily-api.js — 日報（daily_reports）と日報の送付の記録（doc_shares の doc_type = 'daily'）の読み書き
const DailyApi = (() => {
  const ok = r => { if (r.error) throw r.error; return r.data; };
  const T = 'daily_reports';
  const COLS = ['date', 'author', 'sites', 'notes'];
  const pick = row => Object.fromEntries(COLS.filter(k => k in row).map(k => [k, row[k]]));
  return {
    list: async () => ok(await sb.from(T).select('*').order('date', { ascending: false }).order('created_at', { ascending: false })),
    get: async id => ok(await sb.from(T).select('*').eq('id', id).maybeSingle()),
    create: async row => ok(await sb.from(T).insert(pick(row)).select().single()),
    save: async (id, row) => ok(await sb.from(T).update(pick(row)).eq('id', id)),
    remove: async id => ok(await sb.from(T).delete().eq('id', id)),
    // 一覧の「送付済み／未送付」: 日報の記録を1回で全部
    shares: async () => ok(await sb.from('doc_shares').select('*').eq('doc_type', 'daily').order('sent_at', { ascending: false }))
  };
})();
