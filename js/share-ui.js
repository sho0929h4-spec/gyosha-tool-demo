// js/share-ui.js — 13 共有シート（LINE／メール）。簡易版（業者ツール（簡易版）/js/share-ui.js）の openSheet を写して簡略化した。文面とファイル名は ShareLogic
// ShareUi.open({ via: 'line'|'mail', type, docId, docLabel, caseRow, blob, fileName?, onRecorded })（fileName が無ければ ShareLogic.fileName）
//   シート（× だけで閉じる）: 押した手段の文面（LINE = 短め・件名なし／メール = 件名＋本文。直せる）→
//   ファイルを渡せる端末（navigator.canShare({ files })）: 「PDF と文面を共有する」= PDF ファイル＋文面を端末の共有へ・「文面をコピー」
//   それ以外（パソコン）: メール =「メールを開く」（mailto: 件名＋本文＋公開PDF のリンク）／LINE =「文面とリンクをコピー」・「LINEで開く」
//   共有したら doc_shares に記録（送付済み）。1回開いたシートで記録は1回
const ShareUi = (() => {
  // テストで差し替える口（mailto を開く）
  const api = { openUrl: url => { location.href = url; } };

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try {
        const t = document.createElement('textarea');
        t.value = text;
        t.style.position = 'fixed';
        t.style.opacity = '0';
        document.body.appendChild(t);
        t.select();
        const ok = document.execCommand && document.execCommand('copy');
        t.remove();
        return !!ok;
      } catch (e2) { return false; }
    }
  }

  function open(o) {
    const line = o.via === 'line';
    const prev = document.getElementById('dsh-sheet');
    if (prev) prev.remove();
    const fname = o.fileName || ShareLogic.fileName(o.docLabel, o.caseRow);
    const m0 = ctx.membership || {};
    const m1 = ShareLogic.message({ type: o.type, docLabel: o.docLabel, caseRow: o.caseRow, org: ctx.org || {}, me: { name: m0.display_name, tel: m0.phone }, short: line });
    const st = { file: new File([o.blob], fname, { type: 'application/pdf' }), url: '', pdfPath: null, sent: '', busy: false };

    const bg = mk('div', 'modal-bg');
    bg.id = 'dsh-sheet';
    const dlg = mk('div', 'modal');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'dsh-title');
    const hd = mk('div', 'modal-hd');
    const h = mk('h3', null, line ? 'LINEで共有' : 'メールで共有');
    h.id = 'dsh-title';
    const x = dBtn('×', 'modal-x', () => { if (st.busy) return; bg.remove(); });
    x.id = 'dsh-x';
    x.setAttribute('aria-label', '閉じる');
    hd.append(h, x);
    const file = mk('div', 'hint', o.docLabel + ' ・ ' + fname);
    file.id = 'dsh-file';
    const ff = (label, c) => { const d = mk('div', 'ff'); const l = mk('label', null, label); l.htmlFor = c.id; d.append(l, c); return d; };
    const subj = document.createElement('input');
    subj.type = 'text';
    subj.id = 'dsh-subject';
    subj.value = m1.subject;
    const body = document.createElement('textarea');
    body.id = 'dsh-body';
    body.rows = line ? 6 : 10;
    body.value = m1.body;
    const note = mk('div', 'hint');
    note.id = 'dsh-note';
    const acts = mk('div', 'body');
    acts.style.padding = '0';
    acts.style.gap = '8px';
    const msg = mk('div', 'msg err');
    msg.id = 'dsh-msg';
    msg.setAttribute('role', 'alert');
    const out = mk('div', 'body');
    out.style.padding = '0';
    out.id = 'dsh-out';
    out.setAttribute('role', 'status');
    const foot = mk('div', 'hint', '共有すると「送付済み（日時・' + (line ? 'LINE' : 'メール') + '）」が書類に残ります。× でだけ閉じます。');
    dlg.append(hd, file, ...(line ? [] : [ff('件名', subj)]), ff('本文（直せる）', body), note, acts, msg, out, foot);
    bg.appendChild(dlg);
    document.body.appendChild(bg);

    const cur = () => ({ subject: subj.value, body: body.value });
    const sync = () => { acts.querySelectorAll('button').forEach(b => { b.disabled = st.busy; }); x.disabled = st.busy; };
    const okLine = t => mk('div', 'msg ok', t);
    async function record(via) {
      if (st.sent) return;
      await DocsApi.record(o.caseRow.id, o.type, o.docId, via, st.pdfPath);
      st.sent = via;
      out.appendChild(okLine('送付済みにしました（' + ShareLogic.viaLabel(via) + '）'));
      if (o.onRecorded) o.onRecorded();
    }
    async function ensureLink() {
      if (!st.url) { const p = await DocsApi.publicPdf(o.type, o.blob); st.url = p.url; st.pdfPath = p.path; }
      return st.url;
    }
    const run = async (fn, what) => {
      if (st.busy) return;
      st.busy = true;
      sync();
      msg.textContent = '';
      try { await fn(); } catch (e) { msg.textContent = what + ': ' + errText(e); }
      st.busy = false;
      sync();
    };
    // スマホ: 端末の共有（押したその場で呼ぶ。待ってから呼ぶと端末が断る）
    function share() {
      if (st.busy) return;
      let p;
      try { p = navigator.share(Object.assign({ files: [st.file], text: cur().body }, line ? {} : { title: cur().subject })); }
      catch (e) { msg.textContent = '共有できませんでした: ' + errText(e); return; }
      run(async () => {
        try { await p; } catch (e) { if (e && e.name === 'AbortError') return; throw e; }
        out.replaceChildren();
        await record('share');
      }, '共有できませんでした');
    }
    const copyBody = () => run(async () => {
      const ok = await copyText(cur().body);
      out.replaceChildren(ok ? okLine('文面をコピーしました。送り先のアプリに貼り付けてください') : mk('div', 'msg err', 'コピーできませんでした。本文を選んでコピーしてください'));
    }, 'コピーできませんでした');
    const sendMail = () => run(async () => {
      const url = await ensureLink();
      const m = cur();
      const built = ShareLogic.buildMailto({ to: o.caseRow.client_email || '', subject: m.subject, body: m.body, link: o.docLabel + 'PDF: ' + url });
      out.replaceChildren(okLine('メールアプリを開きました。送信してください' + (built.shortened ? '（本文が長いため短くしています）' : '')));
      api.openUrl(built.url);
      await record('mail');
    }, 'メールを開けませんでした');
    const sendLine = () => run(async () => {
      const url = await ensureLink();
      const text = ShareLogic.withLink(cur().body, o.docLabel + 'PDF: ' + url);
      const ok = await copyText(text);
      const kids = [ok ? okLine('文面と PDF のリンクをコピーしました。LINE に貼り付けてください') : mk('div', 'msg err', 'コピーできませんでした。下の文面を選んでコピーし、LINE に貼り付けてください')];
      if (!ok) { const t = document.createElement('textarea'); t.readOnly = true; t.rows = 6; t.value = text; t.id = 'dsh-copybox'; kids.push(t); }
      const a = mk('a', 'btn ghost sm', 'LINEで開く');
      a.id = 'dsh-line-open';
      a.href = ShareLogic.lineUrl(text); // ユーザーが押したときだけ LINE に渡る
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      kids.push(a);
      out.replaceChildren(...kids);
      await record('line');
    }, 'LINE 用の文面を用意できませんでした');

    let files = false;
    try { files = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [st.file] })); } catch (e) { files = false; }
    const b = (t, id, fn, cls) => { const e = dBtn(t, cls, fn); e.id = id; return e; };
    if (files) {
      note.textContent = 'PDF のファイルと本文をスマホの共有に渡します。出てきた一覧から' + (line ? 'LINE' : 'メール') + 'のアプリを選んでください。本文が入らないときは「文面をコピー」で貼り付けてください';
      acts.append(b('PDF と文面を共有する', 'dsh-share', share, 'btn'), b('文面をコピー', 'dsh-copy', copyBody, 'btn ghost sm'));
    } else {
      note.textContent = '送るときに PDF のリンク（URL を知っている人だけが開けます）を本文に入れます';
      acts.append(line ? b('文面とリンクをコピー（LINE に貼り付け）', 'dsh-line', sendLine, 'btn') : b('メールを開く', 'dsh-mail', sendMail, 'btn'));
    }
    (acts.querySelector('button') || x).focus({ preventScroll: true });
  }
  api.open = open;
  return api;
})();
