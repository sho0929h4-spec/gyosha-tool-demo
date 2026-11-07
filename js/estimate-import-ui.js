// js/estimate-import-ui.js — 08 仕入見積の読み込み（#estimate/{id}/import）: PDF・Excel・写真（撮る／選ぶ）を選ぶ → 読み取った行を確かめて選ぶ → 販売単価の付け方 → 明細に入れる
// 読み取りは EstimateImport（移植メモ §1.8・§2・§3）。入れた行は原価（cost_*）として裏に残し、販売は applyProfit で作る。
// 入れるとき: 原価の照合（登録の前。いま入れた値が自分の「過去」にならないように）→ 見積書を保存 → 単価マスタに原価として登録（source＝ファイル名）→ #estimate/{id}
const EstimateImportUi = (() => {
  const EL = EstimateLogic, EI = EstimateImport;
  const K_KEY = 'gyosha-import-k'; // 前回使った係数（この端末だけ）
  let st = null; // { row, caseRow, rates, res, rows: [{description, detail, quantity, unit, unit_price, amount, on}], file, mode: 'k'|'master'|'same', k, verifyOff }
  const num = v => Number(v) || 0;
  const str = v => String(v == null ? '' : v).trim();
  const yen = n => num(n).toLocaleString('ja-JP');
  const setMsg = (text, cls) => { const m = $('im-msg'); m.textContent = text || ''; m.className = 'msg' + (cls ? ' ' + cls : ''); };
  const lastK = () => { try { const v = Number(localStorage.getItem(K_KEY)); return v >= 1 && v <= 6 ? v : 1; } catch (e) { return 1; } };
  const dataOf = s => Object.assign(EL.newData(s.caseRow, ctx.org, ctx.membership, new Date()), s.row.data || {});
  const propOf = s => CaseLogic.placeName(s.caseRow) || str(s.row.data && s.row.data.subject);

  async function read(f) {
    const ext = EI.extOf(f.name);
    if (!ext) { setMsg('PDF・Excel(.xlsx/.xls)・写真(jpg/png)のファイルを選択してください。', 'err'); return; }
    const kind = ext === 'pdf' ? 'PDF' : EI.IMG.includes(ext) ? '写真' : 'Excel';
    const s = st;
    setMsg(kind + 'を読み取り中…');
    $('im-pick').disabled = $('im-photo-btn').disabled = true;
    try {
      const res = await EI.readFile(f, m => { if (st === s) setMsg(m); });
      if (st !== s) return;
      s.res = res;
      s.file = f.name;
      s.verifyOff = false;
      s.rows = EI.prepare(res.items).map(r => Object.assign(r, { on: num(r.amount) > 0 })); // 読めない行（金額 0）は出すが既定で外す
      if (!s.rows.length) setMsg('明細の自動抽出ができませんでした。手動で入力してください。' + (res.error ? '\n' + res.error : ''), 'err');
      else setMsg('✓ ' + res.items.length + '件の明細を読み込みました（' + (res.photo ? '写真の文字認識。数字と文字を確かめてください' : EI.METHOD_LABEL[res.method] || res.method) + '）'
        + (res.subject ? '\n件名: ' + res.subject : '') + (res.pdf_total ? '\n原本最大金額: ¥' + yen(res.pdf_total) : '') + (res.notes ? '\n備考を取得' : ''), 'ok');
      render();
    } catch (e) {
      if (st === s) setMsg(kind + 'の読み込みに失敗しました: ' + errText(e), 'err');
    } finally { $('im-pick').disabled = $('im-photo-btn').disabled = false; }
  }

  function render() {
    const box = $('im-result');
    const y = window.scrollY, fid = document.activeElement && document.activeElement.id;
    box.replaceChildren();
    box.hidden = !st.rows.length;
    $('im-put').disabled = !st.rows.some(r => r.on);
    if (!st.rows.length) return;

    // 合計との突き合わせ（選んだ行で）
    const v = !st.verifyOff && EI.verifyParse(st.rows.filter(r => r.on), st.res.pdf_total, st.res.pdf_total_ex);
    if (v) {
      const vb = mk('div', 'vf ' + (v.ok ? 'ok' : 'ng'));
      vb.id = 'im-verify';
      vb.appendChild(mk('div', 'vf-t', v.text));
      if (!v.ok) {
        const tb = document.createElement('table');
        v.rows.forEach(([k, val]) => { const tr = tb.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = val; });
        const acts = mk('div', 'row');
        if (v.gap) {
          const add = dBtn('差額を1行として追加', 'btn ghost sm', () => {
            st.rows.push(Object.assign(EI.gapRow(v.gap), { on: true }));
            toast('差額 ¥' + yen(v.gap) + ' を「読取差額」として1行追加しました。摘要を実際の項目名に書き換えてください。');
            render();
          });
          add.id = 'im-gap-add';
          acts.appendChild(add);
        }
        const ign = dBtn('無視する', 'btn ghost sm', () => { st.verifyOff = true; render(); });
        ign.id = 'im-gap-ignore';
        acts.appendChild(ign);
        vb.append(tb, acts, mk('div', 'vf-n', '※ 追加すると原価・販売の両方に「読取差額」の行が入ります。中身が分かったら摘要を書き換えてください。'));
      }
      box.appendChild(vb);
    }

    // 読み取った行
    const rc = mk('div', 'card');
    rc.id = 'im-rows';
    rc.appendChild(mk('div', 'card-t', '読み取った行（確認して入れる）'));
    const allL = mk('label', 'check');
    const all = document.createElement('input');
    all.type = 'checkbox';
    all.id = 'im-all';
    all.checked = st.rows.every(r => r.on);
    all.addEventListener('change', () => { st.rows.forEach(r => { r.on = all.checked; }); render(); });
    allL.append(all, document.createTextNode('全部'));
    rc.appendChild(allL);
    st.rows.forEach((r, i) => {
      const l = mk('label', 'im-row' + (r.on ? '' : ' off'));
      l.id = 'im-row-' + i;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'im-on-' + i;
      cb.checked = r.on;
      cb.addEventListener('change', () => { r.on = cb.checked; render(); });
      const m = mk('span', 'im-m');
      m.append(mk('span', 'im-d', (r.description || '（読めない行）') + (r.detail ? '　' + r.detail : '')),
        mk('span', 'im-s', num(r.quantity) + ' ' + (r.unit || '') + ' ・ @' + yen(r.unit_price) + ' ・ ' + (num(r.amount) ? yen(r.amount) : '金額なし')));
      l.append(cb, m);
      rc.appendChild(l);
    });
    box.appendChild(rc);

    // 販売単価の付け方
    const pc = mk('div', 'card');
    pc.id = 'im-price';
    pc.appendChild(mk('div', 'card-t', '販売単価の付け方'));
    const seg = mk('div', 'seg');
    [['k', '仕入 × 係数'], ['master', '単価マスタ'], ['same', 'そのまま']].forEach(([m, label]) => {
      const b = dBtn(label, null, () => { st.mode = m; render(); });
      b.id = 'im-mode-' + m;
      b.setAttribute('aria-pressed', String(st.mode === m));
      seg.appendChild(b);
    });
    pc.appendChild(seg);
    if (st.mode === 'k') {
      const f = mk('div', 'ff');
      const l = mk('label', null, '係数（販売 ＝ 仕入 × 係数。1.00〜6.00）');
      l.htmlFor = 'im-k';
      const k = document.createElement('input');
      Object.assign(k, { type: 'number', id: 'im-k', min: 1, max: 6, step: 0.05, inputMode: 'decimal', value: st.k });
      k.addEventListener('input', () => { st.k = k.value; });
      f.append(l, k);
      pc.appendChild(f);
    } else if (st.mode === 'master') {
      const client = str(dataOf(st).client);
      pc.appendChild(client ? mk('div', 'hint', '「' + client + '」宛の過去の販売単価に合わせます（過去の無い行は今の利益率 ' + num(dataOf(st).profit_pct) + '%）')
        : mk('div', 'msg err', 'クライアント名を入力してください。過去単価は管理会社ごとに揃えます。'));
    } else pc.appendChild(mk('div', 'hint', '販売 ＝ 仕入（利益率 0%）'));
    pc.appendChild(mk('div', 'hint', '仕入の単価は原価として裏に残ります（PDFには出ません）。選んだ行は単価マスタに原価として登録します。'));
    box.appendChild(pc);

    window.scrollTo(0, y);
    if (fid && $(fid)) $(fid).focus({ preventScroll: true });
  }

  async function put() {
    const s = st;
    if (!s || !s.res) return;
    const sel = s.rows.filter(r => r.on);
    if (!sel.length) { setMsg('入れる行を選んでください', 'err'); return; }
    const d = dataOf(s), client = str(d.client), property = propOf(s);
    let pct = num(d.profit_pct);
    if (s.mode === 'k') {
      const k = Number(s.k);
      if (!(k >= 1 && k <= 6)) { setMsg('係数は 1.00〜6.00 の数で入れてください（例 1.3）', 'err'); return; }
      pct = Math.round((k - 1) * 100);
      try { localStorage.setItem(K_KEY, String(k)); } catch (e) { /* 覚えられなくても入れる */ }
    } else if (s.mode === 'same') pct = 0;
    else if (!client) { setMsg('クライアント名を入力してください。過去単価は管理会社ごとに揃えます。', 'err'); return; }

    const sub = str(s.res.subject).slice(0, 200), cur = str(d.subject);
    if (sub && !cur) d.subject = sub;
    else if (sub && sub !== cur && await askPopup('物件名を抽出しました。上書きしますか？\n\n現在：' + cur + '\n抽出：' + sub, { title: '件名を上書きする', okLabel: '上書きする', cancelLabel: '上書きしない', id: 'im-subject-ask' })) d.subject = sub;
    if (st !== s) return;
    if (s.res.notes && !str(d.notes_extra)) d.notes_extra = String(s.res.notes).slice(0, 1000);
    d.vendor = str($('im-vendor').value).slice(0, 100);

    const base = (Array.isArray(d.lines) ? d.lines : []).filter(EL.isRealItem);
    const added = sel.map(r => Object.assign(EL.emptyRow(), { description: str(r.description).slice(0, 200), detail: str(r.detail).slice(0, 200), quantity: num(r.quantity),
      unit: str(r.unit).slice(0, 20), cost_unit_price: num(r.unit_price), cost_amount: num(r.amount), unit_price: num(r.unit_price), amount: num(r.amount) }));
    d.profit_pct = Math.min(500, Math.max(0, pct));
    let lines = EL.applyProfit(base.concat(added), d.profit_pct);
    if (s.mode === 'master') {
      // 過去単価に合わせる（入れた行だけ）。合わせた行は manual（利益率を変えても戻らない）
      EL.suggestPrices(EL.rateView(lines, 'sell'), s.rates, { client, property }).forEach(p => {
        const r = lines[p.index];
        if (p.index < base.length || !p.price || p.price === EL.unitPriceOf(r)) return;
        Object.assign(r, { unit_price: p.price, amount: Math.round(num(r.quantity) * p.price) || p.price, manual: true });
      });
      lines = EL.recalcShokehi(lines);
    }
    d.lines = lines;
    const costAlerts = EL.check(EL.rateView(lines, 'cost'), s.rates, { vendor: d.vendor, property, client, kind: 'cost' });

    $('im-put').disabled = true;
    try { await EstimatesApi.save(s.row.id, { data: d, number: s.row.number || '' }); }
    catch (e) { setMsg('明細に入れられませんでした: ' + errText(e), 'err'); $('im-put').disabled = false; return; }
    let n = 0, rateErr = '';
    try { n = await EstimatesApi.registerRates(EL.rateView(added, 'cost'), { kind: 'cost', client, vendor: d.vendor, property, source: s.file }, s.rates); }
    catch (e) { rateErr = errText(e); }
    EstimateUi.setCostAlerts(s.row.id, costAlerts);
    toast(added.length + '行を明細に入れました' + (n ? '。単価マスタに' + n + '件登録' : '') + (rateErr ? '（単価マスタには登録できませんでした: ' + rateErr + '）' : ''));
    location.hash = '#estimate/' + s.row.id;
  }

  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $('im-back').addEventListener('click', () => { if (st) location.hash = '#estimate/' + st.row.id; });
    [['im-pick', 'im-file'], ['im-photo-btn', 'im-photo']].forEach(([btn, inp]) => {
      $(btn).addEventListener('click', () => $(inp).click());
      $(inp).addEventListener('change', () => {
        const f = $(inp).files[0];
        $(inp).value = '';
        if (f && st) read(f);
      });
    });
    $('im-put').addEventListener('click', () => put());
  }
  async function show(id) {
    wire();
    st = null;
    showScreen('import');
    $('im-result').replaceChildren();
    $('im-result').hidden = true;
    $('im-put').disabled = true;
    $('im-sub').textContent = '';
    setMsg('');
    const row = await EstimatesApi.get(id);
    if (!row) { toast('見積書が見つかりませんでした'); location.replace('#cases'); return; }
    if (row.status !== 'draft') { toast('この版は直せません。新しい版を作ってから読み込んでください'); location.replace('#estimate/' + id); return; }
    const [caseRow, rates] = await Promise.all([CasesApi.get(row.case_id), EstimatesApi.rates()]);
    st = { row, caseRow: caseRow || {}, rates, res: null, rows: [], file: '', mode: 'k', k: lastK(), verifyOff: false };
    $('im-sub').textContent = CaseLogic.placeName(st.caseRow);
    $('im-vendor').value = (row.data && row.data.vendor) || '';
    $('im-vendors').replaceChildren(...Array.from(new Set(rates.filter(r => r.kind === 'cost' && r.vendor).map(r => r.vendor))).sort().map(v => { const o = document.createElement('option'); o.value = v; return o; }));
  }
  return { show };
})();
