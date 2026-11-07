// js/calendar-ui.js — #calendar: 上の「優先順／カレンダー」（.seg）・優先順の一覧・月／週のカレンダー・下のタブ
// genba-docs の js/calendar-ui.js を写して減らした（担当者・候補・日時未定・＋・月のチップ・押した日の印は無い）。
// 月表示: 6週のマス・予定の帯（複数日は1本・はみ出す分は「+N」）・今日は丸。日を押すとその週の週表示。
// 週表示: 上に7日・終日（工事）の帯の段・時間の枠（0:00〜23:00）・今の時刻の線。開くと今の時刻あたりまでスクロール。
// 「11月 ▾」→ 月／週。右上の「今日」。左右スワイプと ‹ › で前後。帯を押すと #case/{id}。
// 優先順／カレンダー・月／週の選択は端末に覚える（localStorage・try/catch）。配置の計算は js/calendar-logic.js（テストあり）
const CalendarUi = (() => {
  const HOUR_H = 44;   // 週表示の1時間の高さ（px）
  const DAY_HEAD = 26; // 月のマスの日付の行の高さ
  const BAR_H = 19;    // 帯1段の高さ（間を含む）
  const K_VIEW = 'gyosha-tool.calview', K_MODE = 'gyosha-tool.calmode';
  const L = () => CalendarLogic;
  const pref = (k, ok, def) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : def; } catch (e) { return def; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 使えない端末ではこの画面の間だけ */ } };
  const today = () => L().todayOf(Date.now());
  const hm = min => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
  let cases = [], events = [], root = null, wired = false, timer = null;
  const st = { view: '', mode: '', anchor: '', scrollTop: null };

  function wire() {
    if (wired) return;
    wired = true;
    $('cal-view').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { st.view = b.dataset.v; setPref(K_VIEW, st.view); render(); }));
    // 画面の大きさが変わったら描き直す（アドレスバーの出入りのような小さな高さの変化では描き直さない）
    let size = { w: innerWidth, h: innerHeight }, rt = null;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (innerWidth === size.w && Math.abs(innerHeight - size.h) < 80) return;
        size = { w: innerWidth, h: innerHeight };
        if (root && root.isConnected) draw(false);
      }, 150);
    });
  }
  async function show() {
    wire();
    showScreen('calendar');
    if (!st.view) { st.view = pref(K_VIEW, ['list', 'cal'], 'list'); st.mode = pref(K_MODE, ['month', 'week'], 'month'); st.anchor = today(); }
    $('cal-msg').textContent = '';
    $('cal-host').replaceChildren(mk('div', 'empty', '読み込み中…'));
    try { cases = await CasesApi.list(); }
    catch (e) { $('cal-msg').textContent = '案件を読み込めませんでした: ' + errText(e); cases = []; }
    events = L().eventsFromCases(cases);
    render();
  }
  function render() {
    $('cal-view').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.view)));
    clearInterval(timer);
    root = null;
    if (st.view === 'list') { renderList(); return; }
    root = mk('div', 'cal');
    root.id = 'cal';
    $('cal-host').replaceChildren(root);
    swipe(root);
    draw(true);
    // 画面を離れたら止める（隠れた画面も DOM に残るので isConnected では分からない）。日が変われば描き直して今日の列・線を動かす
    timer = setInterval(() => {
      if (!root || !$('screen-calendar').classList.contains('active')) { clearInterval(timer); return; }
      if (root.dataset.today !== today()) draw(false); else nowLine();
    }, 60000);
  }

  /* ---------- 優先順 ---------- */
  function renderList() {
    const host = $('cal-host');
    host.replaceChildren();
    const { upcoming, past, undated } = L().priorityList(cases, Date.now());
    if (!cases.length) { host.appendChild(mk('div', 'empty', 'まだ案件がありません')); return; }
    const box = mk('div', 'list');
    box.id = 'cal-list';
    const now = Date.now();
    const sec = (title, list, id) => {
      if (!list.length) return;
      if (title) { const h = mk('div', 'sec-t cal-sec', title); h.id = id; box.appendChild(h); }
      list.forEach(c => {
        const a = mk('a', 'item');
        a.href = '#case/' + c.id;
        a.dataset.caseId = c.id;
        const when = CaseLogic.calLine(c, now);
        if (when) a.appendChild(mk('div', 'item-w', when));
        a.appendChild(mk('div', 'item-t', CaseLogic.placeName(c)));
        a.appendChild(mk('div', 'item-s', c.client_name || '（元請なし）'));
        box.appendChild(a);
      });
    };
    sec('', upcoming);
    sec('日程が過ぎた案件', past, 'cal-sec-past');
    sec('日程の無い案件', undated, 'cal-sec-none');
    host.appendChild(box);
  }

  /* ---------- 月／週 ---------- */
  function set(patch) { Object.assign(st, patch); draw(patch.mode !== undefined || patch.anchor !== undefined); }
  function step(dir) {
    if (st.mode === 'week') set({ anchor: L().addDays(L().weekStart(st.anchor), 7 * dir) });
    else { const p = L().parts(st.anchor), n = L().addMonths(p.y, p.m, dir); set({ anchor: L().ymdOf(n.y, n.m, 1) }); }
  }
  function swipe(el) {
    let x0 = null, y0 = 0;
    el.addEventListener('touchstart', ev => { if (ev.touches.length !== 1) { x0 = null; return; } x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', ev => {
      if (x0 == null) return;
      const t = ev.changedTouches[0], d = L().swipeDir(t.clientX - x0, t.clientY - y0);
      x0 = null;
      if (d) step(d);
    }, { passive: true });
  }
  // 画面の下（下のタブ）までの高さ（px）
  function avail(el) {
    const foot = $('screen-calendar').querySelector('.foot');
    return Math.floor(innerHeight - el.getBoundingClientRect().top - (foot ? foot.offsetHeight : 0) - 8);
  }
  function draw(scrollToNow) {
    const t = today(), tp = L().parts(t), ap = L().parts(st.anchor);
    const prevSc = root.querySelector('#cal-scroll');
    if (prevSc) st.scrollTop = prevSc.scrollTop; // 描き直しても時間の枠のスクロール位置を保つ
    root.dataset.mode = st.mode;
    root.dataset.today = t;
    root.replaceChildren();
    const top = mk('div', 'cal-top');
    const title = st.mode === 'week' ? L().weekTitle(L().weekStart(st.anchor), Date.now()) : L().monthTitle(ap.y, ap.m, Date.now());
    const tb = dBtn('', 'cal-title', () => menu(top));
    tb.id = 'cal-title';
    tb.setAttribute('aria-haspopup', 'menu');
    tb.setAttribute('aria-label', title + '（月／週を切り替える）');
    tb.append(mk('span', null, title), mk('span', 'cal-caret', '▾'));
    const prev = dBtn('‹', 'cal-nav', () => step(-1));
    prev.id = 'cal-prev';
    prev.setAttribute('aria-label', st.mode === 'week' ? '前の週' : '前の月');
    const next = dBtn('›', 'cal-nav', () => step(1));
    next.id = 'cal-next';
    next.setAttribute('aria-label', st.mode === 'week' ? '次の週' : '次の月');
    const td = dBtn('今日', 'cal-today', () => set({ anchor: today() }));
    td.id = 'cal-today';
    td.setAttribute('aria-label', '今日（' + tp.m + '/' + tp.d + '）へ');
    top.append(tb, mk('span', 'cal-sp'), prev, next, td);
    root.appendChild(top);
    if (st.mode === 'week') drawWeek(t, scrollToNow);
    else drawMonth(t);
  }
  // 「11月 ▾」の下の 月／週（入力の無い小さなメニュー。もう一度「11月 ▾」を押すか、選ぶと閉じる）
  function menu(top) {
    const old = top.querySelector('.cal-menu');
    if (old) { old.remove(); return; }
    const m = mk('div', 'cal-menu');
    m.id = 'cal-menu';
    m.setAttribute('role', 'menu');
    [['month', '月'], ['week', '週']].forEach(([k, label]) => {
      const b = dBtn(label, 'cal-menu-i' + (st.mode === k ? ' on' : ''), () => { m.remove(); if (st.mode !== k) { setPref(K_MODE, k); set({ mode: k }); } });
      b.dataset.mode = k;
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(st.mode === k));
      m.appendChild(b);
    });
    top.appendChild(m);
  }
  function bar(ev, cls) {
    const b = dBtn('', 'cal-ev k-' + ev.kind + (cls ? ' ' + cls : ''), () => { location.hash = '#case/' + ev.caseId; });
    b.dataset.caseId = ev.caseId;
    b.dataset.evId = ev.id;
    b.appendChild(mk('span', 'cal-ev-t', ev.title));
    const md = ymd => `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}`;
    const when = ev.allDay ? md(ev.startYmd) + (ev.endYmd > ev.startYmd ? '〜' + md(ev.endYmd) : '') : md(ev.startYmd) + ' ' + hm(ev.startMin) + '〜' + hm(ev.endMin);
    b.title = ev.title + ' ・ ' + when;
    b.setAttribute('aria-label', b.title);
    return b;
  }
  function weekdays(todayDow) {
    const wd = mk('div', 'cal-wd');
    L().WEEK.split('').forEach((w, i) => wd.appendChild(mk('span', i === todayDow ? 'on' : null, w)));
    return wd;
  }
  function drawMonth(t) {
    const ap = L().parts(st.anchor);
    const grid = L().monthGrid(ap.y, ap.m);
    root.appendChild(weekdays(grid.some(w => w.some(d => d.ymd === t)) ? L().dow(t) : -1));
    const month = mk('div', 'cal-month');
    month.id = 'cal-month';
    root.appendChild(month);
    const rowH = Math.max(innerWidth >= 700 ? 96 : 72, Math.floor(avail(month) / 6));
    const lanes = Math.max(1, Math.floor((rowH - DAY_HEAD - 2) / BAR_H));
    const toWeek = d => set({ mode: 'week', anchor: d.ymd });
    grid.forEach(week => {
      const lay = L().layoutWeek(events, week[0].ymd, lanes);
      const row = mk('div', 'cal-wk');
      row.dataset.week = week[0].ymd;
      row.style.height = rowH + 'px';
      row.style.gridTemplateRows = `${DAY_HEAD}px repeat(${lanes}, ${BAR_H}px) 1fr`;
      week.forEach((d, i) => {
        const cell = dBtn('', 'cal-day' + (d.inMonth ? '' : ' out') + (d.ymd === t ? ' today' : ''), () => toWeek(d));
        cell.style.gridColumn = String(i + 1);
        cell.dataset.ymd = d.ymd;
        cell.setAttribute('aria-label', `${d.m}月${d.d}日（${L().WEEK[i]}）の週を見る`);
        cell.appendChild(mk('span', 'cal-dn', String(d.d)));
        row.appendChild(cell);
      });
      lay.bars.forEach(b => {
        const el = bar(b.ev, (b.contL ? 'cl' : '') + (b.contR ? ' cr' : ''));
        el.style.gridColumn = `${b.col + 1} / span ${b.span}`;
        el.style.gridRow = String(b.lane + 2);
        row.appendChild(el);
      });
      lay.more.forEach((n, i) => {
        if (!n) return;
        const d = week[i];
        const more = dBtn('+' + n, 'cal-more', () => toWeek(d));
        more.style.gridColumn = String(i + 1);
        more.style.gridRow = String(lanes + 1);
        more.setAttribute('aria-label', `ほか${n}件（${d.m}/${d.d}）`);
        row.appendChild(more);
      });
      month.appendChild(row);
    });
  }
  function drawWeek(t, scrollToNow) {
    const ws = L().weekStart(st.anchor);
    const view = L().weekView(events, ws, 3);
    const todayCol = view.days.indexOf(t);
    const head = mk('div', 'cal-wh');
    head.id = 'cal-wh';
    head.appendChild(mk('span'));
    view.days.forEach((ymd, i) => {
      const d = mk('div', 'cal-whd' + (ymd === t ? ' today' : ''));
      d.dataset.ymd = ymd;
      d.append(mk('span', 'cal-whw', L().WEEK[i]), mk('span', 'cal-whn', String(L().parts(ymd).d)));
      head.appendChild(d);
    });
    root.appendChild(head);
    // 終日（工事）の帯の段
    const ad = mk('div', 'cal-allday');
    ad.id = 'cal-allday';
    const adLanes = view.allDay.lanes;
    ad.style.gridTemplateRows = adLanes ? `repeat(${adLanes}, ${BAR_H}px)` : '6px';
    view.allDay.bars.forEach(b => {
      const el = bar(b.ev, (b.contL ? 'cl' : '') + (b.contR ? ' cr' : ''));
      el.style.gridColumn = `${b.col + 2} / span ${b.span}`;
      el.style.gridRow = String(b.lane + 1);
      ad.appendChild(el);
    });
    view.allDay.more.forEach((n, i) => {
      if (!n) return;
      const m = mk('span', 'cal-more', '+' + n);
      m.style.gridColumn = String(i + 2);
      m.style.gridRow = String(adLanes);
      ad.appendChild(m);
    });
    root.appendChild(ad);
    // 時間の枠（0:00〜23:00）
    const sc = mk('div', 'cal-scroll');
    sc.id = 'cal-scroll';
    root.appendChild(sc);
    sc.style.height = Math.max(240, avail(sc)) + 'px';
    const inner = mk('div', 'cal-tg');
    inner.style.height = (24 * HOUR_H + 16) + 'px';
    const gut = mk('div', 'cal-hours');
    for (let h = 0; h < 24; h++) {
      const x = mk('span', 'cal-hl', h + ':00');
      x.style.top = (8 + h * HOUR_H) + 'px';
      gut.appendChild(x);
    }
    inner.appendChild(gut);
    const colW = (sc.clientWidth - 44) / 7;
    view.days.forEach((ymd, i) => {
      const col = mk('div', 'cal-col' + (ymd === t ? ' today' : ''));
      col.dataset.ymd = ymd;
      view.columns[i].forEach(x => {
        // 狭い箱（2つ以上並ぶ）は1文字ずつ折り返さず、行ごとに切る
        const el = bar(x.ev, 'box' + (x.cols > 1 && colW / x.cols < 56 ? ' narrow' : ''));
        el.style.top = (8 + x.top * HOUR_H / 60) + 'px';
        el.style.height = Math.max(16, (x.bottom - x.top) * HOUR_H / 60 - 2) + 'px';
        el.style.left = `calc(${(x.col / x.cols) * 100}% + 1px)`;
        el.style.width = `calc(${100 / x.cols}% - 3px)`;
        if (x.bottom - x.top >= 45 && colW >= 80) el.appendChild(mk('span', 'cal-ev-tm', hm(x.ev.startMin) + '〜' + hm(x.ev.endMin)));
        col.appendChild(el);
      });
      if (i === todayCol) { const line = mk('div', 'cal-now'); line.id = 'cal-now'; col.appendChild(line); }
      inner.appendChild(col);
    });
    sc.appendChild(inner);
    nowLine();
    // 開いたら今の時刻あたり（今日の週でなければ最初の予定か 8:00）までスクロール
    if (scrollToNow !== false) {
      let min = 8 * 60;
      if (todayCol >= 0) min = L().minOfMs(Date.now());
      else { const first = view.columns.flat().map(x => x.top).sort((a, b) => a - b)[0]; if (first != null) min = first; }
      sc.scrollTop = Math.max(0, 8 + min * HOUR_H / 60 - sc.clientHeight / 3);
    } else if (st.scrollTop != null) sc.scrollTop = st.scrollTop;
  }
  function nowLine() {
    const line = root && root.querySelector('#cal-now');
    if (line) line.style.top = (8 + L().minOfMs(Date.now()) * HOUR_H / 60) + 'px';
  }
  return { show };
})();
