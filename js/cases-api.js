// js/cases-api.js — 案件・元請（clients）・案件ごとの書類の数の読み書き（sb = 本物の Supabase か偽物）
const CasesApi = (() => {
  const ok = r => { if (r.error) throw r.error; return r.data; };
  const COLS = ['name', 'room', 'address', 'client_id', 'client_name', 'client_contact', 'client_email', 'memo', 'survey_at', 'work_start', 'work_end'];
  const pick = row => Object.fromEntries(COLS.filter(k => k in row).map(k => [k, row[k]]));
  return {
    list: async () => ok(await sb.from('cases').select('*').is('archived_at', null).order('created_at', { ascending: false })),
    get: async id => ok(await sb.from('cases').select('*').eq('id', id).maybeSingle()),
    create: async row => ok(await sb.from('cases').insert(pick(row)).select().single()),
    update: async (id, row) => ok(await sb.from('cases').update(pick(row)).eq('id', id).select().single()),
    clients: async () => ok(await sb.from('clients').select('*').order('name')),
    // 元請の名前が初めてなら clients に足す（同じ名前があればそれを使い、担当者・メールが空なら埋める）
    async ensureClient(name, contact, email) {
      const n = String(name || '').trim();
      if (!n) return null;
      const found = ok(await sb.from('clients').select('*').eq('name', n).maybeSingle());
      if (found) {
        const patch = {};
        if (!found.contact && contact) patch.contact = contact;
        if (!found.email && email) patch.email = email;
        if (Object.keys(patch).length) ok(await sb.from('clients').update(patch).eq('id', found.id));
        return found.id;
      }
      return ok(await sb.from('clients').insert({ name: n, contact: contact || '', email: email || '' }).select().single()).id;
    },
    // 書類の数（案件一覧の札）: { [case_id]: { report: n } }
    async docCounts() {
      const out = {};
      ok(await sb.from('reports').select('id,case_id')).forEach(r => {
        const c = out[r.case_id] || (out[r.case_id] = { report: 0 });
        c.report++;
      });
      return out;
    }
  };
})();
