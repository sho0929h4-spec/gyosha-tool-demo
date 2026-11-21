// tests/e2e/fake-sb.js — supabase-js と同じ呼び方の小さい偽物（本物には一切つながない）。E2E とお試し版（dist-demo）で js/supabase.js の代わりに読む。
// 保存は localStorage 'gyosha-demo-v1'（表とログイン状態）と IndexedDB 'gyosha-demo-v1-files'（写真などのファイル。data URL）。
// 真似るもの（supabase/migrations/001_init.sql と同じ決まり）:
//   from(t).select/insert/update/delete + eq/neq/is/in/order/limit/range/single/maybeSingle（await できる）
//   RLS: 自社（org_id）の行だけ。列 grant: 書ける列だけ（org_id・id・created_by などを送ると permission denied）。必須・文字数の一部
//   管理者（memberships.role = 'admin'）だけ: orgs の update・teikei_rates の insert/update/delete・cases の delete・audit_log を読む（一般は 0 件か permission denied）
//   台帳 files は読むだけ（本物は Worker の file_reserve / file_release。偽物では window.__fake.ledger.put / del）
//   招待・外す（本物は Worker の POST /invite・DELETE /members/{id}）: window.__fake.worker.invite / remove。ロゴ・社印の置く・消すは管理者だけ: worker.orgFile
//   audit_log: orgs の update（変わった列・会社名／住所／登録番号は前後の値 changes）・招待（1時間 30 人まで。too_many）・teikei_rates の保存／標準に戻す・cases の delete・set_member_role で行が入る
//   auth: signInWithPassword（メールとパスワードが空でなければ通す）/ signOut / getSession / getUser / onAuthStateChange / resetPasswordForEmail（送らずに記録）/ updateUser
//   ファイル置き場（本物は Cloudflare R2）: window.__fake.store.put / get / del（1段目のフォルダ = 自社）。呼ぶのは tests/e2e/fake-files.js（js/files.js の代わり）
//   rpc: my_org_id / my_status / is_admin / estimate_next_number / estimate_issue / org_file_bytes / org_members / set_member_role / set_report_items（会社の人なら誰でも）
//   利用を終えた会社（orgs.closed_at。本物と同じく利用者は直せない。テストは db を直接書く）: その会社の人は select 0 件・書けない・rpc は my_status だけ（'closed'）
// 最初のデータ: 会社1つ・利用者1人（管理者）・案件0件。テストからは window.__fake で中を見る。
// 招待・再設定メールのリンクの印（js/supabase.js と同じ行。試験 tests/link-flags.test.js が同じかを見る）
const sbLink = h => { const p = new URLSearchParams(String(h || '').replace(/^#/, '')); return p.get('access_token') ? p.get('type') : null; };
window.SB_INVITE = sbLink(location.hash) === 'invite';
window.SB_RECOVERY = sbLink(location.hash) === 'recovery';
(function () {
  'use strict';
  const KEY = 'gyosha-demo-v1', FKEY = KEY + '-files';
  const ORG = '00000000-0000-4000-8000-000000000001';
  const USER = '00000000-0000-4000-8000-000000000002';
  const now = () => new Date().toISOString();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
  const copy = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const TABLES = ['orgs', 'memberships', 'clients', 'cases', 'reports', 'estimates', 'notices', 'drawings', 'doc_shares', 'estimate_templates', 'estimate_presets', 'rate_master', 'daily_reports', 'teikei_rates', 'files', 'audit_log', 'estimate_phases', 'invoices'];
  const FILE_LIMIT = 1073741824; // orgs.file_limit_bytes の既定（1GB）

  function seed() {
    const t = now();
    const db = { session: null, users: [{ id: USER, email: 'demo@example.com' }] };
    TABLES.forEach(n => { db[n] = []; });
    db.orgs.push({ id: ORG, name: 'お試し工務店', address: '', tel: '', email: '', registration_number: '', logo_path: null, seal_path: null,
      show_company_on_report: true, tax_rate: 0.1, estimate_seq: 0, invoice_seq: 0, bank: '', file_limit_bytes: FILE_LIMIT, closed_at: null, created_at: t });
    db.memberships.push({ user_id: USER, org_id: ORG, display_name: 'お試し担当', phone: '', role: 'admin', created_at: t });
    return db;
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && Array.isArray(v.orgs)) {
        TABLES.forEach(n => { if (!Array.isArray(v[n])) v[n] = []; });
        // 役割・上限が無かった頃の保存（お試し版を前から使っている人）: 1人だけなので管理者にする
        v.memberships.forEach(m => { if (!m.role) m.role = 'admin'; });
        v.orgs.forEach(o => { if (o.file_limit_bytes == null) o.file_limit_bytes = FILE_LIMIT; });
        // 前のフェーズ（工事日調整・工事待ち）で保存していたお試しデータは「発注あり」に
        v.estimate_phases.forEach(p => { if (p.phase === 'scheduling' || p.phase === 'waiting') p.phase = 'ordered'; });
        return v;
      }
    } catch (e) { /* 壊れていたら最初から */ }
    return seed();
  }
  let db = load();
  // ファイルは IndexedDB に置く（localStorage は全部で約 5MB。図面や写真は数枚で入らなくなった）。files は読み込んだ写し（テストが見る）
  let files = {};
  const idb = new Promise((res, rej) => {
    const r = indexedDB.open(FKEY, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('f');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const idbTx = (mode, fn) => idb.then(d => new Promise((res, rej) => {
    const t = d.transaction('f', mode), out = fn(t.objectStore('f'));
    t.oncomplete = () => res(out);
    t.onabort = () => rej(t.error);
  }));
  // shortcut: IndexedDB を開けないブラウザでは、ファイルは開いている間だけ残る。困る人が出たら案内を出す
  const filesReady = (async () => {
    const [k, v] = await idbTx('readonly', s => [s.getAllKeys(), s.getAll()]);
    k.result.forEach((key, i) => { files[key] = v.result[i]; });
    // 前の版（localStorage に入れていた頃）のファイルを移す
    let old = null;
    try { old = JSON.parse(localStorage.getItem(FKEY) || 'null'); } catch (e) { /* 壊れていたら捨てる */ }
    if (old && typeof old === 'object') {
      await idbTx('readwrite', s => { Object.keys(old).forEach(key => { if (!files[key]) s.put(old[key], key); }); });
      Object.keys(old).forEach(key => { if (!files[key]) files[key] = old[key]; });
    }
    localStorage.removeItem(FKEY);
  })().catch(() => {});
  const FULL = 'お試し版の保存場所がいっぱいです。写真を減らすか、設定の「お試しデータを最初に戻す」で消してください';
  function persist() { localStorage.setItem(KEY, JSON.stringify(db)); }

  // 列 grant（001_init.sql と同じ）
  const RATE_COLS = ['kind', 'client', 'vendor', 'property', 'description', 'key', 'unit', 'quantity', 'unit_price', 'source', 'date'];
  const GRANT = {
    orgs: { update: ['name', 'address', 'tel', 'email', 'registration_number', 'logo_path', 'seal_path', 'show_company_on_report', 'tax_rate', 'bank'] },
    invoices: {}, // 読むだけ（足す・印は rpc invoice_issue / invoice_mark）
    memberships: { update: ['display_name', 'phone'] },
    clients: { insert: ['name', 'contact', 'email'], update: ['name', 'contact', 'email', 'closing_day', 'invoice_mode'], del: true },
    estimate_phases: { insert: ['series_id', 'phase'], update: ['phase'] }, // 消す口は無い
    cases: { insert: ['name', 'room', 'address', 'client_id', 'client_name', 'client_contact', 'client_email', 'memo', 'survey_at', 'work_start', 'work_end'],
      update: ['name', 'room', 'address', 'client_id', 'client_name', 'client_contact', 'client_email', 'memo', 'survey_at', 'work_start', 'work_end', 'archived_at'], del: true },
    reports: { insert: ['case_id', 'work_type', 'data', 'photos'], update: ['work_type', 'data', 'photos'], del: true },
    estimates: { insert: ['case_id', 'series_id', 'version', 'number', 'kind', 'data'], update: ['data', 'status', 'number'], del: true },
    notices: { insert: ['case_id', 'data'], update: ['data'], del: true },
    drawings: { insert: ['case_id', 'image_path', 'marks'], update: ['image_path', 'marks'], del: true },
    doc_shares: { insert: ['case_id', 'doc_type', 'doc_id', 'via'], update: ['undone_at'] },
    estimate_templates: { insert: ['owner_user_id', 'name', 'lines', 'sort'], update: ['name', 'lines', 'sort'], del: true },
    estimate_presets: { insert: ['owner_user_id', 'text', 'unit', 'price', 'sort'], update: ['text', 'unit', 'price', 'sort'], del: true },
    rate_master: { insert: RATE_COLS, update: RATE_COLS, del: true },
    daily_reports: { insert: ['date', 'author', 'sites', 'notes'], update: ['date', 'author', 'sites', 'notes'], del: true },
    teikei_rates: { insert: ['data'], update: ['data'], del: true },
    files: {}, // 読むだけ
    audit_log: {} // 読むだけ（管理者）
  };
  // 管理者だけ（policy）。insert は RLS で断る（permission denied）、update/delete は 0 件になる
  const ADMIN_ONLY = { orgs: ['update'], teikei_rates: ['insert', 'update', 'delete'], cases: ['delete'] };
  const DEFAULTS = {
    clients: { contact: '', email: '', closing_day: null, invoice_mode: 'monthly' },
    cases: { room: '', address: '', client_id: null, client_name: '', client_contact: '', client_email: '', memo: '', survey_at: null, work_start: null, work_end: null, archived_at: null },
    reports: { work_type: 'investigate', data: {}, photos: [] },
    estimates: { version: 1, number: '', status: 'draft', kind: 'normal', data: {} },
    notices: { data: {} },
    drawings: { image_path: null, marks: [] },
    doc_shares: { undone_at: null },
    estimate_templates: { owner_user_id: null, lines: [], sort: 0 },
    estimate_presets: { owner_user_id: null, unit: '', price: 0, sort: 0 },
    rate_master: { client: '', vendor: '', property: '', unit: '', quantity: 1, source: '', date: null },
    daily_reports: { author: '', sites: [], notes: '' },
    teikei_rates: { data: {} }
  };
  const HAS_CREATED_BY = ['cases', 'reports', 'estimates', 'notices', 'drawings', 'daily_reports', 'files'];
  const HAS_UPDATED_AT = ['cases', 'reports', 'estimates', 'notices', 'drawings', 'daily_reports', 'teikei_rates', 'estimate_phases'];
  const CASE_CHILD = ['reports', 'estimates', 'notices', 'drawings', 'doc_shares'];
  const err = (message, code) => ({ message, code: code || 'P0001' });
  const denied = () => err('permission denied', '42501');
  const me = () => (db.session ? db.session.user.id : null);
  const myMem = () => db.memberships.find(x => x.user_id === me()) || null;
  const orgOpen = m => db.orgs.some(o => o.id === m.org_id && !o.closed_at);
  const myOrg = () => { const m = myMem(); return m && orgOpen(m) ? m.org_id : null; }; // 本物の my_org_id と同じく利用を終えた会社は返さない
  const isAdmin = () => { const m = myMem(); return !!m && m.role === 'admin'; };
  const adminOnly = (t, op) => (ADMIN_ONLY[t] || []).includes(op) && !isAdmin();
  const visible = (t, r) => (t === 'orgs' ? r.id === myOrg() : r.org_id === myOrg())
    && (!['estimate_templates', 'estimate_presets'].includes(t) || r.owner_user_id == null || r.owner_user_id === me())
    && (t !== 'audit_log' || isAdmin());
  function audit(org, action, detail) {
    const n = db.audit_log.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    db.audit_log.push({ id: n, org_id: org, user_id: me(), action, detail: detail || {}, at: now() });
  }

  // 本物の phases_advance と同じ: 案件に工事日 → 発注あり／工事の報告書を共有かダウンロード → 請求中。戻さない・失注と入金は動かさない
  function advance(caseId) {
    const c = db.cases.find(x => x.id === caseId);
    if (!c) return;
    const done = db.doc_shares.some(d => d.case_id === c.id && d.org_id === c.org_id && d.doc_type === 'report' && !d.undone_at
      && db.reports.some(r => r.id === d.doc_id && ['work', 'repair', 'restore'].includes(r.work_type)));
    const target = done ? 'billing' : c.work_start ? 'ordered' : null;
    if (!target) return;
    [...new Set(db.estimates.filter(e => e.case_id === c.id && e.org_id === c.org_id).map(e => e.series_id))].forEach(sid => {
      const p = db.estimate_phases.find(x => x.org_id === c.org_id && x.series_id === sid);
      if (!p) db.estimate_phases.push({ id: uuid(), org_id: c.org_id, series_id: sid, phase: target, updated_at: now() });
      else if (p.phase === 'proposal' || (p.phase === 'ordered' && target === 'billing')) { p.phase = target; p.updated_at = now(); }
    });
  }
  function check(t, r) {
    const len = (k, n) => r[k] != null && String(r[k]).length > n;
    if (t === 'cases' || t === 'clients') {
      if (!String(r.name || '').trim()) return err('null value in column "name" violates not-null constraint', '23514');
      if (len('name', 100)) return err('name が長すぎます', '23514');
    }
    if (t === 'cases' && r.work_start && r.work_end && r.work_end < r.work_start) return err('new row for relation "cases" violates check constraint', '23514');
    if (t === 'cases' && r.client_id && !db.clients.some(c => c.id === r.client_id && c.org_id === r.org_id)) return err('foreign key violation', '23503');
    if (t === 'clients' && db.clients.some(c => c.id !== r.id && c.org_id === r.org_id && c.name === r.name)) return err('duplicate key value violates unique constraint', '23505');
    if (t === 'estimates' && db.estimates.some(x => x.id !== r.id && x.org_id === r.org_id && x.series_id === r.series_id && x.version === r.version)) return err('duplicate key value violates unique constraint', '23505');
    if (t === 'clients' && ((r.closing_day != null && !(Number.isInteger(r.closing_day) && r.closing_day >= 1 && r.closing_day <= 31)) || (r.invoice_mode !== undefined && !['monthly', 'each'].includes(r.invoice_mode)))) return err('check constraint', '23514');
    if (t === 'estimate_phases' && !['proposal', 'lost', 'ordered', 'billing', 'paid'].includes(r.phase)) return err('check constraint', '23514');
    if (t === 'estimate_phases' && (!r.series_id || db.estimate_phases.some(x => x.id !== r.id && x.org_id === r.org_id && x.series_id === r.series_id))) return err('duplicate key value violates unique constraint', '23505');
    if (t === 'estimates' && r.kind !== undefined && !['normal', 'teikei'].includes(r.kind)) return err('check constraint', '23514');
    if (t === 'teikei_rates' && db.teikei_rates.some(x => x.id !== r.id && x.org_id === r.org_id)) return err('duplicate key value violates unique constraint', '23505');
    if (t === 'teikei_rates' && (!r.data || typeof r.data !== 'object' || Array.isArray(r.data))) return err('check constraint', '23514');
    if (CASE_CHILD.includes(t) && !(t === 'doc_shares' && r.case_id == null) && !db.cases.some(c => c.id === r.case_id && c.org_id === r.org_id)) return err('foreign key violation', '23503');
    if (t === 'reports' && !['investigate', 'work', 'other', 'repair', 'restore'].includes(r.work_type)) return err('check constraint', '23514');
    if (t === 'doc_shares' && (!['report', 'estimate', 'notice', 'drawing', 'daily', 'invoice'].includes(r.doc_type) || !['share', 'mail', 'line', 'download'].includes(r.via))) return err('check constraint', '23514');
    if (t === 'daily_reports' && (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) || len('author', 60) || len('notes', 4000) || !Array.isArray(r.sites))) return err('check constraint', '23514');
    if (t === 'rate_master' && (!['cost', 'sell'].includes(r.kind) || !String(r.description || '').trim() || !r.key || !(Number(r.unit_price) > 0))) return err('check constraint', '23514');
    if (t === 'files' && (!['photo', 'drawing', 'logo', 'seal'].includes(r.kind) || !(Number.isInteger(r.bytes) && r.bytes >= 0) || !r.path || len('path', 300) || String(r.path).split('/')[0] !== r.org_id)) return err('check constraint', '23514');
    if (t === 'files' && db.files.some(x => x.id !== r.id && x.path === r.path)) return err('duplicate key value violates unique constraint', '23505');
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
    contains(c, v) { // jsonb の @>（オブジェクトは鍵ごと・配列は要素を全部含む）
      const has = (x, y) => (Array.isArray(y) ? Array.isArray(x) && y.every(e => x.some(f => has(f, e))) : y && typeof y === 'object' ? !!x && typeof x === 'object' && Object.keys(y).every(k => has(x[k], y[k])) : x === y);
      this.filters.push(r => has(r[c], v));
      return this;
    }
    order(c, o) { this.orders.push([c, !o || o.ascending !== false]); return this; }
    limit(n) { this.lim = n; return this; }
    range(a, b) { this.off = a; this.lim = b - a + 1; return this; } // 本物と同じく a〜b 件目（0 から）
    single() { this.one = 'single'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    then(ok, ng) { return new Promise(r => setTimeout(r, 5)).then(() => this.run()).then(ok, ng); }
    run() {
      const t = this.t;
      if (!TABLES.includes(t)) return { data: null, error: err('relation "' + t + '" does not exist', '42P01') };
      if (!me() || (!myOrg() && this.op !== 'select')) return { data: null, error: denied() }; // 所属の無い人の select は RLS で 0 件（本物と同じ）
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
        if (this.off) rows = rows.slice(this.off);
        if (this.lim != null) rows = rows.slice(0, this.lim);
        return { data: rows };
      }
      if (this.op === 'insert') {
        if (!g.insert) return { error: denied() };
        if (adminOnly(t, 'insert')) return { error: err('new row violates row-level security policy for table "' + t + '"', '42501') };
        const list = Array.isArray(this.rows) ? this.rows : [this.rows];
        const made = [];
        for (const src of list) {
          if (Object.keys(src).some(k => !g.insert.includes(k))) return { error: denied() };
          if (t === 'estimate_phases' && ['billing', 'paid'].includes(src.phase) && !isAdmin()) return { error: err('new row violates row-level security policy for table "estimate_phases"', '42501') }; // 「請求」「入金」は管理者だけ
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
          if (t === 'cases') advance(r.id);
          if (t === 'estimates' || (t === 'doc_shares' && r.doc_type === 'report' && r.case_id)) advance(r.case_id);
          if (t === 'teikei_rates') audit(r.org_id, 'rates_saved');
        }
        return { data: made };
      }
      if (this.op === 'update') {
        if (!g.update || Object.keys(this.patch).some(k => !g.update.includes(k))) return { error: denied() };
        let rows = adminOnly(t, 'update') ? [] : this.match();
        if (t === 'memberships') rows = rows.filter(r => r.user_id === me());
        if (t === 'estimates') rows = rows.filter(r => r.status === 'draft');
        if (t === 'estimate_phases' && !isAdmin()) { // 一般の人は「請求」「入金」の行を動かせない・「請求」「入金」にできない
          rows = rows.filter(r => !['billing', 'paid'].includes(r.phase));
          if (rows.length && ['billing', 'paid'].includes(this.patch.phase)) return { error: err('new row violates row-level security policy for table "estimate_phases"', '42501') };
        }
        if (t === 'estimates' && 'status' in this.patch && this.patch.status !== 'draft' && rows.length) return { error: err('new row violates row-level security policy for table "estimates"', '42501') }; // 出すのは estimate_issue だけ
        // 振込先を変えられるのは2段階認証を済ませたログイン（aal2）だけ（本物は trigger orgs_bank_guard）
        if (t === 'orgs' && 'bank' in this.patch && rows.some(r => (r.bank || '') !== this.patch.bank)) {
          if ((db.session || {}).aal !== 'aal2') return { error: err('two-factor sign-in is required to change the bank account', '42501') };
          const u0 = db.users.find(u => u.id === me()) || {};
          if (rows.some(r => r.bank) && !(u0.mfa === 'verified' && Date.now() - Date.parse(u0.mfa_at) >= 24 * 3600 * 1000)) return { error: err('the two-factor setup must be at least 24 hours old to change an existing bank account', '42501') };
        }
        for (const r of rows) {
          const was = copy(r);
          Object.assign(r, copy(this.patch));
          if (HAS_UPDATED_AT.includes(t)) r.updated_at = now();
          const e = check(t, r);
          if (e) return { error: e };
          if (t === 'cases' && was.work_start !== r.work_start) advance(r.id); // 工事日が変わった（本物は update of work_start の trigger）
          if (t === 'teikei_rates') audit(r.org_id, 'rates_saved');
          if (t === 'orgs') {
            const cols = Object.keys(r).filter(k => k !== 'estimate_seq' && k !== 'invoice_seq' && JSON.stringify(r[k]) !== JSON.stringify(was[k]));
            const changes = {}; // 会社名・住所・登録番号は前と後の値も（本物の audit_trg と同じ。変わらなかったものは入れない）
            ['name', 'address', 'registration_number', 'bank'].forEach(k => { if (cols.includes(k)) changes[k] = { old: was[k], new: r[k] }; });
            if (cols.length) audit(r.id, 'org_updated', Object.keys(changes).length ? { cols, changes } : { cols });
          }
        }
        return { data: rows };
      }
      if (!g.del) return { error: denied() };
      let rows = adminOnly(t, 'delete') ? [] : this.match();
      if (t === 'estimates') rows = rows.filter(r => r.status === 'draft');
      rows.forEach(r => {
        if (t === 'teikei_rates') audit(r.org_id, 'rates_reset');
        if (t === 'cases') audit(r.org_id, 'case_deleted', { name: r.name, room: r.room });
      });
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
  // 2段階認証（本物は Supabase の MFA・TOTP）。偽物は 6 桁の数字なら何でも通す（お試し版では認証アプリを使えないため）。通るとこのログインが aal2 になる
  const mfaErr = m => Object.assign(new Error(m), { status: 422, code: 'mfa_verification_failed' });
  auth.mfa = {
    async listFactors() { await wait(); const f = db.users[0].mfa ? [{ id: 'fake-totp', factor_type: 'totp', status: db.users[0].mfa, created_at: db.users[0].mfa_at }] : []; return { data: { all: f, totp: f.filter(x => x.status === 'verified') }, error: null }; },
    async enroll() { await wait(); db.users[0].mfa = 'unverified'; db.users[0].mfa_at = now(); persist(); return { data: { id: 'fake-totp', type: 'totp', totp: { qr_code: '', secret: '（お試し版では、どの6桁でも通ります）', uri: '' } }, error: null }; },
    async unenroll() { await wait(); if (db.users[0].mfa !== 'verified' || (db.session || {}).aal === 'aal2') delete db.users[0].mfa; persist(); return { data: {}, error: null }; },
    async challengeAndVerify(o) {
      await wait();
      if (!db.session || !db.users[0].mfa || !/^\d{6}$/.test(String((o && o.code) || ''))) return { data: null, error: mfaErr('Invalid TOTP code entered') };
      db.users[0].mfa = 'verified';
      db.session.aal = 'aal2';
      persist();
      return { data: {}, error: null };
    },
    async getAuthenticatorAssuranceLevel() { await wait(); const cur = (db.session || {}).aal || 'aal1'; return { data: { currentLevel: db.session ? cur : null, nextLevel: db.users[0].mfa === 'verified' ? 'aal2' : 'aal1' }, error: null }; }
  };
  function signIn(email) {
    const u = db.users[0];
    db.session = { access_token: 'fake', aal: 'aal1', user: { id: u.id, email: email || u.email } };
    u.last_sign_in_at = now();
    persist();
    emit('SIGNED_IN');
    return { data: { session: sessionObj(), user: copy(db.session.user) }, error: null };
  }

  /* ===== ファイル置き場（本物は R2。tests/e2e/fake-files.js から呼ぶ） ===== */
  const toDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('ファイルを読めませんでした')); r.readAsDataURL(b); });
  const own = p => myOrg() && String(p).split('/')[0] === myOrg();
  const store = {
    async put(path, body) {
      await wait();
      if (!own(path)) throw new Error('この会社のファイルではありません');
      const url = await toDataUrl(body);
      await filesReady;
      try { await idbTx('readwrite', s => { s.put(url, path); }); }
      catch (e) { if (e && e.name === 'QuotaExceededError') throw new Error(FULL); /* 開けない時は開いている間だけ持つ */ }
      files[path] = url;
    },
    async get(path) {
      await wait();
      await filesReady;
      if (!own(path) || !files[path]) throw new Error('ファイルが見つかりません');
      return files[path];
    },
    async del(path) {
      await wait();
      await filesReady;
      if (!own(path)) return;
      delete files[path];
      try { await idbTx('readwrite', s => { s.delete(path); }); } catch (e) { /* 減らす方。失敗しても画面は止めない */ }
    }
  };

  // 台帳（本物は Worker が強い鍵で file_reserve / file_release で書く。偽物ではここから直接。呼ぶのは tests/e2e/fake-files.js）
  const ledger = {
    put(path, bytes, kind) {
      if (!myOrg()) throw new Error('この会社のファイルではありません');
      const r = { id: uuid(), org_id: myOrg(), path, bytes, kind, created_by: me(), created_at: now() };
      const e = check('files', r);
      if (e) throw Object.assign(new Error(e.message), { code: e.code });
      db.files.push(r);
      try { persist(); } catch (x) { db.files.pop(); throw new Error(FULL); }
    },
    del(path) {
      const n = db.files.length;
      db.files = db.files.filter(x => !(x.path === path && x.org_id === myOrg()));
      if (db.files.length !== n) persist();
    }
  };

  // Worker の招待・外す（本物は worker/src/index.js の POST /invite・DELETE /members/{id}。文言も同じ）。呼ぶのは tests/e2e/fake-files.js の Files.api
  const wErr = (m, status) => Object.assign(new Error(m), status ? { status } : {});
  const worker = {
    invite(body) {
      if (!me() || !myOrg()) throw wErr('ログインが切れました。もう一度ログインしてください');
      if (!isAdmin()) throw wErr('管理者だけができます');
      const email = String((body && body.email) || '').trim().toLowerCase(), role = body && body.role;
      if (role === 'admin' && (db.session || {}).aal !== 'aal2') throw wErr('管理者として招待するには2段階認証が要ります', 403); // 本物の Worker と同じ
      if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !['admin', 'member'].includes(role)) throw wErr('メールアドレスか権限が正しくありません');
      // 本物の admin_invite と同じ: 会社ごとに1時間 30 人まで（記録 member_invited で数える）
      const hour = Date.now() - 3600 * 1000;
      if (db.audit_log.filter(x => x.org_id === myOrg() && x.action === 'member_invited' && Date.parse(x.at) > hour).length >= 30) throw wErr('招待が多すぎます。1時間ほど待ってからもう一度お試しください', 'too_many');
      let u = db.users.find(x => String(x.email).toLowerCase() === email);
      const m = u && db.memberships.find(x => x.user_id === u.id);
      if (m) throw m.org_id === myOrg() ? wErr('もうメンバーです', 'member_exists') : wErr('このメールアドレスは別の会社で使われています', 'other_org');
      const status = u && u.email_confirmed_at ? 'added' : 'invite'; // 本物の admin_invite と同じ: メールを確かめていない人には招待を送り直す
      if (!u) { u = { id: uuid(), email, invited_at: now() }; db.users.push(u); } // 本物は招待メールで auth.users ができ、handle_new_user が所属を作る（ログインするまで招待中）
      db.memberships.push({ user_id: u.id, org_id: myOrg(), display_name: email.split('@')[0].slice(0, 60), phone: '', role, created_at: now() });
      audit(myOrg(), 'member_invited', { email, role }); // 本物は admin_invite の中で書く
      persist();
      return { status };
    },
    // ロゴ・社印（{会社id}/org/…）を置く・消すのは管理者だけ（本物は Worker の PUT・DELETE /file。今の所属で決める）。action を渡すと記録（置けた・消せた後）
    orgFile(path, action) {
      if (!me() || !myOrg()) throw wErr('ログインが切れました。もう一度ログインしてください');
      if (!isAdmin()) throw wErr('管理者だけができます');
      if (action) { audit(myOrg(), action, { path }); persist(); }
    },
    remove(id) {
      if (!me() || !myOrg()) throw wErr('ログインが切れました。もう一度ログインしてください');
      if (!isAdmin()) throw wErr('管理者だけができます');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) throw wErr('メンバーの指定が正しくありません');
      if (id === me()) throw wErr('自分は外せません');
      const m = db.memberships.find(x => x.user_id === id && x.org_id === myOrg());
      if (!m) throw wErr('この会社のメンバーではありません');
      db.users = db.users.filter(x => x.id !== id); // 本物は auth のユーザーごと消す（所属は cascade）
      db.memberships = db.memberships.filter(x => x !== m);
      audit(myOrg(), 'member_removed', { name: m.display_name });
      persist();
      return { ok: true };
    }
  };

  async function rpc(fn, args) {
    await wait();
    if (fn === 'my_status' && me()) { const m = myMem(); return { data: !m ? 'none' : orgOpen(m) ? 'ok' : 'closed', error: null }; }
    if (!me() || !myOrg()) return { data: null, error: denied() };
    if (fn === 'my_org_id') return { data: myOrg(), error: null };
    if (fn === 'is_admin') return { data: isAdmin(), error: null };
    if (fn === 'org_members') {
      return { data: db.memberships.filter(m => m.org_id === myOrg()).map(m => {
        const u = db.users.find(x => x.id === m.user_id);
        return { user_id: m.user_id, display_name: m.display_name, phone: m.phone, role: m.role, email: isAdmin() && u ? u.email : null,
          pending: !(u && u.last_sign_in_at), created_at: m.created_at };
      }), error: null };
    }
    if (fn === 'set_member_role') { // 管理者が・同じ会社の・自分以外に・admin/member だけ
      const p = args || {};
      const m = db.memberships.find(x => x.user_id === p.p_user && x.org_id === myOrg());
      if (!isAdmin() || !m || p.p_user === me() || !['admin', 'member'].includes(p.p_role)) return { data: null, error: denied() };
      const prev = m.role;
      if (p.p_role === 'admin' && prev !== 'admin' && (db.session || {}).aal !== 'aal2') return { data: null, error: err('two-factor sign-in is required to make an admin', '42501') };
      m.role = p.p_role;
      audit(myOrg(), 'role_changed', { target: p.p_user, from: prev, to: p.p_role });
      persist();
      return { data: null, error: null };
    }
    if (fn === 'set_report_items') { // 会社の人なら誰でも（本物は security definer の関数。orgs の update は管理者だけ）
      const o = db.orgs.find(x => x.id === myOrg()), v = args && args.p_items;
      if (!o || !v || typeof v !== 'object' || Array.isArray(v)) return { data: null, error: denied() };
      if (JSON.stringify(v).length > 20000) return { data: null, error: err('check constraint', '23514') };
      const before = JSON.stringify(db);
      o.report_items = JSON.parse(JSON.stringify(v));
      audit(o.id, 'org_updated', { cols: ['report_items'] });
      try { persist(); } catch (e) { db = JSON.parse(before); return { data: null, error: err(FULL) }; }
      return { data: o.report_items, error: null };
    }
    if (fn === 'org_file_bytes') return { data: db.files.filter(x => x.org_id === myOrg()).reduce((n, x) => n + x.bytes, 0), error: null };
    if (fn === 'estimate_next_number') {
      const o = db.orgs.find(x => x.id === myOrg());
      o.estimate_seq++;
      persist();
      return { data: String(o.estimate_seq).padStart(4, '0'), error: null };
    }
    // 請求書（本物は invoice_issue / invoice_mark。番号を進めて足す・明細の見積のフェーズをまとめて変える）
    const phasesSet = (series, phase) => series.forEach(sid => {
      const p = db.estimate_phases.find(x => x.org_id === myOrg() && x.series_id === sid);
      if (p) { p.phase = phase; p.updated_at = now(); } else db.estimate_phases.push({ id: uuid(), org_id: myOrg(), series_id: sid, phase, updated_at: now() });
    });
    if (fn === 'invoice_issue') { // 本物と同じ: 管理者だけ・画面から来た発行者／宛先／税／合計は使わない・出した見積だけ・二重請求は断る
      const o = db.orgs.find(x => x.id === myOrg()), d = args && args.p_data, name = String((args && args.p_name) || '');
      if (!o || !isAdmin()) return { data: null, error: denied() };
      const bad = m => ({ data: null, error: err(m, '22023') });
      const YMD = /^\d{4}-\d{2}-\d{2}$/, num = v => typeof v === 'number' && isFinite(v);
      if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.lines) || d.lines.length < 1 || d.lines.length > 500) return bad('bad invoice');
      if (!YMD.test(String(d.issue || '')) || (d.due && !YMD.test(String(d.due))) || String(d.period || '').length > 40) return bad('bad invoice header');
      if (d.lines.some(l => !l || typeof l !== 'object' || !num(l.net) || !num(l.rate) || !num(l.post) || l.rate < 0 || l.rate > 1 || !String(l.title || '') || String(l.title).length > 120
        || String(l.number || '').length > 40 || (l.work && !YMD.test(String(l.work))) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(l.series_id || '')))) return bad('bad invoice line');
      const sids = d.lines.map(l => l.series_id);
      if (new Set(sids).size !== sids.length) return bad('same estimate twice');
      if (sids.some(v => !db.estimates.some(e => e.org_id === o.id && e.series_id === v && e.status === 'issued'))) return bad('estimate is not issued');
      if (db.invoices.some(i => i.org_id === o.id && !i.void_at && i.data.lines.some(l => sids.includes(l.series_id)))) return bad('already invoiced');
      if (!name.trim() || name.length > 100) return { data: null, error: err('check constraint', '23514') };
      const rates = [...new Set(d.lines.map(l => l.rate))].sort((x, y) => y - x);
      const taxes = rates.map(rate => { const net = d.lines.filter(l => l.rate === rate).reduce((n, l) => n + l.net, 0); return { rate, net, tax: Math.round(net * rate) }; });
      const post = d.lines.reduce((n, l) => n + l.post, 0), total = taxes.reduce((n, t) => n + t.net + t.tax, 0) + post;
      o.invoice_seq = (o.invoice_seq || 0) + 1;
      const issuer = { name: o.name || '', registration_number: o.registration_number || '', address: o.address || '', tel: o.tel || '', bank: o.bank || '' };
      const r = { id: uuid(), org_id: o.id, number: 'INV-' + String(o.invoice_seq).padStart(5, '0'), client_id: args.p_client || null, client_name: name,
        data: { issue: d.issue, due: d.due || '', period: d.period || '', to: name.trim(), lines: copy(d.lines), taxes, post, total, issuer }, paid_at: null, void_at: null, created_by: me(), created_at: now(), updated_at: now() };
      db.invoices.push(r);
      phasesSet(sids, 'billing');
      audit(o.id, 'invoice_issued', { number: r.number, client: r.client_name, total });
      try { persist(); } catch (e) { return { data: null, error: err(FULL) }; }
      return { data: copy(r), error: null };
    }
    if (fn === 'invoice_mark') { // 管理者だけ。入金日は最初に付けた日を残す（取り消しても消さない。外したときだけ消す）
      const r = db.invoices.find(x => x.id === (args && args.p_id) && x.org_id === myOrg()), what = args && args.p_what;
      if (!r || !isAdmin()) return { data: null, error: denied() };
      if (r.void_at || !['paid', 'unpaid', 'void'].includes(what)) return { data: null, error: err('cannot mark', '22023') };
      r.paid_at = what === 'paid' ? (r.paid_at || now()) : what === 'unpaid' ? null : r.paid_at;
      r.void_at = what === 'void' ? now() : null;
      r.updated_at = now();
      phasesSet(r.data.lines.map(l => l.series_id), what === 'paid' ? 'paid' : 'billing'); // 外す・取り消す → 請求中（取り消した分はもう一度請求書を作れる）
      audit(r.org_id, 'invoice_' + what, { number: r.number, client: r.client_name });
      persist();
      return { data: copy(r), error: null };
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
    store, ledger, worker,
    save() { persist(); }, // テストが db を直接書き換えたあと（役割を替える・所属を消す）に残す
    signInDemo() { return signIn(''); },
    // 消し終わるまで待てる（お試し版はこのあと読み込み直す）
    reset() { db = seed(); files = {}; localStorage.removeItem(KEY); localStorage.removeItem(FKEY); return idbTx('readwrite', s => { s.clear(); }).catch(() => {}); }
  };
  window.__fake = fake;
  window.sb = { from: t => new Query(t), auth, rpc };
})();
