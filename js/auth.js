// js/auth.js — ログイン・ログアウト・パスワード再設定のメール（と、メールのリンクから戻ったときの新しいパスワード）・所属の無い人と利用を終えた会社の人の画面（ログアウトだけ）
const AuthUi = (() => {
  let wired = false;
  const setMsg = (id, text, ok) => { const e = $(id); e.textContent = text || ''; e.classList.toggle('ok', !!ok); e.classList.toggle('err', !ok && !!text); };
  const loginErr = e => (e && (e.status === 400 || e.code === 'invalid_credentials') ? 'メールアドレスかパスワードが違います' : errText(e));

  function wire() {
    if (wired) return;
    wired = true;
    $('login-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const email = $('login-mail').value.trim(), password = $('login-pw').value;
      if (!email || !password) { setMsg('login-msg', 'メールアドレスとパスワードを入れてください'); return; }
      $('login-btn').disabled = true;
      setMsg('login-msg', '');
      try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        $('login-pw').value = '';
        await App.signedIn(data.user || data.session.user);
      } catch (e) {
        setMsg('login-msg', loginErr(e));
      } finally {
        $('login-btn').disabled = false;
      }
    });
    $('forgot-open').addEventListener('click', () => {
      $('forgot').hidden = !$('forgot').hidden;
      if (!$('forgot').hidden) { $('forgot-mail').value = $('login-mail').value.trim(); $('forgot-mail').focus(); }
    });
    $('forgot-send').addEventListener('click', async () => {
      const email = $('forgot-mail').value.trim();
      if (!/^[^\s@]+@[^\s@]+$/.test(email)) { setMsg('forgot-msg', 'メールアドレスを入れてください'); return; }
      $('forgot-send').disabled = true;
      try {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (error) throw error;
        setMsg('forgot-msg', 'メールを送りました。メールのリンクを開いて、新しいパスワードを決めてください（届かないときは迷惑メールも見てください）', true);
      } catch (e) {
        setMsg('forgot-msg', '送れませんでした: ' + errText(e));
      } finally {
        $('forgot-send').disabled = false;
      }
    });
    $('recover-save').addEventListener('click', async () => {
      const pw = $('recover-pw').value;
      if (pw.length < 8) { setMsg('recover-msg', 'パスワードは8文字以上にしてください'); return; }
      $('recover-save').disabled = true;
      try {
        const { data, error } = await sb.auth.updateUser({ password: pw });
        if (error) throw error;
        $('recover-pw').value = '';
        $('recover').hidden = true;
        await App.signedIn(data.user);
      } catch (e) {
        setMsg('recover-msg', '変えられませんでした: ' + errText(e));
      } finally {
        $('recover-save').disabled = false;
      }
    });
    $('nm-logout').addEventListener('click', async () => {
      const { error } = await sb.auth.signOut();
      if (error) toast('ログアウトできませんでした: ' + errText(error));
    });
    $('logout').addEventListener('click', async () => {
      if (!(await askPopup('ログアウトしますか？', { title: 'ログアウト', okLabel: 'ログアウト', id: 'logout-ask' }))) return;
      const { error } = await sb.auth.signOut();
      if (error) toast('ログアウトできませんでした: ' + errText(error));
    });
  }
  function show() { wire(); showScreen('login'); }
  // 再設定メールのリンクから開いた（Supabase が PASSWORD_RECOVERY を知らせる）
  function recovery() { wire(); $('recover').hidden = false; showScreen('login'); $('recover-pw').focus(); }
  function error(text) { wire(); setMsg('login-msg', text); }
  // 知らせ（自動ログアウトなど）。失敗ではないので赤くしない
  function info(text) { wire(); const e = $('login-msg'); e.textContent = text || ''; e.classList.remove('ok', 'err'); }
  // closed = 会社が利用を終えた（App の my_status）。どちらもログアウトだけ
  function noMember(closed) {
    wire();
    $('nm-msg').textContent = closed ? 'この会社は利用を終えています。運営に問い合わせてください' : 'この会社のメンバーではありません。管理者に招待を頼んでください';
    showScreen('nomember');
  }
  return { show, recovery, error, info, noMember };
})();
