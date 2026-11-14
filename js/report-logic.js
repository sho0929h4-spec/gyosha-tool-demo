// js/report-logic.js — 報告書の規則（UMD: ブラウザは window.ReportLogic / node は module.exports。tests/report-logic.test.js）
// 3つの作業区分（漏水調査／工事／その他）。漏水調査は report-tool の「調査」、工事は「設備修繕」と「復旧工事」を1つにしたもの（項目・文言は report-tool index.html 428-525行・717-737行から）。
// 変えたところ: 確認（validate）は注意だけ（PDF は作れる）。写真の区分は作業前／作業中／作業後だけ。
// 保存の形: reports.work_type = 'investigate' | 'work' | 'other'（古い保存の 'repair' | 'restore' は work として開く）、reports.data = 下の newData の形、reports.photos = [{ path, phase, caption, marks }]
(function (root) {
  const str = v => String(v == null ? '' : v).trim();
  const WTYPE_MODE = { '漏水調査': 'investigate', '工事': 'work', 'その他': 'other', '調査': 'investigate', '設備修繕': 'work', '復旧工事': 'work' };
  const MODE_LABEL = { investigate: '漏水調査', work: '工事', other: 'その他' };
  const INV_ITEMS = ['目視確認', '耐圧テスト（給湯管）', '耐圧テスト（給水管）', '排水テスト', '洗濯パン脱着', '点検口から床下確認'];
  // 場所を選べる項目（漏水調査。排水テストとその他。選んだ場所は data.places[項目] = ['キッチン', ...]。出力は「排水テスト（キッチン・浴室）」）
  const INV_PLACE_ITEMS = ['排水テスト', 'その他'];
  const WORK_ITEMS = ['給湯管更新・交換', '給水管更新・交換', '配管修繕', '水栓交換', '開口補修・復旧', '防水工事'];
  const RESTORE_PLACES = ['廊下', 'キッチン', '洗面所', '浴室', 'トイレ', '居室', 'ベランダ'];
  const RESTORE_PARTS = ['天井', '壁', '床', 'ダウンライト'];
  const AFTER_STATUS = ['正常に復旧', '様子見（経過観察）', '一部未完了（再訪予定）', '要追加工事'];
  const LEAK = ['止まっている', '漏れている（継続的）', '漏れている（断続的）'];
  // [値, 表示]（元栓閉めは「元栓を閉めた」と出し、号室を足して「605号室元栓閉め」にする）
  const LEAK_ACTION = [['養生対応済み', '養生対応済み'], ['すでに養生対応済み', 'すでに養生対応済み'], ['入居者希望により養生せず', '入居者希望により養生せず'], ['元栓閉め', '元栓を閉めた']];

  /* 作業チェックリスト（全区分同じ・報告書に出力。2026-11-08 に短い2項目へ） */
  const CHECK_ITEMS = ['作業後清掃', '写真手ブレ確認'];
  const WORK_CHECKLISTS = { investigate: CHECK_ITEMS, work: CHECK_ITEMS, other: CHECK_ITEMS };
  // 同じ案件に PDF を作った工事掲示があるとき、工事のチェックリストの最後に足す（簡易版 Task 80 と同じ考え。注意だけ）
  const NOTICE_REMOVED = '工事掲示を取り外した';
  /* 利用者ごとの項目（memberships.report_items = { investigate: [...], work: [...], check: [...] }。無いキーは上の最初の項目）
     investigate・work = 作業実施項目、check = 作業チェックリスト。ログインした時に setCustom で入れる */
  const DEFAULT_LISTS = { investigate: INV_ITEMS, work: WORK_ITEMS, check: CHECK_ITEMS };
  const ITEM_MAX = 40, ITEMS_MAX = 30;
  const RESERVED = ['その他', '場所その他', '部位その他', NOTICE_REMOVED]; // 自由記載の印・自動で足す項目と同じ名前は使えない
  const cleanList = v => [...new Set((Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x.trim().slice(0, ITEM_MAX) : '')).filter(x => x && !RESERVED.includes(x)))].slice(0, ITEMS_MAX);
  function cleanCustom(c) {
    const out = {};
    Object.keys(DEFAULT_LISTS).forEach(k => { if (c && Array.isArray(c[k])) out[k] = cleanList(c[k]); });
    return out;
  }
  let custom = {};
  const setCustom = c => { custom = cleanCustom(c); };
  const listOf = k => custom[k] || DEFAULT_LISTS[k];

  const MODES = {
    investigate: {
      checkCardTitle: '作業実施項目', contentCardTitle: '作業内容',
      checkGroups: [{ title: null, items: INV_ITEMS, list: 'investigate', free: true, freePrefix: 'その他', placeItems: INV_PLACE_ITEMS }],
      f1Last: true,
      f1Label: '作業実施内容', f1Req: true,
      showLeak: true, showAfter: false, showF2: true, showReason: true, showF4: true,
      f1ph: '例：605号室キッチン脇のダウンライトまわりから漏水を確認。給水管の耐圧テストを実施。',
      ctxPhotoLabel: '原因箇所の写真',
      reqField: 'f1',
      rSection: '調査結果',
      rRows: [
        { label: '漏水の状況', field: 'leak' },
        { label: '漏水時の対応', field: 'leakAction' },
        { label: '原　因', field: 'f2' },
        { label: '原因と判断した理由', field: 'reason' },
        { label: '作業実施内容', field: 'f1' },
        { label: '次の必要な対応', field: 'f4', next: true }
      ]
    },
    work: {
      checkCardTitle: '作業実施項目・施工範囲', contentCardTitle: '作業内容',
      checkGroups: [
        { title: '作業実施項目', items: WORK_ITEMS, list: 'work', free: true, freePrefix: 'その他' },
        { title: '場所', items: RESTORE_PLACES, free: true, freePrefix: '場所その他' },
        { title: '部位', items: RESTORE_PARTS, free: true, freePrefix: '部位その他' }
      ],
      f1Label: '作業実施内容', f1Req: true,
      showLeak: false, showAfter: true, showF2: false, showReason: false, showF4: false, showNote: true,
      f1ph: '例：既存給湯管を撤去し新規樹脂管（16mm）に更新。接続部の防水処理を実施。通水確認済み。漏水なし。',
      noteph: '入居者からの伝達事項・引き継ぎ事項などがあれば記載',
      ctxPhotoLabel: '年式・型番が分かる写真／作業前・作業中・作業後・養生の写真',
      reqField: 'f1',
      rSection: '作業結果',
      rRows: [
        { label: '作業実施内容', field: 'f1' },
        { label: '対応後の状況', field: 'afterStatus' },
        { label: '申し送り', field: 'note' }
      ]
    },
    other: {
      checkCardTitle: null, contentCardTitle: '作業内容',
      checkGroups: [],
      f1Label: '作業実施内容', f1Req: true,
      showLeak: false, showAfter: false, showF2: false, showReason: false, showF4: false, showNote: true,
      f1ph: '例：実施した作業の内容・確認した箇所など',
      noteph: '入居者からの伝達事項・引き継ぎ事項などがあれば記載',
      ctxPhotoLabel: '作業前・作業中・作業後の写真',
      reqField: 'f1',
      rSection: '作業結果',
      rRows: [
        { label: '作業実施内容', field: 'f1' },
        { label: '申し送り', field: 'note' }
      ]
    }
  };
  // 欄の説明（report-tool の hint をそのまま）
  const HINT = {
    f1: '実施した作業・調査の詳細・手順・確認箇所など',
    f2: '特定できた場合のみ。不明な場合は次の必要な対応へ。',
    reason: 'そう判断した根拠・確認した事実など（自由記載）',
    f4: '原因不明時や追加工事が必要な場合の方針'
  };
  const PHASES = { '': '— 区分 —', wbefore: '作業前', wduring: '作業中', wafter: '作業後' };
  const PHASE_COLORS = { wbefore: '#2563eb', wduring: '#ea580c', wafter: '#0d9488' };

  // 古い保存（repair・restore）は work として開く。知らない名前は investigate
  const modeOf = m => (MODES[m] ? m : (m === 'repair' || m === 'restore') ? 'work' : 'investigate');
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // 新しい報告書の data（物件名・号室は案件から。案件No は report-tool と同じ「YYMMDD-01」）
  function newData(caseRow, now) {
    const d = now || new Date();
    const c = caseRow || {};
    return {
      prop: str(c.name), room: str(c.room), caseNo: `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-01`,
      workDate: isoDate(d), ts: '', te: '', items: [], free: {}, places: {},
      f1: '', note: '', workLabel: '', f2: '', f4: '', reason: '', leak: '', leakAction: '', leakRoom: '', afterStatusSel: '', afterNote: '',
      workChecklist: []
    };
  }
  const arr = v => (Array.isArray(v) ? v : []);
  // 実施項目／施工範囲（今の区分の項目だけ。場所を選べる項目は「排水テスト（キッチン・浴室）」、自由記載は「その他: 〇〇」）
  // 今の区分の項目のまとまり。list のあるまとまり（作業実施項目）は利用者の項目に替え、
  // この報告書でチェック済みなのに一覧に無い項目（消した項目・ほかの人の項目）を後ろに足す（消しても前の報告書からは消えない）
  function groups(mode, d) {
    const m = modeOf(mode);
    const gs = MODES[m].checkGroups.map(g => (g.list ? Object.assign({}, g, { items: listOf(g.list) }) : g));
    const shown = gs.flatMap(g => g.items.concat(g.free ? [g.freePrefix] : []));
    const others = Object.keys(MODES).filter(k => k !== m).flatMap(k => MODES[k].checkGroups.flatMap(g => (g.list ? listOf(g.list).concat(g.items) : g.items).concat(g.free ? [g.freePrefix] : [])));
    const extra = arr(d && d.items).filter(i => typeof i === 'string' && i && !shown.includes(i) && !others.includes(i));
    return gs.map(g => (g.list && extra.length ? Object.assign({}, g, { items: g.items.concat(extra) }) : g));
  }
  function checkedItems(d, mode) {
    const on = arr(d && d.items), free = (d && d.free) || {}, places = (d && d.places) || {};
    const out = [];
    groups(mode, d).forEach(g => {
      const withPlace = i => { const p = arr(g.placeItems).includes(i) ? arr(places[i]).filter(x => RESTORE_PLACES.includes(x)) : []; return p.length ? `${i}（${p.join('・')}）` : i; };
      g.items.forEach(i => { if (on.includes(i)) out.push(withPlace(i)); });
      if (g.free && on.includes(g.freePrefix)) { const t = str(free[g.freePrefix]); out.push(t ? `${withPlace(g.freePrefix)}: ${t}` : withPlace(g.freePrefix)); }
    });
    return out;
  }
  // 漏水時の対応: 漏れているときだけ。元栓閉めは「605号室元栓閉め」
  function leakActionText(d) {
    if (!str(d && d.leak).startsWith('漏れている')) return '';
    const v = str(d.leakAction);
    if (v === '元栓閉め') { const rm = str(d.leakRoom); return (rm ? rm + '号室' : '') + '元栓閉め'; }
    return v;
  }
  const afterStatusText = d => [str(d && d.afterStatusSel), str(d && d.afterNote)].filter(Boolean).join('　');
  const timeStr = d => { const ts = str(d && d.ts), te = str(d && d.te); return ts && te ? `${ts} 〜 ${te}` : ts ? `${ts} 〜` : ''; };
  function fmtDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(iso))) return '';
    const d = new Date(iso + 'T00:00:00');
    const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${wd}）`;
  }
  const todayJa = (now) => { const d = now || new Date(); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
  // 作業チェックリスト（利用者の項目の順。この報告書でチェック済みなのに一覧に無い項目は後ろに足す）
  //   withNotice: 画面に「工事掲示を取り外した」を出すか（工事のときだけ）。PDF ではチェックしてあれば出す
  function workItems(mode, withNotice, d) {
    const list = listOf('check');
    const extra = arr(d && d.workChecklist).filter(i => typeof i === 'string' && i && i !== NOTICE_REMOVED && !list.includes(i));
    return list.concat(extra, modeOf(mode) === 'work' && withNotice !== false ? [NOTICE_REMOVED] : []);
  }
  const workChecked = (d, mode) => workItems(mode, true, d).filter(i => arr(d && d.workChecklist).includes(i));
  // 結果の表（値がある行だけ）
  function resultRows(d, mode) {
    const vals = { f1: str(d.f1), note: str(d.note), f2: str(d.f2), f4: str(d.f4), leak: str(d.leak), leakAction: leakActionText(d), reason: str(d.reason), afterStatus: afterStatusText(d) };
    return MODES[modeOf(mode)].rRows.filter(r => vals[r.field]).map(r => ({ label: r.label, value: vals[r.field], next: !!r.next }));
  }
  // 紙面の編集パネル（report-sheet-ui）で直せる欄。afterStatus は表示だけ（afterStatusSel＋afterNote から作る）
  const SHEET_FIELDS = ['f1', 'leak', 'leakAction', 'f2', 'reason', 'f4', 'note', 'afterStatusSel', 'afterNote'];
  const setField = (d, field, value) => (SHEET_FIELDS.includes(field) ? Object.assign({}, d, { [field]: value == null ? '' : String(value) }) : d);
  // 写真の並べ替え（dir = -1 前へ／1 後へ。端では何もしない）・外す。どちらも新しい配列
  function movePhoto(photos, i, dir) {
    const a = arr(photos).slice(), j = i + dir;
    if (i < 0 || i >= a.length || j < 0 || j >= a.length) return a;
    [a[i], a[j]] = [a[j], a[i]];
    return a;
  }
  const removePhoto = (photos, i) => arr(photos).filter((_, k) => k !== i);
  // 確認（注意だけ。report-tool の validate の文言。必須の不備と、確認が推奨される項目の順）
  function validate(d, mode, nPhotos) {
    const cfg = MODES[modeOf(mode)];
    const out = [];
    if (!str(d.prop)) out.push('物件名が未入力です');
    if (!str(d.room)) out.push('号室が未入力です');
    if (!str(d.workDate)) out.push('作業日が未入力です');
    if (cfg.reqField === 'f1' && !str(d.f1)) out.push(`「${cfg.f1Label}」が未入力です`);
    if (modeOf(mode) === 'other' && !str(d.workLabel)) out.push('作業区分の名前が空です');
    if (str(d.ts) && str(d.te) && str(d.te) < str(d.ts)) out.push('作業終了時間が開始時間より前になっています');
    if (cfg.checkGroups.length > 0 && checkedItems(d, mode).length === 0) out.push(`${cfg.checkCardTitle}が1件も選択されていません`);
    if (!nPhotos) out.push('写真が1枚もアップロードされていません');
    if (!str(d.ts)) out.push('作業開始時刻が未入力です');
    return out;
  }
  // 区分の名前（その他は自由記載。空なら「その他」）
  const modeName = (mode, d) => (modeOf(mode) === 'other' ? str(d && d.workLabel) || 'その他' : MODE_LABEL[modeOf(mode)]);
  const docLabel = (mode, d) => modeName(mode, d) + '報告書';

  const api = { WTYPE_MODE, MODE_LABEL, INV_ITEMS, INV_PLACE_ITEMS, RESTORE_PLACES, RESTORE_PARTS, AFTER_STATUS, LEAK, LEAK_ACTION, WORK_CHECKLISTS, NOTICE_REMOVED, DEFAULT_LISTS, ITEM_MAX, ITEMS_MAX, MODES, HINT, PHASES, PHASE_COLORS,
    modeOf, modeName, newData, checkedItems, leakActionText, afterStatusText, timeStr, fmtDate, todayJa, workItems, workChecked, groups, setCustom, cleanCustom, listOf, resultRows, validate, docLabel, setField, movePhoto, removePhoto };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReportLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
