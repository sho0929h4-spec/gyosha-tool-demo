// js/settings-ui.js — 05 設定: 会社（名前・住所・電話・メール・登録番号・ロゴ・社印・報告書に会社名とロゴを出す）／自分（名前・電話・パスワード変更）
//   見積書・元請の一覧・メンバー招待は「準備中」（index.html の灰色の枠）
const SettingsUi = (() => {
  let wired = false;
  const ok = r => { if (r.error) throw r.error; return r.data; };
  const setMsg = (id, text, good) => { const e = $(id); e.textContent = text || ''; e.classList.toggle('ok', !!good); e.classList.toggle('err', !good && !!text); };
  const ORG_F = { name: 'so-name', address: 'so-addr', tel: 'so-tel', email: 'so-mail', registration_number: 'so-reg' };
  const toggle = (btn, box) => { box.hidden = !box.hidden; btn.setAttribute('aria-expanded', String(!box.hidden)); };

  async function saveOrg(patch) {
    const row = ok(await sb.from('orgs').update(patch).eq('id', ctx.org.id).select().single());
    App.setCtx('org', row);
    return row;
  }
  // ロゴ・社印: 選ぶとすぐ縮めて保存（PNG・長辺600px）。「外す」で消す
  async function renderImg(hostId, col, label) {
    const host = $(hostId);
    host.replaceChildren();
    const path = ctx.org[col];
    if (path) {
      const img = mk('img', 'img-prev');
      img.alt = label;
      img.id = hostId + '-img';
      try { img.src = await signedUrl(path); } catch (e) { img.alt = label + '（読み込めませんでした）'; }
      host.appendChild(img);
    } else host.appendChild(mk('span', 'hint', 'まだありません'));
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.id = hostId + '-file';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const f = input.files[0];
      input.value = '';
      if (!f) return;
      setMsg('so-msg', label + 'を保存中…', true);
      try {
        const blob = await shrinkImage(f, 600, 'image/png');
        const p = ctx.org.id + '/org/' + col + '-' + newId() + '.png';
        const up = await sb.storage.from('photos').upload(p, blob, { contentType: 'image/png' });
        if (up.error) throw up.error;
        const old = ctx.org[col];
        await saveOrg({ [col]: p });
        if (old) sb.storage.from('photos').remove([old]);
        setMsg('so-msg', label + 'を保存しました', true);
      } catch (e) { setMsg('so-msg', label + 'を保存できませんでした: ' + errText(e)); }
      renderImg(hostId, col, label);
    });
    host.appendChild(input);
    host.appendChild(dBtn(path ? '変える' : '選ぶ', 'btn ghost sm', () => input.click()));
    if (path) host.appendChild(dBtn('外す', 'btn ghost sm', async () => {
      if (!(await askPopup(label + 'を外しますか？', { title: label + 'を外す', okLabel: '外す', id: 'img-remove-ask' }))) return;
      try { await saveOrg({ [col]: null }); sb.storage.from('photos').remove([path]); setMsg('so-msg', label + 'を外しました', true); }
      catch (e) { setMsg('so-msg', '外せませんでした: ' + errText(e)); }
      renderImg(hostId, col, label);
    }));
  }

  function wire() {
    if (wired) return;
    wired = true;
    $('set-org-open').addEventListener('click', () => toggle($('set-org-open'), $('set-org-form')));
    $('set-me-open').addEventListener('click', () => toggle($('set-me-open'), $('set-me-form')));
    $('so-save').addEventListener('click', async () => {
      const patch = {};
      Object.entries(ORG_F).forEach(([k, id]) => { patch[k] = $(id).value.trim(); });
      patch.registration_number = patch.registration_number.normalize('NFKC').toUpperCase();
      patch.show_company_on_report = $('so-show').checked;
      if (patch.registration_number && !/^T[0-9]{13}$/.test(patch.registration_number)) { setMsg('so-msg', '登録番号は T と13桁の数字です（例 T1234567890123）'); return; }
      if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) { setMsg('so-msg', 'メールの形が正しくありません'); return; }
      $('so-save').disabled = true;
      try { await saveOrg(patch); $('so-reg').value = patch.registration_number; setMsg('so-msg', '保存しました', true); }
      catch (e) { setMsg('so-msg', '保存できませんでした: ' + errText(e)); }
      finally { $('so-save').disabled = false; }
    });
    $('sm-save').addEventListener('click', async () => {
      $('sm-save').disabled = true;
      try {
        const row = ok(await sb.from('memberships').update({ display_name: $('sm-name').value.trim(), phone: $('sm-tel').value.trim() })
          .eq('user_id', ctx.user.id).select().single());
        App.setCtx('membership', row);
        setMsg('sm-msg', '保存しました', true);
      } catch (e) { setMsg('sm-msg', '保存できませんでした: ' + errText(e)); }
      finally { $('sm-save').disabled = false; }
    });
    $('sm-pw-save').addEventListener('click', async () => {
      const pw = $('sm-pw').value;
      if (pw.length < 6) { setMsg('sm-pw-msg', 'パスワードは6文字以上にしてください'); return; }
      $('sm-pw-save').disabled = true;
      try {
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error) throw error;
        $('sm-pw').value = '';
        setMsg('sm-pw-msg', 'パスワードを変えました。次のログインから新しいパスワードを使います', true);
      } catch (e) { setMsg('sm-pw-msg', '変えられませんでした: ' + errText(e)); }
      finally { $('sm-pw-save').disabled = false; }
    });
  }
  function show() {
    wire();
    showScreen('settings');
    ['so-msg', 'sm-msg', 'sm-pw-msg'].forEach(id => setMsg(id, ''));
    Object.entries(ORG_F).forEach(([k, id]) => { $(id).value = ctx.org[k] || ''; });
    $('so-show').checked = ctx.org.show_company_on_report !== false;
    $('sm-name').value = ctx.membership.display_name || '';
    $('sm-tel').value = ctx.membership.phone || '';
    $('sm-pw').value = '';
    renderImg('so-logo', 'logo_path', 'ロゴ');
    renderImg('so-seal', 'seal_path', '社印');
  }
  return { show };
})();
