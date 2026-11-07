// js/app.js — ルーター（location.hash）と共通の道具: $, mk, dBtn, errText, askPopup, showScreen, toast
//   #login #cases #case/new #case/{id} #case/{id}/edit #settings #report/{id} #estimate/{id} #estimate/{id}/import #notice/{id} #drawing/{id} #doc/{type}/{id}
//   ctx = { user, org, membership }（ログインしていなければ null）
let ctx = null;

function $(id) { return document.getElementById(id); }
function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function dBtn(text, cls, onClick) {
  const b = mk('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', () => onClick(b));
  return b;
}
// 失敗の理由（画面に出す文）。通信の失敗は分かる言葉に
function errText(e) {
  const m = e && e.message ? e.message : String(e || '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return '通信できませんでした。電波の良い所でもう一度お試しください';
  return m || '理由が分かりませんでした';
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
  window.scrollTo(0, 0);
}
let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// 確認のポップアップ（confirm() の代わり）。OK = true、× と「キャンセル」= false。外側のクリックや Esc では閉じない
//   askPopup(text, { title, okLabel, cancelLabel, danger, id }) → Promise<boolean>
//   input: { label, value, placeholder } を渡すと欄を1つ出し、OK = 入れた文字（前後の空白を除く）、× と「キャンセル」= null
//   more: [{ label, value, id, danger }] を渡すと OK の上にボタンを足し、押すと { more: value }（図面の印の「削除」など）
function askPopup(text, opts) {
  const o = opts || {};
  const prev = document.getElementById('ask-pop');
  if (prev && prev._done) prev._done(false);
  return new Promise(resolve => {
    const bg = mk('div', 'modal-bg');
    bg.id = 'ask-pop';
    const dlg = mk('div', 'modal');
    if (o.id) dlg.id = o.id;
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'ask-pop-title');
    dlg.setAttribute('aria-describedby', 'ask-pop-t');
    const hd = mk('div', 'modal-hd');
    const h = mk('h3', null, o.title || '確認');
    h.id = 'ask-pop-title';
    const back = document.activeElement;
    const done = v => {
      bg._done = null;
      bg.remove();
      if (back && back.focus && back.isConnected) back.focus({ preventScroll: true });
      resolve(v);
    };
    const x = dBtn('×', 'modal-x', () => done(o.input ? null : false));
    x.id = 'ask-pop-x';
    x.setAttribute('aria-label', '閉じる');
    hd.append(h, x);
    const t = mk('p', 'ask-pop-t', text);
    t.id = 'ask-pop-t';
    const act = mk('div', 'modal-act');
    let inp = null;
    const no = dBtn(o.cancelLabel || 'キャンセル', 'btn ghost', () => done(o.input ? null : false));
    no.id = 'ask-pop-no';
    const ok = dBtn(o.okLabel || 'OK', 'btn' + (o.danger ? ' red' : ''), () => done(inp ? inp.value.trim() : true));
    ok.id = 'ask-pop-ok';
    act.append(no, ok);
    dlg.append(hd, t);
    if (o.input) {
      const f = mk('div', 'ff');
      const l = mk('label', null, o.input.label || '');
      inp = mk('input');
      inp.type = 'text';
      inp.id = l.htmlFor = 'ask-pop-in';
      inp.value = o.input.value || '';
      inp.placeholder = o.input.placeholder || '';
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok.click(); } });
      f.append(l, inp);
      dlg.appendChild(f);
    }
    if (o.more && o.more.length) {
      const mr = mk('div', 'modal-act col');
      o.more.forEach(m => { const b = dBtn(m.label, 'btn ghost sm' + (m.danger ? ' danger' : ''), () => done({ more: m.value })); if (m.id) b.id = m.id; mr.appendChild(b); });
      dlg.appendChild(mr);
    }
    dlg.appendChild(act);
    bg.appendChild(dlg);
    bg._done = v => done(o.input && v === false ? null : v);
    document.body.appendChild(bg);
    (inp || ok).focus({ preventScroll: true });
  });
}

const App = (() => {
  const UUID = '([0-9a-f-]{36})';
  const ROUTES = [
    [/^#login$/, () => AuthUi.show()],
    [/^#cases$/, () => CasesUi.show()],
    [/^#case\/new$/, () => CaseForm.show(null)],
    [new RegExp('^#case/' + UUID + '/edit$'), id => CaseForm.show(id)],
    [new RegExp('^#case/' + UUID + '$'), id => CaseUi.show(id)],
    [/^#settings$/, () => SettingsUi.show()],
    [new RegExp('^#report/' + UUID + '$'), id => ReportUi.show(id)],
    [new RegExp('^#estimate/' + UUID + '$'), id => EstimateUi.show(id)],
    [new RegExp('^#estimate/' + UUID + '/import$'), id => EstimateImportUi.show(id)],
    [new RegExp('^#notice/' + UUID + '$'), id => NoticeUi.show(id)],
    [new RegExp('^#drawing/' + UUID + '$'), id => DrawingUi.show(id)],
    [new RegExp('^#doc/(report|estimate|notice|drawing)/' + UUID + '$'), (type, id) => PreviewUi.show(type, id)]
  ];
  const leaveHooks = []; // 画面を離れる前（報告書の保存待ちなど）
  const onLeave = fn => leaveHooks.push(fn);

  async function loadCtx(user) {
    const m = await sb.from('memberships').select('*').eq('user_id', user.id).maybeSingle();
    if (m.error) throw m.error;
    if (!m.data) throw new Error('このアカウントはどの会社にも入っていません。招待した人に確かめてください');
    const o = await sb.from('orgs').select('*').eq('id', m.data.org_id).single();
    if (o.error) throw o.error;
    ctx = { user, membership: m.data, org: o.data };
    document.querySelectorAll('.js-org-name').forEach(e => { e.textContent = ctx.org.name || ''; });
  }
  let routing = Promise.resolve();
  function route() {
    routing = routing.then(async () => {
      for (const fn of leaveHooks) { try { await fn(); } catch (e) { console.warn(e); } }
      const h = location.hash || '#cases';
      if (!ctx && h !== '#login') { location.replace('#login'); return; }
      if (ctx && h === '#login') { location.replace('#cases'); return; }
      for (const [re, fn] of ROUTES) {
        const m = h.match(re);
        if (m) {
          try { await fn(...m.slice(1)); }
          catch (e) { console.error(e); toast('画面を開けませんでした: ' + errText(e)); }
          return;
        }
      }
      location.replace('#cases');
    });
    return routing;
  }
  // ログインのあと（AuthUi から）
  async function signedIn(user) {
    await loadCtx(user);
    location.hash = '#cases';
  }
  async function start() {
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === 'SIGNED_OUT') { ctx = null; location.hash = '#login'; }
      if (ev === 'PASSWORD_RECOVERY') AuthUi.recovery();
    });
    window.addEventListener('hashchange', route);
    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session) await loadCtx(data.session.user);
    } catch (e) {
      console.error(e);
      ctx = null;
      AuthUi.error('読み込めませんでした: ' + errText(e));
    }
    route();
  }
  // 設定で会社・自分を直したとき
  function setCtx(part, row) {
    ctx[part] = row;
    document.querySelectorAll('.js-org-name').forEach(e => { e.textContent = ctx.org.name || ''; });
  }
  return { start, route, signedIn, onLeave, setCtx };
})();

// 画像を縮めて Blob にする（長辺 maxEdge px まで。type は 'image/jpeg' か 'image/png'）。読めない画像は理由付きで失敗
function shrinkImage(file, maxEdge, type, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d');
      if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('画像を変換できませんでした'))), type, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像は読み込めませんでした（JPEG・PNG を選んでください）')); };
    img.src = url;
  });
}
// Storage の非公開ファイル（photos。図面は bucket = 'drawings'）の見るための URL（1時間）
async function signedUrl(path, bucket) {
  if (!path) return '';
  const { data, error } = await sb.storage.from(bucket || 'photos').createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
