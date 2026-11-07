// tests/e2e/fake-sb.js — supabase-js と同じ呼び方の小さい偽物（本物には一切つながない）。E2E とお試し版（dist-demo）で js/supabase.js の代わりに読む。
// 保存は localStorage 'gyosha-demo-v1'（表とログイン状態）と 'gyosha-demo-v1-files'（写真などのファイル。data URL）。公開PDF は blob URL（その場限り）。
// 真似るもの（supabase/migrations/001_init.sql と同じ決まり）:
//   from(t).select/insert/update/delete + eq/neq/is/in/order/limit/single/maybeSingle（await できる）
//   RLS: 自社（org_id）の行だけ。列 grant: 書ける列だけ（org_id・id・created_by などを送ると permission denied）。必須・文字数の一部
//   auth: signInWithPassword（メールとパスワードが空でなければ通す）/ signOut / getSession / getUser / onAuthStateChange / resetPasswordForEmail（送らずに記録）/ updateUser
//   storage.from(b).upload / getPublicUrl / createSignedUrl / remove（1段目のフォルダ = 自社）
//   rpc: my_org_id / estimate_next_number / estimate_issue
// 最初のデータ: 会社1つ・利用者1人・案件0件。テストからは window.__fake で中を見る。
(function () {
  'use strict';
  const KEY = 'gyosha-demo-v1', FKEY = KEY + '-files';
  const ORG = '00000000-0000-4000-8000-000000000001';
  const USER = '00000000-0000-4000-8000-000000000002';
  const now = () => new Date().toISOString();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
  const copy = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const TABLES = ['orgs', 'memberships', 'clients', 'cases', 'reports', 'estimates', 'notices', 'drawings', 'doc_shares', 'estimate_templates', 'estimate_presets', 'rate_master', 'daily_reports'];

  function seed() {
    const t = now();
    const db = { session: null, users: [{ id: USER, email: 'demo@example.com' }] };
    TABLES.forEach(n => { db[n] = []; });
    db.orgs.push({ id: ORG, name: 'お試し工務店', address: '', tel: '', email: '', registration_number: '', logo_path: null, seal_path: null,
      show_company_on_report: true, tax_rate: 0.1, estimate_seq: 0, created_at: t });
    db.memberships.push({ user_id: USER, org_id: ORG, display_name: 'お試し担当', phone: '', created_at: t });
    return db;
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && Array.isArray(v.orgs)) { TABLES.forEach(n => { if (!Array.isArray(v[n])) v[n] = []; }); return v; }
    } catch (e) { /* 壊れていたら最初から */ }
    return seed();
  }
  let db = load();
  let files = (() => { try { return JSON.parse(localStorage.getItem(FKEY) || '{}') || {}; } catch (e) { return {}; } })();
  const blobs = {}; // public-pdfs: path → blob URL
  const FULL = 'お試し版の保存場所がいっぱいです。写真を減らすか、設定の「お試しデータを最初に戻す」で消してください';
  function persist() { localStorage.setItem(KEY, JSON.stringify(db)); }

  // 列 grant（001_init.sql と同じ）
  const RATE_COLS = ['kind', 'client', 'vendor', 'property', 'description', 'key', 'unit', 'quantity', 'unit_price', 'source', 'date'];
  const GRANT = {
    orgs: { update: ['name', 'address', 'tel', 'email', 'registration_number', 'logo_path', 'seal_path', 'show_company_on_report', 'tax_rate'] },
    memberships: { update: ['display_name', 'phone'] },
    clients: { insert: ['name', 'contact', 'email'], update: ['name', 'contact', 'email'], del: true },
    cases: { insert: ['name', 'room', 'address', 'client_id', 'client_name', 'client_contact', 'client_email', 'memo', 'survey_at', 'work_start', 'work_end'],
      update: ['name', 'room', 'address', 'client_id', 'client_name', 'client_contact', 'client_email', 'memo', 'survey_at', 'work_start', 'work_end', 'archived_at'], del: true },
    reports: { insert: ['case_id', 'work_type', 'data', 'photos'], update: ['work_type', 'data', 'photos'], del: true },
    estimates: { insert: ['case_id', 'series_id', 'version', 'number', 'data'], update: ['data', 'status', 'number'], del: true },
    notices: { insert: ['case_id', 'data'], update: ['data'], del: true },
    drawings: { insert: ['case_id', 'image_path', 'marks'], update: ['image_path', 'marks'], del: true },
    doc_shares: { insert: ['case_id', 'doc_type', 'doc_id', 'via', 'pdf_path'], update: ['undone_at'] },
    estimate_templates: { insert: ['owner_user_id', 'name', 'lines', 'sort'], update: ['name', 'lines', 'sort'], del: true },
    estimate_presets: { insert: ['owner_user_id', 'text', 'unit', 'price', 'sort'], update: ['text', 'unit', 'price', 'sort'], del: true },
    rate_master: { insert: RATE_COLS, update: RATE_COLS, del: true },
    daily_reports: { insert: ['date', 'author', 'sites', 'notes'], update: ['date', 'author', 'sites', 'notes'], del: true }
  };
  const DEFAULTS = {
    clients: { contact: '', email: '' },
    cases: { room: '', address: '', client_id: null, client_name: '', client_contact: '', client_email: '', memo: '', survey_at: null, work_start: null, work_end: null, archived_at: null },
    reports: { work_type: 'investigate', data: {}, photos: [] },
    estimates: { version: 1, number: '', status: 'draft', data: {} },
    notices: { data: {} },
    drawings: { image_path: null, marks: [] },
    doc_shares: { pdf_path: null, undone_at: null },
    estimate_templates: { owner_user_id: null, lines: [], sort: 0 },
    estimate_presets: { owner_user_id: null, unit: '', price: 0, sort: 0 },
    rate_master: { client: '', vendor: '', property: '', unit: '', quantity: 1, source: '', date: null },
    daily_reports: { author: '', sites: [], notes: '' }
  };
  const HAS_CREATED_BY = ['cases', 'reports', 'estimates', 'notices', 'drawings', 'daily_reports'];
  const HAS_UPDATED_AT = ['cases', 'reports', 'estimates', 'notices', 'drawings', 'daily_reports'];
  const CASE_CHILD = ['reports', 'estimates', 'notices', 'drawings', 'doc_shares'];
  const err = (message, code) => ({ message, code: code || 'P0001' });
  const denied = () => err('permission denied', '42501');
  const me = () => (db.session ? db.session.user.id : null);
  const myOrg = () => { const m = db.memberships.find(x => x.user_id === me()); return m ? m.org_id : null; };
  const visible = (t, r) => (t === 'orgs' ? r.id === myOrg() : r.org_id === myOrg())
    && (!['estimate_templates', 'estimate_presets'].includes(t) || r.owner_user_id == null || r.owner_user_id === me());

  function check(t, r) {
    const len = (k, n) => r[k] != null && String(r[k]).length > n;
    if (t === 'cases' || t === 'clients') {
      if (!String(r.name || '').trim()) return err('null value in column "name" violates not-null constraint', '23514');
      if (len('name', 100)) return err('name が長すぎます', '23514');
    }
    if (t === 'cases' && r.work_start && r.work_end && r.work_end < r.work_start) return err('new row for relation "cases" violates check constraint', '23514');
    if (t === 'cases' && r.client_id && !db.clients.some(c => c.id === r.client_id && c.org_id === r.org_id)) return err('foreign key violation', '23503');
    if (t === 'clients' && db.clients.some(c => c.id !== r.id && c.org_id === r.org_id && c.name === r.name)) return err('duplicate key value violates unique constraint', '23505');
    if (t === 'estimates' && db.estimates.some(x => x.id !== r.id && x.series_id === r.series_id && x.version === r.version)) return err('duplicate key value violates unique constraint', '23505');
    if (CASE_CHILD.includes(t) && !(t === 'doc_shares' && r.case_id == null) && !db.cases.some(c => c.id === r.case_id && c.org_id === r.org_id)) return err('foreign key violation', '23503');
    if (t === 'reports' && !['investigate', 'work', 'other', 'repair', 'restore'].includes(r.work_type)) return err('check constraint', '23514');
    if (t === 'doc_shares' && (!['report', 'estimate', 'notice', 'drawing', 'daily'].includes(r.doc_type) || !['share', 'mail', 'line', 'download'].includes(r.via))) return err('check constraint', '23514');
    if (t === 'daily_reports' && (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) || len('author', 60) || len('notes', 4000) || !Array.isArray(r.sites))) return err('check constraint', '23514');
    if (t === 'rate_master' && (!['cost', 'sell'].includes(r.kind) || !String(r.description || '').trim() || !r.key || !(Number(r.unit_price) > 0))) return err('check constraint', '23514');
    if (t === 'orgs' && r.registration_number && !/^T[0-9]{13}$/.test(r.registration_number)) return err('new row for relation "orgs" violates check constraint', '23514');
    return null;
  }

  class Query {
    constructor(t) { this.t = t; this.op = 'select'; this.filters = []; this.orders = []; this.one = null; this.ret = false; this.lim = null; }
    select() { if (this.op !== 'select') this.ret = true; return this; }
    insert(rows) { this.op = 'insert'; this.rows = rows; return this; }
    update(patch) { this.op = 'update'; this.patch = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push(r => r[c] === v); return this; }
    neq(c, v) { this.filters.push(r => r[c] !== v); return this; }
    is(c, v) { this.filters.push(r => (r[c] == null ? null : r[c]) === v); return this; }
    in(c, vs) { this.filters.push(r => vs.includes(r[c])); return this; }
    order(c, o) { this.orders.push([c, !o || o.ascending !== false]); return this; }
    limit(n) { this.lim = n; return this; }
    single() { this.one = 'single'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    then(ok, ng) { return new Promise(r => setTimeout(r, 5)).then(() => this.run()).then(ok, ng); }
    run() {
      const t = this.t;
      if (!TABLES.includes(t)) return { data: null, error: err('relation "' + t + '" does not exist', '42P01') };
      if (!me() || !myOrg()) return { data: null, error: denied() };
      const before = JSON.stringify(db);
      let out;
      try { out = this.exec(t); } catch (e) { db = JSON.parse(before); return { data: null, error: err(e.message) }; }
      if (out.error) { db = JSON.parse(before); return out; }
      if (this.op !== 'select') {
        try { persist(); } catch (e) { db = JSON.parse(before); return { data: null, error: err(FULL) }; }
      }
      let rows = out.data;
      if (this.op !== 'select' && !this.ret) return { data: null, error: null };
      if (this.one) {
        if (rows.length > 1 || (this.one === 'single' && rows.length === 0)) return { data: null, error: err('JSON object requested, multiple (or no) rows returned', 'PGRST116') };
        return { data: copy(rows[0] || null), error: null };
      }
      return { data: copy(rows), error: null };
    }
    match() { return db[this.t].filter(r => visible(this.t, r) && this.filters.every(f => f(r))); }
    exec(t) {
      const g = GRANT[t] || {};
      if (this.op === 'select') {
        let rows = this.match();
        this.orders.slice().reverse().forEach(([c, asc]) => {
          rows = rows.slice().sort((a, b) => (a[c] == null ? -1 : b[c] == null ? 1 : a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
        });
        if (this.lim != null) rows = rows.slice(0, this.lim);
        return { data: rows };
      }
      if (this.op === 'insert') {
        if (!g.insert) return { error: denied() };
        const list = Array.isArray(this.rows) ? this.rows : [this.rows];
        const made = [];
        for (const src of list) {
          if (Object.keys(src).some(k => !g.insert.includes(k))) return { error: denied() };
          const r = Object.assign({ id: uuid(), org_id: myOrg() }, copy(DEFAULTS[t] || {}), copy(src));
          if (t === 'estimates' && !r.series_id) r.series_id = uuid();
          if (t === 'rate_master' && !r.date) { const d = new Date(); r.date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
          if (t === 'doc_shares') { r.sent_at = now(); r.sent_by = me(); }
          else r.created_at = now();
          if (HAS_CREATED_BY.includes(t)) r.created_by = me();
          if (HAS_UPDATED_AT.includes(t)) r.updated_at = r.created_at;
          const e = check(t, r);
          if (e) return { error: e };
          db[t].push(r);
          made.push(r);
        }
        return { data: made };
      }
      if (this.op === 'update') {
        if (!g.update || Object.keys(this.patch).some(k => !g.update.includes(k))) return { error: denied() };
        let rows = this.match();
        if (t === 'memberships') rows = rows.filter(r => r.user_id === me());
        if (t === 'estimates') rows = rows.filter(r => r.status === 'draft');
        if (t === 'estimates' && 'status' in this.patch && this.patch.status !== 'draft' && rows.length) return { error: err('new row violates row-level security policy for table "estimates"', '42501') }; // 出すのは estimate_issue だけ
        for (const r of rows) {
          Object.assign(r, copy(this.patch));
          if (HAS_UPDATED_AT.includes(t)) r.updated_at = now();
          const e = check(t, r);
          if (e) return { error: e };
        }
        return { data: rows };
      }
      if (!g.del) return { error: denied() };
      let rows = this.match();
      if (t === 'estimates') rows = rows.filter(r => r.status === 'draft');
      db[t] = db[t].filter(r => !rows.includes(r));
      if (t === 'cases') CASE_CHILD.forEach(c => { db[c] = db[c].filter(x => !rows.some(r => r.id === x.case_id)); }); // on delete cascade
      return { data: rows };
    }
  }

  /* ===== auth ===== */
  const listeners = [];
  const sessionObj = () => (db.session ? copy(db.session) : null);
  const emit = ev => listeners.forEach(cb => { try { cb(ev, sessionObj()); } catch (e) { console.error(e); } });
  const wait = () => new Promise(r => setTimeout(r, 5));
  const auth = {
    async getSession() { await wait(); return { data: { session: sessionObj() }, error: null }; },
    async getUser() { await wait(); return { data: { user: db.session ? copy(db.session.user) : null }, error: null }; },
    async signInWithPassword(o) {
      await wait();
      const email = String((o && o.email) || '').trim(), pw = String((o && o.password) || '');
      if (!email || !pw) return { data: { session: null, user: null }, error: Object.assign(new Error('Invalid login credentials'), { status: 400, code: 'invalid_credentials' }) };
      return signIn(email);
    },
    async signOut() { await wait(); db.session = null; persist(); emit('SIGNED_OUT'); return { error: null }; },
    onAuthStateChange(cb) {
      listeners.push(cb);
      return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } } } };
    },
    async resetPasswordForEmail(email, o) { await wait(); fake.resetMails.push({ email, redirectTo: o && o.redirectTo }); return { data: {}, error: null }; },
    async updateUser(attrs) {
      await wait();
      if (!db.session) return { data: { user: null }, error: Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError', status: 400 }) };
      if (attrs && attrs.password != null) {
        if (String(attrs.password).length < 6) return { data: { user: null }, error: Object.assign(new Error('Password should be at least 6 characters.'), { status: 422, code: 'weak_password' }) };
        fake.pwUpdates++; // パスワードそのものは残さない
      }
      return { data: { user: copy(db.session.user) }, error: null };
    }
  };
  function signIn(email) {
    const u = db.users[0];
    db.session = { access_token: 'fake', user: { id: u.id, email: email || u.email } };
    persist();
    emit('SIGNED_IN');
    return { data: { session: sessionObj(), user: copy(db.session.user) }, error: null };
  }

  /* ===== storage ===== */
  const toDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('ファイルを読めませんでした')); r.readAsDataURL(b); });
  function bucket(name) {
    const own = p => myOrg() && String(p).split('/')[0] === myOrg();
    const pub = name === 'public-pdfs';
    return {
      async upload(path, body, o) {
        await wait();
        if (!own(path)) return { data: null, error: err('new row violates row-level security policy', '42501') };
        const k = name + '/' + path;
        if ((pub ? blobs[k] : files[k]) && !(o && o.upsert)) return { data: null, error: err('The resource already exists', '409') };
        if (pub) { blobs[k] = URL.createObjectURL(body); return { data: { path }, error: null }; }
        const url = await toDataUrl(body);
        const prev = files[k];
        files[k] = url;
        try { localStorage.setItem(FKEY, JSON.stringify(files)); }
        catch (e) { if (prev) files[k] = prev; else delete files[k]; return { data: null, error: err(FULL) }; }
        return { data: { path }, error: null };
      },
      getPublicUrl(path) { return { data: { publicUrl: pub ? (blobs[name + '/' + path] || '') : '' } }; },
      async createSignedUrl(path) {
        await wait();
        const u = files[name + '/' + path];
        if (!own(path) || !u) return { data: null, error: err('Object not found', '404') };
        return { data: { signedUrl: u }, error: null };
      },
      async remove(paths) {
        await wait();
        (paths || []).filter(own).forEach(p => { delete files[name + '/' + p]; delete blobs[name + '/' + p]; });
        try { localStorage.setItem(FKEY, JSON.stringify(files)); } catch (e) { /* 減らす方なので失敗しない */ }
        return { data: [], error: null };
      }
    };
  }

  async function rpc(fn, args) {
    await wait();
    if (!me() || !myOrg()) return { data: null, error: denied() };
    if (fn === 'my_org_id') return { data: myOrg(), error: null };
    if (fn === 'estimate_next_number') {
      const o = db.orgs.find(x => x.id === myOrg());
      o.estimate_seq++;
      persist();
      return { data: String(o.estimate_seq).padStart(4, '0'), error: null };
    }
    if (fn === 'estimate_issue') { // その版を issued に、同じ系列のそれより前の版で issued のものを superseded に
      const r = db.estimates.find(x => x.id === (args && args.p_id) && x.org_id === myOrg() && ['draft', 'issued'].includes(x.status));
      if (r) {
        r.status = 'issued';
        db.estimates.filter(x => x.series_id === r.series_id && x.org_id === myOrg() && x.version < r.version && x.status === 'issued').forEach(x => { x.status = 'superseded'; });
        persist();
      }
      return { data: null, error: null };
    }
    return { data: null, error: err('function ' + fn + ' does not exist', '42883') };
  }

  const fake = {
    ORG, USER, resetMails: [], pwUpdates: 0,
    get db() { return db; },
    get files() { return files; },
    signInDemo() { return signIn(''); },
    reset() { db = seed(); files = {}; localStorage.removeItem(KEY); localStorage.removeItem(FKEY); }
  };
  window.__fake = fake;
  window.sb = { from: t => new Query(t), auth, storage: { from: bucket }, rpc };
})();
