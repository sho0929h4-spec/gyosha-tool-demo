// js/app.js — ルーター（location.hash）と共通の道具: $, mk, dBtn, errText, askPopup, showScreen, toast, renderTabs
//   #login #cases #calendar #daily #daily/{id} #case/new #case/{id} #case/{id}/edit #settings #settings/teikei #settings/teikei/{setId} #report/{id} #estimate/{id} #estimate/{id}/import #teikei/{id} #notice/{id} #drawing/{id} #doc/{type}/{id}
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
  // 権限で断られた（使っている間に一般にされた・policy で 0 件になり single が失敗）か、開いた行がもう無い（single が 0 件）。英語のまま出さない
  if (e && (e.code === '42501' || e.code === 'PGRST116')) return 'この操作はできませんでした。管理者だけができる操作か、対象がもう消されています。画面を開き直してください';
  if (/row-level security/i.test(m)) return 'この操作はできませんでした。管理者だけができる操作か、対象がもう消されています。画面を開き直してください';
  return m || '理由が分かりませんでした';
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
  window.scrollTo(0, 0);
}
// 画面下に固定のタブ（02 案件一覧・カレンダー・日報）。<nav class="tabs" data-active="cases"> に入れる。今いる所は太字＋下線（aria-current）
const TABS = [['cases', '案件一覧'], ['calendar', 'カレンダー'], ['daily', '日報']];
function renderTabs() {
  document.querySelectorAll('nav.tabs').forEach(nav => {
    nav.replaceChildren(...TABS.map(([k, label]) => {
      const a = mk('a', 'tab', label);
      a.href = '#' + k;
      a.id = nav.dataset.active + '-tab-' + k;
      if (k === nav.dataset.active) a.setAttribute('aria-current', 'page');
      return a;
    }));
  });
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

// 自動ログアウト: 最後に使った時刻（画面の切り替え・前面に戻った時。1分に1回まで）から IDLE_DAYS 日を超えたら、開いた時・前面に戻った時にログアウト
// shortcut: 端末の localStorage の時刻で見るだけ（時計を進めて戻す・消すと延びる）。サーバのログインの鍵は Supabase 側で別に切れる。サーバで切るなら Supabase Pro のセッションの期限（time-box・inactivity timeout）に替える
const IDLE_DAYS = 30;
const LEAVE_WAIT_MS = 5000; // 自動ログアウトの前に、画面を離れる前の保存を待つ長さ
const Idle = (() => {
  const KEY = 'gt-last-active';
  const get = () => { try { return Number(localStorage.getItem(KEY)); } catch (e) { return 0; } };
  const set = t => { try { localStorage.setItem(KEY, String(t)); } catch (e) { /* 入れられない端末は切らない */ } };
  // 時刻が無い・読めない・未来なら今を入れて続ける
  function over() {
    const now = Date.now(), last = get();
    if (!last || last > now) { set(now); return false; }
    return now - last > IDLE_DAYS * 86400000;
  }
  function touch(force) {
    const now = Date.now(), last = get();
    if (force || !(last <= now && now - last < 60000)) set(now);
  }
  return { over, touch };
})();

const App = (() => {
  const UUID = '([0-9a-f-]{36})';
  const ROUTES = [
    [/^#login$/, () => AuthUi.show()],
    [/^#cases$/, () => CasesUi.show()],
    [/^#calendar$/, () => CalendarUi.show()],
    [/^#daily$/, () => DailyUi.list()],
    [new RegExp('^#daily/' + UUID + '$'), id => DailyUi.show(id)],
    [/^#case\/new$/, () => CaseForm.show(null)],
    [new RegExp('^#case/' + UUID + '/edit$'), id => CaseForm.show(id)],
    [new RegExp('^#case/' + UUID + '$'), id => CaseUi.show(id)],
    [/^#settings$/, () => SettingsUi.show()],
    [/^#settings\/teikei$/, () => TeikeiRatesUi.showList()],
    [/^#settings\/teikei\/([^/]+)$/, id => TeikeiRatesUi.showSet(decodeURIComponent(id))],
    [new RegExp('^#report/' + UUID + '$'), id => ReportUi.show(id)],
    [new RegExp('^#estimate/' + UUID + '$'), id => EstimateUi.show(id)],
    [new RegExp('^#estimate/' + UUID + '/import$'), id => EstimateImportUi.show(id)],
    [new RegExp('^#teikei/' + UUID + '$'), id => TeikeiUi.show(id)],
    [new RegExp('^#notice/' + UUID + '$'), id => NoticeUi.show(id)],
    [new RegExp('^#drawing/' + UUID + '$'), id => DrawingUi.show(id)],
    [new RegExp('^#doc/(report|estimate|notice|drawing|daily)/' + UUID + '$'), (type, id) => PreviewUi.show(type, id)]
  ];
  const leaveHooks = []; // 画面を離れる前（報告書の保存待ちなど）
  const onLeave = fn => leaveHooks.push(fn);
  const runLeave = async () => { for (const fn of leaveHooks) { try { await fn(); } catch (e) { console.warn(e); } } };

  // 所属が取れない人はログインしたまま「メンバーではありません」か「利用を終えています」の画面だけ（noMember。closed = 会社が利用を終えた＝my_status が 'closed'）
  let noMember = false, closed = false;
  // my_status が引けない（通信・関数の失敗）・思わぬ値なら throw（「メンバーではありません」「利用を終えています」と決めつけない。呼んだ側が「読み込めませんでした」）
  async function setNoMember() {
    const s = await sb.rpc('my_status');
    if (s.error || (s.data !== 'closed' && s.data !== 'none')) throw s.error || new Error('会社の状態を確かめられませんでした。開き直してください');
    noMember = true;
    ctx = null;
    closed = s.data === 'closed';
  }
  async function loadCtx(user) {
    const m = await sb.from('memberships').select('*').eq('user_id', user.id).maybeSingle();
    if (m.error) throw m.error;
    noMember = false;
    closed = false;
    if (!m.data) { await setNoMember(); return; }
    const o = await sb.from('orgs').select('*').eq('id', m.data.org_id).single();
    if (o.error) throw o.error;
    ctx = { user, membership: m.data, org: o.data };
    document.querySelectorAll('.js-org-name').forEach(e => { e.textContent = ctx.org.name || ''; });
  }
  let routing = Promise.resolve();
  function route() {
    routing = routing.then(async () => {
      await runLeave();
      const h = location.hash || '#cases';
      if (ctx || noMember) Idle.touch();
      if (noMember) { AuthUi.noMember(closed); return; }
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
    Idle.touch(true);
    try { await loadCtx(user); } catch (e) { throw new Error('読み込めませんでした: ' + errText(e)); }
    location.hash = '#cases';
  }
  let recovering = false;
  async function start() {
    renderTabs();
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === 'SIGNED_OUT') { ctx = null; noMember = false; closed = false; if (location.hash === '#login') route(); else location.hash = '#login'; }
      // 再設定メールのリンク・招待メールのリンク（js/supabase.js の SB_INVITE）から開いたら、パスワードを決める画面
      if (ev === 'PASSWORD_RECOVERY' || (ev === 'SIGNED_IN' && window.SB_INVITE)) { window.SB_INVITE = false; recovering = true; AuthUi.recovery(); }
    });
    window.addEventListener('hashchange', route);
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || !(ctx || noMember)) return;
      if (Idle.over()) { await idleLogout(); route(); } else Idle.touch();
    });
    try {
      const { data } = await sb.auth.getSession();
      // メールのリンク（招待・パスワードの再設定）から開いたときは今ログインしたところなので、前の時刻で切らない
      if (data && data.session && (recovering || window.SB_INVITE || window.SB_RECOVERY)) Idle.touch(true);
      if (data && data.session && Idle.over()) await idleLogout();
      else if (data && data.session) await loadCtx(data.session.user);
      // 初めの SIGNED_IN が onAuthStateChange を付ける前に済んでいたとき
      if (data && data.session && window.SB_INVITE) { window.SB_INVITE = false; recovering = true; AuthUi.recovery(); }
    } catch (e) {
      console.error(e);
      ctx = null;
      AuthUi.error('読み込めませんでした: ' + errText(e));
    }
    if (recovering) return; // パスワードを決める画面のまま（route すると案件の画面に替わってしまう）。決めたら AuthUi が signedIn を呼ぶ
    route();
  }
  // 役割を DB から引き直す（設定・単価表を開くとき。使っている間に権限が変わっても古いままにしない）。所属が無ければ「メンバーではありません」へ → false
  async function refreshRole() {
    const m = await sb.from('memberships').select('*').eq('user_id', ctx.user.id).maybeSingle();
    if (m.error) { console.warn(m.error); return true; } // 引けないときは今の役割のまま（本当の壁は DB）
    if (!m.data) { await setNoMember(); AuthUi.noMember(closed); return false; }
    ctx.membership = m.data;
    return true;
  }
  async function idleLogout() {
    // 書きかけ（報告書・見積書など）を先に保存する（ログアウトの後では保存できない）。保存が返らなくてもログアウトは止めない（5 秒まで待つ）
    await Promise.race([runLeave(), new Promise(r => setTimeout(r, LEAVE_WAIT_MS))]);
    const { error } = await sb.auth.signOut();
    if (error) { console.warn(error); ctx = null; noMember = false; closed = false; } // 通信できなくても入ったままにしない（次に開いたときにまた試す）
    AuthUi.info('30日使われなかったのでログアウトしました'); // 失敗ではないので赤くしない
  }
  // 設定で会社・自分を直したとき
  function setCtx(part, row) {
    ctx[part] = row;
    document.querySelectorAll('.js-org-name').forEach(e => { e.textContent = ctx.org.name || ''; });
  }
  return { start, route, signedIn, onLeave, setCtx, refreshRole };
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
// 写真・図面・ロゴ・社印の見るための URL（1時間。js/files.js）
async function signedUrl(path) {
  return path ? Files.url(path) : '';
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
