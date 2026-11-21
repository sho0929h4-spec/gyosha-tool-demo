// tests/e2e/fake-files.js — js/files.js（本物は Cloudflare R2 の Worker）の偽物。E2E とお試し版（dist-demo）で読む。
// ファイルは fake-sb.js の置き場（localStorage の data URL。window.__fake.store）に、台帳は window.__fake.ledger に入れる（本物では Worker が強い鍵で入れる・消す。利用者は files に書けない）。呼び方と上限は本物と同じ
// api(method, path, json): 本物は Worker の JSON の口。偽物は POST /invite・DELETE /members/{id} を window.__fake.worker で真似る
window.Files = (() => {
  const limit = () => (ctx && ctx.org && ctx.org.file_limit_bytes != null ? Number(ctx.org.file_limit_bytes) : 1024 ** 3);
  const store = () => window.__fake.store;
  async function usage() {
    const { data, error } = await sb.rpc('org_file_bytes');
    if (error) throw error;
    return Number(data) || 0;
  }
  const orgFile = path => String(path).split('/')[1] === 'org'; // ロゴ・社印。置く・消すは管理者だけ（本物の Worker と同じ）
  async function upload(path, blob, contentType, kind) {
    if (orgFile(path)) window.__fake.worker.orgFile(path);
    if ((await usage()) + blob.size > limit()) throw new Error('この会社の写真・図面の置き場がいっぱいです。管理者に相談してください');
    await store().put(path, blob);
    try { window.__fake.ledger.put(path, blob.size, kind); } catch (e) { await store().del(path); throw e; }
    if (orgFile(path)) window.__fake.worker.orgFile(path, 'org_file_saved');
    return { path, bytes: blob.size };
  }
  async function remove(path) {
    if (!path) return;
    if (orgFile(path)) { try { window.__fake.worker.orgFile(path); } catch (e) { return; } } // 本物の remove も断られたら黙る（画面を止めない）
    await store().del(path);
    window.__fake.ledger.del(path);
    if (orgFile(path)) window.__fake.worker.orgFile(path, 'org_file_deleted');
  }
  const url = path => store().get(path);
  async function api(method, path, json) {
    await new Promise(r => setTimeout(r, 5));
    if (method === 'POST' && path === '/invite') return window.__fake.worker.invite(json);
    const m = method === 'DELETE' && /^\/members\/([^/]+)$/.exec(path);
    if (m) return window.__fake.worker.remove(decodeURIComponent(m[1]));
    throw new Error('見つかりません');
  }
  return { upload, remove, url, usage, api, get LIMIT() { return limit(); }, get WARN() { return limit() * 8 / 9; } };
})();
