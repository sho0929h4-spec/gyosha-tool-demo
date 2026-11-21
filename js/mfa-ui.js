// js/mfa-ui.js — 2段階認証（スマホの認証アプリの6桁。Supabase の MFA・TOTP）。求めるのは 振込先を変えるとき・管理者を増やすとき（招待・権限）だけ
//   守りの本体は DB と Worker（ログインの鍵の aal が aal2 でなければ断る: trigger orgs_bank_guard・set_member_role・Worker の /invite）。ここはその手続きの画面
// MfaUi.ensure(what) → Promise<boolean>: このログインが2段階認証済み（aal2）なら true。まだなら、設定済みの人には6桁を聞き、
//   未設定の人には設定（QR か鍵 → 6桁）をしてもらう。× は false。通信の失敗などは throw。what = 何をするために要るか（「振込先を変える」など）
// MfaUi.age() → 認証アプリの登録（確かめ済み）からたった時間（ミリ秒）。登録が無ければ -1（もう入っている振込先を変えるには 24 時間たっていること）
const MfaUi = (() => {
  const ok = r => { if (r.error) throw r.error; return r.data; };
  async function age() {
    const f = (ok(await sb.auth.mfa.listFactors()).totp || []).filter(x => x.status === 'verified').map(x => Date.parse(x.created_at)).filter(t => t > 0);
    return f.length ? Date.now() - Math.min(...f) : -1;
  }
  async function ensure(what) {
    const lv = ok(await sb.auth.mfa.getAuthenticatorAssuranceLevel());
    if (lv.currentLevel === 'aal2') return true;
    const fs = ok(await sb.auth.mfa.listFactors());
    const verified = (fs.totp || []).find(f => f.status === 'verified');
    if (verified) return ask(verified.id, null, what);
    // 設定しかけ（まだ確かめていない）の残りを片付けてから、新しく設定する
    for (const f of (fs.all || []).filter(x => x.status !== 'verified')) { try { await sb.auth.mfa.unenroll({ factorId: f.id }); } catch (e) { /* 残っていても次の設定で分かる */ } }
    const en = ok(await sb.auth.mfa.enroll({ factorType: 'totp' }));
    return ask(en.id, en.totp || {}, what);
  }
  // ポップアップ（右上の × でだけ閉じる）。totp があれば初めての設定（QR と鍵を見せる）
  function ask(factorId, totp, what) {
    const why = (what || 'この操作をする') + 'には2段階認証が要ります。';
    return new Promise(resolve => {
      const bg = mk('div', 'modal-bg');
      const dlg = mk('div', 'modal');
      dlg.id = 'mfa-pop';
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      dlg.setAttribute('aria-label', '2段階認証');
      const done = v => { bg.remove(); resolve(v); };
      const hd = mk('div', 'modal-hd');
      const x = dBtn('×', 'modal-x', () => done(false));
      x.id = 'mfa-x';
      x.setAttribute('aria-label', '閉じる');
      hd.append(mk('h3', null, totp ? '2段階認証を設定' : '2段階認証'), x);
      dlg.append(hd, mk('p', 'hint', totp
        ? why + 'スマホの認証アプリ（Google Authenticator など）で下の QR を読み取るか、鍵を入れてください。そのあと、アプリに出た6桁を入れます。'
        : why + '認証アプリに出ている6桁を入れてください。'));
      if (totp && totp.qr_code) { const img = mk('img', 'mfa-qr'); img.src = totp.qr_code; img.alt = '設定用の QR コード'; dlg.appendChild(img); }
      if (totp && totp.secret) { const k = mk('div', 'mfa-key', '鍵: ' + totp.secret); k.id = 'mfa-key'; dlg.appendChild(k); }
      const f = mk('div', 'ff'), l = mk('label', null, '認証アプリの6桁'), inp = mk('input');
      inp.type = 'text';
      inp.id = l.htmlFor = 'mfa-code';
      inp.inputMode = 'numeric';
      inp.maxLength = 6;
      inp.autocomplete = 'one-time-code';
      f.append(l, inp);
      const msg = mk('div', 'msg err');
      msg.id = 'mfa-msg';
      msg.setAttribute('role', 'status');
      const act = mk('div', 'modal-act');
      const go = dBtn('確かめる', 'btn', async () => {
        const code = inp.value.replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) { msg.textContent = '6桁の数字を入れてください'; return; }
        go.disabled = true;
        const r = await sb.auth.mfa.challengeAndVerify({ factorId, code }).catch(e => ({ error: e }));
        go.disabled = false;
        if (r.error) { msg.textContent = /fetch|network/i.test(String(r.error.message)) ? errText(r.error) : '6桁が違うか、時間切れです。認証アプリの今の6桁を入れてください'; return; }
        done(true);
      });
      go.id = 'mfa-ok';
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go.click(); } });
      act.append(go);
      dlg.append(f, msg, act);
      bg.appendChild(dlg);
      document.body.appendChild(bg);
      inp.focus({ preventScroll: true });
    });
  }
  return { ensure, age };
})();
