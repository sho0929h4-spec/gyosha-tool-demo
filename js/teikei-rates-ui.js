// js/teikei-rates-ui.js — 05 設定: 定型見積の単価表。#settings/teikei（部位ごとのセットの一覧）・#settings/teikei/{setId}（1つのセットを直す）
//   直した分は保存するまで画面の中だけ（自動保存はしない）。「保存する」で TeikeiApi.saveRates。保存しないで設定の外へ出るときは確かめる
//   単価表の変更は、このあとに作る定型見積から効く（作った見積は data に自分の単価を持っている）
//   一般管理費（共通費）のセットは 行＋プリセットの係数だけ直せる（auto・day_linked はそのまま）。セットの options（養生率・1階）もそのまま
const TeikeiRatesUi = (() => {
  const TL = TeikeiLogic;
  let draft = null, dirty = false, wired = false;
  const yen = n => (Number(n) || 0).toLocaleString('ja-JP');
  const vs = v => (v == null ? '' : String(v));
  const touch = () => { dirty = true; $('tr-sub').textContent = '保存していない変更があります'; };
  const setHref = id => '#settings/teikei/' + encodeURIComponent(id);

  async function load() {
    if (draft && dirty) return; // 直している途中は画面の中のものを使う。それ以外は毎回読み直す
    draft = await TeikeiApi.rates();
    dirty = false;
  }
  function msg(text, good) { const m = $('tr-msg'); if (!m) return; m.textContent = text || ''; m.className = 'msg' + (text ? (good ? ' ok' : ' err') : ''); }

  // 保存できない単価表（共通費が無い・セットの id が重なる）は止める
  function problem(r) {
    if (!TL.keihiSet(r)) return '一般管理費（共通費）のセットが無いので保存できません';
    const ids = TL.sets(r).map(s => s.id);
    if (new Set(ids).size !== ids.length) return '同じ id のセットが2つあるので保存できません';
    return '';
  }
  async function save() {
    const p = problem(draft);
    if (p) { toast(p); return false; }
    $('tr-save').disabled = true;
    try {
      await TeikeiApi.saveRates(draft);
      delete draft.isDefault;
      dirty = false;
      $('tr-sub').textContent = '保存しました';
      if ($('tr-now')) $('tr-now').textContent = 'この会社の単価表を使っています。';
      toast('単価表を保存しました。このあとに作る定型見積から使います');
      return true;
    } catch (e) { toast('保存できませんでした: ' + errText(e)); return false; }
    finally { $('tr-save').disabled = false; }
  }
  // 一覧とセットの間の行き来では何もしない（直した分は画面の中に持ったまま）
  App.onLeave(async () => {
    if (!dirty || /^#settings\/teikei(\/|$)/.test(location.hash)) return;
    const yes = await askPopup('単価表の変更を保存していません。保存しますか？\n保存しないと、直した分は消えます。', { title: '定型見積の単価表', okLabel: '保存する', cancelLabel: '保存しないで離れる', id: 'tr-leave-ask' });
    if (!yes) { draft = null; dirty = false; } else await save(); // 保存に失敗したら直した分は持ったまま（次に開くと load が戻す）
  });

  function wire() {
    if (wired) return;
    wired = true;
    $('tr-save').addEventListener('click', save);
  }
  async function open(title, back) {
    wire();
    $('tr-title').textContent = title;
    $('tr-back').href = back;
    $('tr-body').replaceChildren();
    showScreen('tkrates');
    await load();
    $('tr-sub').textContent = dirty ? '保存していない変更があります' : draft.isDefault ? '標準の単価表' : '会社の単価表';
  }
  const card = title => { const c = mk('div', 'card'); if (title) c.appendChild(mk('div', 'card-t', title)); return c; };
  const msgBox = () => { const m = mk('div', 'msg'); m.id = 'tr-msg'; m.setAttribute('role', 'status'); return m; };

  /* ---------- 一覧 ---------- */
  async function showList() {
    await open('定型見積の単価表', '#settings');
    const body = $('tr-body');
    const top = card();
    const now = mk('div', 'hint', draft.isDefault ? '標準の単価表を使っています。直して保存すると、この会社の単価表になります。' : 'この会社の単価表を使っています。');
    now.id = 'tr-now';
    top.append(now, mk('div', 'hint', '直した単価は、このあとに作る定型見積から使います（作った見積の中身は変わりません）。'));
    top.appendChild(msgBox());
    body.appendChild(top);
    const link = (s, text, sub) => {
      const a = mk('a', 'btn ghost sm tk-set tr-set');
      a.href = setHref(s.id);
      a.dataset.set = s.id;
      a.append(mk('span', null, text), mk('small', null, sub));
      return a;
    };
    const k = TL.keihiSet(draft);
    if (k) {
      const c = card('一般管理費');
      c.appendChild(link(k, '一般管理費（共通費）', k.items.length + '行 ・ 係数 ' + (k.presets || []).map(p => p.label + '×' + p.coef).join('／')));
      body.appendChild(c);
    }
    TL.partsOf(draft).forEach(p => {
      const c = card(p.part || '（部位未設定）');
      p.sets.forEach(s => c.appendChild(link(s, s.work || '（工事名なし）', (s.category === 'オプション' ? 'オプション ・ ' : '') + (s.items || []).length + '行 ・ 既定 ' + yen(TL.setDefaultTotal(s)) + '円')));
      body.appendChild(c);
    });
    const add = dBtn('＋ セットを足す', 'btn ghost', () => {
      const id = 'usr-' + Date.now().toString(36);
      draft.sets.push({ id, category: '標準', part: 'その他', work: '新しい工事', items: [{ name: '', spec: '', qty: 1, unit: '式', price: 0 }] });
      touch();
      location.hash = setHref(id);
    });
    add.id = 'tr-add-set';
    const reset = dBtn('標準の単価表に戻す', 'btn ghost sm danger', async () => {
      if (!(await askPopup('標準の単価表に戻しますか？\nこの会社で直した単価表は消えます。作った見積の中身は変わりません。', { title: '標準の単価表に戻す', okLabel: '標準に戻す', danger: true, id: 'tr-reset-ask' }))) return;
      try { await TeikeiApi.resetRates(); } catch (e) { toast('戻せませんでした: ' + errText(e)); return; }
      draft = null;
      await showList();
      msg('標準の単価表に戻しました', true);
    });
    reset.id = 'tr-reset';
    // 単価表をファイル（JSON）で出し入れ。自社の単価表や他の会社から受け取った表を入れる。読み込んだら「保存」でこの会社の単価表になる
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.id = 'tr-file';
    file.hidden = true;
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      const r = TL.parseRates(await f.text());
      if (r.error) { msg('読み込めませんでした: ' + r.error); return; }
      draft = r.data;
      dirty = true;
      await showList();
      msg('ファイルを読み込みました（' + TL.sets(draft).length + 'セット）。「保存」を押すとこの会社の単価表になります', true);
    });
    const imp = dBtn('ファイルから読み込む', 'btn ghost sm', () => file.click());
    imp.id = 'tr-import';
    const exp = dBtn('ファイルに書き出す', 'btn ghost sm', () => {
      const out = { version: draft.version || '', sets: draft.sets };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
      a.download = '定型見積の単価表_' + EstimateLogic.ymd(new Date()) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    exp.id = 'tr-export';
    const io = mk('div', 'grid2');
    io.append(imp, exp);
    body.append(add, io, file, reset);
  }

  /* ---------- 1つのセット ---------- */
  function input(id, label, value, attrs, onInput) {
    const f = mk('div', 'ff'), l = mk('label', null, label), e = mk('input');
    e.type = 'text';
    e.id = l.htmlFor = id;
    Object.assign(e, { autocomplete: 'off' }, attrs || {});
    e.value = vs(value);
    e.addEventListener('input', () => { onInput(e.value); touch(); });
    f.append(l, e);
    return f;
  }
  const NUMI = { inputMode: 'numeric' }, DECI = { inputMode: 'decimal' };
  const num = (v, d) => TL.numOr(v, d);

  async function showSet(setId) {
    await open('単価表のセット', '#settings/teikei');
    const s = TL.masterSet(draft, setId);
    if (!s) { toast('セットが見つかりませんでした'); location.replace('#settings/teikei'); return; }
    const keihi = s.category === '共通費';
    $('tr-title').textContent = keihi ? '一般管理費（共通費）' : s.work || '単価表のセット';
    const body = $('tr-body');
    const head = card(keihi ? '一般管理費（共通費）' : 'セット');
    if (keihi) {
      head.appendChild(mk('div', 'hint', '係数は、廊下のみ／居室のみ／廊下＋居室のときに単価に掛ける数です（工事日数の行には掛けません）'));
      const g = mk('div', 'grid3');
      (s.presets || []).forEach((p, i) => {
        const f = input('tr-coef-' + i, p.label, p.coef, DECI, v => { const n = num(v, p.coef); if (n >= 0) p.coef = n; }); // 空・読めない・負は前の値のまま
        f.lastChild.addEventListener('blur', e => { e.target.value = vs(p.coef); });
        g.appendChild(f);
      });
      head.appendChild(g);
    } else {
      const dl = mk('datalist');
      dl.id = 'tr-parts';
      TL.partsOf(draft).forEach(p => dl.appendChild(Object.assign(mk('option'), { value: p.part })));
      const part = input('tr-part', '部位', s.part, { maxLength: 60 }, v => { s.part = v; });
      part.lastChild.setAttribute('list', 'tr-parts');
      head.append(part, dl, input('tr-work', '工事名', s.work, { maxLength: 100 }, v => { s.work = v; }));
      const f = mk('div', 'ff');
      f.appendChild(mk('span', 'lbl', '区分'));
      const seg = mk('div', 'seg');
      seg.id = 'tr-cat';
      ['標準', 'オプション'].forEach(c => {
        const b = dBtn(c, null, () => { s.category = c; touch(); seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
        b.setAttribute('aria-pressed', String(s.category === c));
        seg.appendChild(b);
      });
      f.appendChild(seg);
      head.appendChild(f);
      if (s.options) head.appendChild(mk('div', 'hint', '養生率・1階の決まりはそのまま使います'));
    }
    head.appendChild(msgBox());
    body.appendChild(head);

    const lines = card('行');
    lines.id = 'tr-lines';
    const draw = () => {
      lines.replaceChildren(mk('div', 'card-t', '行'));
      s.items.forEach((it, i) => {
        const c = mk('div', 'ln');
        c.id = 'tr-ln-' + i;
        c.append(input('tr-name-' + i, '名称', it.name, { maxLength: 100 }, v => { it.name = v; }),
          input('tr-spec-' + i, '材質・寸法', it.spec, { maxLength: 100 }, v => { it.spec = v; }));
        const g = mk('div', 'grid3');
        g.append(input('tr-qty-' + i, '数量', it.qty, DECI, v => { it.qty = num(v, null); }),
          input('tr-unit-' + i, '単位', it.unit, { maxLength: 20 }, v => { it.unit = v; }),
          input('tr-price-' + i, '単価（円）', it.price, NUMI, v => { it.price = Math.round(num(v, 0)); }));
        c.appendChild(g);
        if (!keihi) {
          const l = mk('label', 'check'), cb = mk('input');
          cb.type = 'checkbox';
          cb.id = 'tr-qin-' + i;
          cb.checked = !!it.qty_input;
          cb.addEventListener('change', () => { if (cb.checked) it.qty_input = true; else delete it.qty_input; touch(); });
          l.append(cb, '数量は入力する');
          c.appendChild(l);
        }
        const del = dBtn('行を消す', 'btn ghost sm', () => {
          if (s.items.length <= 1) { toast('行が1つも無いセットは作れません。セットごと消してください'); return; }
          s.items.splice(i, 1); touch(); draw();
        });
        del.id = 'tr-del-' + i;
        c.appendChild(del);
        lines.appendChild(c);
      });
      const add = dBtn('＋ 行を足す', 'btn ghost sm', () => { s.items.push({ name: '', spec: '', qty: 1, unit: '式', price: 0 }); touch(); draw(); $('tr-name-' + (s.items.length - 1)).focus(); });
      add.id = 'tr-add-line';
      lines.appendChild(add);
    };
    draw();
    body.appendChild(lines);
    if (!keihi) {
      const del = dBtn('このセットを消す', 'btn ghost sm danger', async () => {
        if (!(await askPopup('「' + (s.work || 'このセット') + '」を単価表から消しますか？\n保存するまでは元に戻せます（保存しないで離れる）。', { title: 'セットを消す', okLabel: '消す', danger: true, id: 'tr-del-set-ask' }))) return;
        draft.sets = draft.sets.filter(x => x !== s);
        touch();
        location.hash = '#settings/teikei';
      });
      del.id = 'tr-del-set';
      body.appendChild(del);
    }
  }
  return { showList, showSet };
})();
