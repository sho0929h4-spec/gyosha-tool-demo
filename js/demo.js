// tools/demo/demo.js — お試し版（dist-demo）だけに入るファイル。js/fake-sb.js（偽バックエンド）のすぐ後に読む。
//   上に「お試し版」の帯・ログイン画面は「お試しで入る」ボタンだけ（メールとパスワードは使わない）・設定に「お試しデータを最初に戻す」
(function () {
  const $ = id => document.getElementById(id);
  const band = document.createElement('div');
  band.id = 'demo-band';
  band.textContent = 'お試し版: 入れたデータはこの端末のブラウザの中にだけ残ります（会社の本当のデータにはつながりません）';
  band.style.cssText = 'background:#fff7e0;border-bottom:1px solid #e6c766;color:#5a4500;font-size:12px;padding:8px 16px;text-align:center;overflow-wrap:anywhere';
  document.body.prepend(band);

  // ログイン画面: メールとパスワードの欄を隠し、「お試しで入る」だけにする
  $('login-form').hidden = true;
  $('forgot').hidden = true;
  const box = document.createElement('div');
  box.className = 'body';
  box.style.padding = '0';
  const go = document.createElement('button');
  go.type = 'button';
  go.id = 'demo-enter';
  go.className = 'btn';
  go.textContent = 'お試しで入る';
  const msg = document.createElement('div');
  msg.className = 'msg err';
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const { data } = window.__fake.signInDemo();
      await App.signedIn(data.user);
    } catch (e) { msg.textContent = '入れませんでした: ' + errText(e); }
    finally { go.disabled = false; }
  });
  const note = document.createElement('div');
  note.className = 'hint';
  note.style.textAlign = 'center';
  note.textContent = 'ログインは要りません。案件の登録 → 報告書 → PDF → 共有まで試せます。';
  box.append(go, msg, note);
  $('login-form').after(box);

  // 設定: お試しデータを最初に戻す
  const reset = document.createElement('div');
  reset.className = 'card';
  reset.id = 'demo-reset';
  const t = document.createElement('div');
  t.className = 'card-t';
  t.textContent = 'お試しデータ';
  const d = document.createElement('div');
  d.className = 'card-d';
  d.textContent = 'この端末に入れた案件・報告書・写真を全部消して、最初の状態に戻します。';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ghost sm';
  b.id = 'demo-reset-btn';
  b.textContent = 'お試しデータを最初に戻す';
  b.addEventListener('click', async () => {
    if (!(await askPopup('この端末のお試しデータを全部消して、最初の状態に戻しますか？', { title: 'お試しデータを最初に戻す', okLabel: '最初に戻す', danger: true, id: 'demo-reset-ask' }))) return;
    await window.__fake.reset();
    location.replace(location.pathname + '#login');
    location.reload();
  });
  reset.append(t, d, b);
  $('set-extra').appendChild(reset);
})();
