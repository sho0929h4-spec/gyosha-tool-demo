// js/cases-ui.js — 02 案件一覧: 検索（物件名・号室）・新しい順・書類の数の札・＋案件を登録
const CasesUi = (() => {
  let all = [], counts = {}, wired = false;
  const DOC_TAGS = [['report', '報告書']];
  function render() {
    const host = $('cases-list');
    const q = $('cases-q').value;
    const list = all.filter(c => CaseLogic.matches(c, q));
    host.replaceChildren();
    if (!all.length) { host.appendChild(mk('div', 'empty', 'まだ案件がありません。下の「＋ 案件を登録」から登録してください')); return; }
    if (!list.length) { host.appendChild(mk('div', 'empty', '見つかりませんでした')); return; }
    list.forEach(c => {
      const a = mk('a', 'item');
      a.href = '#case/' + c.id;
      a.appendChild(mk('div', 'item-t', CaseLogic.placeName(c)));
      a.appendChild(mk('div', 'item-s', (c.client_name || '（元請なし）') + ' ・ ' + CaseLogic.md(c.created_at) + ' 登録'));
      const n = counts[c.id] || {};
      const tags = mk('div', 'tags');
      DOC_TAGS.forEach(([k, label]) => { if (n[k]) tags.appendChild(mk('span', 'tag', label + ' ' + n[k])); });
      if (tags.children.length) a.appendChild(tags);
      host.appendChild(a);
    });
    host.appendChild(mk('div', 'empty', '新しい順'));
  }
  async function show() {
    if (!wired) { wired = true; $('cases-q').addEventListener('input', render); }
    showScreen('cases');
    $('cases-msg').textContent = '';
    try {
      [all, counts] = await Promise.all([CasesApi.list(), CasesApi.docCounts()]);
    } catch (e) {
      $('cases-msg').textContent = '案件を読み込めませんでした: ' + errText(e);
    }
    render();
  }
  return { show };
})();
