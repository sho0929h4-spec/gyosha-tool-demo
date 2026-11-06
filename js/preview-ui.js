// js/preview-ui.js — 12 プレビューと共有（共通）。#doc/{type}/{id}
//   PDF を端末の中で作り（進み: 準備／描画／保存）、作ったときのページの画像を <canvas> に出す（pdf.js は使わない）。
//   編集に戻る／LINEで共有／メールで共有／PDFをダウンロード／送付の記録（送付済み（日時・手段）・送っていないに戻す）
const PreviewUi = (() => {
  let st = null; // { type, row, caseRow, label, blob, fname }
  const cache = new Map(); // 書類の id + updated_at → { blob, pages }（同じ内容なら作り直さない）
  let wired = false;

  function drawPages(pages) {
    const host = $('dv-pages');
    host.replaceChildren();
    pages.forEach((src, i) => {
      const c = document.createElement('canvas');
      c.className = 'dv-page';
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', (i + 1) + 'ページ目');
      host.appendChild(c);
      const img = new Image();
      img.onload = () => { c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); };
      img.src = src;
    });
  }
  const busy = on => ['dv-line', 'dv-mail', 'dv-dl'].forEach(id => { $(id).disabled = on; });

  async function renderSent() {
    if (!st) return;
    const box = $('dv-sent');
    let last = null;
    try { last = DocsApi.last(await DocsApi.sharesOf(st.type, st.row.id), st.type, st.row.id); }
    catch (e) { box.replaceChildren(mk('div', 'msg err', '送付の記録を読めませんでした: ' + errText(e))); return; }
    const row = mk('div', 'row');
    row.style.justifyContent = 'space-between';
    row.append(mk('span', null, '送付の記録'), mk('span', 'hint', DocsApi.statusText(last)));
    row.lastChild.id = 'dv-sent-t';
    box.replaceChildren(row);
    if (last) {
      const undo = dBtn('送っていないに戻す', 'textlink', async () => {
        if (!(await askPopup('この' + st.label + 'を「送っていない」に戻しますか？\n送付の記録を外します。送った PDF のリンクはそのままです。', { title: '送っていないに戻す', okLabel: '戻す', id: 'dv-undo-ask' }))) return;
        try { await DocsApi.undoAll(st.type, st.row.id); } catch (e) { toast('戻せませんでした: ' + errText(e)); return; }
        renderSent();
      });
      undo.id = 'dv-undo';
      undo.style.justifyContent = 'flex-start';
      box.appendChild(undo);
    }
  }

  async function makePdf() {
    const s = st;
    const key = s.row.id + '@' + s.row.updated_at;
    busy(true);
    $('dv-progress').className = 'msg';
    $('dv-retry').hidden = true;
    try {
      let hit = cache.get(key);
      if (!hit) {
        $('dv-progress').textContent = 'PDFを作成中…（準備）';
        const photos = Array.isArray(s.row.photos) ? s.row.photos : [];
        const photoUrls = await Promise.all(photos.map(p => signedUrl(p.path).catch(() => '')));
        const show = ctx.org.show_company_on_report !== false;
        const logoUrl = show && ctx.org.logo_path ? await signedUrl(ctx.org.logo_path).catch(() => '') : '';
        let pages = [];
        const blob = await ReportPdf.toBlob({ report: s.row, org: ctx.org, logoUrl, photoUrls, createdDate: ReportLogic.todayJa(new Date(s.row.data.pdf_at || s.row.updated_at)),
          onStep: t => { if (st === s) $('dv-progress').textContent = 'PDFを作成中…（' + t + '）'; }, onPages: p => { pages = p; } });
        hit = { blob, pages };
        cache.clear();
        cache.set(key, hit);
      }
      if (st !== s) return;
      s.blob = hit.blob;
      drawPages(hit.pages);
      $('dv-progress').textContent = hit.pages.length + 'ページ';
      busy(false);
    } catch (e) {
      if (st !== s) return;
      $('dv-progress').className = 'msg err';
      $('dv-progress').textContent = 'PDFを作れませんでした: ' + errText(e);
      $('dv-retry').hidden = false;
    }
  }

  function wire() {
    if (wired) return;
    wired = true;
    $('dv-retry').addEventListener('click', () => { if (st) makePdf(); });
    ['line', 'mail'].forEach(via => $('dv-' + via).addEventListener('click', () => {
      if (!st || !st.blob) return;
      ShareUi.open({ via, type: st.type, docId: st.row.id, docLabel: st.label, caseRow: st.caseRow, blob: st.blob, onRecorded: renderSent });
    }));
    $('dv-dl').addEventListener('click', async () => {
      if (!st || !st.blob) return;
      const url = URL.createObjectURL(st.blob);
      const a = mk('a');
      a.href = url;
      a.download = ShareLogic.fileName(st.label, st.caseRow);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      try { await DocsApi.record(st.caseRow.id, st.type, st.row.id, 'download', null); toast('PDFをダウンロードしました'); }
      catch (e) { toast('ダウンロードの記録を残せませんでした: ' + errText(e)); }
      renderSent();
    });
  }

  async function show(type, id) {
    wire();
    st = null;
    busy(true);
    $('dv-pages').replaceChildren();
    $('dv-sent').replaceChildren();
    $('dv-title').textContent = '';
    $('dv-sub').textContent = '';
    $('dv-progress').textContent = '';
    showScreen('doc');
    const r = await sb.from('reports').select('*').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) { toast('書類が見つかりませんでした'); location.replace('#cases'); return; }
    const caseRow = (await CasesApi.get(r.data.case_id)) || {};
    st = { type, row: r.data, caseRow, label: DocsApi.title(type, r.data), blob: null };
    $('dv-title').textContent = st.label;
    $('dv-sub').textContent = CaseLogic.placeName(caseRow) + ' ・ ' + CaseLogic.md(r.data.created_at) + ' 作成';
    $('dv-back').href = '#case/' + caseRow.id;
    $('dv-edit').href = '#' + type + '/' + id;
    renderSent();
    await makePdf();
  }
  return { show };
})();
