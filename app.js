/* 수양관 사무 자동화 — 단일 페이지 앱 (Supabase 저장) */
(() => {
'use strict';
const CFG = window.OW_CONFIG;
const sb = window.supabase.createClient(CFG.url, CFG.key);
const BUCKET = CFG.bucket || 'ow-files';

/* ---------- 공통 ---------- */
const $ = s => document.querySelector(s);
const M = () => $('#main');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const DOW = ['일','월','화','수','목','금','토'];
const dow = s => DOW[new Date(s + 'T00:00').getDay()] || '';
const md = s => s ? (+s.slice(5, 7)) + '/' + (+s.slice(8, 10)) : '';
const lt = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? String(iso).slice(0, 16).replace('T', ' ') : `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
let MONTH = today().slice(0, 7);
const mLabel = m => m.slice(0, 4) + '년 ' + (+m.slice(5)) + '월';
function mRange(m) { const [y, mo] = m.split('-').map(Number); const n = mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`; return [m + '-01', n + '-01']; }
const monthPick = () => `<input type="month" class="mpick" value="${MONTH}" aria-label="월 선택">`;
function bindMonth() { M().querySelectorAll('.mpick').forEach(i => i.onchange = () => { if (i.value) { MONTH = i.value; route(); } }); }
const hrs = (s, e) => { if (!s || !e) return 0; const m = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; }; return Math.round(((m(e) - m(s) + 1440) % 1440) / 6) / 10; };
const fileUrl = p => sb.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function toast(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 2800); }
async function q(p) { const { data, error } = await p; if (error) { toast('오류: ' + error.message); throw error; } return data; }

function korMoney(n) {
  n = Math.round(Number(n) || 0); if (!n) return '영';
  const d = ['','일','이','삼','사','오','육','칠','팔','구'], u = ['','십','백','천'], b = ['','만','억','조'];
  let s = '', i = 0;
  while (n > 0) { const c = n % 10000; if (c) { let t = ''; const ds = String(c).padStart(4, '0'); for (let j = 0; j < 4; j++) { const v = +ds[j]; if (v) t += d[v] + u[3 - j]; } s = t + b[i] + s; } n = Math.floor(n / 10000); i++; }
  return s;
}

/* 표를 휴대폰에서 세로로 보이게 할 때 칸 이름 붙이기 */
new MutationObserver(() => { for (const c of document.querySelectorAll('.stack td:not([data-l])')) { let i = 0, p = c; while (p = p.previousElementSibling) i += p.colSpan; c.dataset.l = c.closest('table').rows[0].cells[i]?.textContent || ''; } }).observe(document, { childList: true, subtree: true });

/* ---------- 로그인 ---------- */
const DOMAIN = 'suyanggwan.local';
let ME = null, SITE = null, SITES = [];
const myName = () => ME?.name || '';
const isAdmin = () => ME?.role === '관리자';
const isHQ = () => !!ME && ME.site_id === null;
const siteName = id => (SITES.find(x => x.id === id) || {}).name || (id ? id : '본부');
async function adminCall(body) {
  const { data, error } = await sb.functions.invoke('ow-admin', { body });
  if (error) { let msg = error.message; try { const j = await error.context.json(); if (j.error) msg = j.error; } catch {} toast(msg); throw new Error(msg); }
  return data;
}
function showLogin(msg = '') {
  ME = null; document.body.classList.add('out'); $('#who').innerHTML = '';
  $('#orgName').textContent = '수양관 사무 자동화';
  M().innerHTML = `<div class="login"><h2>로그인</h2><p class="note">삼봉리 · 안산 · 몽산포 · 덕정 · 충주 · 청풍</p>
    <form id="lf"><label class="f" for="lid">아이디<input id="lid" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
    <label class="f" for="lpw">비밀번호<input id="lpw" type="password" autocomplete="current-password" required></label>
    <p class="err" id="lerr">${esc(msg)}</p><button class="pri" type="submit">로그인</button></form>
    <p class="note">아이디나 비밀번호를 잊었으면 관리자에게 초기화를 요청하세요.</p></div>`;
  $('#lid').focus();
  $('#lf').onsubmit = async e => {
    e.preventDefault(); const btn = e.submitter || $('#lf button'); btn.disabled = true; $('#lerr').textContent = '';
    const id = $('#lid').value.trim().toLowerCase();
    const { error } = await sb.auth.signInWithPassword({ email: id.includes('@') ? id : `${id}@${DOMAIN}`, password: $('#lpw').value });
    btn.disabled = false;
    if (error) { $('#lerr').textContent = /banned/i.test(error.message) ? '사용이 중지된 계정입니다. 관리자에게 문의하세요.' : '아이디 또는 비밀번호가 맞지 않습니다.'; return; }
    await start();
  };
}
async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data } = await sb.from('ow_profiles').select('*').eq('id', session.user.id).maybeSingle();
  return data && data.active ? data : null;
}
function drawWho() {
  const sitePart = isHQ()
    ? `<select id="siteSel" aria-label="수양관 선택" style="width:auto;min-height:36px;padding:4px 8px">${SITES.map(x => `<option value="${esc(x.id)}"${x.id === SITE ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
    : `<span class="pill">${esc(siteName(SITE))}</span>`;
  $('#who').innerHTML = `${sitePart}<span><b>${esc(ME.name)}</b> <span class="pill${isAdmin() ? ' acc' : ''}">${isHQ() ? '본부 ' : ''}${esc(ME.role)}</span></span><button class="ghost" id="pwBtn">비밀번호 변경</button><button id="outBtn">로그아웃</button>`;
  const sel = $('#siteSel');
  if (sel) sel.onchange = async () => { SITE = sel.value; try { localStorage.setItem('ow-site', SITE); } catch {} await loadSettings(); toast(siteName(SITE) + '(으)로 바꿨습니다.'); route(); };
  $('#outBtn').onclick = async () => { await sb.auth.signOut(); showLogin(); };
  $('#pwBtn').onclick = () => openModal('비밀번호 변경', `<div class="form"><label class="f" for="np1">새 비밀번호 (6자 이상)<input id="np1" type="password" autocomplete="new-password"></label><label class="f" for="np2">새 비밀번호 확인<input id="np2" type="password" autocomplete="new-password"></label></div>`,
    [{ label: '변경', cls: 'pri', onClick: async m => {
      const a = m.querySelector('#np1').value, b = m.querySelector('#np2').value;
      if (a.length < 6) { toast('6자 이상으로 입력하세요.'); return false; } if (a !== b) { toast('두 비밀번호가 다릅니다.'); return false; }
      const { error } = await sb.auth.updateUser({ password: a }); if (error) { toast('변경하지 못했습니다: ' + error.message); return false; } toast('비밀번호를 바꿨습니다.');
    } }]);
}

/* ---------- 설정 ---------- */
const S_DEFAULT = { org: { name: '' }, roles: ['담당','팀장','총무부장','사무처장'], approvers: {}, staff: [], meal: { people: [], price: 0, place: '' }, check_items: [] };
let S = { ...S_DEFAULT };
async function loadSettings() {
  const rows = await q(sb.from('ow_settings').select('key,value').eq('site_id', SITE));
  S = { ...S_DEFAULT };
  for (const r of rows) S[r.key] = r.value;
  $('#orgName').textContent = S.org?.name || siteName(SITE) || '수양관 사무 자동화';
  $('#staffList').innerHTML = (S.staff || []).map(n => `<option value="${esc(n)}">`).join('');
}
async function saveSetting(k, v) { await q(sb.from('ow_settings').upsert({ site_id: SITE, key: k, value: v, updated_at: new Date().toISOString() }, { onConflict: 'site_id,key' })); S[k] = v; }

/* ---------- 모달·폼 ---------- */
function openModal(title, body, actions = []) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="mh"><h3>${esc(title)}</h3><button class="ghost" data-x>닫기</button></div><div class="mb"></div><div class="mf"></div></div>`;
  m.querySelector('.mb').innerHTML = body;
  const close = () => { m.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  m.querySelector('[data-x]').onclick = close;
  m.addEventListener('click', e => { if (e.target === m) close(); });
  for (const a of actions) {
    const b = document.createElement('button'); b.textContent = a.label; b.className = a.cls || '';
    b.onclick = async () => { b.disabled = true; try { if (await a.onClick(m) !== false) close(); } catch (e) { console.error(e); } finally { b.disabled = false; } };
    m.querySelector('.mf').append(b);
  }
  m.close = close;
  document.body.append(m);
  m.querySelector('.mb input, .mb select, .mb textarea')?.focus();
  return m;
}
function confirmBox(text, label, fn) { openModal('확인', `<p>${esc(text)}</p>`, [{ label: '취소', onClick: () => true }, { label, cls: 'pri', onClick: fn }]); }
function fieldHTML(f, v) {
  const id = 'f_' + f.k; v = v ?? f.def ?? '';
  let inp;
  if (f.type === 'select') inp = `<select id="${id}" data-k="${f.k}">${f.options.map(o => `<option${String(o) === String(v) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (f.type === 'textarea') inp = `<textarea id="${id}" data-k="${f.k}">${esc(v)}</textarea>`;
  else inp = `<input id="${id}" data-k="${f.k}" type="${f.type || 'text'}" value="${esc(v)}"${f.list ? ` list="${f.list}"` : ''}${f.type === 'number' ? ' inputmode="decimal"' : ''}>`;
  return `<label class="f${f.wide ? ' wide' : ''}" for="${id}">${esc(f.label)}${f.req ? ' *' : ''}${inp}</label>`;
}
function readForm(root, fields) {
  const o = {};
  for (const f of fields) { const el = root.querySelector(`[data-k="${f.k}"]`); let v = el.value.trim(); if (f.type === 'number') v = v === '' ? null : Number(v); else if (v === '') v = null; o[f.k] = v; }
  return o;
}
function formModal(title, fields, data, onSave, extra = []) {
  return openModal(title, `<div class="form">${fields.map(f => fieldHTML(f, data[f.k])).join('')}</div>`, [...extra, {
    label: '저장', cls: 'pri', onClick: async m => {
      const v = readForm(m, fields);
      const miss = fields.find(f => f.req && (v[f.k] === null || v[f.k] === ''));
      if (miss) { toast(miss.label + '을(를) 입력하세요.'); return false; }
      await onSave(v); toast('저장했습니다.');
    }
  }]);
}

/* ---------- 사진 ---------- */
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file); const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', .82));
  } catch { return file; }
}
async function uploadPhoto(file, folder) {
  const blob = await shrink(file); const path = `${folder}/${today().slice(0, 7)}/${uid()}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error; return path;
}

/* ---------- 결재 ---------- */
function approveHTML(ap) {
  return `<div class="approve">${S.roles.map(r => { const a = (ap || {})[r];
    return `<button data-role="${esc(r)}" class="${a ? 'on' : ''}"><span class="t">${esc(r)}</span><span class="s">${a ? `<span class="seal">${esc(a.name)}<br>${esc(md((a.at || '').slice(0, 10)))}</span>` : '<span class="noprint">결재</span>'}</span></button>`; }).join('')}</div>`;
}
/* ---------- 수정 요청 (결재자 승인 후 반영) ---------- */
const CR_LABEL = { ow_logs: '작업 일지', ow_expenses: '지출결의서', ow_checks: '시설 점검' };
const CR_VIEW = { ow_logs: '#log/', ow_expenses: '#exp/', ow_checks: '#check/' };
const isChangeApprover = () => isAdmin() || Object.values(S.approvers || {}).some(l => Array.isArray(l) && l.includes(myName()));
const crTitle = (tbl, x) => tbl === 'ow_logs' ? `${md(x.date)} ${((x.tasks || []).find(t => t.text) || {}).text || '작업 일지'}`
  : tbl === 'ow_expenses' ? `${md(x.date)} ${x.title || '지출결의서'}` : `${md(x.date)} 점검 (${x.inspector || ''})`;
async function requestChange(tbl, before, after, action, reason) {
  const clean = o => { const c = { ...o }; delete c.updated_at; delete c.created_at; return c; };
  await q(sb.from('ow_change_requests').insert({ site_id: before.site_id || SITE, tbl, record_id: before.id, action, title: crTitle(tbl, after || before),
    before: clean(before), after: after ? clean({ ...before, ...after }) : null, reason: (reason || '').trim() || null, requested_name: myName() }));
  toast(`${action} 요청을 올렸습니다. 결재자가 승인하면 반영됩니다.`);
}
function askDelete(tbl, row, back) {
  formModal(`${CR_LABEL[tbl]} 삭제 요청`, [{ k: 'reason', label: '삭제 사유', type: 'textarea', req: 1, wide: 1 }], {},
    async v => { await requestChange(tbl, row, null, '삭제', v.reason); location.hash = back; });
}
async function pendingBanner(tbl, id) {
  const rows = await q(sb.from('ow_change_requests').select('id,action,requested_name,reason,created_at').eq('record_id', id).eq('status', '대기'));
  if (!rows.length) return '';
  return `<div class="panel noprint" style="border-color:var(--acc);margin-bottom:14px"><b style="color:var(--acc)">승인 대기 중인 요청 ${rows.length}건</b>
    <ul class="list">${rows.map(x => `<li><span>${esc(x.action)} 요청 · ${esc(x.requested_name || '')} · ${esc(lt(x.created_at))}${x.reason ? ' · ' + esc(x.reason) : ''}</span><a href="#requests">처리하기 →</a></li>`).join('')}</ul>
    <p class="note">승인되기 전까지는 아래 내용이 그대로 유지됩니다.</p></div>`;
}

/* 결재는 로그인한 본인 이름으로만. 결재자가 지정된 칸은 지정된 사람만, 지정되지 않은 칸은 관리자만 */
const canSign = r => { const list = S.approvers?.[r] || []; return list.length ? list.includes(myName()) : isAdmin(); };
function bindApprove(table, row, rerender) {
  M().querySelectorAll('[data-role]').forEach(b => b.onclick = () => {
    const r = b.dataset.role, ap = { ...(row.approvals || {}) };
    const save = async (cancel = false) => { const res = await q(sb.rpc('ow_stamp', { tbl: table, rec: row.id, role: r, cancel })); row.approvals = res || {};
      if (table === 'ow_expenses' && row.kind === '물품구입' && !row.stock_applied_at) { const x = await q(sb.from('ow_expenses').select('stock_applied_at').eq('id', row.id).maybeSingle()); if (x?.stock_applied_at) { row.stock_applied_at = x.stock_applied_at; toast('결재 완료 — 구입 품목을 재고에 입고했습니다.'); } }
      rerender(); };
    if (ap[r]) {
      if (ap[r].uid !== ME.id && ap[r].name !== myName() && !isAdmin()) return toast('다른 사람의 결재는 본인이나 관리자만 취소할 수 있습니다.');
      confirmBox(`${ap[r].name} 님의 ${r} 결재를 취소할까요?`, '결재 취소', async () => { await save(true); }); return;
    }
    if (!canSign(r)) { const list = S.approvers?.[r] || []; return toast(list.length ? `${r} 결재는 ${list.join(', ')} 님만 할 수 있습니다.` : `${r} 결재자가 아직 지정되지 않았습니다. 관리자가 설정에서 지정하세요.`); }
    confirmBox(`${myName()} 이름으로 ${r} 결재합니다.`, '결재', async () => { await save(); toast(r + ' 결재 완료'); });
  });
}
const lastRole = () => S.roles[S.roles.length - 1];
const pending = rows => rows.filter(r => !(r.approvals || {})[lastRole()]).length;
const stampsHTML = ap => `<div class="stamps">${S.roles.map(r => `<i class="${(ap || {})[r] ? 'on' : ''}">${esc(r)}</i>`).join('')}</div>`;

/* ---------- 라우터 ---------- */
const NAV = { docrec: 'docs', 'docrec-edit': 'docs', doc: 'docs', 'doc-edit': 'docs', plan: 'plans', 'plan-edit': 'plans', leave: 'leaves', 'leave-edit': 'leaves', log: 'logs', 'log-edit': 'logs', exp: 'expenses', 'exp-edit': 'expenses', check: 'checks', 'check-edit': 'checks' };
const routes = {};
async function route() {
  if (!ME) return;
  const [name, arg] = (location.hash.slice(1) || 'home').split('/');
  const fn = routes[name] || routes.home;
  const key = routes[name] ? (NAV[name] || name) : 'home';
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.r === key));
  document.querySelector('nav a.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  refreshBadge();
  try { await fn(arg); }
  catch (e) { console.error(e); M().innerHTML = `<div class="empty">불러오지 못했습니다. 인터넷 연결과 config.js 설정을 확인하세요.<br><small>${esc(e.message || e)}</small></div>`; }
  scrollTo(0, 0);
}
addEventListener('hashchange', route);

/* ================= 홈 ================= */
/* ---------- 나스 백업 보고 ---------- */
function backupSummary(runs) {
  const days = {};
  (runs || []).forEach(r => { const d = lt(r.at).slice(0, 10); const x = days[d] ||= { day: d, at: r.at, bytes: null, files: null, fail: [] }; if (r.at > x.at) x.at = r.at; if (r.status !== '성공') x.fail.push(r.note || r.part); else if (r.part === 'data') x.bytes = r.bytes; else if (r.part === 'files') x.files = r.files; });
  const list = Object.values(days).sort((a, b) => b.day.localeCompare(a.day));
  const last = list[0] || null;
  const hours = last ? (Date.now() - new Date(last.at)) / 36e5 : null;
  const state = !last ? 'none' : last.fail.length || last.bytes === null || last.files === null ? 'bad' : hours > 26 ? 'late' : 'ok';
  return { list, last, state, hours };
}
const kb = n => n === null || n === undefined ? '-' : n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
function backupPanel(bk) {
  if (bk.state === 'none') return '<p class="note">아직 백업 기록이 없습니다.</p>';
  const l = bk.last;
  const pill = { ok: '<span class="pill ok">정상</span>', late: `<span class="pill bad">${Math.floor(bk.hours)}시간째 백업 없음</span>`, bad: '<span class="pill bad">확인 필요</span>' }[bk.state];
  return `<ul class="list"><li><span>최근 백업 <b>${esc(lt(l.at))}</b></span>${pill}</li><li><span>전체 자료 ${kb(l.bytes)} · 첨부 파일 ${l.files ?? '-'}개</span></li>${l.fail.length ? `<li class="note">오류: ${esc(l.fail.join(', '))}</li>` : ''}<li class="note">매일 02:00 · 저장 위치 sungrak_sg /수양관사무자동화/백업</li></ul>`;
}
routes.home = async () => {
  const [a, b] = mRange(MONTH);
  const [logs, exps, meals, tasks, inv, crs, docsSoon, bruns] = await Promise.all([
    q(sb.from('ow_logs').select('id,date,tasks,approvals,place').eq('site_id', SITE).gte('date', a).lt('date', b).order('date', { ascending: false })),
    q(sb.from('ow_expenses').select('id,date,title,total,approvals').eq('site_id', SITE).gte('date', a).lt('date', b).order('date', { ascending: false })),
    q(sb.from('ow_meals').select('count').eq('site_id', SITE).gte('date', a).lt('date', b)),
    q(sb.from('ow_tasks').select('*').eq('site_id', SITE).neq('status', '완료').order('due', { ascending: true, nullsFirst: false }).limit(50)),
    q(sb.from('ow_inventory').select('id,name,qty,min_qty,unit').eq('site_id', SITE)),
    q(sb.from('ow_change_requests').select('id').eq('site_id', SITE).eq('status', '대기')),
    q(sb.from('ow_docs').select('id,category,title,holder,expires').eq('site_id', SITE).not('expires', 'is', null).lte('expires', addDays(today(), 60)).order('expires')),
    isAdmin() ? q(sb.from('ow_backup_runs').select('*').order('at', { ascending: false }).limit(40)) : Promise.resolve([])
  ]);
  const bk = backupSummary(bruns);
  const soon = docsSoon;
  const low = inv.filter(i => Number(i.qty) <= Number(i.min_qty) && Number(i.min_qty) > 0);
  const mealN = meals.reduce((s, m) => s + m.count, 0);
  const t0 = today(), over = tasks.filter(t => t.due && t.due < t0);
  M().innerHTML = `
  <div class="head"><h2>${esc(siteName(SITE))} · ${esc(mLabel(MONTH))}</h2><div class="ctrls">${monthPick()}</div></div>
  <div class="kpis">
    <a href="#logs" class="hot"><b class="num">${logs.length}</b><span>작업 일지</span></a>
    <a href="#logs"><b class="num">${pending(logs) + pending(exps)}</b><span>결재 대기 (일지·지출)</span></a>
    <a href="#requests" class="${crs.length ? 'hot' : ''}"><b class="num">${crs.length}</b><span>수정 승인 대기</span></a>
    <a href="#expenses"><b class="num">${won(exps.reduce((s, e) => s + Number(e.total), 0))}</b><span>지출 합계(원)</span></a>
    <a href="#meals"><b class="num">${mealN}</b><span>식수 · ${won(mealN * (S.meal?.price || 0))}원</span></a>
    <a href="#tasks" class="${over.length ? 'bad' : ''}"><b class="num">${tasks.length}</b><span>남은 할 일${over.length ? ` · 지남 ${over.length}` : ''}</span></a>
    <a href="#inventory" class="${low.length ? 'bad' : ''}"><b class="num">${low.length}</b><span>재고 부족</span></a>
    <a href="#docs" class="${soon.some(d => d.expires < today()) ? 'bad' : soon.length ? 'hot' : ''}"><b class="num">${soon.length}</b><span>서류 만료 임박·지남</span></a>
  </div>
  <div class="cols">
    <div class="panel"><h3>최근 작업 일지 <a href="#logs">전체 보기</a></h3><ul class="list">${logs.slice(0, 6).map(l => { const t = (l.tasks || []).find(x => x.text) || {}; return `<li><a href="#log/${l.id}">${esc(md(l.date))} ${esc(t.text || '(내용 없음)')}</a>${(l.approvals || {})[lastRole()] ? '<span class="pill ok">결재 완료</span>' : '<span class="pill">결재 대기</span>'}</li>`; }).join('') || '<li class="note">이번 달 일지가 없습니다.</li>'}</ul></div>
    <div class="panel"><h3>할 일 <a href="#tasks">전체 보기</a></h3><ul class="list">${tasks.slice(0, 6).map(t => `<li><span>${esc(t.title)}${t.assignee ? ` <span class="note">· ${esc(t.assignee)}</span>` : ''}</span><span class="due ${t.due && t.due < t0 ? 'over' : ''}">${t.due ? esc(md(t.due)) : ''}</span></li>`).join('') || '<li class="note">남은 할 일이 없습니다.</li>'}</ul></div>
    <div class="panel"><h3>지출결의서 <a href="#expenses">전체 보기</a></h3><ul class="list">${exps.slice(0, 6).map(e => `<li><a href="#exp/${e.id}">${esc(md(e.date))} ${esc(e.title)}</a><span class="num">${won(e.total)}원</span></li>`).join('') || '<li class="note">이번 달 지출결의서가 없습니다.</li>'}</ul></div>
    ${isAdmin() ? `<div class="panel"><h3>나스(NAS) 백업 <a href="#settings">기록 보기</a></h3>${backupPanel(bk)}</div>` : ''}
    <div class="panel"><h3>건물 관리 서류 만료 <a href="#docs">전체 보기</a></h3><ul class="list">${soon.slice(0, 6).map(d => `<li><a href="#doc/${d.id}">${esc(d.title)}${d.holder ? ` <span class="note">· ${esc(d.holder)}</span>` : ''}</a>${ddayPill(d.expires)}</li>`).join('') || '<li class="note">60일 안에 만료되는 서류가 없습니다.</li>'}</ul></div>
    <div class="panel"><h3>재고 부족 <a href="#inventory">재고 보기</a></h3><ul class="list">${low.map(i => `<li><span>${esc(i.name)}</span><span class="danger">${esc(i.qty)} / 최소 ${esc(i.min_qty)} ${esc(i.unit || '')}</span></li>`).join('') || '<li class="note">부족한 품목이 없습니다.</li>'}</ul></div>
  </div>`;
  bindMonth();
};

/* ================= 작업 일지 ================= */
const WEATHER = ['맑음','흐림','비','눈'], CATS = ['시설보수','청소','설비','조경','행사준비','기타'], STAT = ['예정','진행중','완료'], KINDS = ['작업 전','작업 중','작업 후'];
const SAFE = [['ppe','보호구(안전화·장갑·안전모) 착용'],['edu','작업 전 안전교육 / 작업 내용 공유'],['power','전기·가스·화기 차단 확인'],['clean','작업 후 정리정돈 및 시건 확인']];
const logHours = l => (l.tasks || []).reduce((a, t) => a + hrs(t.start, t.end), 0);
const logCost = l => (l.mats || []).reduce((a, m) => a + (Number(m.qty) || 0) * (Number(m.price) || 0), 0);

routes.logs = async () => {
  const [a, b] = mRange(MONTH);
  const rows = await q(sb.from('ow_logs').select('*').eq('site_id', SITE).gte('date', a).lt('date', b).order('date', { ascending: false }));
  M().innerHTML = `
  <div class="head"><h2>작업 일지</h2><div class="ctrls">${monthPick()}<a class="btn" href="#album">사진첩</a><a class="btn pri" href="#log-edit/new">+ 새 일지</a></div></div>
  <div class="kpis"><div class="hot"><b class="num">${rows.length}</b><span>일지</span></div><div><b class="num">${rows.reduce((s, l) => s + logHours(l), 0).toFixed(1).replace(/\.0$/, '')}</b><span>총 작업시간(h)</span></div><div><b class="num">${won(rows.reduce((s, l) => s + logCost(l), 0))}</b><span>자재비(원)</span></div><div><b class="num">${pending(rows)}</b><span>결재 대기</span></div></div>
  <div class="cards">${rows.map(l => { const t = (l.tasks || []).find(x => x.text) || {}, ph = (l.photos || [])[0];
    return `<a class="card" href="#log/${l.id}"><div class="date"><b class="num">${+l.date.slice(8)}</b><span>${dow(l.date)}요일 · ${esc(l.weather || '')}</span></div>
      <div><h3>${esc(t.text || '(작업 내용 없음)')}</h3><div class="meta"><span class="pill">${esc(l.cat || '')}</span><span>${esc(l.place || t.place || '')}</span><span>${(l.crew || []).length}명</span><span>${logHours(l)}h</span>${logCost(l) ? `<span>${won(logCost(l))}원</span>` : ''}<span>작성 ${esc(l.author || '')}</span></div>${stampsHTML(l.approvals)}</div>
      ${ph ? `<img class="thumb" alt="" loading="lazy" src="${esc(fileUrl(ph.path))}">` : '<span></span>'}</a>`; }).join('') || `<div class="empty">${mLabel(MONTH)} 일지가 없습니다. <b>+ 새 일지</b>로 작성하세요.</div>`}</div>`;
  bindMonth();
};

routes.log = async id => {
  const l = await q(sb.from('ow_logs').select('*').eq('id', id).maybeSingle());
  if (!l) { M().innerHTML = '<div class="empty">일지를 찾을 수 없습니다.</div>'; return; }
  const render = () => {
    const tbl = (head, rows, foot = '') => `<div class="scroll"><table class="stack"><thead><tr>${head.map(h => `<th${h[0] === '#' ? ' class="r"' : ''}>${esc(h.replace('#', ''))}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}">기록 없음</td></tr>`}</tbody>${foot}</table></div>`;
    const grp = KINDS.map(k => { const ps = (l.photos || []).filter(p => p.kind === k); return ps.length ? `<h4 style="margin:12px 0 8px">${k}</h4><div class="photos">${ps.map(p => `<div class="ph"><img alt="${esc(p.cap)}" src="${esc(fileUrl(p.path))}">${p.cap ? `<div class="in">${esc(p.cap)}</div>` : ''}</div>`).join('')}</div>` : ''; }).join('');
    M().innerHTML = `
    <div class="head noprint"><a class="btn ghost" href="#logs">← 목록</a><div class="ctrls"><button class="ghost danger" id="del">삭제 요청</button><a class="btn" href="#log-edit/${l.id}">수정 요청</a><button class="pri" onclick="print()">인쇄</button></div></div>
    <div class="doc">
      <div class="doctop"><h2>작업 일지</h2>${approveHTML(l.approvals)}</div>
      <div class="kv">${[['작업일자', `${l.date} (${dow(l.date)})`], ['날씨', l.weather], ['작성자', l.author], ['작업 장소', l.place], ['작업 구분', l.cat], ['총 인원', (l.crew || []).length + '명'], ['총 작업시간', logHours(l) + '시간'], ['총 자재비', won(logCost(l)) + '원']].map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('')}</div>
      <section class="sec"><h3><em>1</em>금일 작업 내용</h3>${tbl(['작업 내용','장소','작업자','시간','#시간(h)','상태'], (l.tasks || []).map(t => `<tr><td>${esc(t.text)}</td><td>${esc(t.place)}</td><td>${esc(t.worker)}</td><td>${esc(t.start)}~${esc(t.end)}</td><td class="r">${hrs(t.start, t.end)}</td><td>${esc(t.status)}</td></tr>`).join(''))}</section>
      <section class="sec"><h3><em>2</em>투입 인원</h3>${tbl(['성명','소속/구분','담당 작업','시간','#시간(h)','비고'], (l.crew || []).map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.org)}</td><td>${esc(c.role)}</td><td>${c.start ? esc(c.start) + '~' + esc(c.end) : ''}</td><td class="r">${hrs(c.start, c.end) || ''}</td><td>${esc(c.note)}</td></tr>`).join(''))}</section>
      <section class="sec"><h3><em>3</em>사용 자재 · 장비</h3>${tbl(['품명 / 규격','단위','#수량','#단가','#금액','구입처'], (l.mats || []).map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.unit)}</td><td class="r">${esc(m.qty)}</td><td class="r">${won(m.price)}</td><td class="r">${won((Number(m.qty) || 0) * (Number(m.price) || 0))}</td><td>${esc(m.shop)}</td></tr>`).join(''), (l.mats || []).length ? `<tfoot><tr><td>합계</td><td></td><td></td><td></td><td class="r">${won(logCost(l))}</td><td></td></tr></tfoot>` : '')}</section>
      <section class="sec"><h3><em>4</em>안전 점검</h3><div class="checks">${SAFE.map(([k, t]) => `<label><input type="checkbox" disabled${(l.safety || {})[k] ? ' checked' : ''}>${t}</label>`).join('')}</div></section>
      <section class="sec"><h3><em>5</em>특이사항 / 문제점</h3><p class="pre">${esc(l.notes || '없음')}</p></section>
      <section class="sec"><h3><em>6</em>명일 작업 계획</h3><p class="pre">${esc(l.plan || '없음')}</p></section>
      <section class="sec"><h3><em>7</em>작업 사진</h3>${grp || '<p class="note">사진 없음</p>'}</section>
    </div>`;
    bindApprove('ow_logs', l, render);
    $('#del').onclick = () => askDelete('ow_logs', l, '#log/' + l.id);
    if (banner) M().querySelector('.doc').insertAdjacentHTML('beforebegin', banner);
  };
  const banner = await pendingBanner('ow_logs', l.id);
  render();
};

/* 동적 줄 편집기 (일지·지출 공용) */
function rowsEditor(container, list, cols, newRow, calc) {
  const draw = () => {
    container.innerHTML = `<div class="rows">${list.map((r, i) => `<div class="row">${cols.map(([k, l, t = 'text', x]) => {
      const cls = x === 'wide' ? ' wide' : '';
      if (t === 'sel') return `<label class="f${cls}">${l}<select data-i="${i}" data-c="${k}">${x.map(o => `<option${r[k] === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
      return `<label class="f${cls}">${l}<input type="${t}" ${t === 'number' ? 'inputmode="decimal" min="0"' : ''} ${x && x !== 'wide' ? `list="${x}"` : ''} data-i="${i}" data-c="${k}" value="${esc(r[k])}"></label>`; }).join('')}
      ${calc ? `<div class="calc" data-calc="${i}">${calc(r)}</div>` : ''}<button class="ghost x" type="button" data-del="${i}" aria-label="줄 삭제">삭제</button></div>`).join('')}</div>
      <button type="button" class="add" style="margin-top:10px">+ 줄 추가</button>`;
  };
  container.addEventListener('input', e => { const d = e.target.dataset; if (d.c === undefined) return; list[d.i][d.c] = e.target.value; if (calc) { const c = container.querySelector(`[data-calc="${d.i}"]`); if (c) c.textContent = calc(list[d.i]); } container.dispatchEvent(new Event('rowschange', { bubbles: true })); });
  container.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.del !== undefined) { list.splice(+b.dataset.del, 1); draw(); } else if (b.classList.contains('add')) { list.push(newRow()); draw(); } container.dispatchEvent(new Event('rowschange', { bubbles: true })); });
  draw();
  return { redraw: () => { draw(); container.dispatchEvent(new Event('rowschange', { bubbles: true })); } };
}
function photoEditor(container, photos, folder, withKind) {
  const draw = () => {
    container.innerHTML = `<div class="photos">${photos.map((p, i) => `<div class="ph"><img alt="" src="${esc(fileUrl(p.path))}"><div class="in">
      ${withKind ? `<select data-pk="${i}">${KINDS.map(k => `<option${p.kind === k ? ' selected' : ''}>${k}</option>`).join('')}</select>` : ''}
      <input data-pc="${i}" placeholder="설명" value="${esc(p.cap)}"><button type="button" class="ghost" data-pdel="${i}">빼기</button></div></div>`).join('')}
      <label class="drop"><b>사진 올리기</b><span>눌러서 사진을 고르거나 찍으세요 · 여러 장 가능</span><input type="file" accept="image/*" multiple hidden></label></div>`;
  };
  container.addEventListener('input', e => { const d = e.target.dataset; if (d.pk) photos[d.pk].kind = e.target.value; if (d.pc) photos[d.pc].cap = e.target.value; });
  container.addEventListener('click', e => { const b = e.target.closest('[data-pdel]'); if (b) { photos.splice(+b.dataset.pdel, 1); draw(); } });
  container.addEventListener('change', async e => {
    if (e.target.type !== 'file') return;
    const files = [...e.target.files]; const kind = photos.length ? photos[photos.length - 1].kind : '작업 전';
    for (const f of files) { toast('사진 올리는 중… (' + (files.indexOf(f) + 1) + '/' + files.length + ')'); try { photos.push({ path: await uploadPhoto(f, folder), kind, cap: '' }); draw(); } catch (err) { toast('사진을 올리지 못했습니다: ' + (err.message || '')); } }
    toast('사진을 올렸습니다. 저장을 눌러 주세요.');
  });
  draw();
}

routes['log-edit'] = async id => {
  let l;
  if (id && id !== 'new') l = await q(sb.from('ow_logs').select('*').eq('id', id).maybeSingle());
  const d = l ? structuredClone(l) : { date: today(), weather: '맑음', author: myName(), place: '', cat: '시설보수',
    tasks: [{ text: '', place: '', worker: '', start: '09:00', end: '18:00', status: '진행중' }], crew: [{ name: '', org: '', role: '', start: '09:00', end: '18:00', note: '' }], mats: [], safety: {}, notes: '', plan: '', photos: [], approvals: {} };
  const F = [{ k: 'date', label: '작업일자', type: 'date', req: 1 }, { k: 'weather', label: '날씨', type: 'select', options: WEATHER }, { k: 'author', label: '작성자', list: 'staffList', req: 1 }, { k: 'place', label: '작업 장소' }, { k: 'cat', label: '작업 구분', type: 'select', options: CATS }];
  M().innerHTML = `
  <div class="head"><h2>${l ? '일지 수정 요청' : '새 작업 일지'}</h2><div class="ctrls"><a class="btn ghost" href="${l ? '#log/' + l.id : '#logs'}">취소</a><button class="pri" id="save">저장</button></div></div>
  <section class="sec"><h3>기본 정보</h3><div class="form" id="basic">${F.map(f => fieldHTML(f, d[f.k])).join('')}</div></section>
  <section class="sec"><h3><em>1</em>금일 작업 내용</h3><div id="r1"></div></section>
  <section class="sec"><h3><em>2</em>투입 인원</h3><div id="r2"></div></section>
  <section class="sec"><h3><em>3</em>사용 자재 · 장비</h3><div id="r3"></div></section>
  <section class="sec"><h3><em>4</em>안전 점검</h3><div class="checks">${SAFE.map(([k, t]) => `<label><input type="checkbox" data-s="${k}"${d.safety[k] ? ' checked' : ''}>${t}</label>`).join('')}</div></section>
  <section class="sec"><h3><em>5</em>특이사항 / 문제점</h3><textarea id="notes">${esc(d.notes)}</textarea></section>
  <section class="sec"><h3><em>6</em>명일 작업 계획</h3><textarea id="plan">${esc(d.plan)}</textarea></section>
  <section class="sec"><h3><em>7</em>작업 사진</h3><div id="ph"></div></section>
  ${l ? '<section class="sec"><h3>수정 사유 <span class="note">(결재자에게 보입니다)</span></h3><input id="reason" placeholder="예: 작업 시간 정정"></section>' : ''}
  <div class="ctrls" style="justify-content:flex-end;padding-top:16px"><button class="pri" id="save2">저장</button></div>`;
  rowsEditor($('#r1'), d.tasks, [['text','작업 내용','text','wide'],['place','장소'],['worker','작업자','text','staffList'],['start','시작','time'],['end','종료','time'],['status','상태','sel',STAT]], () => ({ text: '', place: '', worker: '', start: '09:00', end: '18:00', status: '진행중' }), r => hrs(r.start, r.end) + '시간');
  rowsEditor($('#r2'), d.crew, [['name','성명','text','staffList'],['org','소속/구분'],['role','담당 작업'],['start','시작','time'],['end','종료','time'],['note','비고']], () => ({ name: '', org: '', role: '', start: '09:00', end: '18:00', note: '' }), r => hrs(r.start, r.end) + '시간');
  rowsEditor($('#r3'), d.mats, [['name','품명 / 규격','text','wide'],['unit','단위'],['qty','수량','number'],['price','단가(원)','number'],['shop','구입처'],['note','비고']], () => ({ name: '', unit: '개', qty: '', price: '', shop: '', note: '' }), r => '금액 ' + won((Number(r.qty) || 0) * (Number(r.price) || 0)) + '원');
  photoEditor($('#ph'), d.photos, 'logs', true);
  const save = async () => {
    const v = readForm($('#basic'), F); if (!v.date || !v.author) return toast('작업일자와 작성자를 입력하세요.');
    Object.assign(d, v); d.notes = $('#notes').value; d.plan = $('#plan').value;
    M().querySelectorAll('[data-s]').forEach(c => d.safety[c.dataset.s] = c.checked);
    const body = { date: d.date, weather: d.weather, author: d.author, place: d.place, cat: d.cat,
      tasks: d.tasks.filter(t => t.text || t.worker), crew: d.crew.filter(c => c.name), mats: d.mats.filter(m => m.name).map(m => ({ ...m, qty: Number(m.qty) || 0, price: Number(m.price) || 0 })),
      safety: d.safety, notes: d.notes, plan: d.plan, photos: d.photos, updated_at: new Date().toISOString() };
    if (l) { await requestChange('ow_logs', l, body, '수정', $('#reason').value); location.hash = '#log/' + l.id; return; }
    const res = await q(sb.from('ow_logs').insert({ ...body, site_id: SITE }).select('id').single());
    toast('저장했습니다.'); location.hash = '#log/' + res.id;
  };
  $('#save').onclick = save; $('#save2').onclick = save;
};

/* 사진첩 */
routes.album = async () => {
  const [a, b] = mRange(MONTH);
  const rows = (await q(sb.from('ow_logs').select('id,date,place,tasks,photos').eq('site_id', SITE).gte('date', a).lt('date', b).order('date', { ascending: false }))).filter(l => (l.photos || []).length);
  const list = []; const total = rows.reduce((s, l) => s + l.photos.length, 0);
  M().innerHTML = `<div class="head"><h2>작업 사진첩</h2><div class="ctrls">${monthPick()}<a class="btn" href="#logs">일지 목록</a></div></div>
  ${rows.length ? `<p class="note">${mLabel(MONTH)} 사진 ${total}장 · 일지 ${rows.length}건. 사진을 누르면 크게 볼 수 있습니다.</p>` : `<div class="empty">${mLabel(MONTH)}에 올린 사진이 없습니다. 일지 작성 화면의 <b>7. 작업 사진</b>에서 올리면 여기에 모입니다.</div>`}
  ${rows.map(l => { const t = (l.tasks || []).find(x => x.text) || {};
    return `<section class="alb"><header><b class="num">${md(l.date)}</b><span class="note">${dow(l.date)}요일</span><h3>${esc(t.text || '(작업 내용 없음)')}</h3><span class="note">${esc(l.place || t.place || '')}</span><a class="btn ghost" href="#log/${l.id}">일지 보기 →</a></header>
    <div class="kinds">${KINDS.map(k => { const ps = l.photos.filter(p => (p.kind || '작업 전') === k); if (!ps.length) return '';
      return `<div><h4>${k} <span class="note">${ps.length}장</span></h4><div class="pics">${ps.map(p => { const i = list.push({ p, l }) - 1; return `<button data-lb="${i}"><img loading="lazy" alt="" src="${esc(fileUrl(p.path))}"><span>${esc(p.cap)}</span></button>`; }).join('')}</div></div>`; }).join('')}</div></section>`; }).join('')}`;
  bindMonth();
  let cur = 0, lb = null;
  const show = i => {
    cur = (i + list.length) % list.length; const { p, l } = list[cur];
    if (!lb) { lb = document.createElement('div'); lb.id = 'lb'; lb.innerHTML = `<div class="bar2"><span id="lbc"></span><button data-a="x">닫기 ✕</button></div><div class="stage"><img alt=""></div><div class="cap"></div><div class="nav2"><button data-a="p">← 이전</button><button data-a="o">이 일지 보기</button><button data-a="n">다음 →</button></div>`; document.body.append(lb);
      lb.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'x') close(); if (a === 'p') show(cur - 1); if (a === 'n') show(cur + 1); if (a === 'o') { close(); location.hash = '#log/' + list[cur].l.id; } }; addEventListener('keydown', key); }
    lb.querySelector('img').src = fileUrl(p.path); lb.querySelector('.cap').textContent = [p.kind, p.cap, l.date].filter(Boolean).join(' · '); lb.querySelector('#lbc').textContent = `${cur + 1} / ${list.length}`;
  };
  const close = () => { lb?.remove(); lb = null; removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); };
  M().querySelectorAll('[data-lb]').forEach(b => b.onclick = () => show(+b.dataset.lb));
  addEventListener('hashchange', close, { once: true });
};

/* ================= 지출결의서 ================= */
const PAY = ['법인카드','개인카드(정산)','현금','계좌이체'];
const EKINDS = ['식대', '운영비', '물품구입'];
const GOODS = ['사무용품', '공구·장비', '자재', '청소용품', '비품', '소모품', '기타'];
const CATS_OF = { 운영비: () => OPEX, 물품구입: () => GOODS };
const OPEX = ['전기', '수도', '가스', '유류', '소모품', '수리·보수', '통신', '차량', '청소·위생', '기타'];
let EXPK = '전체';
const expTotal = items => (items || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
routes.expenses = async () => {
  const [a, b] = mRange(MONTH);
  const all = await q(sb.from('ow_expenses').select('*').eq('site_id', SITE).gte('date', a).lt('date', b).order('date', { ascending: false }));
  const rows = EXPK === '전체' ? all : all.filter(e => (e.kind || '식대') === EXPK);
  const sumK = k => all.filter(e => (e.kind || '식대') === k).reduce((s, e) => s + Number(e.total), 0);
  const ops = all.filter(e => e.kind === EXPK && CATS_OF[EXPK]), byCat = {};
  ops.forEach(e => (e.items || []).forEach(i => { const c = i.cat || '기타'; byCat[c] = (byCat[c] || 0) + (Number(i.qty) || 0) * (Number(i.price) || 0); }));
  const catList = CATS_OF[EXPK] ? CATS_OF[EXPK]() : [];
  const cats = catList.filter(c => byCat[c]).concat(Object.keys(byCat).filter(c => !catList.includes(c)));
  M().innerHTML = `<div class="head"><h2>지출결의서</h2><div class="ctrls">${monthPick()}<a class="btn" href="#meals">식대 결의서 만들기</a><a class="btn" href="#exp-edit/new-op">+ 운영비 결의서</a><a class="btn" href="#exp-edit/new-buy">+ 물품구입 결의서</a><a class="btn pri" href="#exp-edit/new">+ 새 결의서</a></div></div>
  <div class="kpis"><div class="hot"><b class="num">${won(all.reduce((s, e) => s + Number(e.total), 0))}</b><span>${mLabel(MONTH)} 지출 합계(원)</span></div><div><b class="num">${won(sumK('식대'))}</b><span>식대(원)</span></div><div><b class="num">${won(sumK('운영비'))}</b><span>운영비(원)</span></div><div><b class="num">${won(sumK('물품구입'))}</b><span>물품구입(원)</span></div><div><b class="num">${pending(all)}</b><span>결재 대기</span></div></div>
  <div class="ctrls" style="margin:4px 0 12px" role="group" aria-label="구분">${['전체', ...EKINDS].map(k => `<button type="button" class="${k === EXPK ? 'pri' : 'ghost'}" data-ek="${k}">${k}</button>`).join('')}</div>
  ${CATS_OF[EXPK] && cats.length ? `<section class="sec"><h3>${EXPK} ${EXPK === '물품구입' ? '분류' : '항목'}별 합계</h3><div class="scroll"><table class="stack"><thead><tr><th>${EXPK === '물품구입' ? '분류' : '항목'}</th><th class="r">금액(원)</th></tr></thead><tbody>${cats.map(c => `<tr><td>${esc(c)}</td><td class="r num">${won(byCat[c])}</td></tr>`).join('')}</tbody><tfoot><tr><td>합계</td><td class="r num">${won(sumK(EXPK))}</td></tr></tfoot></table></div></section>` : ''}
  ${rows.length ? `<div class="scroll"><table class="stack"><thead><tr><th>지출일</th><th>구분</th><th>제목</th><th>거래처</th><th>결제</th><th class="r">금액(원)</th><th>결재</th></tr></thead><tbody>${rows.map(e => `<tr><td>${esc(e.date)}</td><td>${esc(e.kind || '식대')}</td><td><a href="#exp/${e.id}"><b>${esc(e.title)}</b></a></td><td>${esc(e.vendor)}</td><td>${esc(e.pay_method)}</td><td class="r num">${won(e.total)}</td><td>${stampsHTML(e.approvals)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${mLabel(MONTH)} ${EXPK === '전체' ? '' : EXPK + ' '}지출결의서가 없습니다.</div>`}`;
  M().querySelectorAll('[data-ek]').forEach(b => b.onclick = () => { EXPK = b.dataset.ek; route(); });
  bindMonth();
};
routes.exp = async id => {
  const e = await q(sb.from('ow_expenses').select('*').eq('id', id).maybeSingle());
  if (!e) { M().innerHTML = '<div class="empty">결의서를 찾을 수 없습니다.</div>'; return; }
  const render = () => {
    M().innerHTML = `<div class="head noprint"><a class="btn ghost" href="#expenses">← 목록</a><div class="ctrls"><button class="ghost danger" id="del">삭제 요청</button><a class="btn" href="#exp-edit/${e.id}">수정 요청</a><button class="pri" onclick="print()">인쇄</button></div></div>
    <div class="doc">
      <div class="doctop"><h2>지출결의서${e.kind && e.kind !== '식대' ? ` <small>(${esc(e.kind)})</small>` : ''}</h2>${approveHTML(e.approvals)}</div>
      <div class="kv">${[['구분', e.kind || '식대'], ['부서', e.dept], ['작성자', e.author], ['지출일', e.date], ['거래처', e.vendor], ['결제 방법', e.pay_method], ['작성일', (e.created_at || '').slice(0, 10)]].map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('')}</div>
      <div class="amount">금 ${korMoney(e.total)}원정 <small>(₩${won(e.total)})</small></div>
      <p><b>제목</b> ${esc(e.title)}</p>
      ${e.kind === '물품구입' ? `<p class="note noprint">${e.stock_applied_at ? `📦 재고에 입고 반영됨 (${esc(lt(e.stock_applied_at))}) — <a href="#inventory">재고 보기</a>` : '📦 결재가 모두 끝나면 품목이 재고에 자동으로 입고됩니다.'}</p>` : ''}
      <div class="scroll"><table class="stack"><thead><tr><th>내용</th><th class="r">수량</th><th class="r">단가</th><th class="r">금액</th><th>비고</th></tr></thead>
      <tbody>${(e.items || []).map(i => `<tr><td>${CATS_OF[e.kind] && i.cat ? `[${esc(i.cat)}] ` : ''}${esc(i.desc)}${i.spec ? ` <small>(${esc(i.spec)})</small>` : ''}</td><td class="r">${esc(i.qty)}${i.unit ? ' ' + esc(i.unit) : ''}</td><td class="r">${won(i.price)}</td><td class="r">${won((Number(i.qty) || 0) * (Number(i.price) || 0))}</td><td>${esc(i.note)}</td></tr>`).join('') || '<tr><td colspan="5">내역 없음</td></tr>'}</tbody>
      <tfoot><tr><td>합계</td><td></td><td></td><td class="r">${won(e.total)}</td><td></td></tr></tfoot></table></div>
      ${e.note ? `<section class="sec"><h3>비고</h3><p class="pre">${esc(e.note)}</p></section>` : ''}
      <p style="margin-top:18px">위 금액을 지출하고자 하오니 결재하여 주시기 바랍니다.</p>
      ${(e.history || []).length ? `<section class="sec noprint"><h3>수정 이력 <span class="note">${e.history.length}건 · 인쇄에는 나오지 않습니다</span></h3>${e.history.slice().reverse().map(h => {
        const it = x => (x?.items || []).map(i => `${i.desc} ${i.qty} × ${won(i.price)}`).join(' / ') || '없음';
        const qsum = x => (x?.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);
        const rows = [['내역', it(h.before), it(h.after)], ['수량', qsum(h.before), qsum(h.after)], ['합계(원)', won(h.before?.total), won(h.after?.total)], ['비고', h.before?.note || '', h.after?.note || '']].filter(r => String(r[1]) !== String(r[2]) || r[0] === '합계(원)');
        return `<div style="margin-bottom:16px"><p class="meta"><b style="color:var(--ink)">${esc((h.at || '').slice(0, 16).replace('T', ' '))}</b><span>${esc(h.by || '')}</span>${h.reason ? `<span>사유: ${esc(h.reason)}</span>` : ''}</p>
        <div class="scroll"><table class="stack"><thead><tr><th>항목</th><th>바뀌기 전</th><th>바뀐 후</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td><b>${esc(r[2])}</b></td></tr>`).join('')}</tbody></table></div></div>`; }).join('')}</section>` : ''}
      ${(e.receipts || []).length ? `<section class="sec"><h3>증빙 (영수증)</h3><div class="photos">${e.receipts.map(p => `<div class="ph"><img alt="${esc(p.cap)}" src="${esc(fileUrl(p.path))}">${p.cap ? `<div class="in">${esc(p.cap)}</div>` : ''}</div>`).join('')}</div></section>` : ''}
    </div>`;
    bindApprove('ow_expenses', e, render);
    $('#del').onclick = () => askDelete('ow_expenses', e, '#exp/' + e.id);
    if (banner) M().querySelector('.doc').insertAdjacentHTML('beforebegin', banner);
  };
  const banner = await pendingBanner('ow_expenses', e.id);
  render();
};
routes['exp-edit'] = async id => {
  let e;
  const newKind = id === 'new-op' ? '운영비' : id === 'new-buy' ? '물품구입' : '식대';
  if (id && !id.startsWith('new')) e = await q(sb.from('ow_expenses').select('*').eq('id', id).maybeSingle());
  const d = e ? structuredClone(e) : { date: today(), title: '', dept: S.org?.name || '덕정 수양관', author: myName(), vendor: '', pay_method: PAY[0], items: [], note: '', receipts: [], kind: newKind };
  d.kind = d.kind || '식대';
  const F = [{ k: 'kind', label: '구분', type: 'select', options: EKINDS }, { k: 'title', label: '제목', req: 1, wide: 1 }, { k: 'date', label: '지출일', type: 'date', req: 1 }, { k: 'dept', label: '부서' }, { k: 'author', label: '작성자', list: 'staffList', req: 1 }, { k: 'vendor', label: '거래처' }, { k: 'pay_method', label: '결제 방법', type: 'select', options: PAY }];
  M().innerHTML = `<div class="head"><h2>${e ? '결의서 수정 요청' : d.kind === '식대' ? '새 지출결의서' : `새 ${d.kind} 결의서`}</h2><div class="ctrls"><a class="btn ghost" href="${e ? '#exp/' + e.id : '#expenses'}">취소</a><button class="pri" id="save">저장</button></div></div>
  <section class="sec"><h3>기본 정보</h3><div class="form" id="basic">${F.map(f => fieldHTML(f, d[f.k])).join('')}</div></section>
  <section class="sec"><h3>지출 내역 <span class="note" id="tot"></span></h3>
    <div class="ctrls" id="mealCtl" style="margin-bottom:12px"><input type="month" id="mm" value="${esc((d.date || today()).slice(0, 7))}" aria-label="식수표 월"><select id="mmode" aria-label="불러오기 방식"><option value="sum">전체 합산 (한 줄)</option><option value="each">1인별 (사람마다 한 줄)</option></select><button type="button" id="fromMeal">식수표에서 수량 불러오기</button><span class="note">고른 달 식수표의 식수를 수량으로, 설정의 1식 단가를 단가로 넣습니다.</span></div>
    <div id="items"></div></section>
  <section class="sec"><h3>비고</h3><textarea id="note">${esc(d.note)}</textarea></section>
  ${e ? `<section class="sec"><h3>수정 사유 <span class="note">(결재자에게 보이고, 승인되면 수정 이력에 남습니다)</span></h3><input id="reason" placeholder="예: 식수표 기준으로 재계산"></section>` : ''}
  <section class="sec"><h3>증빙 (영수증 사진)</h3><div id="rc"></div></section>`;
  const tot = () => $('#tot').textContent = '합계 ' + won(expTotal(d.items)) + '원';
  const calcR = r => '금액 ' + won((Number(r.qty) || 0) * (Number(r.price) || 0)) + '원';
  let ed;
  const drawItems = () => {
    const k = d.kind, cl = CATS_OF[k] ? CATS_OF[k]() : null;
    const blank = () => k === '물품구입' ? { cat: GOODS[0], desc: '', spec: '', unit: '개', qty: 1, price: '', note: '' } : cl ? { cat: cl[0], desc: '', qty: 1, price: '', note: '' } : { desc: '', qty: 1, price: '', note: '' };
    if (!d.items.length) d.items.push(blank());
    if (cl) d.items.forEach(i => { if (!cl.includes(i.cat)) i.cat = cl[0]; });
    $('#items').replaceWith(Object.assign(document.createElement('div'), { id: 'items' }));
    const cols = k === '물품구입' ? [['cat','분류','sel',GOODS],['desc','품명','text','wide'],['spec','규격'],['unit','단위'],['qty','수량','number'],['price','단가(원)','number'],['note','비고']]
      : cl ? [['cat','항목','sel',cl],['desc','내용','text','wide'],['qty','수량','number'],['price','단가(원)','number'],['note','비고']]
      : [['desc','내용','text','wide'],['qty','수량','number'],['price','단가(원)','number'],['note','비고']];
    ed = rowsEditor($('#items'), d.items, cols, blank, calcR);
    $('#items').addEventListener('rowschange', tot);
    $('#mealCtl').style.display = k === '식대' ? '' : 'none';
    tot();
  };
  drawItems();
  $('#f_kind').onchange = ev => { d.kind = ev.target.value; drawItems(); };
  const isMeal = x => (x.note || '').includes('식수표') || /식대/.test(x.desc || '');
  const loadMeal = async (m, mode, quiet) => {
    const [a, b] = mRange(m);
    const rows = await q(sb.from('ow_meals').select('person,count').eq('site_id', SITE).gte('date', a).lt('date', b));
    const cnt = {}; rows.forEach(r => cnt[r.person] = (cnt[r.person] || 0) + r.count);
    const people = [...new Set([...(S.meal?.people || []), ...Object.keys(cnt)])].filter(p => cnt[p]);
    if (!people.length) { if (!quiet) toast(mLabel(m) + ' 식수표에 입력된 식수가 없습니다.'); return false; }
    const price = Number(S.meal?.price) || 0;
    const total = people.reduce((s, p) => s + cnt[p], 0);
    // 빈 줄과 이전에 불러온 식대 줄은 지우고 새로 넣기
    for (let i = d.items.length - 1; i >= 0; i--) { const x = d.items[i]; if ((!x.desc && !Number(x.price)) || isMeal(x)) d.items.splice(i, 1); }
    if (mode === 'sum') {
      d.items.unshift({ desc: `${mLabel(m)} 직원 식대`, qty: total, price, note: `식수표 합산 (${people.map(p => `${p} ${cnt[p]}식`).join(', ')})` });
    } else {
      people.slice().reverse().forEach(p => d.items.unshift({ desc: `${p} 식대`, qty: cnt[p], price, note: `${mLabel(m)} 식수표` }));
    }
    const setIf = (k, v) => { const el = M().querySelector(`[data-k="${k}"]`); if (el && !el.value.trim() && v) el.value = v; };
    setIf('title', `${mLabel(m)} 직원 식대`); setIf('vendor', S.meal?.place || '');
    ed.redraw();
    toast(`${mLabel(m)} 식수표에서 ${people.length}명, 총 ${total}식을 불러왔습니다.`);
    return true;
  };
  $('#fromMeal').onclick = () => { const m = $('#mm').value; if (!m) return toast('불러올 달을 고르세요.'); loadMeal(m, $('#mmode').value); };
  photoEditor($('#rc'), d.receipts, 'receipts', false);
  $('#save').onclick = async () => {
    const v = readForm($('#basic'), F); if (!v.title || !v.date || !v.author) return toast('제목, 지출일, 작성자를 입력하세요.');
    // 식대 결의서인데 식수 줄이 없으면 그 달 식수표를 자동으로 불러옴
    if (v.kind === '식대' && /식대/.test(v.title) && !d.items.some(x => isMeal(x) && Number(x.qty) > 0)) {
      const ok = await loadMeal(v.date.slice(0, 7), 'sum', true);
      if (ok) { const f = readForm($('#basic'), F); Object.assign(v, { vendor: v.vendor || f.vendor }); }
    }
    const items = d.items.filter(i => i.desc).map(i => ({ ...i, qty: Number(i.qty) || 0, price: Number(i.price) || 0 }));
    const body = { ...v, items, total: expTotal(items), note: $('#note').value, receipts: d.receipts, updated_at: new Date().toISOString() };
    if (e) { await requestChange('ow_expenses', e, body, '수정', $('#reason').value); location.hash = '#exp/' + e.id; return; }
    const res = await q(sb.from('ow_expenses').insert({ ...body, site_id: SITE }).select('id').single());
    toast('저장했습니다.'); location.hash = '#exp/' + res.id;
  };
};

/* ================= 승인 요청 ================= */
const CR_FIELDS = {
  ow_logs: { date: '작업일자', weather: '날씨', author: '작성자', place: '작업 장소', cat: '작업 구분', tasks: '작업 내용', crew: '투입 인원', mats: '자재·장비', safety: '안전 점검', notes: '특이사항', plan: '명일 계획', photos: '사진' },
  ow_expenses: { kind: '구분', date: '지출일', title: '제목', dept: '부서', author: '작성자', vendor: '거래처', pay_method: '결제 방법', items: '지출 내역', total: '합계(원)', note: '비고', receipts: '영수증' },
  ow_checks: { date: '점검일', inspector: '점검자', results: '점검 결과', note: '종합 의견' } };
function crShow(k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'tasks') return v.map(t => `${t.text || ''} (${t.start || ''}~${t.end || ''}, ${t.status || ''})`).join(' / ') || '없음';
  if (k === 'crew') return v.map(c => c.name).join(', ') || '없음';
  if (k === 'mats') return v.map(m => `${m.name} ${m.qty}${m.unit || ''} × ${won(m.price)}`).join(' / ') || '없음';
  if (k === 'items') return v.map(i => `${i.desc} ${i.qty} × ${won(i.price)}`).join(' / ') || '없음';
  if (k === 'photos' || k === 'receipts') return `${v.length}장`;
  if (k === 'safety') return `${Object.values(v).filter(Boolean).length}/4 확인`;
  if (k === 'results') { const b = Object.values(v).filter(x => x.r === '불량').length; return `${Object.keys(v).length}항목 · 불량 ${b}`; }
  if (k === 'total') return won(v);
  return String(v);
}
function crDiff(x) {
  const F = CR_FIELDS[x.tbl] || {};
  if (x.action === '삭제') return `<p class="danger"><b>이 자료 전체를 삭제합니다.</b></p>`;
  const norm = (k, v) => { if (v === null || v === undefined || v === '') return null; if (k === 'safety') return Object.keys(v).filter(z => v[z]).sort(); if (Array.isArray(v) && !v.length) return null; if (k === 'total') return Number(v); return v; };
  const rows = Object.keys(F).filter(k => JSON.stringify(norm(k, x.before?.[k])) !== JSON.stringify(norm(k, x.after?.[k])))
    .map(k => `<tr><td>${esc(F[k])}</td><td>${esc(crShow(k, x.before?.[k]))}</td><td><b>${esc(crShow(k, x.after?.[k]))}</b></td></tr>`).join('');
  return rows ? `<div class="scroll"><table class="stack"><thead><tr><th>항목</th><th>지금</th><th>바뀔 내용</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="note">바뀐 내용이 없습니다.</p>';
}
async function refreshBadge() {
  try { const { count } = await sb.from('ow_change_requests').select('id', { count: 'exact', head: true }).eq('site_id', SITE).eq('status', '대기');
    const a = document.querySelector('nav a[data-r="requests"]'); if (a) a.textContent = count ? `승인 요청 (${count})` : '승인 요청'; } catch {}
}
routes.requests = async () => {
  const rows = await q(sb.from('ow_change_requests').select('*').eq('site_id', SITE).order('created_at', { ascending: false }).limit(60));
  const pend = rows.filter(x => x.status === '대기'), done = rows.filter(x => x.status !== '대기');
  const can = isChangeApprover();
  const card = x => `<div class="panel" style="margin-bottom:12px">
    <h3><span>${x.action === '삭제' ? '<span class="pill bad">삭제</span>' : '<span class="pill acc">수정</span>'} ${esc(CR_LABEL[x.tbl])} · <a href="${CR_VIEW[x.tbl]}${esc(x.record_id)}">${esc(x.title || '')}</a></span>
      ${x.status === '대기' ? '<span class="pill">대기</span>' : x.status === '승인' ? '<span class="pill ok">승인</span>' : '<span class="pill bad">반려</span>'}</h3>
    <p class="meta"><span>요청 ${esc(x.requested_name || '')} · ${esc(lt(x.created_at))}</span>${x.reason ? `<span>사유: ${esc(x.reason)}</span>` : ''}
      ${x.decided_name ? `<span>${esc(x.status)} ${esc(x.decided_name)} · ${esc(lt(x.decided_at))}</span>` : ''}${x.comment ? `<span>의견: ${esc(x.comment)}</span>` : ''}</p>
    ${crDiff(x)}
    ${x.status === '대기' ? `<div class="ctrls" style="margin-top:10px;justify-content:flex-end">
      ${x.requested_by === ME.id ? `<button class="ghost" data-cancel="${x.id}">요청 취소</button>` : ''}
      ${can ? `<button class="danger" data-rej="${x.id}">반려</button><button class="pri" data-ok="${x.id}">승인</button>` : ''}</div>` : ''}</div>`;
  M().innerHTML = `<div class="head"><h2>승인 요청 <span class="note" style="font-size:16px">${esc(siteName(SITE))}</span></h2></div>
    <p class="note">작업 일지·지출결의서·시설 점검을 고치거나 지우면 이곳에 요청이 올라옵니다. ${can ? '결재자로서 승인하면 바로 반영되고, 반려하면 그대로 남습니다.' : '이 수양관의 결재자나 관리자가 승인하면 반영됩니다.'}</p>
    <h3 style="margin:16px 0 10px">대기 ${pend.length}건</h3>${pend.map(card).join('') || '<div class="empty">대기 중인 요청이 없습니다.</div>'}
    ${done.length ? `<h3 style="margin:22px 0 10px">처리 완료 (최근)</h3>${done.map(card).join('')}` : ''}`;
  const decide = async (id, ok, note) => { await q(sb.rpc('ow_decide_change', { req: id, approve: ok, note: note || null })); toast(ok ? '승인했습니다. 반영됐습니다.' : '반려했습니다.'); route(); refreshBadge(); };
  M().querySelectorAll('[data-ok]').forEach(b => b.onclick = () => { const x = rows.find(r => r.id === b.dataset.ok);
    confirmBox(`${x.title} ${x.action} 요청을 승인할까요? ${x.action === '삭제' ? '자료가 삭제되며 되돌릴 수 없습니다.' : '바로 반영됩니다.'}`, '승인', () => decide(x.id, true)); });
  M().querySelectorAll('[data-rej]').forEach(b => b.onclick = () => formModal('반려', [{ k: 'note', label: '반려 사유 (요청자에게 보입니다)', type: 'textarea', wide: 1 }], {}, v => decide(b.dataset.rej, false, v.note)));
  M().querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => confirmBox('이 요청을 취소할까요?', '요청 취소', async () => { await q(sb.from('ow_change_requests').delete().eq('id', b.dataset.cancel)); route(); refreshBadge(); }));
};

/* ================= 식수표 ================= */
routes.meals = async () => {
  const [a, b] = mRange(MONTH); const people = S.meal?.people || []; const price = Number(S.meal?.price) || 0;
  const rows = await q(sb.from('ow_meals').select('*').eq('site_id', SITE).gte('date', a).lt('date', b));
  const map = {}; rows.forEach(r => map[r.date + '|' + r.person] = r.count);
  const days = []; for (let d = new Date(a + 'T00:00'); ymd(d) < b; d.setDate(d.getDate() + 1)) days.push(ymd(d));
  const sum = p => days.reduce((s, d) => s + (map[d + '|' + p] || 0), 0);
  const draw = () => {
    const total = people.reduce((s, p) => s + sum(p), 0);
    M().innerHTML = `<div class="head"><h2>식수표</h2><div class="ctrls">${monthPick()}<button id="fill" class="noprint">평일 모두 채우기</button><button id="mkexp" class="noprint">지출결의서 만들기</button><button class="pri noprint" onclick="print()">인쇄</button></div></div>
    <div class="doc">
    <p class="note">${mLabel(MONTH)} · ${esc(S.meal?.place || '')} · 1식 ${won(price)}원. 칸을 누를 때마다 0 → 1 → 2식으로 바뀝니다. 인원과 단가는 <a href="#settings">설정</a>에서 바꿉니다.</p>
    ${people.length ? `<div class="scroll"><table class="meal"><thead><tr><th>날짜</th>${people.map(p => `<th>${esc(p)}</th>`).join('')}</tr></thead><tbody>
    ${days.map(d => { const w = new Date(d + 'T00:00').getDay(); return `<tr class="${w === 0 || w === 6 ? 'we' : ''}"><td>${md(d)} (${DOW[w]})</td>${people.map(p => { const n = map[d + '|' + p] || 0; return `<td><button data-d="${d}" data-p="${esc(p)}" class="${n ? 'on' : ''}" aria-label="${md(d)} ${esc(p)} ${n}식">${n || ''}</button></td>`; }).join('')}</tr>`; }).join('')}</tbody>
    <tfoot><tr><td>식수</td>${people.map(p => `<td class="num">${sum(p)}</td>`).join('')}</tr><tr><td>금액(원)</td>${people.map(p => `<td class="num">${won(sum(p) * price)}</td>`).join('')}</tr></tfoot></table></div>
    <div class="amount">합계 ${total}식 · ${won(total * price)}원</div>` : '<div class="empty">설정에서 식사 인원을 먼저 넣어 주세요.</div>'}</div>`;
    bindMonth();
    M().querySelectorAll('[data-d]').forEach(btn => btn.onclick = async () => {
      const k = btn.dataset.d + '|' + btn.dataset.p, n = ((map[k] || 0) + 1) % 3;
      if (n === 0) await q(sb.from('ow_meals').delete().eq('site_id', SITE).eq('date', btn.dataset.d).eq('person', btn.dataset.p));
      else await q(sb.from('ow_meals').upsert({ site_id: SITE, date: btn.dataset.d, person: btn.dataset.p, count: n }, { onConflict: 'site_id,date,person' }));
      map[k] = n; draw();
    });
    $('#fill') && ($('#fill').onclick = () => confirmBox(`${mLabel(MONTH)} 평일(월~금)에 모든 인원 1식씩 채웁니다. 이미 입력한 칸은 그대로 둡니다.`, '채우기', async () => {
      const ins = []; days.forEach(d => { const w = new Date(d + 'T00:00').getDay(); if (w > 0 && w < 6) people.forEach(p => { if (!map[d + '|' + p]) ins.push({ site_id: SITE, date: d, person: p, count: 1 }); }); });
      if (ins.length) await q(sb.from('ow_meals').upsert(ins, { onConflict: 'site_id,date,person', ignoreDuplicates: true }));
      ins.forEach(r => map[r.date + '|' + r.person] = 1); draw(); toast(ins.length + '칸을 채웠습니다. 휴일·결근은 칸을 눌러 지우세요.');
    }));
    $('#mkexp') && ($('#mkexp').onclick = () => { const total = people.reduce((s, p) => s + sum(p), 0); if (!total) return toast('식수가 없습니다.');
      confirmBox(`${mLabel(MONTH)} 식대 ${won(total * price)}원으로 지출결의서를 만듭니다.`, '만들기', async () => {
        const items = [{ desc: `${mLabel(MONTH)} 직원 식대`, qty: total, price, note: `식수표 합산 (${people.filter(p => sum(p)).map(p => `${p} ${sum(p)}식`).join(', ')})` }];
        const res = await q(sb.from('ow_expenses').insert({ site_id: SITE, date: today(), title: `${mLabel(MONTH)} 직원 식대`, dept: S.org?.name || '', author: myName(), vendor: S.meal?.place || '', pay_method: PAY[0], items, total: expTotal(items), note: `식수표 기준 (${mLabel(MONTH)}, 1식 ${won(price)}원)` }).select('id').single());
        toast('지출결의서를 만들었습니다.'); location.hash = '#exp/' + res.id;
      }); });
  };
  draw();
};

/* ================= 물품 구입 계획서 ================= */
const planDone = p => S.roles.every(r => (p.approvals || {})[r]);
let PKIND = '요청서';
const URG = ['보통', '긴급'];
routes.plans = async () => {
  const [a, b] = mRange(MONTH);
  const all = await q(sb.from('ow_plans').select('*').eq('site_id', SITE).gte('date', a).lt('date', b).order('date', { ascending: false }));
  const rows = all.filter(p => (p.kind || '계획서') === PKIND), isReq = PKIND === '요청서';
  M().innerHTML = `<div class="head"><h2>물품 구입 요청·계획</h2><div class="ctrls">${monthPick()}<a class="btn pri" href="#plan-edit/new">+ ${PKIND} 작성</a></div></div>
  <div class="ctrls" style="margin:4px 0 12px" role="group" aria-label="구분">${['요청서', '계획서'].map(k => `<button type="button" class="${k === PKIND ? 'pri' : 'ghost'}" data-pk="${k}">물품 구입 ${k} <small>${all.filter(p => (p.kind || '계획서') === k).length || ''}</small></button>`).join('')}</div>
  <div class="kpis"><div class="hot"><b class="num">${won(rows.reduce((s, p) => s + Number(p.total), 0))}</b><span>${mLabel(MONTH)} ${isReq ? '요청' : '계획'} 금액(원)</span></div><div><b class="num">${rows.length}</b><span>${PKIND}</span></div><div><b class="num">${rows.filter(p => !planDone(p)).length}</b><span>결재 대기</span></div><div><b class="num">${rows.filter(p => p.expense_id || p.plan_id).length}</b><span>${isReq ? '처리됨' : '결의서 작성됨'}</span></div></div>
  ${rows.length ? `<div class="scroll"><table class="stack"><thead><tr><th>작성일</th><th>제목</th>${isReq ? '<th>요청자</th>' : ''}<th>${isReq ? '필요일' : '희망 구입일'}</th><th class="r">예정 금액(원)</th><th>결재</th><th>${isReq ? '처리' : '결의서'}</th></tr></thead><tbody>${rows.map(p => `<tr><td>${esc(p.date)}</td><td><a href="#plan/${p.id}"><b>${esc(p.title)}</b></a>${p.urgency === '긴급' ? ' <span class="pill bad">긴급</span>' : ''}</td>${isReq ? `<td>${esc(p.author || '')}</td>` : ''}<td>${esc(p.needed_by || '')}</td><td class="r num">${won(p.total)}</td><td>${stampsHTML(p.approvals)}</td><td>${p.plan_id ? `<a href="#plan/${p.plan_id}">계획서</a>` : p.expense_id ? `<a href="#exp/${p.expense_id}">결의서</a>` : planDone(p) ? '<span class="pill acc">진행 가능</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${mLabel(MONTH)} 물품 구입 ${PKIND}가 없습니다.</div>`}
  <p class="note">${isReq ? '직원이 필요한 물품을 <b>요청서</b>로 올리고, 결재가 끝나면 <b>구입 계획서</b>나 <b>지출결의서(물품구입)</b>로 바로 이어서 만들 수 있습니다.' : '계획서 결재가 끝나면 <b>지출결의서(물품구입)</b>로 바로 옮길 수 있고, 그 결의서 결재가 끝나면 재고에 자동 입고됩니다.'}</p>`;
  M().querySelectorAll('[data-pk]').forEach(b => b.onclick = () => { PKIND = b.dataset.pk; route(); });
  bindMonth();
};
routes.plan = async id => {
  const p = await q(sb.from('ow_plans').select('*').eq('id', id).maybeSingle());
  if (!p) { M().innerHTML = '<div class="empty">계획서를 찾을 수 없습니다.</div>'; return; }
  const render = () => {
    const locked = Object.keys(p.approvals || {}).length > 0, done = planDone(p), isReq = p.kind === '요청서', K = isReq ? '요청서' : '계획서';
    M().innerHTML = `<div class="head noprint"><a class="btn ghost" href="#plans">← 목록</a><div class="ctrls">${locked && !isAdmin() ? '' : `<button class="ghost danger" id="del">삭제</button><a class="btn" href="#plan-edit/${p.id}">수정</a>`}${p.expense_id ? `<a class="btn" href="#exp/${p.expense_id}">결의서 보기</a>` : ''}${p.plan_id ? `<a class="btn" href="#plan/${p.plan_id}">계획서 보기</a>` : ''}${done && !p.expense_id && !p.plan_id ? (isReq ? '<button id="toPlan">구입 계획서로 만들기</button>' : '') + '<button id="toExp">지출결의서로 만들기</button>' : ''}<button class="pri" onclick="print()">인쇄</button></div></div>
    ${locked && !done && !isAdmin() ? '<p class="note noprint">결재가 진행 중이라 수정·삭제하려면 결재를 먼저 취소하세요.</p>' : ''}
    <div class="doc">
      <div class="doctop"><h2>물품 구입 ${K}${p.urgency === '긴급' ? ' <span class="pill bad">긴급</span>' : ''}</h2>${approveHTML(p.approvals)}</div>
      <div class="kv">${(isReq ? [['부서', p.dept || siteName(p.site_id)], ['요청자', p.author], ['요청일', p.date], ['필요일', p.needed_by], ['긴급도', p.urgency || '보통'], ['구입처(희망)', p.vendor]] : [['부서', p.dept || siteName(p.site_id)], ['작성자', p.author], ['작성일', p.date], ['희망 구입일', p.needed_by], ['구입처(예정)', p.vendor]]).map(([k, v]) => `<div><span>${k}</span>${esc(v || '')}</div>`).join('')}</div>
      <div class="amount">예정 금액 금 ${korMoney(p.total)}원정 <small>(₩${won(p.total)})</small></div>
      <p><b>제목</b> ${esc(p.title)}</p>
      ${p.purpose ? `<section class="sec"><h3>${isReq ? '사용 목적' : '구입 목적'}</h3><p class="pre">${esc(p.purpose)}</p></section>` : ''}
      <div class="scroll"><table class="stack"><thead><tr><th>분류</th><th>품명</th><th>규격</th><th class="r">수량</th><th class="r">단가</th><th class="r">금액</th><th>비고</th></tr></thead>
      <tbody>${(p.items || []).map(i => `<tr><td>${esc(i.cat || '')}</td><td>${esc(i.desc)}</td><td>${esc(i.spec || '')}</td><td class="r">${esc(i.qty)}${i.unit ? ' ' + esc(i.unit) : ''}</td><td class="r">${won(i.price)}</td><td class="r">${won((Number(i.qty) || 0) * (Number(i.price) || 0))}</td><td>${esc(i.note || '')}</td></tr>`).join('') || '<tr><td colspan="7">품목 없음</td></tr>'}</tbody>
      <tfoot><tr><td>합계</td><td></td><td></td><td></td><td></td><td class="r">${won(p.total)}</td><td></td></tr></tfoot></table></div>
      ${p.note ? `<section class="sec"><h3>비고</h3><p class="pre">${esc(p.note)}</p></section>` : ''}
      <p style="margin-top:18px">${isReq ? '위와 같이 물품 구입을 요청하오니 검토하여 주시기 바랍니다.' : '위와 같이 물품을 구입하고자 하오니 결재하여 주시기 바랍니다.'}</p>
    </div>`;
    bindApprove('ow_plans', p, render);
    const del = $('#del'); if (del) del.onclick = () => confirmBox(`'${p.title}' ${K}를 삭제할까요?`, '삭제', async () => { await q(sb.from('ow_plans').delete().eq('id', p.id)); toast('삭제했습니다.'); location.hash = '#plans'; });
    const tp = $('#toPlan'); if (tp) tp.onclick = () => confirmBox('이 요청서 내용으로 물품 구입 계획서를 만들까요? 만든 계획서는 다시 결재를 받습니다.', '만들기', async () => {
      const { data, error } = await sb.rpc('ow_request_to_plan', { req: p.id }); if (error) return toast(error.message);
      toast('물품 구입 계획서를 만들었습니다.'); PKIND = '계획서'; location.hash = '#plan/' + data; });
    const te = $('#toExp'); if (te) te.onclick = () => confirmBox(`이 ${K} 내용으로 물품구입 지출결의서를 만들까요? 만든 뒤 실제 구입 내역에 맞게 고칠 수 있습니다.`, '만들기', async () => {
      const { data, error } = await sb.rpc('ow_plan_to_expense', { plan: p.id }); if (error) return toast(error.message);
      toast('물품구입 지출결의서를 만들었습니다.'); location.hash = '#exp/' + data; });
  };
  render();
};
routes['plan-edit'] = async id => {
  let p = null;
  if (id && id !== 'new') { p = await q(sb.from('ow_plans').select('*').eq('id', id).maybeSingle()); if (!p) { M().innerHTML = '<div class="empty">계획서를 찾을 수 없습니다.</div>'; return; } }
  const K = p ? (p.kind || '계획서') : PKIND, isReq = K === '요청서';
  const d = p ? structuredClone(p) : { kind: K, urgency: '보통', date: today(), title: '', author: myName(), dept: S.org?.name || siteName(SITE), purpose: '', needed_by: '', vendor: '', items: [], note: '' };
  const blank = () => ({ cat: GOODS[0], desc: '', spec: '', unit: '개', qty: 1, price: '', note: '' });
  if (!d.items.length) d.items.push(blank());
  const F = isReq ? [{ k: 'title', label: '제목', req: 1, wide: 1 }, { k: 'date', label: '요청일', type: 'date', req: 1 }, { k: 'needed_by', label: '필요일', type: 'date' }, { k: 'dept', label: '부서' }, { k: 'author', label: '요청자', list: 'staffList', req: 1 }, { k: 'urgency', label: '긴급도', type: 'select', options: URG }, { k: 'vendor', label: '구입처(희망)' }, { k: 'purpose', label: '사용 목적', type: 'textarea', wide: 1 }]
    : [{ k: 'title', label: '제목', req: 1, wide: 1 }, { k: 'date', label: '작성일', type: 'date', req: 1 }, { k: 'needed_by', label: '희망 구입일', type: 'date' }, { k: 'dept', label: '부서' }, { k: 'author', label: '작성자', list: 'staffList', req: 1 }, { k: 'vendor', label: '구입처(예정)' }, { k: 'purpose', label: '구입 목적', type: 'textarea', wide: 1 }];
  M().innerHTML = `<div class="head"><h2>${p ? K + ' 수정' : '물품 구입 ' + K + ' 작성'}</h2><div class="ctrls"><a class="btn ghost" href="${p ? '#plan/' + p.id : '#plans'}">취소</a><button class="pri" id="save">저장</button></div></div>
  <div class="form" id="basic">${F.map(f => fieldHTML(f, d[f.k])).join('')}</div>
  <section class="sec"><h3>구입 품목 <span class="note" id="tot"></span></h3><div id="items"></div></section>
  <div class="form">${fieldHTML({ k: 'note', label: '비고', type: 'textarea', wide: 1 }, d.note)}</div>`;
  const tot = () => $('#tot').textContent = '예정 합계 ' + won(expTotal(d.items)) + '원';
  rowsEditor($('#items'), d.items, [['cat','분류','sel',GOODS],['desc','품명','text','wide'],['spec','규격'],['unit','단위'],['qty','수량','number'],['price','예상 단가(원)','number'],['note','비고']], blank, r => '금액 ' + won((Number(r.qty) || 0) * (Number(r.price) || 0)) + '원');
  $('#items').addEventListener('rowschange', tot); tot();
  $('#save').onclick = async () => {
    const v = readForm($('#basic'), F); v.note = $('#f_note').value.trim() || null;
    if (!v.title || !v.date || !v.author) return toast(isReq ? '제목, 요청일, 요청자를 입력하세요.' : '제목, 작성일, 작성자를 입력하세요.');
    const items = d.items.filter(i => i.desc).map(i => ({ ...i, qty: Number(i.qty) || 0, price: Number(i.price) || 0 }));
    if (!items.length) return toast('품목을 한 줄 이상 입력하세요.');
    const body = { ...v, kind: K, items, total: expTotal(items) };
    if (p) { await q(sb.from('ow_plans').update({ ...body, updated_at: new Date().toISOString() }).eq('id', p.id)); toast('저장했습니다.'); location.hash = '#plan/' + p.id; }
    else { const r = await q(sb.from('ow_plans').insert({ ...body, site_id: SITE }).select('id').single()); toast('저장했습니다. 결재자에게 알려 주세요.'); location.hash = '#plan/' + r.id; }
  };
};

/* ================= 휴가 신청서 (월차·연차·병가·휴가) ================= */
const LKINDS = ['월차', '연차', '병가', '휴가', '공가', '경조사', '기타'];
const LCOLOR = { 월차: 'acc', 연차: 'ok', 병가: 'bad', 휴가: 'ok' };
const leaveDays = (a, b, half) => { if (!a || !b) return 0; if (half) return 0.5; const d = (new Date(b) - new Date(a)) / 864e5 + 1; return d > 0 ? d : 0; };
const lPeriod = l => l.start_date === l.end_date ? `${l.start_date}${l.half ? ` (${l.half} 반차)` : ''}` : `${l.start_date} ~ ${l.end_date}`;
let LYEAR = today().slice(0, 4);
routes.leaves = async () => {
  const [a, b] = mRange(MONTH);
  const rows = await q(sb.from('ow_leaves').select('*').eq('site_id', SITE).lt('start_date', b).gte('end_date', a).order('start_date', { ascending: false }));
  const yr = await q(sb.from('ow_leaves').select('applicant,kind,days,approvals').eq('site_id', SITE).gte('start_date', LYEAR + '-01-01').lte('start_date', LYEAR + '-12-31'));
  const done = l => !!(l.approvals || {})[lastRole()];
  const people = {}; yr.forEach(l => { const p = people[l.applicant] ||= {}; p[l.kind] = (p[l.kind] || 0) + Number(l.days || 0); });
  const used = LKINDS.filter(k => yr.some(l => l.kind === k));
  M().innerHTML = `<div class="head"><h2>휴가 신청서</h2><div class="ctrls">${monthPick()}<a class="btn pri" href="#leave-edit/new">+ 신청서 작성</a></div></div>
  <div class="kpis"><div class="hot"><b class="num">${rows.length}</b><span>${mLabel(MONTH)} 신청</span></div><div><b class="num">${rows.reduce((s, l) => s + Number(l.days || 0), 0)}</b><span>신청 일수</span></div><div><b class="num">${rows.filter(l => !done(l)).length}</b><span>결재 대기</span></div></div>
  ${rows.length ? `<div class="scroll"><table class="stack"><thead><tr><th>기간</th><th>종류</th><th>신청자</th><th class="r">일수</th><th>사유</th><th>결재</th></tr></thead><tbody>${rows.map(l => `<tr><td><a href="#leave/${l.id}"><b>${esc(lPeriod(l))}</b></a></td><td><span class="pill ${LCOLOR[l.kind] || ''}">${esc(l.kind)}</span></td><td>${esc(l.applicant)}</td><td class="r num">${esc(Number(l.days))}</td><td>${esc(l.reason || '')}</td><td>${stampsHTML(l.approvals)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${mLabel(MONTH)} 휴가 신청이 없습니다.</div>`}
  <section class="sec"><h3>${esc(LYEAR)}년 사용 현황 <span class="note">신청 기준 일수</span> <select id="lyear" style="width:auto;min-height:32px;padding:2px 8px;margin-left:8px">${[0, 1, 2].map(i => String(+today().slice(0, 4) - i)).map(y => `<option${y === LYEAR ? ' selected' : ''}>${y}</option>`).join('')}</select></h3>
  ${Object.keys(people).length ? `<div class="scroll"><table class="stack"><thead><tr><th>이름</th>${used.map(k => `<th class="r">${k}</th>`).join('')}<th class="r">합계</th></tr></thead><tbody>${Object.entries(people).sort().map(([n, p]) => `<tr><td>${esc(n)}</td>${used.map(k => `<td class="r num">${p[k] || ''}</td>`).join('')}<td class="r num"><b>${Object.values(p).reduce((s, x) => s + x, 0)}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="note">기록이 없습니다.</p>'}</section>`;
  $('#lyear').onchange = e => { LYEAR = e.target.value; route(); };
  bindMonth();
};
routes.leave = async id => {
  const l = await q(sb.from('ow_leaves').select('*').eq('id', id).maybeSingle());
  if (!l) { M().innerHTML = '<div class="empty">신청서를 찾을 수 없습니다.</div>'; return; }
  const render = () => {
    const locked = Object.keys(l.approvals || {}).length > 0;
    M().innerHTML = `<div class="head noprint"><a class="btn ghost" href="#leaves">← 목록</a><div class="ctrls">${locked && !isAdmin() ? '<span class="note">결재가 시작돼 수정·삭제하려면 결재를 먼저 취소하세요.</span>' : `<button class="ghost danger" id="del">삭제</button><a class="btn" href="#leave-edit/${l.id}">수정</a>`}<button class="pri" onclick="print()">인쇄</button></div></div>
    <div class="doc">
      <div class="doctop"><h2>${esc(l.kind)} 신청서</h2>${approveHTML(l.approvals)}</div>
      <div class="kv">${[['소속', l.dept || siteName(l.site_id)], ['직위', l.position], ['성명', l.applicant], ['종류', l.kind], ['기간', lPeriod(l)], ['일수', Number(l.days) + '일'], ['업무 대행자', l.substitute], ['비상 연락처', l.contact], ['신청일', (l.created_at || '').slice(0, 10)]].map(([k, v]) => `<div><span>${k}</span>${esc(v || '')}</div>`).join('')}</div>
      <section class="sec"><h3>사유</h3><p class="pre">${esc(l.reason || '')}</p></section>
      ${l.note ? `<section class="sec"><h3>비고</h3><p class="pre">${esc(l.note)}</p></section>` : ''}
      <p style="margin-top:28px;text-align:center">위와 같이 ${esc(l.kind)}를 신청하오니 허락하여 주시기 바랍니다.</p>
      <p style="margin-top:18px;text-align:center">${esc((l.created_at || today()).slice(0, 10).replace(/-/g, '. '))}.</p>
      <p style="margin-top:10px;text-align:right">신청인 &nbsp; <b>${esc(l.applicant)}</b> &nbsp; (인)</p>
    </div>`;
    bindApprove('ow_leaves', l, render);
    const del = $('#del'); if (del) del.onclick = () => confirmBox(`${l.applicant}님의 ${l.kind} 신청서를 삭제할까요?`, '삭제', async () => { await q(sb.from('ow_leaves').delete().eq('id', l.id)); toast('삭제했습니다.'); location.hash = '#leaves'; });
  };
  render();
};
routes['leave-edit'] = async id => {
  let l = null;
  if (id && id !== 'new') { l = await q(sb.from('ow_leaves').select('*').eq('id', id).maybeSingle()); if (!l) { M().innerHTML = '<div class="empty">신청서를 찾을 수 없습니다.</div>'; return; } }
  const d = l || { kind: '연차', applicant: myName(), dept: S.org?.name || siteName(SITE), position: '', start_date: today(), end_date: today(), half: null, days: 1, reason: '', contact: '', substitute: '', note: '' };
  const F = [{ k: 'kind', label: '종류', type: 'select', options: LKINDS, req: 1 }, { k: 'applicant', label: '성명', list: 'staffList', req: 1 }, { k: 'dept', label: '소속' }, { k: 'position', label: '직위' },
    { k: 'start_date', label: '시작일', type: 'date', req: 1 }, { k: 'end_date', label: '종료일', type: 'date', req: 1 }, { k: 'half', label: '반차', type: 'select', options: ['없음', '오전', '오후'] }, { k: 'days', label: '일수', type: 'number', req: 1 },
    { k: 'substitute', label: '업무 대행자', list: 'staffList' }, { k: 'contact', label: '비상 연락처', type: 'tel' }, { k: 'reason', label: '사유', type: 'textarea', wide: 1, req: 1 }, { k: 'note', label: '비고', type: 'textarea', wide: 1 }];
  M().innerHTML = `<div class="head"><h2>${l ? '신청서 수정' : '휴가 신청서 작성'}</h2><div class="ctrls"><a class="btn ghost" href="${l ? '#leave/' + l.id : '#leaves'}">취소</a><button class="pri" id="save">저장</button></div></div>
  <div class="form" id="basic">${F.map(f => fieldHTML(f, f.k === 'half' ? (d.half || '없음') : d[f.k])).join('')}</div>
  <p class="note">월차·연차·병가·휴가 모두 같은 양식입니다. 일수는 기간을 고르면 자동으로 계산되고, 직접 고칠 수도 있습니다.</p>`;
  const recalc = () => { const s = $('#f_start_date').value, e = $('#f_end_date').value, h = $('#f_half').value; if (e < s) $('#f_end_date').value = s; if (h !== '없음') $('#f_end_date').value = s; $('#f_days').value = leaveDays(s, $('#f_end_date').value, h !== '없음'); };
  ['start_date', 'end_date', 'half'].forEach(k => $('#f_' + k).onchange = recalc);
  $('#save').onclick = async () => {
    const v = readForm($('#basic'), F);
    if (!v.applicant || !v.start_date || !v.end_date || !v.reason) return toast('성명, 기간, 사유를 입력하세요.');
    if (v.end_date < v.start_date) return toast('종료일이 시작일보다 빠릅니다.');
    if (!(v.days > 0)) return toast('일수를 확인하세요.');
    v.half = v.half === '없음' ? null : v.half; if (v.half) v.end_date = v.start_date;
    if (l) { await q(sb.from('ow_leaves').update({ ...v, updated_at: new Date().toISOString() }).eq('id', l.id)); toast('저장했습니다.'); location.hash = '#leave/' + l.id; }
    else { const r = await q(sb.from('ow_leaves').insert({ ...v, site_id: SITE }).select('id').single()); toast('신청했습니다. 결재자에게 알려 주세요.'); location.hash = '#leave/' + r.id; }
  };
};

/* ================= 건물 관리 서류 (자격증·법정 교육·법정 점검·안전진단·소방 계획) ================= */
const DOCS_BUCKET = 'ow-docs';
const DCATS = ['자격증', '법정 교육', '법정 점검', '안전진단', '소방 계획', '석면 관리', '공사·보수', '인허가·보험', '계약·용역', '기타'];
const DTEMPLATE = [
  ['자격증', '소방안전관리자', '선임 후 2년마다 실무교육'], ['자격증', '전기안전관리자', '선임 유지'], ['자격증', '위험물안전관리자', '선임 유지'], ['자격증', '보일러(에너지관리) 자격', ''],
  ['법정 교육', '소방안전관리자 실무교육', '2년'], ['법정 교육', '전기안전관리자 직무교육', '3년'], ['법정 교육', '산업안전보건교육 (근로자)', '분기·연간'], ['법정 교육', '직장 내 성희롱 예방교육', '1년'], ['법정 교육', '개인정보보호 교육', '1년'], ['법정 교육', '장애인 인식개선 교육', '1년'], ['법정 교육', '퇴직연금 교육', '1년'],
  ['법정 점검', '소방시설 작동점검', '1년'], ['법정 점검', '소방시설 종합점검', '1년 (대상 건물)'], ['법정 점검', '전기설비 정기검사·점검', '3년 / 월차 점검'], ['법정 점검', '승강기 정기검사', '1년'], ['법정 점검', '가스시설 정기검사', '1년'], ['법정 점검', '저수조 청소·수질검사', '반기 / 1년'], ['법정 점검', '정화조 청소·방류수 검사', '1년'], ['법정 점검', '보일러 계속사용검사', '1년'],
  ['안전진단', '건축물 정기 안전점검', '반기'], ['안전진단', '정밀안전점검·진단', '대상 시설별'],
  ['소방 계획', '소방안전관리자 업무 수행 기록표', '월 1회 이상', 'fire_log'], ['법정 점검', '위험물 저장소 일반점검 (지하탱크)', '연 1회 이상', 'tank_check'],
  ['소방 계획', '소방계획서', '1년 (변경 시 수정)', 'fire_plan'], ['소방 계획', '자위소방대 편성표', '변경 시'], ['소방 계획', '소방훈련·교육 실시 기록', '연 1회 이상'],
  ['석면 관리', '건축물 석면조사 결과서', '보관 (재조사·공사 시 갱신)'], ['석면 관리', '건축물 석면지도', '변경 시 수정·비치'], ['석면 관리', '석면건축물안전관리인 지정·신고', '변경 시 10일 이내 변경신고'],
  ['석면 관리', '석면건축물안전관리인 교육', '신고 후 1년 이내 이수'], ['석면 관리', '석면건축물 손상상태 조사', '6개월마다', 'asb_check'], ['석면 관리', '실내공기 중 석면농도 측정', '2년마다 (측정기관)'], ['석면 관리', '석면 해체·제거 작업 기록', '작업 시'],
  ['공사·보수', '공사·보수 계획서', '공사 전마다', 'work_plan'], ['공사·보수', '공사 완료 보고서', '공사 끝날 때마다', 'work_done'],
  ['인허가·보험', '건축물대장', ''], ['인허가·보험', '화재보험(다중이용시설 등)', '1년'], ['인허가·보험', '영업·시설 신고증', '']
];
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return ymd(x); };
const dday = d => d ? Math.round((new Date(d) - new Date(today())) / 864e5) : null;
const ddayPill = d => { const n = dday(d); if (n === null) return ''; return n < 0 ? `<span class="pill bad">${-n}일 지남</span>` : n <= 30 ? `<span class="pill bad">D-${n}</span>` : n <= 60 ? `<span class="pill acc">D-${n}</span>` : `<span class="pill ok">D-${n}</span>`; };
const docUrl = async path => { const { data, error } = await sb.storage.from(DOCS_BUCKET).createSignedUrl(path, 600); if (error) throw error; return data.signedUrl; };
let DCAT = '전체';
routes.docs = async () => {
  const all = await q(sb.from('ow_docs').select('*').eq('site_id', SITE).order('category').order('expires', { ascending: true, nullsFirst: false }));
  const rows = DCAT === '전체' ? all : all.filter(d => d.category === DCAT);
  const over = all.filter(d => d.expires && dday(d.expires) < 0).length, d30 = all.filter(d => d.expires && dday(d.expires) >= 0 && dday(d.expires) <= 30).length, d60 = all.filter(d => d.expires && dday(d.expires) > 30 && dday(d.expires) <= 60).length;
  M().innerHTML = `<div class="head"><h2>건물 관리 서류</h2><div class="ctrls">${all.length ? (DTEMPLATE.some(t => (DCAT === '전체' || t[0] === DCAT) && !all.some(d => d.title === t[1])) ? `<button id="tpl2" class="ghost">${DCAT === '전체' ? '빠진 기본 항목 넣기' : esc(DCAT) + ' 기본 항목 넣기'}</button>` : '') : '<button id="tpl">기본 항목 불러오기</button>'}<a class="btn pri" href="#doc-edit/new">+ 서류 등록</a></div></div>
  <div class="kpis"><div class="hot"><b class="num">${all.length}</b><span>등록 서류</span></div><div class="${over ? 'bad' : ''}"><b class="num">${over}</b><span>기한 지남</span></div><div class="${d30 ? 'bad' : ''}"><b class="num">${d30}</b><span>30일 안에 만료</span></div><div><b class="num">${d60}</b><span>60일 안에 만료</span></div></div>
  <div class="ctrls" style="margin:4px 0 12px;flex-wrap:wrap" role="group" aria-label="분류">${['전체', ...DCATS].map(k => `<button type="button" class="${k === DCAT ? 'pri' : 'ghost'}" data-dc="${k}">${k}${k !== '전체' ? ` <small>${all.filter(d => d.category === k).length || ''}</small>` : ''}</button>`).join('')}</div>
  ${rows.length ? `<div class="scroll"><table class="stack"><thead><tr><th>분류</th><th>서류명</th><th>대상·담당</th><th>기관</th><th>취득·시행일</th><th>만료·다음 예정일</th><th>상태</th><th>첨부</th></tr></thead><tbody>${rows.map(d => `<tr><td>${esc(d.category)}</td><td><a href="#doc/${d.id}"><b>${esc(d.title)}</b></a>${d.cycle ? `<br><small class="note">주기 ${esc(d.cycle)}</small>` : ''}</td><td>${esc(d.holder || '')}</td><td>${esc(d.org || '')}</td><td>${esc(d.issued || '')}</td><td>${esc(d.expires || '')}</td><td>${d.expires ? ddayPill(d.expires) : '<span class="pill">기한 없음</span>'}</td><td>${(d.files || []).length ? `📎 ${d.files.length}` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${DCAT === '전체' ? '등록된 서류가 없습니다. <b>기본 항목 불러오기</b>로 자주 쓰는 법정 서류 목록을 한 번에 넣을 수 있습니다.' : DCAT + ' 서류가 없습니다.'}</div>`}`;
  M().querySelectorAll('[data-dc]').forEach(b => b.onclick = () => { DCAT = b.dataset.dc; route(); });
  const t2 = $('#tpl2'); if (t2) t2.onclick = () => { const miss = DTEMPLATE.filter(t => (DCAT === '전체' || t[0] === DCAT) && !all.some(d => d.title === t[1])); confirmBox(`아직 없는 기본 항목 ${miss.length}개를 넣을까요? (${miss.map(t => t[1]).join(', ')})`, '넣기', async () => {
    await q(sb.from('ow_docs').insert(miss.map(([category, title, cycle, form]) => ({ site_id: SITE, category, title, cycle: cycle || null, form: form || null })))); toast(miss.length + '개 항목을 넣었습니다.'); route(); }); };
  const t = $('#tpl'); if (t) t.onclick = () => confirmBox(`자격증·법정 교육·법정 점검·소방 계획·석면 관리 등 ${DTEMPLATE.length}개 기본 항목을 넣을까요? 날짜와 첨부는 비어 있으니 하나씩 채우면 됩니다. 필요 없는 항목은 관리자가 지울 수 있습니다.`, '넣기', async () => {
    await q(sb.from('ow_docs').insert(DTEMPLATE.map(([category, title, cycle, form]) => ({ site_id: SITE, category, title, cycle: cycle || null, form: form || null })))); toast('기본 항목을 넣었습니다.'); route(); });
};
routes.doc = async id => {
  const d = await q(sb.from('ow_docs').select('*').eq('id', id).maybeSingle());
  if (!d) { M().innerHTML = '<div class="empty">서류를 찾을 수 없습니다.</div>'; return; }
  M().innerHTML = `<div class="head"><a class="btn ghost" href="#docs">← 목록</a><div class="ctrls">${isAdmin() ? '<button class="ghost danger" id="del">삭제</button>' : ''}<a class="btn pri" href="#doc-edit/${d.id}">수정·갱신</a></div></div>
  <div class="doc"><div class="doctop"><h2>${esc(d.title)}</h2>${d.expires ? ddayPill(d.expires) : ''}</div>
  <div class="kv">${[['분류', d.category], ['대상·담당', d.holder], ['발급·시행 기관', d.org], ['취득·시행일', d.issued], ['만료·다음 예정일', d.expires], ['주기', d.cycle], ['최근 수정', lt(d.updated_at)]].map(([k, v]) => `<div><span>${k}</span>${esc(v || '')}</div>`).join('')}</div>
  ${d.note ? `<section class="sec"><h3>메모</h3><p class="pre">${esc(d.note)}</p></section>` : ''}
  ${FORMS[d.form] ? `<section class="sec"><h3>${esc(FORMS[d.form].name)} 기록 <a class="btn pri" href="#docrec-edit/new-${d.id}" style="margin-left:8px">${FORMS[d.form].kind === 'plan' ? '+ 소방계획서 작성' : FORMS[d.form].addLabel || '+ 기록 작성'}</a></h3><div id="recs"><p class="note">불러오는 중…</p></div></section>` : ''}
  <section class="sec"><h3>첨부 서류</h3>${(d.files || []).length ? `<ul class="list">${d.files.map((f, i) => `<li><span>${/^image\//.test(f.type || '') ? '🖼️' : '📄'} ${esc(f.name)}</span><button class="ghost" data-open="${i}">열기</button></li>`).join('')}</ul>` : '<p class="note">첨부된 파일이 없습니다. <b>수정·갱신</b>에서 PDF·사진·한글·엑셀 파일을 올릴 수 있습니다.</p>'}</section></div>`;
  if (FORMS[d.form]) { const fm = FORMS[d.form]; const recs = await q(sb.from('ow_doc_records').select('id,date,performer,results,header,approvals').eq('doc_id', d.id).order('date', { ascending: false }).limit(60));
    $('#recs').innerHTML = recs.length ? `<div class="scroll"><table class="stack"><thead><tr><th>${fm.dateLabel}</th><th>${fm.performer}</th><th>${fm.kind === 'plan' ? '연도' : '결과'}</th></tr></thead><tbody>${recs.map(x => { const bad = Object.values(x.results || {}).filter(v => v?.r && !GOOD.includes(v.r)).length; return `<tr><td><a href="#docrec/${x.id}"><b>${esc(x.date)}</b>${x.header?.title ? ' · ' + esc(x.header.title) : ''}</a>${fm.approve ? (S.roles.every(k => (x.approvals || {})[k]) ? ' <span class="pill ok">결재 완료</span>' : ' <span class="pill acc">결재 중</span>') : ''}</td><td>${esc(x.performer || '')}</td><td>${fm.kind === 'plan' ? `<span class="pill acc">${esc(x.date.slice(0, 4))}년도</span>` : bad ? `<span class="pill bad">확인 필요 ${bad}건</span>` : `<span class="pill ok">모두 ${esc(fm.results[0])}</span>`}</td></tr>`; }).join('')}</tbody></table></div>` : `<p class="note">아직 기록이 없습니다. ${esc(fm.cycle)} 작성하세요.</p>`; }
  M().querySelectorAll('[data-open]').forEach(b => b.onclick = async () => { const w = window.open('', '_blank'); try { const u = await docUrl(d.files[+b.dataset.open].path); if (w) w.location = u; else location.href = u; } catch (e) { w && w.close(); toast('파일을 열지 못했습니다: ' + e.message); } });
  const del = $('#del'); if (del) del.onclick = () => confirmBox(`'${d.title}' 서류를 삭제할까요? 첨부 파일도 함께 지워집니다.`, '삭제', async () => {
    if ((d.files || []).length) await sb.storage.from(DOCS_BUCKET).remove(d.files.map(f => f.path));
    await q(sb.from('ow_docs').delete().eq('id', d.id)); toast('삭제했습니다.'); location.hash = '#docs'; });
};
routes['doc-edit'] = async id => {
  let d0 = null;
  if (id && id !== 'new') { d0 = await q(sb.from('ow_docs').select('*').eq('id', id).maybeSingle()); if (!d0) { M().innerHTML = '<div class="empty">서류를 찾을 수 없습니다.</div>'; return; } }
  const d = d0 ? structuredClone(d0) : { category: DCAT !== '전체' ? DCAT : DCATS[0], title: '', holder: '', org: '', issued: '', expires: '', cycle: '', files: [], note: '' };
  d.files = d.files || [];
  const removed = [];
  const F = [{ k: 'category', label: '분류', type: 'select', options: DCATS, req: 1 }, { k: 'title', label: '서류명', req: 1, wide: 1 }, { k: 'holder', label: '대상·담당 (자격증 소지자, 교육 이수자 등)', list: 'staffList' }, { k: 'org', label: '발급·시행 기관' },
    { k: 'issued', label: '취득·시행일', type: 'date' }, { k: 'expires', label: '만료·다음 예정일', type: 'date' }, { k: 'cycle', label: '주기 (예: 1년, 2년, 반기)' }, { k: 'form', label: '기록 양식 (해당 시)', type: 'select', options: ['없음', ...Object.values(FORMS).map(f => f.name)] }, { k: 'note', label: '메모', type: 'textarea', wide: 1 }];
  d.form = FORMS[d.form]?.name || '없음';
  M().innerHTML = `<div class="head"><h2>${d0 ? '서류 수정·갱신' : '서류 등록'}</h2><div class="ctrls"><a class="btn ghost" href="${d0 ? '#doc/' + d0.id : '#docs'}">취소</a><button class="pri" id="save">저장</button></div></div>
  <div class="form" id="basic">${F.map(f => fieldHTML(f, d[f.k])).join('')}</div>
  <section class="sec"><h3>첨부 서류 <span class="note">PDF·사진·한글·엑셀·워드, 파일당 20MB까지 · 해당 수양관 로그인 사용자만 열람</span></h3><div id="files"></div>
  <label class="drop" style="margin-top:10px"><b>파일 올리기</b><span>자격증 사본, 교육 이수증, 점검 결과서, 소방계획서 등</span><input id="fin" type="file" accept=".pdf,.hwp,.hwpx,.xlsx,.docx,image/*" multiple hidden></label></section>
  <p class="note">갱신할 때는 새 취득·시행일과 만료일로 바꾸고 새 서류를 올리세요. 예전 파일은 남겨 두거나 빼기로 지울 수 있습니다.</p>`;
  const drawFiles = () => $('#files').innerHTML = d.files.length ? `<ul class="list">${d.files.map((f, i) => `<li><span>${/^image\//.test(f.type || '') ? '🖼️' : '📄'} ${esc(f.name)}</span><button type="button" class="ghost" data-rm="${i}">빼기</button></li>`).join('')}</ul>` : '<p class="note">첨부된 파일이 없습니다.</p>';
  drawFiles();
  $('#files').onclick = e => { const b = e.target.closest('[data-rm]'); if (!b) return; removed.push(...d.files.splice(+b.dataset.rm, 1)); drawFiles(); };
  $('#fin').onchange = async e => {
    for (const f of e.target.files) {
      if (f.size > 20 * 1024 * 1024) { toast(f.name + ': 20MB가 넘습니다.'); continue; }
      const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${SITE}/${uid()}.${ext}`;
      toast(f.name + ' 올리는 중…');
      const { error } = await sb.storage.from(DOCS_BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
      if (error) { toast(f.name + ' 올리지 못했습니다: ' + error.message); continue; }
      d.files.push({ path, name: f.name, type: f.type || '', at: new Date().toISOString() }); drawFiles();
    }
    e.target.value = ''; toast('파일을 올렸습니다. 저장을 눌러 주세요.');
  };
  $('#save').onclick = async () => {
    const v = readForm($('#basic'), F); if (!v.title) return toast('서류명을 입력하세요.');
    v.form = Object.keys(FORMS).find(k => FORMS[k].name === v.form) || null;
    const body = { ...v, files: d.files, updated_at: new Date().toISOString() };
    let target;
    if (d0) { await q(sb.from('ow_docs').update(body).eq('id', d0.id)); target = d0.id; }
    else { target = (await q(sb.from('ow_docs').insert({ ...body, site_id: SITE }).select('id').single())).id; }
    if (removed.length && isAdmin()) await sb.storage.from(DOCS_BUCKET).remove(removed.map(f => f.path));
    toast('저장했습니다.'); location.hash = '#doc/' + target;
  };
};

/* ---------- 서식 기록 (소방안전관리자 업무 수행 기록표 · 위험물 지하탱크저장소 일반점검표) ---------- */
const TANK_ITEMS = [
  ['탱크본체', '누설의 유무', '육안'],
  ['상부', '뚜껑의 균열·변형·손상·부등침하의 유무', '육안 및 실측'], ['상부', '허가외 구조물 설치여부', '육안'],
  ['맨홀', '변형·손상·토사 등의 퇴적의 유무', '육안'],
  ['통기관', '인화방지망의 손상·막힘의 유무', '육안'], ['통기관', '밸브의 작동상황', '작동확인'], ['통기관', '관내의 장애물의 유무', '육안'], ['통기관', '도장상황 및 부식의 유무', '육안'],
  ['안전장치', '부식·손상의 유무', '육안'], ['안전장치', '작동상황', '육안 및 작동확인'],
  ['가연성증기회수장치', '손상의 유무', '육안'], ['가연성증기회수장치', '작동상황', '육안 및 작동확인'],
  ['계측장치 · 액량자동표시장치', '손상의 유무', '육안'], ['계측장치 · 액량자동표시장치', '작동상황', '육안 및 작동확인'], ['계측장치 · 액량자동표시장치', '부착부의 손상의 유무', '육안'],
  ['계측장치 · 온도계', '손상의 유무', '육안'], ['계측장치 · 온도계', '작동상황', '육안 및 작동확인'], ['계측장치 · 온도계', '부착부의 손상의 유무', '육안'],
  ['계측장치 · 계량구', '덮개의 폐쇄상황', '육안'], ['계측장치 · 계량구', '변형·손상의 유무', '육안'],
  ['누설검지관', '변형·손상·토사 등의 퇴적의 유무', '육안'],
  ['누설검지장치 (이중벽탱크)', '손상의 유무', '육안'], ['누설검지장치 (이중벽탱크)', '경보장치의 기능의 적부', '작동확인'],
  ['주입구', '폐쇄시의 누설의 유무', '육안'], ['주입구', '변형·손상의 유무', '육안'], ['주입구', '접지전극손상의 유무', '육안'], ['주입구', '접지저항치의 적부', '접지저항측정'],
  ['주입구의 비트', '균열·손상의 유무', '육안'], ['주입구의 비트', '체유·체수·토사 등의 퇴적의 유무', '육안'],
  ['배관 (플랜지·밸브 포함)', '누설의 유무', '육안'], ['배관 (플랜지·밸브 포함)', '변형·손상의 유무', '육안'], ['배관 (플랜지·밸브 포함)', '도장상황 및 부식의 유무', '육안'], ['배관 (플랜지·밸브 포함)', '지반면과 이격상태', '육안'],
  ['배관의 비트', '균열·손상의 유무', '육안'], ['배관의 비트', '체유·체수·토사 등의 퇴적의 유무', '육안'],
  ['전기방식 설비', '단자함의 손상·토사 등의 퇴적의 유무', '육안'], ['전기방식 설비', '단자의 탈락의 유무', '육안'], ['전기방식 설비', '방식전류(전위)의 적부', '전위측정'],
  ['점검함', '균열·손상·체유·체수·토사 등의 퇴적의 유무', '육안'],
  ['밸브', '누설·손상의 유무', '육안'], ['밸브', '폐쇄기능의 적부', '작동확인'],
  ['펌프설비 · 전동기', '손상의 유무', '육안'], ['펌프설비 · 전동기', '고정상태의 적부', '육안'], ['펌프설비 · 전동기', '회전부 등의 급유상태', '육안'], ['펌프설비 · 전동기', '이상진동·소음·발열 등의 유무', '작동확인'],
  ['펌프설비 · 펌프', '누설의 유무', '육안'], ['펌프설비 · 펌프', '변형·손상의 유무', '육안'], ['펌프설비 · 펌프', '도장상태 및 부식의 유무', '육안'], ['펌프설비 · 펌프', '고정상태의 적부', '육안'], ['펌프설비 · 펌프', '회전부 등의 급유상태', '육안'], ['펌프설비 · 펌프', '유량 및 유압의 적부', '육안'], ['펌프설비 · 펌프', '이상진동·소음·발열 등의 유무', '작동확인'], ['펌프설비 · 펌프', '기초의 균열·손상의 유무', '육안'],
  ['펌프설비 · 접지', '단선의 유무', '육안'], ['펌프설비 · 접지', '부착부분의 탈락의 유무', '육안'], ['펌프설비 · 접지', '접지저항치의 적부', '저항측정'],
  ['펌프설비 · 주위·바닥·집유설비·유분리장치', '균열·손상 등의 유무', '육안'], ['펌프설비 · 주위·바닥·집유설비·유분리장치', '체유·체수·토사 등의 퇴적의 유무', '육안'],
  ['펌프설비 · 펌프실', '지붕·벽·바닥·방화문 등의 균열·손상의 유무', '육안'], ['펌프설비 · 펌프실', '환기·배출설비 등의 손상의 유무 및 기능의 적부', '육안 및 작동확인'], ['펌프설비 · 펌프실', '조명설비의 손상의 유무', '육안'],
  ['전기설비 · 배전반·차단기·배선 등', '변형·손상의 유무', '육안'], ['전기설비 · 배전반·차단기·배선 등', '고정상태의 적부', '육안'], ['전기설비 · 배전반·차단기·배선 등', '기능의 적부', '육안 및 작동확인'], ['전기설비 · 배전반·차단기·배선 등', '배선접합부의 탈락의 유무', '육안'],
  ['전기설비 · 접지', '단선의 유무', '육안'], ['전기설비 · 접지', '부착부분의 탈락의 유무', '육안'], ['전기설비 · 접지', '접지저항치의 적부', '저항측정'],
  ['표지·게시판', '손상의 유무', '육안'], ['표지·게시판', '기재사항의 적부', '육안'],
  ['소화기', '위치·설치수·압력의 적부', '육안'],
  ['경보설비', '손상의 유무', '육안'], ['경보설비', '기능의 적부', '작동확인']
];
const FORMS = {
  fire_log: {
    name: '소방안전관리자 업무 수행 기록표', law: '화재의 예방 및 안전관리에 관한 법률 시행규칙 [별지 제12호서식]', months: 1, cycle: '월 1회 이상',
    performer: '수행자', dateLabel: '수행일자', results: ['양호', '불량'],
    header: [['name', '상호'], ['grade', '등급 (특급·1급·2급·3급)'], ['addr', '소재지', 'wide'], ['basement', '지하층'], ['floors', '지상층'], ['area', '연면적(㎡)'], ['floorArea', '바닥면적(㎡)'], ['bldgs', '동수']],
    items: [['소방시설', '소화기·옥내소화전설비·소화용수설비·비상조명등·유도등(피난구 유도등, 통로 유도등)'], ['피난방화시설', '방화문·피난계단·피난통로·복도, 출구 통로'], ['화기취급감독', '방화문 자동폐쇄 정상 작동·비상구 잠금·폐쇄 금지·유도등 점등 여부·피난방화시설 점검 체크리스트'], ['기타사항', '소방시설 점검결과 보고서로 갈음']],
    report: [['at', '보고일시'], ['how', '보고방법 (대면·서면·정보통신)'], ['to', '보고받은 사람'], ['fix', '조치방법 (이전·제거·수리·교체·기타)']],
    guide: '소방안전관리자는 업무를 수행한 날을 포함하여 월 1회 이상 작성합니다. 경보설비 수신기, 소화설비 제어반, 가압송수장치(펌프 등)를 중점적으로 확인하세요.'
  },
  tank_check: {
    name: '지하탱크저장소 일반점검표', law: '위험물안전관리에 관한 세부기준 [별지 제12호서식]', months: 12, cycle: '연 1회 이상',
    performer: '점검자', dateLabel: '점검연월일', results: ['양호', '불량', '보완중', '해당없음'],
    header: [['type', '탱크 형태 (이중벽·전용실 여부)'], ['permit', '설치허가 연월일 및 허가번호', 'wide'], ['installer', '설치자'], ['manager', '안전관리자'], ['name', '사업소명'], ['addr', '설치위치', 'wide'], ['product', '위험물 품명'], ['amount', '허가량'], ['ratio', '지정수량의 배수'], ['facility', '시설명/호칭번호']],
    items: TANK_ITEMS.map(([g, c, m]) => [g, c, m]),
    guide: '지정수량 이상의 위험물은 저장소가 아닌 장소에서 저장·취급할 수 없으며, 저장·취급은 기준 법령에 따릅니다.'
  },
  asb_check: {
    name: '석면건축물 손상상태 조사표', law: '석면안전관리법 제22조, 시행령 제33조, 시행규칙 제26조 (석면건축물 관리기준)', months: 6, cycle: '6개월마다 (6개월이 되는 달 말일까지)',
    performer: '석면건축물안전관리인', dateLabel: '조사일', results: ['양호', '손상', '비산 우려', '조치완료', '해당없음'],
    header: [['name', '건축물명'], ['addr', '소재지', 'wide'], ['area', '석면건축자재 면적 합계(㎡)'], ['kind', '석면 종류 (백석면 등)'], ['map', '석면지도 작성일'], ['org', '석면조사기관']],
    items: [
      ['천장재', '파손·균열·처짐·탈락 여부'], ['천장재', '누수·습기·얼룩으로 인한 변형'],
      ['벽체·칸막이', '깨짐·구멍·긁힘, 못·나사 박힘'], ['바닥재', '들뜸·깨짐·마모'],
      ['지붕재 (슬레이트)', '파손·부식·이끼, 빗물 흐름'], ['배관·보온재', '보온재·개스킷·패킹 손상, 노출 부분'],
      ['분무재·내화피복재', '부스러짐·박리 여부'], ['비산 가능성', '진동(기계실·문 여닫힘), 기류(공조·환기), 사람 접촉 빈도'],
      ['표시·관리', '석면 함유 표시, 석면지도 비치, 이용자 안내'], ['공사·보수', '석면 자재 건드리는 공사 여부, 해체·제거 신고']
    ],
    reportTitle: '조치 및 관리대장 기록', itemsTitle: '조사 항목', addLabel: '+ 조사표 작성', report: [['fix', '조치 내용 (보수·밀봉·구역 폐쇄 등)'], ['fixdate', '조치일'], ['ledger', '석면건축물 관리대장(정보망) 기록일']],
    guide: '석면건축물 소유자는 6개월마다 손상 상태와 비산 가능성을 조사하고, 위해성에 따라 보수·밀봉·구역 폐쇄 등 필요한 조치를 한 뒤 석면건축물 관리대장(석면관리 정보망)에 지체 없이 기록해야 합니다. 손상 부위는 직접 만지거나 제거하지 말고 사진을 첨부하세요.'
  },
  work_plan: {
    name: '공사·보수 계획서', law: '수양관 시설 공사·보수 사전 계획', months: 0, cycle: '공사 전마다', approve: 1,
    performer: '작성자 (공사 담당)', dateLabel: '작성일', results: ['완료', '미완료', '해당없음'],
    header: [['title', '공사명', 'wide'], ['kind', '구분 (공사·보수·교체·수리)'], ['place', '위치'], ['why', '필요성·목적', 'wide'],
      ['start', '예정 시작일'], ['end', '예정 완료일'], ['budget', '예상 금액 (원)'], ['account', '예산 항목'], ['how', '시공 방법 (직영·업체)'], ['vendor', '업체 (후보)']],
    items: [
      ['현장', '현장 조사, 공사 전 사진 촬영'], ['견적', '견적 2곳 이상 비교'], ['예산', '예산 확보 확인'],
      ['일정', '수련회·행사 일정 피해서 일정 잡기'], ['공지', '사용 중지 구역·기간 안내'], ['안전', '작업 안전대책 (고소·화기·전기 작업 등)'],
      ['소방', '소방시설 차단·영향 여부 확인'], ['석면', '석면 자재 포함 여부 확인 (해체·제거 신고 필요 여부)'],
      ['인허가', '인허가·신고 필요 여부 확인'], ['폐기물', '폐기물 처리 계획']
    ],
    reportTitle: '공사 범위와 세부 내용', report: [['scope', '공사 범위·물량'], ['material', '주요 자재'], ['risk', '예상 문제와 대책']],
    noteLabel: '세부 계획 및 특이사항', toDone: 1, itemsTitle: '사전 확인 항목', addLabel: '+ 공사·보수 계획서 작성',
    guide: '결재가 끝나면 공사를 진행하고, 공사가 끝나면 이 계획서 화면의 "공사 완료 보고서 만들기"로 완료 보고서를 작성하세요. 견적서·현장 사진은 원본 첨부에 올려 두세요.'
  },
  work_done: {
    name: '공사 완료 보고서', law: '수양관 시설 공사 준공 확인', months: 0, cycle: '공사 끝날 때마다', approve: 1,
    performer: '보고자 (공사 감독)', dateLabel: '보고일', results: ['적합', '부적합', '보완중', '해당없음'],
    header: [['title', '공사명', 'wide'], ['place', '공사 위치'], ['vendor', '시공업체'], ['contact', '업체 대표·연락처'], ['start', '착공일'], ['end', '준공(완료)일'],
      ['contract', '계약금액 (원)'], ['final', '최종 정산금액 (원)'], ['warranty', '하자보수 기간'], ['warrantyEnd', '하자보수 만료일']],
    items: [
      ['시공', '설계·견적·계약 내용대로 시공됨'], ['시공', '변경 사항은 협의하고 기록함'], ['자재', '계약한 규격의 자재 사용 (자재 승인·시험성적서)'],
      ['안전', '공사 중 사고 없음, 임시 안전시설 철거'], ['정리', '현장 청소, 가설물·남은 자재 철거'], ['폐기물', '건설폐기물 적법 처리 (석면 자재는 해체·제거 신고 확인)'],
      ['시운전', '설비·기계 시운전과 정상 작동 확인'], ['서류', '준공 사진(공사 전·중·후)·도면 제출'], ['서류', '하자이행보증서 제출'], ['정산', '공사대금 정산, 지출결의서 작성']
    ],
    reportTitle: '보완 요청 및 하자 처리', report: [['fix', '보완 요청 사항'], ['due', '보완 기한'], ['done', '보완 완료일']],
    noteLabel: '공사 내용 및 특이사항', itemsTitle: '준공 확인 항목', addLabel: '+ 공사 완료 보고서 작성',
    guide: '공사 전·중·후 사진과 견적서·계약서·준공 도면을 원본 첨부에 올려 두세요. 하자보수 만료일 전에 현장을 다시 확인하고, 결재가 끝나면 공사대금 지출결의서를 작성합니다.'
  }
};
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return ymd(x); };
const GOOD = ['양호', '적합', '완료', '조치완료', '해당없음'];
const resPill = r => r ? `<span class="pill ${r === '해당없음' ? '' : GOOD.includes(r) ? 'ok' : 'bad'}">${esc(r)}</span>` : '';
/* ---------- 소방계획서 (작성·수정·인쇄) ---------- */
const PLAN_SECTIONS = [
  ['selfcheck', '1. 화재 예방을 위한 자체점검계획 및 대응대책', '예) 매월 1회 소방안전관리자 자체점검(업무 수행 기록표 작성), 연 1회 작동점검·종합점검 실시, 불량 사항은 즉시 수리 후 보고'],
  ['maintain', '2. 소방시설·피난시설·방화시설 점검·정비계획', '예) 소화기 압력 월 1회 확인, 유도등·비상조명등 점등 확인, 방화문 자동폐쇄 장치 점검'],
  ['evac', '3. 피난계획 (피난층·피난시설 위치, 피난경로, 장애인·노약자 피난)', '예) 각 층 피난 경로와 집결지(주차장), 거동 불편자 담당자 지정'],
  ['compart', '4. 방화구획·제연구획, 내부 마감재료 및 방염물품 사용 현황', ''],
  ['training', '5. 소방훈련 및 교육 계획', '예) 연 1회 이상 소방훈련(소화·통보·피난), 신규 직원 입사 시 교육, 실시 결과 기록 보관'],
  ['hotwork', '6. 화기취급 작업 안전관리', '예) 용접·절단 작업 시 사전 허가, 소화기 비치, 작업 후 30분 감시'],
  ['shared', '7. 공동 및 분임 소방안전관리', ''],
  ['spread', '8. 소화 및 연소 방지에 관한 사항', ''],
  ['hazmat', '9. 위험물 저장·취급 관리', '예) 지하탱크저장소(경유) 일반점검 연 1회, 누설·통기관·접지 상태 확인'],
  ['etc', '10. 그 밖의 사항', '']
];
const PLAN_TABLES = {
  crew: { label: '자위소방대 편성', cols: [['team', '편성 (지휘·통보연락·초기소화·피난유도·응급구조)'], ['name', '성명'], ['role', '임무'], ['phone', '연락처']],
    defaults: [['대장(지휘)', '', '화재 시 총괄 지휘, 소방서 연락 판단', ''], ['통보연락반', '', '119 신고, 관계자 연락, 방송', ''], ['초기소화반', '', '소화기·옥내소화전으로 초기 진화', ''], ['피난유도반', '', '숙박객·이용자 피난 유도, 인원 확인', ''], ['응급구조반', '', '부상자 응급처치, 구급차 안내', '']] },
  fac: { label: '소방·방화·전기·가스·위험물 시설 현황', cols: [['kind', '시설'], ['qty', '수량'], ['loc', '위치'], ['note', '비고 (점검일 등)']],
    defaults: [['소화기', '', '', ''], ['옥내소화전', '', '', ''], ['자동화재탐지설비 (수신기)', '', '', ''], ['유도등·비상조명등', '', '', ''], ['방화문', '', '', ''], ['위험물 저장소 (지하탱크)', '', '', '']] }
};
FORMS.fire_plan = {
  name: '소방계획서', law: '화재의 예방 및 안전관리에 관한 법률 시행령 제27조 (소방계획서 포함 사항)', months: 12, cycle: '1년 (변경 시 수정)', kind: 'plan',
  performer: '작성자 (소방안전관리자)', dateLabel: '작성일',
  header: [['name', '대상물 명칭'], ['grade', '등급 (특급·1급·2급·3급)'], ['addr', '소재지', 'wide'], ['use', '용도'], ['structure', '구조'], ['basement', '지하층'], ['floors', '지상층'], ['area', '연면적(㎡)'], ['floorArea', '바닥면적(㎡)'], ['bldgs', '동수'], ['capacity', '수용인원'], ['manager', '소방안전관리자 (선임일)'], ['owner', '관계인 (소유자·관리자)'], ['station', '관할 소방서']],
  items: [], guide: '소방계획서는 매년 작성하고, 건물·시설·인원이 바뀌면 즉시 고칩니다. 관할 소방서 제출·보관 방식은 해당 소방서 안내를 따르세요.'
};
function planViewHTML(r, d, fm) {
  const h = r.header || {}, res = r.results || {}, sec = res.sections || {}, tb = res.tables || {};
  const tableHTML = (key) => { const t = PLAN_TABLES[key], rows = (tb[key] || []).filter(x => Object.values(x).some(Boolean)); return `<section class="sec"><h3>${esc(t.label)}</h3>${rows.length ? `<div class="scroll"><table class="stack"><thead><tr>${t.cols.map(([, l]) => `<th>${esc(l.replace(/ \(.*\)$/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.map(x => `<tr>${t.cols.map(([k]) => `<td>${esc(x[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="note">작성되지 않음</p>'}</section>`; };
  return `<div class="head noprint"><a class="btn ghost" href="#doc/${r.doc_id}">← ${esc(d.title)}</a><div class="ctrls">${isAdmin() ? '<button class="ghost danger" id="del">삭제</button>' : ''}<button id="dup">새 연도로 복사</button><a class="btn" href="#docrec-edit/${r.id}">수정</a><button class="pri" onclick="print()">인쇄</button></div></div>
  <div class="doc"><p class="note" style="margin:0">${esc(fm.law)}</p>
    <div class="doctop"><h2>${esc((r.date || '').slice(0, 4))}년도 소방계획서</h2><span class="pill acc">${esc(r.date || '')} 작성</span></div>
    <section class="sec"><h3>일반 현황</h3><div class="kv">${[[fm.performer, r.performer], ...fm.header.map(([k, l]) => [l, h[k]])].map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v || '')}</div>`).join('')}</div></section>
    ${tableHTML('fac')}${tableHTML('crew')}
    ${PLAN_SECTIONS.map(([k, l]) => `<section class="sec"><h3>${esc(l)}</h3>${sec[k] ? `<p class="pre">${esc(sec[k])}</p>` : '<p class="note">작성되지 않음</p>'}</section>`).join('')}
    ${(r.files || []).length ? `<section class="sec noprint"><h3>첨부</h3><ul class="list">${r.files.map((f, i) => `<li><span>📄 ${esc(f.name)}</span><button class="ghost" data-open="${i}">열기</button></li>`).join('')}</ul></section>` : ''}
    <p class="note" style="margin-top:14px">※ ${esc(fm.guide)}</p></div>`;
}
function planEditHTML(r, d, fm, src) {
  const h = src?.header || {}, res = src?.results || {}, sec = res.sections || {}, tb = res.tables || {};
  const tableEd = key => { const t = PLAN_TABLES[key]; const rows = (tb[key] && tb[key].length ? tb[key] : t.defaults.map(a => Object.fromEntries(t.cols.map(([k], i) => [k, a[i]])))); return `<section class="sec"><h3>${esc(t.label)}</h3><div class="scroll"><table class="stack" data-tb="${key}"><thead><tr>${t.cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map(x => `<tr>${t.cols.map(([k]) => `<td><input data-c="${k}" value="${esc(x[k] || '')}"></td>`).join('')}<td><button type="button" class="ghost" data-rmrow>빼기</button></td></tr>`).join('')}</tbody></table></div><button type="button" class="ghost" data-addrow="${key}" style="margin-top:6px">+ 줄 추가</button></section>`; };
  return `<div class="head"><h2>소방계획서 ${r ? '수정' : '작성'}</h2><div class="ctrls"><a class="btn ghost" href="${r ? '#docrec/' + r.id : '#doc/' + d.id}">취소</a><button class="pri" id="save">저장</button></div></div>
  ${!r && src ? '<p class="note">지난 소방계획서 내용을 불러왔습니다. 바뀐 부분만 고치면 됩니다.</p>' : ''}
  <section class="sec"><h3>일반 현황</h3><div class="form" id="hd">${fieldHTML({ k: 'date', label: fm.dateLabel, type: 'date', req: 1 }, r?.date || today())}${fieldHTML({ k: 'performer', label: fm.performer, list: 'staffList', req: 1 }, r?.performer || src?.performer || d.holder || myName())}
  ${fm.header.map(([k, l, w]) => fieldHTML({ k: 'h_' + k, label: l, wide: w ? 1 : 0 }, h[k])).join('')}</div></section>
  ${tableEd('fac')}${tableEd('crew')}
  ${PLAN_SECTIONS.map(([k, l, ph]) => `<section class="sec"><h3>${esc(l)}</h3><textarea data-sec="${k}" rows="4" placeholder="${esc(ph)}" style="width:100%">${esc(sec[k] || '')}</textarea></section>`).join('')}`;
}
function bindPlanEdit(r, d, fm) {
  M().addEventListener('click', e => {
    const rm = e.target.closest('[data-rmrow]'); if (rm) { rm.closest('tr').remove(); return; }
    const add = e.target.closest('[data-addrow]'); if (add) { const t = PLAN_TABLES[add.dataset.addrow]; const tbody = M().querySelector(`[data-tb="${add.dataset.addrow}"] tbody`); tbody.insertAdjacentHTML('beforeend', `<tr>${t.cols.map(([k]) => `<td><input data-c="${k}"></td>`).join('')}<td><button type="button" class="ghost" data-rmrow>빼기</button></td></tr>`); }
  });
  $('#save').onclick = async () => {
    const date = $('#f_date').value, performer = $('#f_performer').value.trim();
    if (!date || !performer) return toast('작성일과 작성자를 입력하세요.');
    const header = {}; fm.header.forEach(([k]) => header[k] = $('#f_h_' + k).value.trim());
    const sections = {}; M().querySelectorAll('[data-sec]').forEach(t => sections[t.dataset.sec] = t.value.trim());
    const tables = {}; Object.keys(PLAN_TABLES).forEach(key => { tables[key] = [...M().querySelectorAll(`[data-tb="${key}"] tbody tr`)].map(tr => Object.fromEntries([...tr.querySelectorAll('[data-c]')].map(i => [i.dataset.c, i.value.trim()]))).filter(x => Object.values(x).some(Boolean)); });
    const body = { date, performer, header, results: { sections, tables }, report: {}, updated_at: new Date().toISOString() };
    let id;
    if (r) { await q(sb.from('ow_doc_records').update(body).eq('id', r.id)); id = r.id; }
    else id = (await q(sb.from('ow_doc_records').insert({ ...body, doc_id: d.id, site_id: d.site_id, files: [] }).select('id').single())).id;
    if (!d.issued || date >= d.issued) await q(sb.from('ow_docs').update({ issued: date, expires: addMonths(date, fm.months), holder: d.holder || performer, cycle: d.cycle || fm.cycle, updated_at: new Date().toISOString() }).eq('id', d.id));
    toast(`저장했습니다. 다음 정비 예정일: ${addMonths(date, fm.months)}`); location.hash = '#docrec/' + id;
  };
}

routes.docrec = async id => {
  const r = await q(sb.from('ow_doc_records').select('*').eq('id', id).maybeSingle());
  if (!r) { M().innerHTML = '<div class="empty">기록을 찾을 수 없습니다.</div>'; return; }
  const d = await q(sb.from('ow_docs').select('id,title,form').eq('id', r.doc_id).maybeSingle());
  const fm = FORMS[d?.form]; if (!fm) { M().innerHTML = '<div class="empty">양식을 찾을 수 없습니다.</div>'; return; }
  if (fm.kind === 'plan') {
    M().innerHTML = planViewHTML(r, d, fm);
    M().querySelectorAll('[data-open]').forEach(b => b.onclick = async () => { const w = window.open('', '_blank'); try { const u = await docUrl(r.files[+b.dataset.open].path); if (w) w.location = u; else location.href = u; } catch (e) { w && w.close(); toast('파일을 열지 못했습니다: ' + e.message); } });
    $('#dup').onclick = () => { location.hash = '#docrec-edit/new-' + r.doc_id; };
    const del = $('#del'); if (del) del.onclick = () => confirmBox(`${r.date} 소방계획서를 삭제할까요?`, '삭제', async () => { await q(sb.from('ow_doc_records').delete().eq('id', r.id)); toast('삭제했습니다.'); location.hash = '#doc/' + r.doc_id; });
    return;
  }
  const h = r.header || {}, res = r.results || {}, rp = r.report || {};
  const bad = fm.items.filter((_, i) => res[i]?.r && !GOOD.includes(res[i].r)).length;
  M().innerHTML = `<div class="head noprint"><a class="btn ghost" href="#doc/${r.doc_id}">← ${esc(d.title)}</a><div class="ctrls">${isAdmin() ? '<button class="ghost danger" id="del">삭제</button>' : ''}<a class="btn" href="#docrec-edit/${r.id}">수정</a>${fm.toDone ? '<button class="btn" id="toDone">공사 완료 보고서 만들기</button>' : ''}<button class="pri" onclick="print()">인쇄</button></div></div>
  <div class="doc">
    <p class="note" style="margin:0">${esc(fm.law)}</p>
    <div class="doctop"><h2>${esc(fm.name)}</h2>${bad ? `<span class="pill bad">확인 필요 ${bad}건</span>` : `<span class="pill ok">모두 ${esc(fm.results[0])}</span>`}</div>
    ${fm.approve ? approveHTML(r.approvals) : ''}
    <div class="kv">${[[fm.dateLabel, r.date], [fm.performer, (r.performer || '') + ' (서명)'], ...fm.header.map(([k, l]) => [l, h[k]])].map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v || '')}</div>`).join('')}</div>
    <div class="scroll" style="margin-top:14px"><table class="stack"><thead><tr><th>점검항목</th><th>${d.form === 'fire_log' ? '확인내용' : d.form === 'work_done' ? '확인 사항' : '점검내용'}</th>${fm.items[0][2] ? '<th>점검방법</th>' : ''}<th>결과</th><th>조치 내용</th></tr></thead>
    <tbody>${fm.items.map(([g, c, m], i) => `<tr><td>${i && fm.items[i - 1][0] === g ? '' : `<b>${esc(g)}</b>`}</td><td>${esc(c)}</td>${m !== undefined ? `<td>${esc(m)}</td>` : ''}<td>${resPill(res[i]?.r)}</td><td>${esc(res[i]?.fix || '')}</td></tr>`).join('')}</tbody></table></div>
    ${fm.report ? `<section class="sec"><h3>${esc(fm.reportTitle || '불량사항 개선보고')}</h3><div class="kv">${fm.report.map(([k, l]) => `<div><span>${esc(l)}</span>${esc(rp[k] || '')}</div>`).join('')}</div></section>` : ''}
    ${r.note ? `<section class="sec"><h3>${esc(fm.noteLabel || '기타사항')}</h3><p class="pre">${esc(r.note)}</p></section>` : ''}
    ${(r.files || []).length ? `<section class="sec noprint"><h3>첨부 (원본)</h3><ul class="list">${r.files.map((f, i) => `<li><span>📄 ${esc(f.name)}</span><button class="ghost" data-open="${i}">열기</button></li>`).join('')}</ul></section>` : ''}
    <p class="note" style="margin-top:14px">※ ${esc(fm.guide)}</p>
  </div>`;
  M().querySelectorAll('[data-open]').forEach(b => b.onclick = async () => { const w = window.open('', '_blank'); try { const u = await docUrl(r.files[+b.dataset.open].path); if (w) w.location = u; else location.href = u; } catch (e) { w && w.close(); toast('파일을 열지 못했습니다: ' + e.message); } });
  if (fm.approve) bindApprove('ow_doc_records', r, () => route());
  const td = $('#toDone'); if (td) td.onclick = async () => {
    let w = (await q(sb.from('ow_docs').select('id').eq('site_id', d.site_id || r.site_id).eq('form', 'work_done').limit(1)))[0];
    if (!w) w = await q(sb.from('ow_docs').insert({ site_id: r.site_id, category: '공사·보수', title: '공사 완료 보고서', cycle: '공사 끝날 때마다', form: 'work_done' }).select('id').single());
    PREFILL = { title: h.title, place: h.place, vendor: h.vendor, contract: h.budget, start: h.start, end: h.end };
    location.hash = '#docrec-edit/new-' + w.id; };
  const del = $('#del'); if (del) del.onclick = () => confirmBox(`${r.date} 기록을 삭제할까요?`, '삭제', async () => { await q(sb.from('ow_doc_records').delete().eq('id', r.id)); toast('삭제했습니다.'); location.hash = '#doc/' + r.doc_id; });
};
let PREFILL = null;
routes['docrec-edit'] = async arg => {
  let r = null, docId;
  if (arg && arg.startsWith('new-')) docId = arg.slice(4);
  else { r = await q(sb.from('ow_doc_records').select('*').eq('id', arg).maybeSingle()); if (!r) { M().innerHTML = '<div class="empty">기록을 찾을 수 없습니다.</div>'; return; } docId = r.doc_id; }
  const d = await q(sb.from('ow_docs').select('*').eq('id', docId).maybeSingle());
  const fm = FORMS[d?.form]; if (!fm) { M().innerHTML = '<div class="empty">이 서류에는 기록 양식이 없습니다.</div>'; return; }
  if (fm.kind === 'plan') {
    const src = r || (await q(sb.from('ow_doc_records').select('*').eq('doc_id', docId).order('date', { ascending: false }).limit(1)))[0] || null;
    M().innerHTML = planEditHTML(r, d, fm, src); bindPlanEdit(r, d, fm); return;
  }
  let prev = null;
  if (!r) prev = (await q(sb.from('ow_doc_records').select('header,report').eq('doc_id', docId).order('date', { ascending: false }).limit(1)))[0];
  const h = r?.header || (PREFILL ? { ...PREFILL } : prev?.header) || {}; PREFILL = null; const res = structuredClone(r?.results || {}), rp = r?.report || {}, files = structuredClone(r?.files || []);
  M().innerHTML = `<div class="head"><h2>${esc(fm.name)} ${r ? '수정' : '작성'}</h2><div class="ctrls"><a class="btn ghost" href="${r ? '#docrec/' + r.id : '#doc/' + docId}">취소</a><button class="pri" id="save">저장</button></div></div>
  <div class="form" id="hd">${fieldHTML({ k: 'date', label: fm.dateLabel, type: 'date', req: 1 }, r?.date || today())}${fieldHTML({ k: 'performer', label: fm.performer, list: 'staffList', req: 1 }, r?.performer || d.holder || myName())}
  ${fm.header.map(([k, l, w]) => fieldHTML({ k: 'h_' + k, label: l, wide: w ? 1 : 0 }, h[k])).join('')}</div>
  <section class="sec"><h3>${esc(fm.itemsTitle || '점검 항목')} <span class="note">${r ? '' : prev ? '기본 정보는 지난 기록에서 가져왔습니다 · ' : ''}<button type="button" class="ghost" id="allok">모두 ${esc(fm.results[0])}</button></span></h3>
  <div class="scroll"><table class="stack"><thead><tr><th>점검항목</th><th>내용</th><th>결과</th><th>조치 내용</th></tr></thead><tbody>${fm.items.map(([g, c, m], i) => `<tr><td>${i && fm.items[i - 1][0] === g ? '' : `<b>${esc(g)}</b>`}</td><td>${esc(c)}${m ? ` <small class="note">(${esc(m)})</small>` : ''}</td><td><select data-ri="${i}" style="min-width:96px"><option value=""></option>${fm.results.map(o => `<option${res[i]?.r === o ? ' selected' : ''}>${o}</option>`).join('')}</select></td><td><input data-fi="${i}" value="${esc(res[i]?.fix || '')}" placeholder="불량·보완 시 조치"></td></tr>`).join('')}</tbody></table></div></section>
  ${fm.report ? `<section class="sec"><h3>${esc(fm.reportTitle || '불량사항 개선보고')}</h3><div class="form" id="rp">${fm.report.map(([k, l]) => fieldHTML({ k: 'r_' + k, label: l }, rp[k])).join('')}</div></section>` : ''}
  <div class="form">${fieldHTML({ k: 'note', label: fm.noteLabel || '기타사항', type: 'textarea', wide: 1 }, r?.note)}</div>
  <section class="sec"><h3>원본 첨부 <span class="note">서명한 서식 스캔·사진·한글 파일 등</span></h3><div id="rf"></div><label class="drop" style="margin-top:8px"><b>파일 올리기</b><span>PDF·한글·사진</span><input id="rfin" type="file" accept=".pdf,.hwp,.hwpx,image/*" multiple hidden></label></section>`;
  const drawF = () => $('#rf').innerHTML = files.length ? `<ul class="list">${files.map((f, i) => `<li><span>📄 ${esc(f.name)}</span><button type="button" class="ghost" data-rm="${i}">빼기</button></li>`).join('')}</ul>` : '<p class="note">첨부 없음</p>';
  drawF(); $('#rf').onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { files.splice(+b.dataset.rm, 1); drawF(); } };
  $('#rfin').onchange = async e => { for (const f of e.target.files) { if (f.size > 20 * 1024 * 1024) { toast(f.name + ': 20MB 초과'); continue; } const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, ''); const path = `${d.site_id}/${uid()}.${ext}`; const { error } = await sb.storage.from(DOCS_BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream' }); if (error) { toast('올리지 못했습니다: ' + error.message); continue; } files.push({ path, name: f.name, type: f.type || '' }); drawF(); } e.target.value = ''; };
  M().addEventListener('change', e => { const i = e.target.dataset.ri; if (i !== undefined) (res[i] ||= {}).r = e.target.value; });
  M().addEventListener('input', e => { const i = e.target.dataset.fi; if (i !== undefined) (res[i] ||= {}).fix = e.target.value; });
  $('#allok').onclick = () => { M().querySelectorAll('[data-ri]').forEach(s => { if (!s.value) { s.value = fm.results[0]; (res[s.dataset.ri] ||= {}).r = fm.results[0]; } }); };
  $('#save').onclick = async () => {
    const date = $('#f_date').value, performer = $('#f_performer').value.trim();
    if (!date || !performer) return toast(`${fm.dateLabel}와 ${fm.performer}를 입력하세요.`);
    const header = {}; fm.header.forEach(([k]) => header[k] = $('#f_h_' + k).value.trim());
    const report = {}; (fm.report || []).forEach(([k]) => report[k] = $('#f_r_' + k).value.trim());
    const body = { date, performer, header, results: res, report, note: $('#f_note').value.trim() || null, files, updated_at: new Date().toISOString() };
    let id;
    if (r) { await q(sb.from('ow_doc_records').update(body).eq('id', r.id)); id = r.id; }
    else id = (await q(sb.from('ow_doc_records').insert({ ...body, doc_id: docId, site_id: d.site_id }).select('id').single())).id;
    if (!d.issued || date >= d.issued) await q(sb.from('ow_docs').update({ issued: date, ...(fm.months ? { expires: addMonths(date, fm.months) } : {}), holder: d.holder || performer, cycle: d.cycle || fm.cycle, updated_at: new Date().toISOString() }).eq('id', docId));
    toast(fm.months ? `저장했습니다. 다음 예정일을 ${addMonths(date, fm.months)}로 맞췄습니다.` : '저장했습니다.'); location.hash = '#docrec/' + id;
  };
};

/* ================= 할 일 ================= */
const TSTAT = ['할 일','진행중','완료'], PRI = ['높음','보통','낮음'];
let TFILTER = '남은 일';
routes.tasks = async () => {
  const rows = await q(sb.from('ow_tasks').select('*').eq('site_id', SITE).order('due', { ascending: true, nullsFirst: false }).order('created_at'));
  const t0 = today();
  const F = [{ k: 'title', label: '할 일', req: 1, wide: 1 }, { k: 'due', label: '마감일', type: 'date' }, { k: 'assignee', label: '담당자', list: 'staffList' }, { k: 'priority', label: '중요도', type: 'select', options: PRI, def: '보통' }, { k: 'status', label: '상태', type: 'select', options: TSTAT, def: '할 일' }, { k: 'note', label: '메모', type: 'textarea', wide: 1 }];
  const shown = rows.filter(t => TFILTER === '전체' ? true : TFILTER === '남은 일' ? t.status !== '완료' : t.status === TFILTER);
  M().innerHTML = `<div class="head"><h2>할 일</h2><div class="ctrls"><select id="tf" aria-label="보기">${['남은 일','전체',...TSTAT].map(o => `<option${o === TFILTER ? ' selected' : ''}>${o}</option>`).join('')}</select><button class="pri" id="add">+ 할 일</button></div></div>
  <p class="note">왼쪽 상태 버튼을 누르면 할 일 → 진행중 → 완료로 바뀝니다. 제목을 누르면 수정합니다.</p>
  ${shown.map(t => `<div class="task ${t.status === '완료' ? 'done' : ''}"><button class="st ${t.status === '완료' ? 'pill ok' : t.status === '진행중' ? 'pill acc' : ''}" data-st="${t.id}">${esc(t.status)}</button>
    <div><button class="tt" data-ed="${t.id}">${t.priority === '높음' ? '<span class="pill bad">중요</span> ' : ''}${esc(t.title)}</button><div class="meta">${t.assignee ? `<span>${esc(t.assignee)}</span>` : ''}${t.note ? `<span>${esc(t.note.slice(0, 40))}</span>` : ''}</div></div>
    <span class="due ${t.due && t.due < t0 && t.status !== '완료' ? 'over' : ''}">${t.due ? esc(md(t.due)) + ' (' + dow(t.due) + ')' : ''}</span></div>`).join('') || '<div class="empty">할 일이 없습니다.</div>'}`;
  $('#tf').onchange = () => { TFILTER = $('#tf').value; route(); };
  $('#add').onclick = () => formModal('할 일 추가', F, {}, async v => { await q(sb.from('ow_tasks').insert({ ...v, site_id: SITE })); route(); });
  M().querySelectorAll('[data-st]').forEach(b => b.onclick = async () => { const t = rows.find(x => x.id === b.dataset.st); const n = TSTAT[(TSTAT.indexOf(t.status) + 1) % 3]; await q(sb.from('ow_tasks').update({ status: n, updated_at: new Date().toISOString() }).eq('id', t.id)); route(); });
  M().querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { const t = rows.find(x => x.id === b.dataset.ed);
    formModal('할 일 수정', F, t, async v => { await q(sb.from('ow_tasks').update({ ...v, updated_at: new Date().toISOString() }).eq('id', t.id)); route(); },
      [{ label: '삭제', cls: 'ghost danger', onClick: () => { confirmBox('이 할 일을 삭제할까요?', '삭제', async () => { await q(sb.from('ow_tasks').delete().eq('id', t.id)); route(); }); } }]); });
};

/* ================= 시설 점검 ================= */
const CRES = ['양호','불량','조치완료'];
routes.checks = async () => {
  const [a, b] = mRange(MONTH);
  const rows = await q(sb.from('ow_checks').select('*').eq('site_id', SITE).gte('date', a).lt('date', b).order('date', { ascending: false }));
  const bad = r => Object.values(r.results || {}).filter(x => x.r === '불량').length;
  M().innerHTML = `<div class="head"><h2>시설 점검</h2><div class="ctrls">${monthPick()}<a class="btn pri" href="#check-edit/new">+ 점검 기록</a></div></div>
  <div class="kpis"><div class="hot"><b class="num">${rows.length}</b><span>점검 횟수</span></div><div class="${rows.some(bad) ? 'bad' : ''}"><b class="num">${rows.reduce((s, r) => s + bad(r), 0)}</b><span>불량 항목</span></div></div>
  ${rows.length ? `<ul class="list">${rows.map(r => `<li><a href="#check/${r.id}"><b>${esc(r.date)} (${dow(r.date)})</b> · ${esc(r.inspector || '')}</a>${bad(r) ? `<span class="pill bad">불량 ${bad(r)}</span>` : '<span class="pill ok">이상 없음</span>'}</li>`).join('')}</ul>` : `<div class="empty">${mLabel(MONTH)} 점검 기록이 없습니다.</div>`}`;
  bindMonth();
};
const ckey = (it, i) => i + ':' + it.item;
routes.check = async id => {
  const r = await q(sb.from('ow_checks').select('*').eq('id', id).maybeSingle());
  if (!r) { M().innerHTML = '<div class="empty">기록을 찾을 수 없습니다.</div>'; return; }
  const items = r.results || {};
  M().innerHTML = `<div class="head noprint"><a class="btn ghost" href="#checks">← 목록</a><div class="ctrls"><button class="ghost danger" id="del">삭제 요청</button><a class="btn" href="#check-edit/${r.id}">수정 요청</a><button class="pri" onclick="print()">인쇄</button></div></div>
  <div class="doc"><div class="doctop"><h2>시설 점검표</h2></div>
  <div class="kv"><div><span>점검일</span>${esc(r.date)} (${dow(r.date)})</div><div><span>점검자</span>${esc(r.inspector)}</div><div><span>시설</span>${esc(S.org?.name || '')}</div></div>
  <div class="scroll" style="margin-top:14px"><table class="stack"><thead><tr><th>구분</th><th>점검 항목</th><th>결과</th><th>조치 내용</th></tr></thead><tbody>
  ${Object.values(items).map(x => `<tr><td>${esc(x.area)}</td><td>${esc(x.item)}</td><td>${x.r === '불량' ? '<span class="pill bad">불량</span>' : x.r === '조치완료' ? '<span class="pill acc">조치완료</span>' : '양호'}</td><td>${esc(x.note)}</td></tr>`).join('')}</tbody></table></div>
  ${r.note ? `<section class="sec"><h3>종합 의견</h3><p class="pre">${esc(r.note)}</p></section>` : ''}</div>`;
  $('#del').onclick = () => askDelete('ow_checks', r, '#check/' + r.id);
  const banner = await pendingBanner('ow_checks', r.id); if (banner) M().querySelector('.doc').insertAdjacentHTML('beforebegin', banner);
};
routes['check-edit'] = async id => {
  let r; if (id && id !== 'new') r = await q(sb.from('ow_checks').select('*').eq('id', id).maybeSingle());
  const list = r ? Object.values(r.results || {}) : (S.check_items || []).map(x => ({ area: x.area, item: x.item, r: '양호', note: '' }));
  M().innerHTML = `<div class="head"><h2>${r ? '점검 기록 수정 요청' : '시설 점검'}</h2><div class="ctrls"><a class="btn ghost" href="${r ? '#check/' + r.id : '#checks'}">취소</a><button class="pri" id="save">저장</button></div></div>
  <div class="form" id="basic">${fieldHTML({ k: 'date', label: '점검일', type: 'date', req: 1 }, r?.date || today())}${fieldHTML({ k: 'inspector', label: '점검자', list: 'staffList', req: 1 }, r?.inspector || myName())}</div>
  <section class="sec"><h3>${esc(fm.itemsTitle || '점검 항목')} <span class="note">(항목은 설정에서 바꿉니다)</span></h3>
  ${list.map((x, i) => `<div class="chk"><div><span class="pill">${esc(x.area)}</span> ${esc(x.item)}</div><div class="seg" role="radiogroup">${CRES.map(o => `<label class="${o === '불량' ? 'b' : ''}"><input type="radio" name="c${i}" value="${o}"${x.r === o ? ' checked' : ''}><span>${o}</span></label>`).join('')}</div>
    <input class="wide" data-n="${i}" placeholder="조치 내용 / 메모" value="${esc(x.note)}"></div>`).join('') || '<p class="note">설정에서 점검 항목을 먼저 넣어 주세요.</p>'}</section>
  <section class="sec"><h3>종합 의견</h3><textarea id="note">${esc(r?.note || '')}</textarea></section>
  ${r ? '<section class="sec"><h3>수정 사유 <span class="note">(결재자에게 보입니다)</span></h3><input id="reason" placeholder="예: 점검 결과 정정"></section>' : ''}`;
  $('#save').onclick = async () => {
    const date = M().querySelector('[data-k="date"]').value, inspector = M().querySelector('[data-k="inspector"]').value.trim();
    if (!date || !inspector) return toast('점검일과 점검자를 입력하세요.');
    const results = {}; list.forEach((x, i) => { results[ckey(x, i)] = { area: x.area, item: x.item, r: M().querySelector(`[name="c${i}"]:checked`)?.value || '양호', note: M().querySelector(`[data-n="${i}"]`).value }; });
    const body = { date, inspector, results, note: $('#note').value };
    if (r) { await requestChange('ow_checks', r, body, '수정', $('#reason').value); location.hash = '#check/' + r.id; return; }
    const res = await q(sb.from('ow_checks').insert({ ...body, site_id: SITE }).select('id').single());
    toast('저장했습니다.'); location.hash = '#check/' + res.id;
  };
};

/* ================= 재고 ================= */
routes.inventory = async () => {
  const rows = await q(sb.from('ow_inventory').select('*').eq('site_id', SITE).order('name'));
  const F = [{ k: 'name', label: '품명', req: 1 }, { k: 'spec', label: '규격' }, { k: 'unit', label: '단위', def: '개' }, { k: 'min_qty', label: '최소 보유량 (이하면 부족 표시)', type: 'number', def: 0 }, { k: 'location', label: '보관 위치' }, { k: 'note', label: '메모', wide: 1 }];
  const low = i => Number(i.min_qty) > 0 && Number(i.qty) <= Number(i.min_qty);
  M().innerHTML = `<div class="head"><h2>자재 · 비품 재고</h2><div class="ctrls"><input id="sq" placeholder="품명 검색" aria-label="품명 검색"><button class="pri" id="add">+ 품목</button></div></div>
  <div class="kpis"><div class="hot"><b class="num">${rows.length}</b><span>품목</span></div><div class="${rows.some(low) ? 'bad' : ''}"><b class="num">${rows.filter(low).length}</b><span>재고 부족</span></div></div>
  ${rows.length ? `<div class="scroll"><table class="stack" id="inv"><thead><tr><th>품명</th><th>규격</th><th class="r">현재고</th><th class="r">최소</th><th>위치</th><th></th></tr></thead><tbody>
  ${rows.map(i => `<tr class="${low(i) ? 'low' : ''}" data-name="${esc((i.name + ' ' + (i.spec || '')).toLowerCase())}"><td><button class="tt ghost" style="padding:0;min-height:0;color:inherit" data-ed="${i.id}"><b>${esc(i.name)}</b></button></td><td>${esc(i.spec)}</td><td class="r num">${esc(Number(i.qty))} ${esc(i.unit)}</td><td class="r">${esc(Number(i.min_qty))}</td><td>${esc(i.location)}</td>
  <td class="r"><button data-mv="${i.id}" data-k="입고">입고</button> <button data-mv="${i.id}" data-k="출고">출고</button> <button class="ghost" data-hist="${i.id}">기록</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">등록된 품목이 없습니다. <b>+ 품목</b>으로 추가하세요.</div>'}`;
  $('#sq').oninput = () => { const s = $('#sq').value.trim().toLowerCase(); M().querySelectorAll('#inv tbody tr').forEach(tr => tr.hidden = s && !tr.dataset.name.includes(s)); };
  $('#add').onclick = () => formModal('품목 추가', [...F, { k: 'qty', label: '현재 수량', type: 'number', def: 0 }], {}, async v => { v.qty = v.qty || 0; v.min_qty = v.min_qty || 0; await q(sb.from('ow_inventory').insert({ ...v, site_id: SITE })); route(); });
  M().querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { const i = rows.find(x => x.id === b.dataset.ed);
    formModal('품목 수정', F, i, async v => { v.min_qty = v.min_qty || 0; await q(sb.from('ow_inventory').update({ ...v, updated_at: new Date().toISOString() }).eq('id', i.id)); route(); },
      [{ label: '삭제', cls: 'ghost danger', onClick: () => { confirmBox(`${i.name} 품목과 입출고 기록을 모두 삭제할까요?`, '삭제', async () => { await q(sb.from('ow_inventory').delete().eq('id', i.id)); route(); }); } }]); });
  M().querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const i = rows.find(x => x.id === b.dataset.mv), k = b.dataset.k;
    formModal(`${i.name} ${k}`, [{ k: 'qty', label: `${k} 수량 (${i.unit || ''})`, type: 'number', req: 1 }, { k: 'date', label: '날짜', type: 'date', def: today() }, { k: 'who', label: '담당', list: 'staffList', def: myName() }, { k: 'note', label: '메모 (사용처·구입처 등)', wide: 1 }], {},
      async v => { if (!(v.qty > 0)) { toast('수량은 0보다 커야 합니다.'); throw new Error('qty'); } if (k === '출고' && v.qty > Number(i.qty)) toast('현재고보다 많이 출고했습니다. 수량을 확인하세요.'); await q(sb.from('ow_inventory_moves').insert({ ...v, item_id: i.id, kind: k })); route(); }); });
  M().querySelectorAll('[data-hist]').forEach(b => b.onclick = async () => { const i = rows.find(x => x.id === b.dataset.hist);
    const mv = await q(sb.from('ow_inventory_moves').select('*').eq('item_id', i.id).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(100));
    openModal(i.name + ' 입출고 기록', mv.length ? `<table><thead><tr><th>날짜</th><th>구분</th><th class="r">수량</th><th>담당</th><th>메모</th></tr></thead><tbody>${mv.map(m => `<tr><td>${esc(m.date)}</td><td>${m.kind === '입고' ? '<span class="pill ok">입고</span>' : '<span class="pill">출고</span>'}</td><td class="r">${esc(Number(m.qty))}</td><td>${esc(m.who)}</td><td>${esc(m.note)}</td></tr>`).join('')}</tbody></table>` : '<p class="note">기록이 없습니다.</p>'); });
};

/* ================= 연락처 ================= */
const CCAT = ['업체','거래처','관공서','직원','기타'];
routes.contacts = async () => {
  const rows = await q(sb.from('ow_contacts').select('*').eq('site_id', SITE).order('name'));
  const F = [{ k: 'name', label: '이름', req: 1 }, { k: 'company', label: '회사 / 소속' }, { k: 'phone', label: '전화번호', type: 'tel' }, { k: 'category', label: '분류', type: 'select', options: CCAT, def: '업체' }, { k: 'note', label: '메모 (취급 품목, 계좌 등)', type: 'textarea', wide: 1 }];
  M().innerHTML = `<div class="head"><h2>연락처</h2><div class="ctrls"><input id="sq" placeholder="이름·회사·메모 검색" aria-label="연락처 검색"><button class="pri" id="add">+ 연락처</button></div></div>
  ${rows.length ? `<ul class="list" id="cl">${rows.map(c => `<li data-s="${esc([c.name, c.company, c.phone, c.note, c.category].join(' ').toLowerCase())}"><div><button class="ghost" style="padding:0;min-height:0;color:inherit" data-ed="${c.id}"><b>${esc(c.name)}</b></button> <span class="pill">${esc(c.category)}</span><div class="meta"><span>${esc(c.company)}</span>${c.note ? `<span>${esc(c.note.slice(0, 50))}</span>` : ''}</div></div>
  ${c.phone ? `<a class="btn" href="tel:${esc(c.phone.replace(/[^0-9+]/g, ''))}">${esc(c.phone)}</a>` : ''}</li>`).join('')}</ul>` : '<div class="empty">등록된 연락처가 없습니다.</div>'}`;
  $('#sq').oninput = () => { const s = $('#sq').value.trim().toLowerCase(); M().querySelectorAll('#cl li').forEach(li => li.hidden = s && !li.dataset.s.includes(s)); };
  $('#add').onclick = () => formModal('연락처 추가', F, {}, async v => { await q(sb.from('ow_contacts').insert({ ...v, site_id: SITE })); route(); });
  M().querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { const c = rows.find(x => x.id === b.dataset.ed);
    formModal('연락처 수정', F, c, async v => { await q(sb.from('ow_contacts').update(v).eq('id', c.id)); route(); },
      [{ label: '삭제', cls: 'ghost danger', onClick: () => { confirmBox(`${c.name} 연락처를 삭제할까요?`, '삭제', async () => { await q(sb.from('ow_contacts').delete().eq('id', c.id)); route(); }); } }]); });
};

/* ================= 설정 ================= */
routes.settings = async () => {
  await loadSettings();
  const lines = a => (a || []).join('\n');
  const parse = t => t.split('\n').map(s => s.trim()).filter(Boolean);
  const admin = isAdmin();
  const accounts = admin ? (await q(sb.from('ow_profiles').select('*').order('created_at'))).filter(a => isHQ() ? true : a.site_id === SITE) : [];
  M().innerHTML = `<div class="head"><h2>설정 <span class="note" style="font-size:16px">${esc(siteName(SITE))}</span></h2>${isHQ() ? '<p class="note">다른 수양관 설정은 오른쪽 위에서 수양관을 바꾼 뒤 고치세요.</p>' : ''}</div>
  ${admin ? `<section class="sec"><h3>팀원 계정 <span class="note">${isHQ() ? '6개 수양관 전체 · ' : esc(siteName(SITE)) + ' · '}${accounts.filter(a => a.active).length}명 사용 중</span></h3>
    <div class="scroll"><table class="stack acct"><thead><tr><th>이름</th><th>소속</th><th>아이디</th><th>권한</th><th>상태</th><th></th></tr></thead><tbody>
    ${accounts.map(a => `<tr class="${a.active ? '' : 'off'}"><td><b>${esc(a.name)}</b>${a.id === ME.id ? ' <span class="note">(나)</span>' : ''}</td><td>${a.site_id ? esc(siteName(a.site_id)) : '<span class="pill acc">본부</span>'}</td><td>${esc(a.login_id)}</td><td>${a.role === '관리자' ? '<span class="pill acc">관리자</span>' : '직원'}</td><td>${a.active ? '사용 중' : '<span class="pill">사용 중지</span>'}</td>
      <td class="r"><button data-acc="${a.id}">관리</button></td></tr>`).join('')}</tbody></table></div>
    <button class="pri" id="accAdd" style="margin-top:10px">+ 팀원 계정 만들기</button>
    <p class="note">팀원은 아이디와 비밀번호로 로그인합니다. 비밀번호를 잊으면 여기서 새로 정해 주세요. 그만둔 사람은 <b>사용 중지</b>하면 로그인할 수 없고, 남긴 기록은 그대로 남습니다.</p></section>`
  : `<p class="note">설정은 관리자만 바꿀 수 있습니다. 바꿀 내용이 있으면 관리자에게 요청하세요.</p>`}
  <section class="sec"><h3>기관 정보</h3><div class="form"><label class="f">기관 이름<input id="org" value="${esc(S.org?.name)}"></label></div><button id="sOrg" style="margin-top:10px">저장</button></section>
  <section class="sec"><h3>직원 명단 <span class="note">(한 줄에 한 명)</span></h3><textarea id="staff">${esc(lines(S.staff))}</textarea><button id="sStaff" style="margin-top:10px">저장</button></section>
  <section class="sec"><h3>결재자 지정</h3><p class="note">결재 칸마다 결재할 수 있는 사람을 고릅니다. 아무도 고르지 않은 칸은 직원 누구나 결재할 수 있습니다.</p>
    ${S.roles.map((r, ri) => `<div style="margin:12px 0"><b>${esc(r)}</b><div class="pick" style="margin-top:6px">${(S.staff || []).map((n, ni) => `<label class="pill" style="display:inline-flex;gap:6px;align-items:center;min-height:36px;padding:0 12px"><input type="checkbox" data-ap="${ri}" value="${esc(n)}" style="width:18px;height:18px;min-height:0"${(S.approvers?.[r] || []).includes(n) ? ' checked' : ''}>${esc(n)}</label>`).join('')}</div></div>`).join('')}
    <button id="sAp">저장</button></section>
  <section class="sec"><h3>식수표</h3><div class="form"><label class="f wide">식사 인원 (한 줄에 한 명)<textarea id="mp">${esc(lines(S.meal?.people))}</textarea></label><label class="f">1식 단가(원)<input id="mprice" type="number" inputmode="numeric" value="${esc(S.meal?.price)}"></label><label class="f">식당(거래처)<input id="mplace" value="${esc(S.meal?.place)}"></label></div><button id="sMeal" style="margin-top:10px">저장</button></section>
  <section class="sec"><h3>시설 점검 항목 <span class="note">(한 줄에 "구분 | 항목")</span></h3><textarea id="ci" style="min-height:200px">${esc((S.check_items || []).map(x => x.area + ' | ' + x.item).join('\n'))}</textarea><button id="sCi" style="margin-top:10px">저장</button></section>
  ${admin ? `<section class="sec"><h3>나스(NAS) 백업 기록 <span class="note">매일 02:00 · sungrak_sg /수양관사무자동화/백업</span></h3><div id="bkSec"><p class="note">불러오는 중…</p></div></section>` : ''}
  <section class="sec"><h3>결재 방식</h3><p class="note">결재는 로그인한 본인 이름으로만 찍힙니다. 결재자를 지정한 칸은 지정된 사람만, 지정하지 않은 칸은 관리자만 결재할 수 있습니다. 결재자 이름은 팀원 계정의 이름과 같아야 합니다.</p></section>`;
  if (!admin) { M().querySelectorAll('section.sec input, section.sec textarea, section.sec button').forEach(el => el.disabled = true); return; }
  const done = () => toast('저장했습니다.');
  const ROLE_OPTS = ['직원', '관리자'];
  const SITE_OPTS = ['본부 (6곳 모두)', ...SITES.map(x => x.name)];
  const siteFromLabel = l => l.startsWith('본부') ? null : (SITES.find(x => x.name === l) || {}).id;
  const addStaff = async name => { if (name && !(S.staff || []).includes(name)) await saveSetting('staff', [...(S.staff || []), name]); };
  if ($('#bkSec')) q(sb.from('ow_backup_runs').select('*').order('at', { ascending: false }).limit(200)).then(runs => {
    const bk = backupSummary(runs);
    $('#bkSec').innerHTML = backupPanel(bk) + (bk.list.length ? `<div class="scroll" style="margin-top:8px"><table class="stack"><thead><tr><th>날짜</th><th>시각</th><th class="r">전체 자료</th><th class="r">첨부 파일</th><th>결과</th></tr></thead><tbody>${bk.list.slice(0, 30).map(d => `<tr><td>${esc(d.day)}</td><td>${esc(lt(d.at).slice(11, 16))}</td><td class="r">${kb(d.bytes)}</td><td class="r">${d.files ?? '-'}</td><td>${d.fail.length ? `<span class="pill bad">오류</span> <small>${esc(d.fail.join(', '))}</small>` : d.bytes !== null && d.files !== null ? '<span class="pill ok">성공</span>' : '<span class="pill">일부</span>'}</td></tr>`).join('')}</tbody></table></div>` : '');
  });
  $('#accAdd').onclick = () => formModal('팀원 계정 만들기', [
    { k: 'name', label: '이름', req: 1 }, { k: 'login_id', label: '아이디 (영문 소문자·숫자, 3~20자)', req: 1 },
    { k: 'password', label: '처음 비밀번호 (6자 이상)', req: 1 }, { k: 'role', label: '권한', type: 'select', options: ROLE_OPTS, def: '직원' },
    ...(isHQ() ? [{ k: 'site', label: '소속', type: 'select', options: SITE_OPTS, def: siteName(SITE) }] : [])], {},
    async v => { const siteId = isHQ() ? siteFromLabel(v.site) : SITE; delete v.site;
      await adminCall({ action: 'create', ...v, site_id: siteId, login_id: String(v.login_id).toLowerCase() }); if (siteId === SITE) await addStaff(v.name);
      openModal('계정을 만들었습니다', `<p>아래 내용을 <b>${esc(v.name)}</b> 님에게 전해 주세요. 처음 로그인한 뒤 오른쪽 위 <b>비밀번호 변경</b>으로 바꾸게 하세요.</p><div class="kv"><div><span>아이디</span>${esc(String(v.login_id).toLowerCase())}</div><div><span>비밀번호</span>${esc(v.password)}</div></div>`); route(); });
  M().querySelectorAll('[data-acc]').forEach(b => b.onclick = () => {
    const a = accounts.find(x => x.id === b.dataset.acc);
    const m = openModal(`${a.name} (${a.login_id})`, `<div class="form"><label class="f" for="an">이름<input id="an" value="${esc(a.name)}"></label>
      <label class="f" for="ar">권한<select id="ar">${ROLE_OPTS.map(o => `<option${o === a.role ? ' selected' : ''}>${o}</option>`).join('')}</select></label>
      ${isHQ() ? `<label class="f" for="as">소속<select id="as">${SITE_OPTS.map(o => `<option${siteFromLabel(o) === a.site_id ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>` : ''}</div>
      <div class="ctrls" style="margin-top:12px"><button id="aSave">이름·권한 저장</button><button id="aPw">비밀번호 새로 정하기</button>${a.id !== ME.id ? `<button id="aAct" class="${a.active ? 'danger' : ''}">${a.active ? '사용 중지' : '다시 사용'}</button>` : ''}</div>`);
    m.querySelector('#aSave').onclick = async () => { await adminCall({ action: 'update', user_id: a.id, name: m.querySelector('#an').value, role: m.querySelector('#ar').value, ...(isHQ() ? { site_id: siteFromLabel(m.querySelector('#as').value) } : {}) }); await addStaff(m.querySelector('#an').value.trim()); m.close(); done(); if (a.id === ME.id) { ME = await loadMe(); drawWho(); } route(); };
    m.querySelector('#aPw').onclick = () => { m.close(); formModal(`${a.name} 비밀번호 새로 정하기`, [{ k: 'password', label: '새 비밀번호 (6자 이상)', req: 1 }], {}, async v => { await adminCall({ action: 'reset_password', user_id: a.id, password: v.password }); openModal('비밀번호를 바꿨습니다', `<p><b>${esc(a.name)}</b> 님에게 새 비밀번호 <b>${esc(v.password)}</b> 를 알려 주세요.</p>`); }); };
    const act = m.querySelector('#aAct');
    if (act) act.onclick = () => { m.close(); confirmBox(a.active ? `${a.name} 님 계정을 사용 중지할까요? 로그인할 수 없게 되고, 남긴 기록은 그대로 남습니다.` : `${a.name} 님 계정을 다시 사용하게 할까요?`, a.active ? '사용 중지' : '다시 사용', async () => { await adminCall({ action: 'update', user_id: a.id, active: !a.active }); done(); route(); }); };
  });
  $('#sOrg').onclick = async () => { await saveSetting('org', { ...(S.org || {}), name: $('#org').value.trim() || '수양관' }); await loadSettings(); done(); };
  $('#sStaff').onclick = async () => { await saveSetting('staff', parse($('#staff').value)); await loadSettings(); done(); route(); };
  $('#sAp').onclick = async () => { const ap = {}; S.roles.forEach((r, ri) => ap[r] = [...M().querySelectorAll(`[data-ap="${ri}"]:checked`)].map(c => c.value)); await saveSetting('approvers', ap); done(); };
  $('#sMeal').onclick = async () => { await saveSetting('meal', { people: parse($('#mp').value), price: Number($('#mprice').value) || 0, place: $('#mplace').value.trim() }); done(); };
  $('#sCi').onclick = async () => { await saveSetting('check_items', parse($('#ci').value).map(s => { const [a, ...b] = s.split('|'); return b.length ? { area: a.trim(), item: b.join('|').trim() } : { area: '기타', item: a.trim() }; })); done(); };
};

/* ---------- 시작 ---------- */
async function start() {
  ME = await loadMe();
  if (!ME) {
    const { data: { session } } = await sb.auth.getSession();
    if (session) { await sb.auth.signOut(); return showLogin('이 계정은 사용할 수 없습니다. 관리자에게 문의하세요.'); }
    return showLogin();
  }
  document.body.classList.remove('out');
  SITES = (await sb.from('ow_sites').select('*').order('sort')).data || [];
  if (ME.site_id) SITE = ME.site_id;
  else { let saved = null; try { saved = localStorage.getItem('ow-site'); } catch {} SITE = SITES.some(x => x.id === saved) ? saved : (SITES[0] || {}).id; }
  drawWho();
  try { await loadSettings(); } catch (e) { console.error(e); }
  route();
}
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && ME) showLogin('로그인이 끝났습니다. 다시 로그인하세요.'); });
start();
})();

