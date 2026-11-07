// js/preview-ui.js — 12 プレビューと共有（共通）。#doc/{type}/{id}（type = report | estimate | notice | drawing）
//   PDF を端末の中で作り（進み: 準備／描画／保存）、作ったときのページの画像を <canvas> に出す（pdf.js は使わない）。
//   編集に戻る／LINEで共有／メールで共有／PDFをダウンロード／送付の記録（送付済み（日時・手段）・送っていないに戻す）
//   見積書: 共有・ダウンロードを記録したら、その版を発行済みにする（EstimatesApi.issue）。発行済みの版は「編集に戻る」の代わりに「新しい版を作って直す」
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
      img.onload = () => { c.width = img.naturalWidth; c.height = img.naturalHeight; c.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); };
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
        let pages = [], blob;
        const onStep = t => { if (st === s) $('dv-progress').textContent = 'PDFを作成中…（' + t + '）'; };
        const onPages = p => { pages = p; };
        if (s.type === 'drawing') {
          const imgUrl = await signedUrl(s.row.image_path, 'drawings');
          blob = await DrawingPdf.toBlob({ drawing: s.row, imgUrl, caseRow: s.caseRow, org: ctx.org, onStep, onPages });
        } else if (s.type === 'notice') {
          blob = await NoticePdf.toBlob({ notice: s.row, org: ctx.org, onStep, onPages });
        } else if (s.type === 'estimate') {
          const sealUrl = ctx.org.seal_path ? await signedUrl(ctx.org.seal_path).catch(() => '') : '';
          blob = await EstimatePdf.toBlob({ estimate: s.row, org: ctx.org, sealUrl, onStep, onPages });
        } else {
          const photos = Array.isArray(s.row.photos) ? s.row.photos : [];
          const photoUrls = await Promise.all(photos.map(p => signedUrl(p.path).catch(() => '')));
          const show = ctx.org.show_company_on_report !== false;
          const logoUrl = show && ctx.org.logo_path ? await signedUrl(ctx.org.logo_path).catch(() => '') : '';
          blob = await ReportPdf.toBlob({ report: s.row, org: ctx.org, logoUrl, photoUrls, createdDate: ReportLogic.todayJa(new Date(s.row.data.pdf_at || s.row.updated_at)), onStep, onPages });
        }
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

  // 見積書の発行済み・古い版は直せない（直すときは新しい版を作る）
  function editBtns() {
    const ro = st.type === 'estimate' && st.row.status !== 'draft';
    $('dv-edit').hidden = ro;
    $('dv-newver').hidden = !ro;
  }
  // 共有・ダウンロードを記録した: 見積書はその版を発行済みに（同じ系列の前の発行済みは古い版に）
  async function recorded() {
    const s = st;
    if (s && s.type === 'estimate') {
      try { await EstimatesApi.issue(s.row); s.row = (await EstimatesApi.get(s.row.id)) || s.row; }
      catch (e) { toast('発行済みにできませんでした: ' + errText(e)); }
      if (st === s) editBtns();
    }
    renderSent();
  }

  function wire() {
    if (wired) return;
    wired = true;
    $('dv-retry').addEventListener('click', () => { if (st) makePdf(); });
    ['line', 'mail'].forEach(via => $('dv-' + via).addEventListener('click', () => {
      if (!st || !st.blob) return;
      ShareUi.open({ via, type: st.type, docId: st.row.id, docLabel: st.label, caseRow: st.caseRow, blob: st.blob, fileName: st.fname, onRecorded: recorded });
    }));
    $('dv-newver').addEventListener('click', async () => {
      if (!st) return;
      $('dv-newver').disabled = true;
      try { location.hash = '#estimate/' + (await EstimatesApi.createDraft(st.caseRow, st.row)).id; }
      catch (e) { toast('新しい版を作れませんでした: ' + errText(e)); }
      finally { $('dv-newver').disabled = false; }
    });
    $('dv-dl').addEventListener('click', async () => {
      if (!st || !st.blob) return;
      const url = URL.createObjectURL(st.blob);
      const a = mk('a');
      a.href = url;
      a.download = st.fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      try { await DocsApi.record(st.caseRow.id, st.type, st.row.id, 'download', null); toast('PDFをダウンロードしました'); }
      catch (e) { toast('ダウンロードの記録を残せませんでした: ' + errText(e)); renderSent(); return; }
      recorded();
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
    $('dv-edit').hidden = $('dv-newver').hidden = true;
    showScreen('doc');
    const r = await sb.from({ report: 'reports', estimate: 'estimates', notice: 'notices', drawing: 'drawings' }[type]).select('*').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) { toast('書類が見つかりませんでした'); location.replace('#cases'); return; }
    let caseRow = (await CasesApi.get(r.data.case_id)) || {};
    const d = r.data.data || {};
    // 工事掲示は号室ごと（別の号室に複製したもの）なので、共有の件名は掲示の物件名・号室にする
    if (type === 'notice') caseRow = Object.assign({}, caseRow, { name: d.propertyName || caseRow.name, room: d.roomNo || caseRow.room });
    const label = DocsApi.title(type, r.data);
    st = { type, row: r.data, caseRow, label, blob: null,
      fname: type === 'estimate' ? EstimatePdf.fileName(d.subject) : type === 'notice' ? NoticeLogic.fileName(d) : type === 'drawing' ? DrawingLogic.fileName(caseRow) : ShareLogic.fileName(label, caseRow) };
    $('dv-title').textContent = st.label;
    $('dv-sub').textContent = CaseLogic.placeName(caseRow) + ' ・ ' + CaseLogic.md(r.data.created_at) + ' 作成';
    $('dv-back').href = '#case/' + caseRow.id;
    $('dv-edit').href = '#' + type + '/' + id;
    editBtns();
    renderSent();
    await makePdf();
  }
  return { show };
})();
