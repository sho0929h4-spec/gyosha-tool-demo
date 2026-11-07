// js/notice-logic.js — 工事掲示の規則（UMD: ブラウザは window.NoticeLogic / node は module.exports。tests/notice-logic.test.js）。DOM に触らない
// 文言・決まりは移植メモ §4（元の工事掲示PDF作成 app.js の WORK_TYPES・buildNoticeTexts・buildBodyText・render・normalizeEditText・baseFileName）から写した。
// 変えたところ: 連絡先は会社の設定（orgs の name・address・tel）から入れる（書き換えはできる）。連絡先の登録簿（localStorage）は無い。
// 保存の形（notices.data）は移植メモ §4.9 のとおり（newData の形）。PDF を作ったら pdf_at が入る。
(function (root) {
  const str = v => String(v == null ? '' : v).trim();
  const num = v => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };

  // 工事内容。本文・注記の文言はここだけ。extra は選んだときだけ出す欄（data のキー）
  const WORK_TYPES = [
    { key: 'noise', label: '音が出る工事', text: '作業中は騒音が発生いたします。' },
    { key: 'vibration', label: '振動がある工事', text: '作業中は振動が発生いたします。' },
    { key: 'water', label: '断水がある', text: '断水中はトイレ・浴室・キッチン・洗面台など、水回りのご使用をお控えください。' },
    { key: 'drain', label: '排水制限がある', text: '作業中はキッチン・浴室・洗面台・洗濯機など、排水を伴うご使用をお控えください。',
      extra: { key: 'drainRooms', label: '排水制限のかかる号室', placeholder: '例：501〜503号室、全戸' } },
    { key: 'traffic', label: '通行制限がある', text: '作業中は一部通行しにくい場合がございます。' },
    { key: 'odor', label: '臭気が発生する可能性がある', text: '作業中は一時的に臭気が発生する可能性がございます。' },
    { key: 'other', label: 'その他（自由記入）', text: '',
      extra: { key: 'otherWorkText', label: 'その他の工事内容', placeholder: '例：高圧洗浄機を使用いたします' } }
  ];
  const NOISE_VIBRATION_TEXT = '作業中は騒音・振動が発生いたします。';
  // 赤・太字で強調する所（固定。欄は無い）: 題の号室、記書きの【排水制限】【工事日】【作業時間】の行と ※注記
  const EMPHASIS = ['drain', 'date', 'time'];
  const REQUIRED = [['propertyName', '物件名'], ['roomNo', '号室'], ['workName', '工事名称']];
  // プレビューで直したとき、入力欄へ書き戻すキー（ほかは overrides に入れる）
  const WRITE_BACK = ['addressee', 'contactCompany', 'contactAddress', 'contactTel'];
  const GREETING = '〜工事施工のご挨拶〜';
  const OPENING = '拝啓　時下益々ご清栄のこととお慶び申し上げます。';
  const P2 = ['近隣にお住まいの皆様にはご不便とご迷惑をおかけいたしますが、', '細心の注意を払いながら安全第一に工事を進めて参りますので、', 'ご理解とご協力の程、宜しくお願いいたします。'];
  const P3 = ['なお、何かお気づきの点がございましたら下記連絡先までご一報下さいます様、', '重ねて宜しくお願い申し上げます。'];
  // 直接編集した所の名前（「自動の文に戻す」のボタン）
  const DETAIL_NAME = { place: '工事場所', content: '工事内容', drain: '排水制限', date: '工事日', time: '作業時間' };
  const SLOT_NAME = { noticeDate: '通知日', greeting: '挨拶の見出し', opening: '書き出し', subject: '題', body: '本文', closing: '敬具', ki: '記', contactTitle: 'お問い合わせ先の見出し' };
  const slotName = key => SLOT_NAME[key] || (/^detailLabel\./.test(key) ? '【' + (DETAIL_NAME[key.slice(12)] || '') + '】の見出し' : /^detail\./.test(key) ? '【' + (DETAIL_NAME[key.slice(7)] || '') + '】' : key);

  // '502' → '502号室'。「号室」「号」が付いていても重ねない
  function normalizeRoom(v) {
    const s = str(v);
    if (!s) return '';
    if (/号室$/.test(s)) return s;
    if (/号$/.test(s)) return s + '室';
    return s + '号室';
  }
  // 何部屋か: 数字（全角も）で終われば normalizeRoom、そうでなければそのまま（「全戸」など）
  const normalizeRooms = v => { const s = str(v); return !s ? '' : /[0-9０-９]$/.test(s) ? normalizeRoom(s) : s; };
  const asSentence = v => { const s = str(v); return !s ? '' : /[。．.！!？?]$/.test(s) ? s : s + '。'; };
  // '08:30' → '8:30'
  const formatTime = v => { const s = str(v); const m = s.match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) + ':' + m[2] : s; };

  function noticeDate(d) {
    const y = num(d && d.noticeYear), m = num(d && d.noticeMonth);
    if (!y || !m) return '';
    if (d.noticeKichijitsu) return `${y}年${m}月吉日`;
    const day = num(d.noticeDay);
    return day ? `${y}年${m}月${day}日` : `${y}年${m}月`;
  }
  function dateParts(v) {
    const p = str(v).split('-');
    if (p.length !== 3) return null;
    const y = num(p[0]), m = num(p[1]), day = num(p[2]);
    return y && m && day ? { y, m, d: day, key: y * 10000 + m * 100 + day } : null;
  }
  // 1日なら「2026年9月9日」、期間なら「2026年9月7日 〜 9月9日」（年をまたぐときだけ終わりにも年）
  function workDate(d) {
    if (d && d.workDateTbd) return '未定';
    const s = dateParts(d && d.workDate);
    if (!s) return '未定';
    const start = `${s.y}年${s.m}月${s.d}日`;
    const e = dateParts(d.workDateEnd);
    if (!e || e.key <= s.key) return start;
    return start + ' 〜 ' + (e.y !== s.y ? e.y + '年' : '') + `${e.m}月${e.d}日`;
  }
  function workTime(d) {
    const s = formatTime(d && d.timeStart), e = formatTime(d && d.timeEnd);
    const t = s && e ? `${s} 〜 ${e}` : s || e;
    return !t ? '' : d.timePlanned ? t + '（予定）' : t;
  }
  // 選んだ工事内容の文（表の順。音＋振動は1文。同じ文は1度だけ）
  function noticeTexts(d) {
    const wt = (d && d.workTypes) || {};
    const out = [];
    if (wt.noise && wt.vibration) out.push(NOISE_VIBRATION_TEXT);
    else WORK_TYPES.slice(0, 2).forEach(w => { if (wt[w.key]) out.push(w.text); });
    WORK_TYPES.slice(2).forEach(w => {
      if (!wt[w.key]) return;
      const t = w.key === 'other' ? asSentence(d.otherWorkText) : w.text;
      if (t) out.push(t);
    });
    return out.filter((t, i) => out.indexOf(t) === i);
  }
  // 記書きの注記: 頭に「※」、最後の「。」を取る
  const toNotes = texts => texts.map(t => '※' + t.replace(/。$/, ''));
  const autoAddressee = d => (str(d && d.propertyName) || '（物件名）') + 'に居住中の皆様へ';
  const addresseeOf = d => (d && d.addresseeEdited && str(d.addressee)) || autoAddressee(d);
  // 連絡先は data の値（会社の設定から入れたもの）。まだ入れていない古い data だけ会社の設定を使う
  const contactOf = (d, org, k, ok) => (d && d[k] != null ? str(d[k]) : str(org && org[ok]));

  // 掲示の文面（自動の文。直接編集 overrides は画面と PDF の組み立てで当てる）
  function compose(data, org) {
    const d = data || {};
    const room = normalizeRoom(d.roomNo) || '（号室）';
    const prop = str(d.propertyName) || '（物件名）';
    const work = str(d.workName) || '（工事名称）';
    const texts = noticeTexts(d);
    const p1 = [`下記のとおり、${room}にて${work}を実施いたします。`, ...texts, ...String(d.otherNotice || '').split(/\r?\n/).map(str).filter(Boolean)];
    const details = [
      { key: 'place', label: '【工事場所】', value: prop + '　' + room, notes: [] },
      { key: 'content', label: '【工事内容】', value: work, notes: toNotes(texts) }
    ];
    const drain = (d.workTypes || {}).drain ? normalizeRooms(d.drainRooms) : '';
    if (drain) details.push({ key: 'drain', label: '【排水制限】', value: drain, notes: [] });
    details.push({ key: 'date', label: '【工事日】', value: workDate(d), notes: [] });
    const time = workTime(d);
    if (time) details.push({ key: 'time', label: '【作業時間】', value: time, notes: [] });
    return {
      addressee: addresseeOf(d), noticeDate: noticeDate(d), greeting: GREETING, opening: OPENING,
      subject: '「　' + room + '　' + work + 'のお知らせ　」',
      body: [p1, P2.slice(), P3.slice()], closing: '敬具', ki: '記', details,
      contact: { title: 'お問い合わせ先', company: contactOf(d, org, 'contactCompany', 'name'), address: contactOf(d, org, 'contactAddress', 'address'), tel: contactOf(d, org, 'contactTel', 'tel') }
    };
  }

  // 新しい掲示の data（物件名・号室は案件から。連絡先は会社の設定から）
  function newData(caseRow, today, org) {
    const t = today || new Date();
    const c = caseRow || {}, o = org || {};
    const workTypes = {};
    WORK_TYPES.forEach(w => { workTypes[w.key] = false; });
    return {
      propertyName: str(c.name), addressee: '', addresseeEdited: false,
      noticeYear: String(t.getFullYear()), noticeMonth: String(t.getMonth() + 1), noticeDay: '', noticeKichijitsu: true,
      workDate: '', workDateEnd: '', workDateTbd: false, timeStart: '', timeEnd: '', timePlanned: true,
      roomNo: str(c.room), workName: '復旧工事', workTypes, drainRooms: '', otherWorkText: '', otherNotice: '',
      contactCompany: str(o.name), contactAddress: str(o.address), contactTel: str(o.tel), overrides: {}
    };
  }
  // 必須（PDF を作るときだけ）: { missing: [キー], text }
  function validate(data) {
    const miss = REQUIRED.filter(([k]) => !str(data && data[k]));
    return { missing: miss.map(([k]) => k), text: miss.length ? '必須項目が未入力です：' + miss.map(([, l]) => l).join('、') : '' };
  }
  // 画面から消えた所の直接編集は捨てる
  function pruneOverrides(overrides, visibleKeys) {
    const keep = new Set(visibleKeys || []), out = {};
    Object.keys(overrides || {}).forEach(k => { if (keep.has(k)) out[k] = overrides[k]; });
    return out;
  }
  // 何行も書ける所は本文と記書きの値だけ
  const isMultiline = key => key === 'body' || String(key).indexOf('detail.') === 0;
  // プレビューの文字の読み取り: 特殊な空白をならす。1行の所は改行を空白に、何行もの所は行末の空白と3つ以上の改行を詰める
  function readSlot(key, text) {
    const t = String(text == null ? '' : text).replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n');
    if (!isMultiline(key)) return t.replace(/\n+/g, ' ').trim();
    return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
  }
  const safe = s => str(s).replace(/[\\/:*?"<>|]/g, '_').replace(/[\x00-\x1f]/g, '').replace(/\s+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  // 工事掲示_{物件名}_{号室}_{工事日}.pdf（工事日の空白は詰める）
  const fileName = d => '工事掲示_' + safe(d && d.propertyName) + '_' + safe(normalizeRoom(d && d.roomNo)) + '_' + safe(workDate(d || {}).replace(/\s+/g, '')) + '.pdf';
  // 書類の名前（案件画面・プレビュー・共有）: 「工事掲示 302号室」
  const docLabel = d => ['工事掲示', normalizeRoom(d && d.roomNo)].filter(Boolean).join(' ');

  const api = { WORK_TYPES, NOISE_VIBRATION_TEXT, EMPHASIS, REQUIRED, WRITE_BACK,
    normalizeRoom, normalizeRooms, asSentence, formatTime, noticeDate, workDate, workTime, noticeTexts, toNotes,
    autoAddressee, compose, newData, validate, pruneOverrides, isMultiline, readSlot, fileName, docLabel, slotName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NoticeLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
