// tests/e2e/fake-files.js — js/files.js（本物は Cloudflare R2 の Worker）の偽物。E2E とお試し版（dist-demo）で読む。
// ファイルは fake-sb.js の置き場（localStorage の data URL。window.__fake.store）に、台帳は偽の files 表に入れる（本物では Worker が入れる・消す）。呼び方と上限は本物と同じ
window.Files = (() => {
  const LIMIT = 9 * 1024 ** 3, WARN = 8 * 1024 ** 3;
  const store = () => window.__fake.store;
  async function usage() {
    const { data, error } = await sb.rpc('org_file_bytes');
    if (error) throw error;
    return Number(data) || 0;
  }
  async function upload(path, blob, contentType, kind) {
    if ((await usage()) + blob.size > LIMIT) throw new Error('写真・図面の置き場がいっぱいです（9GB）。相談してください');
    await store().put(path, blob);
    const { error } = await sb.from('files').insert({ path, bytes: blob.size, kind });
    if (error) { await store().del(path); throw error; }
    return { path, bytes: blob.size };
  }
  async function remove(path) {
    if (!path) return;
    await store().del(path);
    await sb.from('files').delete().eq('path', path);
  }
  const url = path => store().get(path);
  return { upload, remove, url, usage, LIMIT, WARN };
})();
