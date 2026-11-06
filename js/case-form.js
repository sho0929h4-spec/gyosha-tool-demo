// js/case-form.js — 03 案件の登録・編集。元請は clients から候補（datalist）・新しい名前は clients に足す
const CaseForm = (() => {
  let cur = null, clients = [], wired = false, saving = false;
  const F = { name: 'cf-name', room: 'cf-room', address: 'cf-addr', client_name: 'cf-client', client_contact: 'cf-contact', client_email: 'cf-mail', memo: 'cf-memo' };
  const backTo = () => (cur ? '#case/' + cur.id : '#cases');

  function wire() {
    if (wired) return;
    wired = true;
    $('cf-back').addEventListener('click', () => { location.hash = backTo(); });
    $('cf-cancel').addEventListener('click', () => { location.hash = backTo(); });
    $('cf-save').addEventListener('click', save);
    $('cf-form').addEventListener('submit', ev => { ev.preventDefault(); save(); });
    $('cf-form').addEventListener('input', () => { $('cf-msg').textContent = ''; });
    // 前に使った元請を選んだら、担当者・メールが空のときだけ埋める
    $('cf-client').addEventListener('change', () => {
      const c = clients.find(x => x.name === $('cf-client').value.trim());
      if (!c) return;
      if (!$('cf-contact').value.trim()) $('cf-contact').value = c.contact || '';
      if (!$('cf-mail').value.trim()) $('cf-mail').value = c.email || '';
    });
  }
  async function show(id) {
    wire();
    cur = null;
    $('cf-msg').textContent = '';
    Object.values(F).forEach(k => { $(k).value = ''; });
    $('cf-title').textContent = id ? '案件を編集' : '案件を登録';
    $('cf-save').textContent = id ? '保存する' : '登録する';
    showScreen('caseform');
    try {
      const [row, cl] = await Promise.all([id ? CasesApi.get(id) : null, CasesApi.clients()]);
      if (id && !row) { toast('案件が見つかりませんでした'); location.replace('#cases'); return; }
      cur = row;
      clients = cl;
      $('cf-clients').replaceChildren(...clients.map(c => { const o = document.createElement('option'); o.value = c.name; return o; }));
      if (row) Object.entries(F).forEach(([k, el]) => { $(el).value = row[k] || ''; });
    } catch (e) {
      $('cf-msg').textContent = '読み込めませんでした: ' + errText(e);
    }
    if (!id) $('cf-name').focus();
  }
  async function save() {
    if (saving) return;
    const row = {};
    Object.entries(F).forEach(([k, el]) => { row[k] = $(el).value.trim(); });
    if (!row.name) { $('cf-msg').textContent = '物件名を入れてください'; $('cf-name').focus(); return; }
    if (row.client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.client_email)) { $('cf-msg').textContent = '送り先メールの形が正しくありません'; $('cf-mail').focus(); return; }
    saving = true;
    $('cf-save').disabled = true;
    $('cf-msg').textContent = '';
    try {
      row.client_id = await CasesApi.ensureClient(row.client_name, row.client_contact, row.client_email);
      const saved = cur ? await CasesApi.update(cur.id, row) : await CasesApi.create(row);
      toast(cur ? '保存しました' : '登録しました');
      location.hash = '#case/' + saved.id;
    } catch (e) {
      $('cf-msg').textContent = (cur ? '保存' : '登録') + 'できませんでした: ' + errText(e);
    } finally {
      saving = false;
      $('cf-save').disabled = false;
    }
  }
  return { show };
})();
