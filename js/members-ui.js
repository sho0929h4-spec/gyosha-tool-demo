// js/members-ui.js — 05 設定（管理者だけ）: メンバー（#set-mem: 一覧・招待・権限を変える・外す）と操作の記録（#set-audit: 新しい順に 50 件ずつ。「さらに 50 件」）
//   招待・外すは Worker（Files.api の POST /invite・DELETE /members/{id}）、権限は rpc set_member_role、一覧は rpc org_members、記録は audit_log
//   隠すのは使いやすさのためだけ。本当の壁は DB（policy・rpc）と Worker（一般は 403）
const MembersUi = (() => {
  const ROLE = { admin: '管理者', member: '一般' };
  const ACT = { org_updated: '会社の情報を変えた', rates_saved: '単価表を保存した', rates_reset: '単価表を標準に戻した', case_deleted: '案件を消した',
    member_invited: 'メンバーを招待した', member_removed: 'メンバーを外した', role_changed: '権限を変えた',
    org_file_saved: 'ロゴ・社印を保存した', org_file_deleted: 'ロゴ・社印を消した' };
  const COL = { name: '会社名', address: '住所', registration_number: '登録番号' }; // 会社の情報を変えた（detail.changes）で前と後を出す列
  const PAGE = 50;
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const ok = r => { if (r.error) throw r.error; return r.data; };
  const nameOf = m => m.display_name || m.email || '（名前なし）';
  let members = [];
  const msg = (text, good) => { const e = $('mem-msg'); if (!e) return; e.textContent = text || ''; e.className = 'msg' + (text ? (good ? ' ok' : ' err') : ''); };

  // admin = ctx.membership.role === 'admin'。一般にはカードごと出さない
  async function show(admin) {
    $('set-mem').hidden = $('set-audit').hidden = !admin;
    $('set-mem').replaceChildren();
    $('set-audit').replaceChildren();
    if (!admin) return;
    drawInvite();
    await refresh();
  }
  async function refresh() {
    try { members = ok(await sb.rpc('org_members')) || []; } catch (e) { members = []; msg('メンバーを読み込めませんでした: ' + errText(e)); }
    drawList();
    drawAudit();
  }

  function drawInvite() {
    const c = $('set-mem');
    c.append(mk('div', 'card-t', 'メンバー'), mk('div', 'card-d', '同じ会社で使う人。管理者は会社の情報・単価表・メンバーを変えられます'));
    const list = mk('div', 'list');
    list.id = 'mem-list';
    const f = mk('div', 'ff'), l = mk('label', null, '招待する人のメールアドレス'), inp = mk('input');
    inp.type = 'email';
    inp.id = l.htmlFor = 'mem-mail';
    inp.maxLength = 200;
    inp.autocomplete = 'off';
    inp.placeholder = 'name@example.com';
    f.append(l, inp);
    const chk = mk('label', 'check'), cb = mk('input');
    cb.type = 'checkbox';
    cb.id = 'mem-admin';
    chk.append(cb, '管理者にする');
    const send = dBtn('招待する', 'btn sm', async () => {
      const email = inp.value.trim().toLowerCase();
      if (!EMAIL.test(email)) { msg('メールアドレスを入れてください'); return; }
      send.disabled = true;
      msg('');
      try {
        const j = await Files.api('POST', '/invite', { email, role: cb.checked ? 'admin' : 'member' });
        msg(j.status === 'added' ? 'メンバーに加えました' : '招待メールを送りました', true);
        inp.value = '';
        cb.checked = false;
      } catch (e) { msg(errText(e)); } // もうメンバーです／このメールアドレスは別の会社で使われています（409）／招待が多すぎます…（429）は Worker の文言のまま
      finally { send.disabled = false; }
      await refresh();
    });
    send.id = 'mem-invite';
    const m = mk('div', 'msg');
    m.id = 'mem-msg';
    m.setAttribute('role', 'status');
    c.append(list, mk('div', 'sep'), f, chk, send, m);
  }

  function drawList() {
    const host = $('mem-list');
    if (!host) return;
    host.replaceChildren();
    members.forEach(m => {
      const me = m.user_id === ctx.user.id;
      const row = mk('div', 'rm mem-li');
      row.dataset.user = m.user_id;
      row.append(mk('div', 'rm-t', nameOf(m) + (me ? '（自分）' : '')),
        mk('div', null, [m.email, ROLE[m.role] || m.role, m.pending ? '招待中' : ''].filter(Boolean).join(' ・ ')));
      if (!me) {
        const act = mk('div', 'mem-act');
        const to = m.role === 'admin' ? 'member' : 'admin';
        const role = dBtn(to === 'admin' ? '管理者にする' : '一般にする', 'btn ghost sm', async () => {
          role.disabled = true;
          try { ok(await sb.rpc('set_member_role', { p_user: m.user_id, p_role: to })); msg(nameOf(m) + 'さんを' + ROLE[to] + 'にしました', true); }
          catch (e) { msg('権限を変えられませんでした: ' + errText(e)); }
          await refresh();
        });
        role.className += ' mem-role';
        const out = dBtn('外す', 'btn ghost sm danger mem-del', async () => {
          if (!(await askPopup(nameOf(m) + 'さんを外しますか？ この人はログインできなくなります。作った書類は残ります\nこの人だけの定型テンプレート・よく使う明細は消えます。', { title: 'メンバーを外す', okLabel: '外す', danger: true, id: 'mem-del-ask' }))) return;
          out.disabled = true;
          try { await Files.api('DELETE', '/members/' + encodeURIComponent(m.user_id)); msg(nameOf(m) + 'さんを外しました', true); }
          catch (e) { msg('外せませんでした: ' + errText(e)); }
          await refresh();
        });
        act.append(role, out);
        row.appendChild(act);
      }
      host.appendChild(row);
    });
  }

  // 「日時・だれ・何をした」。だれ = org_members の名前。user_id が null は運営（service キー・システム）
  async function drawAudit() {
    const c = $('set-audit');
    c.replaceChildren(mk('div', 'card-t', '操作の記録'), mk('div', 'card-d', '会社の情報・ロゴと社印・単価表・案件の削除・メンバーの変更（新しい順に 50 件ずつ）'));
    const list = mk('div', 'list');
    list.id = 'audit-list';
    c.appendChild(list);
    await moreAudit(list, 0);
  }
  // from 件目から 50 件を足す。50 件そろったら「さらに 50 件」（足りなければこれで全部）
  async function moreAudit(list, from) {
    let rows;
    try { rows = ok(await sb.from('audit_log').select('*').order('at', { ascending: false }).order('id', { ascending: false }).range(from, from + PAGE - 1)) || []; }
    catch (e) { list.appendChild(mk('div', 'msg err', '記録を読み込めませんでした: ' + errText(e))); return; }
    if (!rows.length && !from) { list.appendChild(mk('div', 'hint', 'まだありません')); return; }
    const nameById = id => { const m = id && members.find(x => x.user_id === id); return m ? nameOf(m) : ''; };
    const who = id => (id == null ? '運営' : nameById(id) || '（外した人）');
    rows.forEach(r => {
      const d = r.detail || {};
      // detail.id（Worker が書くようになる）か target。外した人は名前が引けないので「外した人」（かっこを重ねない）
      const extra = r.action === 'case_deleted' ? d.name : r.action === 'member_invited' ? d.email : r.action === 'member_removed' ? (d.name || nameById(d.id) || '外した人')
        : r.action === 'role_changed' ? ((nameById(d.id || d.target) || '外した人') + ' → ' + (ROLE[d.to] || ''))
        : r.action === 'org_updated' && Array.isArray(d.cols) && d.cols.join() === 'report_items' ? '報告書の項目' : '';
      const li = mk('div', 'audit-li');
      li.append(mk('span', 'hint', new Date(r.at).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })),
        mk('span', null, who(r.user_id) + '　' + (ACT[r.action] || 'その他の操作') + (extra ? '（' + extra + '）' : '')));
      if (r.action === 'org_updated' && d.changes) Object.keys(COL).forEach(k => {
        const x = d.changes[k];
        if (x) li.appendChild(mk('span', 'audit-ch', COL[k] + ': ' + (x.old || '（なし）') + ' → ' + (x.new || '（なし）')));
      });
      list.appendChild(li);
    });
    if (rows.length < PAGE) return;
    const more = dBtn('さらに 50 件', 'btn ghost sm', async () => { more.remove(); await moreAudit(list, from + PAGE); });
    more.id = 'audit-more';
    list.appendChild(more);
  }
  return { show };
})();
