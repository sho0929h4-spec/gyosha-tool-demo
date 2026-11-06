// js/settings-ui.js — 05 設定: 会社（名前・住所・電話・メール・登録番号・ロゴ・社印・報告書に会社名とロゴを出す）／自分（名前・電話・パスワード変更）
//   見積書（消費税率・定型テンプレートの一覧と削除・よく使う明細の追加と削除・単価マスタの一覧と削除）。元請の一覧・メンバー招待は「準備中」
const SettingsUi = (() => {
  let wired = false;
  const ok = r => { if (r.error) throw r.error; return r.data; };
  const setMsg = (id, text, good) => { const e = $(id); e.textContent = text || ''; e.classList.toggle('ok', !!good); e.classList.toggle('err', !good && !!text); };
  const ORG_F = { name: 'so-name', address: 'so-addr', tel: 'so-tel', email: 'so-mail', registration_number: 'so-reg' };
  const toggle = (btn, box) => { box.hidden = !box.hidden; btn.setAttribute('aria-expanded', String(!box.hidden)); };

  async function saveOrg(patch) {
    const row = ok(await sb.from('orgs').update(patch).eq('id', ctx.org.id).select().single());
    App.setCtx('org', row);
    return row;
  }
  // ロゴ・社印: 選ぶとすぐ縮めて保存（PNG・長辺600px）。「外す」で消す
  async function renderImg(hostId, col, label) {
    const host = $(hostId);
    host.replaceChildren();
    const path = ctx.org[col];
    if (path) {
      const img = mk('img', 'img-prev');
      img.alt = label;
      img.id = hostId + '-img';
      try { img.src = await signedUrl(path); } catch (e) { img.alt = label + '（読み込めませんでした）'; }
      host.appendChild(img);
    } else host.appendChild(mk('span', 'hint', 'まだありません'));
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.id = hostId + '-file';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const f = input.files[0];
      input.value = '';
      if (!f) return;
      setMsg('so-msg', label + 'を保存中…', true);
      try {
        const blob = await shrinkImage(f, 600, 'image/png');
        const p = ctx.org.id + '/org/' + col + '-' + newId() + '.png';
        const up = await sb.storage.from('photos').upload(p, blob, { contentType: 'image/png' });
        if (up.error) throw up.error;
        const old = ctx.org[col];
        await saveOrg({ [col]: p });
        if (old) sb.storage.from('photos').remove([old]);
        setMsg('so-msg', label + 'を保存しました', true);
      } catch (e) { setMsg('so-msg', label + 'を保存できませんでした: ' + errText(e)); }
      renderImg(hostId, col, label);
    });
    host.appendChild(input);
    host.appendChild(dBtn(path ? '変える' : '選ぶ', 'btn ghost sm', () => input.click()));
    if (path) host.appendChild(dBtn('外す', 'btn ghost sm', async () => {
      if (!(await askPopup(label + 'を外しますか？', { title: label + 'を外す', okLabel: '外す', id: 'img-remove-ask' }))) return;
      try { await saveOrg({ [col]: null }); sb.storage.from('photos').remove([path]); setMsg('so-msg', label + 'を外しました', true); }
      catch (e) { setMsg('so-msg', '外せませんでした: ' + errText(e)); }
      renderImg(hostId, col, label);
    }));
  }

  // 見積書: 定型（登録は見積書の画面から）・よく使う明細の一覧。押すと消す（確かめてから）
  async function renderEst() {
    const list = (hostId, rows, label, text, del) => {
      const host = $(hostId);
      host.replaceChildren();
      if (!rows.length) { host.appendChild(mk('div', 'hint', 'まだありません')); return; }
      rows.forEach(r => {
        const li = mk('div', 'set-li');
        li.appendChild(mk('span', null, text(r)));
        li.appendChild(dBtn('削除', 'btn ghost sm', async () => {
          if (!(await askPopup('「' + (r.name || r.text) + '」を消しますか？', { title: label + 'を消す', okLabel: '消す', danger: true, id: 'set-est-del-ask' }))) return;
          try { await del(r.id); setMsg('se-msg', '消しました', true); } catch (e) { setMsg('se-msg', '消せませんでした: ' + errText(e)); }
          renderEst();
        }));
        host.appendChild(li);
      });
    };
    try {
      const [tpls, pres] = await Promise.all([EstimatesApi.templates(), EstimatesApi.presets()]);
      list('se-tpl', tpls, '定型', t => t.name + '（' + (t.lines || []).length + '行 ¥' + EstimateLogic.templateTotal({ items: t.lines || [] }).toLocaleString('ja-JP') + '）', EstimatesApi.delTemplate);
      list('se-pre', pres, 'よく使う明細', p => p.text + ' ¥' + Number(p.price).toLocaleString('ja-JP') + (p.unit ? '／' + p.unit : ''), EstimatesApi.delPreset);
    } catch (e) { setMsg('se-msg', '読み込めませんでした: ' + errText(e)); }
  }

  // 単価マスタの一覧（移植メモ §1.7「一覧画面」）: key ごとに2段のカード。原価／販売／すべて・文字で絞る（摘要・業者・物件）・値幅が中央値の30%超は赤
  let rateKind = 'cost', rateRecs = [];
  const yen = n => Number(n || 0).toLocaleString('ja-JP');
  async function loadRates() {
    try { rateRecs = await EstimatesApi.rates(); } catch (e) { rateRecs = []; setMsg('se-rate-msg', '単価マスタを読み込めませんでした: ' + errText(e)); }
    renderRates();
  }
  function renderRates() {
    document.querySelectorAll('#se-rate-kind button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === rateKind)));
    const all = EstimateLogic.rateSummary(rateRecs, rateKind), q = $('se-rate-q').value.trim().toLowerCase();
    const list = !q ? all : all.filter(g => g.description.toLowerCase().includes(q) || g.vendors.some(v => v.toLowerCase().includes(q)) || g.properties.some(p => p.toLowerCase().includes(q)));
    $('se-rate-count').textContent = all.length ? list.length + '件' + (list.length !== all.length ? ' / 全' + all.length + '件' : '') : '';
    const host = $('se-rate');
    host.replaceChildren();
    if (!list.length) { host.appendChild(mk('div', 'hint', all.length ? '該当する単価がありません。' : '登録された単価がありません。仕入見積を読み込むか、見積書のPDFを作ると自動でたまります。')); return; }
    list.forEach(g => {
      const c = mk('div', 'rm');
      const l2 = mk('div');
      l2.append(document.createTextNode(g.count + '件 ・ 中央値 ' + yen(g.median) + ' ・ '), mk('span', EstimateLogic.wideSpread(g) ? 'err' : null, g.min === g.max ? '最安〜最高 —' : '最安〜最高 ' + yen(g.min) + '〜' + yen(g.max)));
      c.append(mk('div', 'rm-t', g.description + (g.unit ? '（' + g.unit + '）' : '')), l2,
        mk('div', null, '最新 ' + yen(g.latest) + (g.latest_date ? '（' + g.latest_date + '）' : '')),
        mk('div', 'hint', '業者: ' + (g.vendors.join('、') || '—') + ' ／ 物件: ' + (g.properties.join('、') || '—')));
      c.appendChild(dBtn('削除', 'btn ghost sm', async () => {
        if (!(await askPopup('「' + g.description + '」の記録 ' + g.count + '件を単価マスタから消しますか？', { title: '単価マスタから消す', okLabel: '消す', danger: true, id: 'set-rate-del-ask' }))) return;
        try { await EstimatesApi.delRates(g.ids); setMsg('se-rate-msg', '消しました', true); } catch (e) { setMsg('se-rate-msg', '消せませんでした: ' + errText(e)); }
        loadRates();
      }));
      host.appendChild(c);
    });
  }

  function wire() {
    if (wired) return;
    wired = true;
    document.querySelectorAll('#se-rate-kind button').forEach(b => b.addEventListener('click', () => { rateKind = b.dataset.kind; renderRates(); }));
    $('se-rate-q').addEventListener('input', renderRates);
    $('set-est-open').addEventListener('click', () => toggle($('set-est-open'), $('set-est-form')));
    $('se-tax-save').addEventListener('click', async () => {
      const v = $('se-tax').value.trim(), pct = Number(v);
      if (v === '' || !(pct >= 0 && pct < 100)) { setMsg('se-tax-msg', '消費税率は 0〜99 の数で入れてください（例 10）'); return; }
      $('se-tax-save').disabled = true;
      try { await saveOrg({ tax_rate: Math.round(pct * 10) / 1000 }); setMsg('se-tax-msg', '保存しました。下書きの見積書はこの税率で計算します', true); }
      catch (e) { setMsg('se-tax-msg', '保存できませんでした: ' + errText(e)); }
      finally { $('se-tax-save').disabled = false; }
    });
    $('se-pre-add').addEventListener('click', async () => {
      const text = $('se-pre-text').value.trim(), unit = $('se-pre-unit').value.trim(), pv = $('se-pre-price').value.trim(), price = Number(pv);
      if (!text) { setMsg('se-msg', '摘要を入れてください'); return; }
      if (pv === '' || !(price >= 0)) { setMsg('se-msg', '単価は 0 以上の数で入れてください'); return; }
      $('se-pre-add').disabled = true;
      try {
        await EstimatesApi.addPreset(text, unit, Math.round(price));
        ['se-pre-text', 'se-pre-unit', 'se-pre-price'].forEach(id => { $(id).value = ''; });
        setMsg('se-msg', '「' + text + '」を足しました', true);
        renderEst();
      } catch (e) { setMsg('se-msg', '足せませんでした: ' + errText(e)); }
      finally { $('se-pre-add').disabled = false; }
    });
    $('set-org-open').addEventListener('click', () => toggle($('set-org-open'), $('set-org-form')));
    $('set-me-open').addEventListener('click', () => toggle($('set-me-open'), $('set-me-form')));
    $('so-save').addEventListener('click', async () => {
      const patch = {};
      Object.entries(ORG_F).forEach(([k, id]) => { patch[k] = $(id).value.trim(); });
      patch.registration_number = patch.registration_number.normalize('NFKC').toUpperCase();
      patch.show_company_on_report = $('so-show').checked;
      if (patch.registration_number && !/^T[0-9]{13}$/.test(patch.registration_number)) { setMsg('so-msg', '登録番号は T と13桁の数字です（例 T1234567890123）'); return; }
      if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) { setMsg('so-msg', 'メールの形が正しくありません'); return; }
      $('so-save').disabled = true;
      try { await saveOrg(patch); $('so-reg').value = patch.registration_number; setMsg('so-msg', '保存しました', true); }
      catch (e) { setMsg('so-msg', '保存できませんでした: ' + errText(e)); }
      finally { $('so-save').disabled = false; }
    });
    $('sm-save').addEventListener('click', async () => {
      $('sm-save').disabled = true;
      try {
        const row = ok(await sb.from('memberships').update({ display_name: $('sm-name').value.trim(), phone: $('sm-tel').value.trim() })
          .eq('user_id', ctx.user.id).select().single());
        App.setCtx('membership', row);
        setMsg('sm-msg', '保存しました', true);
      } catch (e) { setMsg('sm-msg', '保存できませんでした: ' + errText(e)); }
      finally { $('sm-save').disabled = false; }
    });
    $('sm-pw-save').addEventListener('click', async () => {
      const pw = $('sm-pw').value;
      if (pw.length < 6) { setMsg('sm-pw-msg', 'パスワードは6文字以上にしてください'); return; }
      $('sm-pw-save').disabled = true;
      try {
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error) throw error;
        $('sm-pw').value = '';
        setMsg('sm-pw-msg', 'パスワードを変えました。次のログインから新しいパスワードを使います', true);
      } catch (e) { setMsg('sm-pw-msg', '変えられませんでした: ' + errText(e)); }
      finally { $('sm-pw-save').disabled = false; }
    });
  }
  function show() {
    wire();
    showScreen('settings');
    ['so-msg', 'sm-msg', 'sm-pw-msg', 'se-tax-msg', 'se-msg', 'se-rate-msg'].forEach(id => setMsg(id, ''));
    $('se-tax').value = Math.round(Number(ctx.org.tax_rate || 0) * 1000) / 10;
    renderEst();
    loadRates();
    Object.entries(ORG_F).forEach(([k, id]) => { $(id).value = ctx.org[k] || ''; });
    $('so-show').checked = ctx.org.show_company_on_report !== false;
    $('sm-name').value = ctx.membership.display_name || '';
    $('sm-tel').value = ctx.membership.phone || '';
    $('sm-pw').value = '';
    renderImg('so-logo', 'logo_path', 'ロゴ');
    renderImg('so-seal', 'seal_path', '社印');
  }
  return { show };
})();
