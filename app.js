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
const S_DEFAULT = { org: { name: '덕정 수양관' }, roles: ['담당','팀장','총괄부장','사무처장'], approvers: {}, staff: [], meal: { people: [], price: 0, place: '' }, check_items: [] };
let S = { ...S_DEFAULT };
async function loadSettings() {
  const rows = await q(sb.from('ow_settings').select('key,value').eq('site_id', SITE));
  S = { ...S_DEFAULT };
  for (const r of rows) S[r.key] = r.value;
  $('#orgName').textContent = S.org?.name || '수양관';
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
/* 결재는 로그인한 본인 이름으로만. 결재자가 지정된 칸은 지정된 사람만, 지정되지 않은 칸은 관리자만 */
const canSign = r => { const list = S.approvers?.[r] || []; return list.length ? list.includes(myName()) : isAdmin(); };
function bindApprove(table, row, rerender) {
  M().querySelectorAll('[data-role]').forEach(b => b.onclick = () => {
    const r = b.dataset.role, ap = { ...(row.approvals || {}) };
    const save = async () => { await q(sb.from(table).update({ approvals: ap }).eq('id', row.id)); row.approvals = ap; rerender(); };
    if (ap[r]) {
      if (ap[r].uid !== ME.id && ap[r].name !== myName() && !isAdmin()) return toast('다른 사람의 결재는 본인이나 관리자만 취소할 수 있습니다.');
      confirmBox(`${ap[r].name} 님의 ${r} 결재를 취소할까요?`, '결재 취소', async () => { delete ap[r]; await save(); }); return;
    }
    if (!canSign(r)) { const list = S.approvers?.[r] || []; return toast(list.length ? `${r} 결재는 ${list.join(', ')} 님만 할 수 있습니다.` : `${r} 결재자가 아직 지정되지 않았습니다. 관리자가 설정에서 지정하세요.`); }
    confirmBox(`${myName()} 이름으로 ${r} 결재합니다.`, '결재', async () => { ap[r] = { name: myName(), uid: ME.id, at: new Date().toISOString() }; await save(); toast(r + ' 결재 완료'); });
  });
}
const lastRole = () => S.roles[S.roles.length - 1];
const pending = rows => rows.filter(r => !(r.approvals || {})[lastRole()]).length;
const stampsHTML = ap => `<div class="stamps">${S.roles.map(r => `<i class="${(ap || {})[r] ? 'on' : ''}">${esc(r)}</i>`).join('')}</div>`;

/* ---------- 라우터 ---------- */
const NAV = { log: 'logs', 'log-edit': 'logs', exp: 'expenses', 'exp-edit': 'expenses', check: 'checks', 'check-edit': 'checks' };
const routes = {};
async function route() {
  if (!ME) return;
  const [name, arg] = (location.hash.slice(1) || 'home').split('/');
  const fn = routes[name] || routes.home;
  const key = routes[name] ? (NAV[name] || name) : 'home';
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.r === key));
  document.querySelector('nav a.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  try { await fn(arg); }
  catch (e) { console.error(e); M().innerHTML = `<div class="empty">불러오지 못했습니다. 인터넷 연결과 config.js 설정을 확인하세요.<br><small>${esc(e.message || e)}</small></div>`; }
  scrollTo(0, 0);
}
addEventListener('hashchange', route);

/* ================= 홈 ================= */
routes.home = async () => {
  const [a, b] = mRange(MONTH);
  const [logs, exps, meals, tasks, inv] = await Promise.all([
    q(sb.from('ow_logs').select('id,date,tasks,approvals,place').eq('site_id', SITE).gte('date', a).lt('date', b).order('date', { ascending: false })),
    q(sb.from('ow_expenses').select('id,date,title,total,approvals').eq('site_id', SITE).gte('date', a).lt('date', b).order('date', { ascending: false })),
    q(sb.from('ow_meals').select('count').eq('site_id', SITE).gte('date', a).lt('date', b)),
    q(sb.from('ow_tasks').select('*').eq('site_id', SITE).neq('status', '완료').order('due', { ascending: true, nullsFirst: false }).limit(50)),
    q(sb.from('ow_inventory').select('id,name,qty,min_qty,unit').eq('site_id', SITE))
  ]);
  const low = inv.filter(i => Number(i.qty) <= Number(i.min_qty) && Number(i.min_qty) > 0);
  const mealN = meals.reduce((s, m) => s + m.count, 0);
  const t0 = today(), over = tasks.filter(t => t.due && t.due < t0);
  M().innerHTML = `
  <div class="head"><h2>${esc(siteName(SITE))} · ${esc(mLabel(MONTH))}</h2><div class="ctrls">${monthPick()}</div></div>
  <div class="kpis">
    <a href="#logs" class="hot"><b class="num">${logs.length}</b><span>작업 일지</span></a>
    <a href="#logs"><b class="num">${pending(logs) + pending(exps)}</b><span>결재 대기 (일지·지출)</span></a>
    <a href="#expenses"><b class="num">${won(exps.reduce((s, e) => s + Number(e.total), 0))}</b><span>지출 합계(원)</span></a>
    <a href="#meals"><b class="num">${mealN}</b><span>식수 · ${won(mealN * (S.meal?.price || 0))}원</span></a>
    <a href="#tasks" class="${over.length ? 'bad' : ''}"><b class="num">${tasks.length}</b><span>남은 할 일${over.length ? ` · 지남 ${over.length}` : ''}</span></a>
    <a href="#inventory" class="${low.length ? 'bad' : ''}"><b class="num">${low.length}</b><span>재고 부족</span></a>
  </div>
  <div class="cols">
    <div class="panel"><h3>최근 작업 일지 <a href="#logs">전체 보기</a></h3><ul class="list">${logs.slice(0, 6).map(l => { const t = (l.tasks || []).find(x => x.text) || {}; return `<li><a href="#log/${l.id}">${esc(md(l.date))} ${esc(t.text || '(내용 없음)')}</a>${(l.approvals || {})[lastRole()] ? '<span class="pill ok">결재 완료</span>' : '<span class="pill">결재 대기</span>'}</li>`; }).join('') || '<li class="note">이번 달 일지가 없습니다.</li>'}</ul></div>
    <div class="panel"><h3>할 일 <a href="#tasks">전체 보기</a></h3><ul class="list">${tasks.slice(0, 6).map(t => `<li><span>${esc(t.title)}${t.assignee ? ` <span class="note">· ${esc(t.assignee)}</span>` : ''}</span><span class="due ${t.due && t.due < t0 ? 'over' : ''}">${t.due ? esc(md(t.due)) : ''}</span></li>`).join('') || '<li class="note">남은 할 일이 없습니다.</li>'}</ul></div>
    <div class="panel"><h3>지출결의서 <a href="#expenses">전체 보기</a></h3><ul class="list">${exps.slice(0, 6).map(e => `<li><a href="#exp/${e.id}">${esc(md(e.date))} ${esc(e.title)}</a><span class="num">${won(e.total)}원</span></li>`).join('') || '<li class="note">이번 달 지출결의서가 없습니다.</li>'}</ul></div>
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
    <div class="head noprint"><a class="btn ghost" href="#logs">← 목록</a><div class="ctrls"><button class="ghost danger" id="del">삭제</button><a class="btn" href="#log-edit/${l.id}">수정</a><button class="pri" onclick="print()">인쇄</button></div></div>
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
    $('#del').onclick = () => confirmBox('이 일지를 삭제할까요? 되돌릴 수 없습니다.', '삭제', async () => { await q(sb.from('ow_logs').delete().eq('id', l.id)); toast('삭제했습니다.'); location.hash = '#logs'; });
  };
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
  <div class="head"><h2>${l ? '일지 수정' : '새 작업 일지'}</h2><div class="ctrls"><a class="btn ghost" href="${l ? '#log/' + l.id : '#logs'}">취소</a><button class="pri" id="save">저장</button></div></div>
  <section class="sec"><h3>기본 정보</h3><div class="form" id="basic">${F.map(f => fieldHTML(f, d[f.k])).join('')}</div></section>
  <section class="sec"><h3><em>1</em>금일 작업 내용</h3><div id="r1"></div></section>
  <section class="sec"><h3><em>2</em>투입 인원</h3><div id="r2"></div></section>
  <section class="sec"><h3><em>3</em>사용 자재 · 장비</h3><div id="r3"></div></section>
  <section class="sec"><h3><em>4</em>안전 점검</h3><div class="checks">${SAFE.map(([k, t]) => `<label><input type="checkbox" data-s="${k}"${d.safety[k] ? ' checked' : ''}>${t}</label>`).join('')}</div></section>
  <section class="sec"><h3><em>5</em>특이사항 / 문제점</h3><textarea id="notes">${esc(d.notes)}</textarea></section>
  <section class="sec"><h3><em>6</em>명일 작업 계획</h3><textarea id="plan">${esc(d.plan)}</textarea></section>
  <section class="sec"><h3><em>7</em>작업 사진</h3><div id="ph"></div></section>
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
    const res = l ? await q(sb.from('ow_logs').update(body).eq('id', l.id).select('id').single()) : await q(sb.from('ow_logs').insert({ ...body, site_id: SITE }).select('id').single());
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
const expTotal = items => (items || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
routes.expenses = async () => {
  const [a, b] = mRange(MONTH);
  const rows = await q(sb.from('ow_expenses').select('*').eq('site_id', SITE).gte('date', a).lt('date', b).order('date', { ascending: false }));
  M().innerHTML = `<div class="head"><h2>지출결의서</h2><div class="ctrls">${monthPick()}<a class="btn" href="#meals">식대 결의서 만들기</a><a class="btn pri" href="#exp-edit/new">+ 새 결의서</a></div></div>
  <div class="kpis"><div class="hot"><b class="num">${won(rows.reduce((s, e) => s + Number(e.total), 0))}</b><span>${mLabel(MONTH)} 지출 합계(원)</span></div><div><b class="num">${rows.length}</b><span>결의서</span></div><div><b class="num">${pending(rows)}</b><span>결재 대기</span></div></div>
  ${rows.length ? `<div class="scroll"><table class="stack"><thead><tr><th>지출일</th><th>제목</th><th>거래처</th><th>결제</th><th class="r">금액(원)</th><th>결재</th></tr></thead><tbody>${rows.map(e => `<tr><td>${esc(e.date)}</td><td><a href="#exp/${e.id}"><b>${esc(e.title)}</b></a></td><td>${esc(e.vendor)}</td><td>${esc(e.pay_method)}</td><td class="r num">${won(e.total)}</td><td>${stampsHTML(e.approvals)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${mLabel(MONTH)} 지출결의서가 없습니다.</div>`}`;
  bindMonth();
};
routes.exp = async id => {
  const e = await q(sb.from('ow_expenses').select('*').eq('id', id).maybeSingle());
  if (!e) { M().innerHTML = '<div class="empty">결의서를 찾을 수 없습니다.</div>'; return; }
  const render = () => {
    M().innerHTML = `<div class="head noprint"><a class="btn ghost" href="#expenses">← 목록</a><div class="ctrls"><button class="ghost danger" id="del">삭제</button><a class="btn" href="#exp-edit/${e.id}">수정</a><button class="pri" onclick="print()">인쇄</button></div></div>
    <div class="doc">
      <div class="doctop"><h2>지출결의서</h2>${approveHTML(e.approvals)}</div>
      <div class="kv">${[['부서', e.dept], ['작성자', e.author], ['지출일', e.date], ['거래처', e.vendor], ['결제 방법', e.pay_method], ['작성일', (e.created_at || '').slice(0, 10)]].map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('')}</div>
      <div class="amount">금 ${korMoney(e.total)}원정 <small>(₩${won(e.total)})</small></div>
      <p><b>제목</b> ${esc(e.title)}</p>
      <div class="scroll"><table class="stack"><thead><tr><th>내용</th><th class="r">수량</th><th class="r">단가</th><th class="r">금액</th><th>비고</th></tr></thead>
      <tbody>${(e.items || []).map(i => `<tr><td>${esc(i.desc)}</td><td class="r">${esc(i.qty)}</td><td class="r">${won(i.price)}</td><td class="r">${won((Number(i.qty) || 0) * (Number(i.price) || 0))}</td><td>${esc(i.note)}</td></tr>`).join('') || '<tr><td colspan="5">내역 없음</td></tr>'}</tbody>
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
    $('#del').onclick = () => confirmBox('이 결의서를 삭제할까요? 되돌릴 수 없습니다.', '삭제', async () => { await q(sb.from('ow_expenses').delete().eq('id', e.id)); toast('삭제했습니다.'); location.hash = '#expenses'; });
  };
  render();
};
routes['exp-edit'] = async id => {
  let e;
  if (id && id !== 'new') e = await q(sb.from('ow_expenses').select('*').eq('id', id).maybeSingle());
  const d = e ? structuredClone(e) : { date: today(), title: '', dept: S.org?.name || '덕정 수양관', author: myName(), vendor: '', pay_method: PAY[0], items: [{ desc: '', qty: 1, price: '', note: '' }], note: '', receipts: [] };
  const F = [{ k: 'title', label: '제목', req: 1, wide: 1 }, { k: 'date', label: '지출일', type: 'date', req: 1 }, { k: 'dept', label: '부서' }, { k: 'author', label: '작성자', list: 'staffList', req: 1 }, { k: 'vendor', label: '거래처' }, { k: 'pay_method', label: '결제 방법', type: 'select', options: PAY }];
  M().innerHTML = `<div class="head"><h2>${e ? '결의서 수정' : '새 지출결의서'}</h2><div class="ctrls"><a class="btn ghost" href="${e ? '#exp/' + e.id : '#expenses'}">취소</a><button class="pri" id="save">저장</button></div></div>
  <section class="sec"><h3>기본 정보</h3><div class="form" id="basic">${F.map(f => fieldHTML(f, d[f.k])).join('')}</div></section>
  <section class="sec"><h3>지출 내역 <span class="note" id="tot"></span></h3>
    <div class="ctrls" style="margin-bottom:12px"><input type="month" id="mm" value="${esc((d.date || today()).slice(0, 7))}" aria-label="식수표 월"><select id="mmode" aria-label="불러오기 방식"><option value="sum">전체 합산 (한 줄)</option><option value="each">1인별 (사람마다 한 줄)</option></select><button type="button" id="fromMeal">식수표에서 수량 불러오기</button><span class="note">고른 달 식수표의 식수를 수량으로, 설정의 1식 단가를 단가로 넣습니다.</span></div>
    <div id="items"></div></section>
  <section class="sec"><h3>비고</h3><textarea id="note">${esc(d.note)}</textarea></section>
  ${e ? `<section class="sec"><h3>수정 사유 <span class="note">(선택 · 금액이나 내역이 바뀌면 수정 이력에 남습니다)</span></h3><input id="reason" placeholder="예: 식수표 기준으로 재계산"></section>` : ''}
  <section class="sec"><h3>증빙 (영수증 사진)</h3><div id="rc"></div></section>`;
  const tot = () => $('#tot').textContent = '합계 ' + won(expTotal(d.items)) + '원';
  const ed = rowsEditor($('#items'), d.items, [['desc','내용','text','wide'],['qty','수량','number'],['price','단가(원)','number'],['note','비고']], () => ({ desc: '', qty: 1, price: '', note: '' }), r => '금액 ' + won((Number(r.qty) || 0) * (Number(r.price) || 0)) + '원');
  $('#items').addEventListener('rowschange', tot); tot();
  $('#fromMeal').onclick = async () => {
    const m = $('#mm').value; if (!m) return toast('불러올 달을 고르세요.');
    const [a, b] = mRange(m);
    const rows = await q(sb.from('ow_meals').select('person,count').eq('site_id', SITE).gte('date', a).lt('date', b));
    const cnt = {}; rows.forEach(r => cnt[r.person] = (cnt[r.person] || 0) + r.count);
    const people = [...new Set([...(S.meal?.people || []), ...Object.keys(cnt)])].filter(p => cnt[p]);
    if (!people.length) return toast(mLabel(m) + ' 식수표에 입력된 식수가 없습니다.');
    const price = Number(S.meal?.price) || 0;
    const total = people.reduce((s, p) => s + cnt[p], 0);
    const isMeal = x => (x.note || '').includes('식수표') || /식대/.test(x.desc || '');
    // 빈 줄과 이전에 불러온 식대 줄은 지우고 새로 넣기
    for (let i = d.items.length - 1; i >= 0; i--) { const x = d.items[i]; if ((!x.desc && !Number(x.price)) || isMeal(x)) d.items.splice(i, 1); }
    if ($('#mmode').value === 'sum') {
      d.items.unshift({ desc: `${mLabel(m)} 직원 식대`, qty: total, price, note: `식수표 합산 (${people.map(p => `${p} ${cnt[p]}식`).join(', ')})` });
    } else {
      people.slice().reverse().forEach(p => d.items.unshift({ desc: `${p} 식대`, qty: cnt[p], price, note: `${mLabel(m)} 식수표` }));
    }
    const setIf = (k, v) => { const el = M().querySelector(`[data-k="${k}"]`); if (el && !el.value.trim() && v) el.value = v; };
    setIf('title', `${mLabel(m)} 직원 식대`); setIf('vendor', S.meal?.place || '');
    ed.redraw();
    toast(`${mLabel(m)} 식수표에서 ${people.length}명, 총 ${total}식을 불러왔습니다.`);
  };
  photoEditor($('#rc'), d.receipts, 'receipts', false);
  $('#save').onclick = async () => {
    const v = readForm($('#basic'), F); if (!v.title || !v.date || !v.author) return toast('제목, 지출일, 작성자를 입력하세요.');
    const items = d.items.filter(i => i.desc).map(i => ({ ...i, qty: Number(i.qty) || 0, price: Number(i.price) || 0 }));
    const body = { ...v, items, total: expTotal(items), note: $('#note').value, receipts: d.receipts, updated_at: new Date().toISOString() };
    if (e) {
      const pick = x => JSON.stringify({ items: (x.items || []).map(i => [i.desc || '', Number(i.qty) || 0, Number(i.price) || 0]), total: Number(x.total) || 0 });
      if (pick(e) !== pick(body)) {
        const now = new Date(), at = `${ymd(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
        body.history = [...(e.history || []), { at, by: v.author || '', reason: ($('#reason')?.value || '').trim(),
          before: { items: e.items || [], total: Number(e.total) || 0, note: e.note || '' }, after: { items, total: body.total, note: body.note } }];
      }
    }
    const res = e ? await q(sb.from('ow_expenses').update(body).eq('id', e.id).select('id').single()) : await q(sb.from('ow_expenses').insert({ ...body, site_id: SITE }).select('id').single());
    toast('저장했습니다.'); location.hash = '#exp/' + res.id;
  };
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
  M().innerHTML = `<div class="head noprint"><a class="btn ghost" href="#checks">← 목록</a><div class="ctrls"><button class="ghost danger" id="del">삭제</button><a class="btn" href="#check-edit/${r.id}">수정</a><button class="pri" onclick="print()">인쇄</button></div></div>
  <div class="doc"><div class="doctop"><h2>시설 점검표</h2></div>
  <div class="kv"><div><span>점검일</span>${esc(r.date)} (${dow(r.date)})</div><div><span>점검자</span>${esc(r.inspector)}</div><div><span>시설</span>${esc(S.org?.name || '')}</div></div>
  <div class="scroll" style="margin-top:14px"><table class="stack"><thead><tr><th>구분</th><th>점검 항목</th><th>결과</th><th>조치 내용</th></tr></thead><tbody>
  ${Object.values(items).map(x => `<tr><td>${esc(x.area)}</td><td>${esc(x.item)}</td><td>${x.r === '불량' ? '<span class="pill bad">불량</span>' : x.r === '조치완료' ? '<span class="pill acc">조치완료</span>' : '양호'}</td><td>${esc(x.note)}</td></tr>`).join('')}</tbody></table></div>
  ${r.note ? `<section class="sec"><h3>종합 의견</h3><p class="pre">${esc(r.note)}</p></section>` : ''}</div>`;
  $('#del').onclick = () => confirmBox('이 점검 기록을 삭제할까요?', '삭제', async () => { await q(sb.from('ow_checks').delete().eq('id', r.id)); location.hash = '#checks'; });
};
routes['check-edit'] = async id => {
  let r; if (id && id !== 'new') r = await q(sb.from('ow_checks').select('*').eq('id', id).maybeSingle());
  const list = r ? Object.values(r.results || {}) : (S.check_items || []).map(x => ({ area: x.area, item: x.item, r: '양호', note: '' }));
  M().innerHTML = `<div class="head"><h2>${r ? '점검 기록 수정' : '시설 점검'}</h2><div class="ctrls"><a class="btn ghost" href="${r ? '#check/' + r.id : '#checks'}">취소</a><button class="pri" id="save">저장</button></div></div>
  <div class="form" id="basic">${fieldHTML({ k: 'date', label: '점검일', type: 'date', req: 1 }, r?.date || today())}${fieldHTML({ k: 'inspector', label: '점검자', list: 'staffList', req: 1 }, r?.inspector || myName())}</div>
  <section class="sec"><h3>점검 항목 <span class="note">(항목은 설정에서 바꿉니다)</span></h3>
  ${list.map((x, i) => `<div class="chk"><div><span class="pill">${esc(x.area)}</span> ${esc(x.item)}</div><div class="seg" role="radiogroup">${CRES.map(o => `<label class="${o === '불량' ? 'b' : ''}"><input type="radio" name="c${i}" value="${o}"${x.r === o ? ' checked' : ''}><span>${o}</span></label>`).join('')}</div>
    <input class="wide" data-n="${i}" placeholder="조치 내용 / 메모" value="${esc(x.note)}"></div>`).join('') || '<p class="note">설정에서 점검 항목을 먼저 넣어 주세요.</p>'}</section>
  <section class="sec"><h3>종합 의견</h3><textarea id="note">${esc(r?.note || '')}</textarea></section>`;
  $('#save').onclick = async () => {
    const date = M().querySelector('[data-k="date"]').value, inspector = M().querySelector('[data-k="inspector"]').value.trim();
    if (!date || !inspector) return toast('점검일과 점검자를 입력하세요.');
    const results = {}; list.forEach((x, i) => { results[ckey(x, i)] = { area: x.area, item: x.item, r: M().querySelector(`[name="c${i}"]:checked`)?.value || '양호', note: M().querySelector(`[data-n="${i}"]`).value }; });
    const body = { date, inspector, results, note: $('#note').value };
    const res = r ? await q(sb.from('ow_checks').update(body).eq('id', r.id).select('id').single()) : await q(sb.from('ow_checks').insert({ ...body, site_id: SITE }).select('id').single());
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
  <section class="sec"><h3>결재 방식</h3><p class="note">결재는 로그인한 본인 이름으로만 찍힙니다. 결재자를 지정한 칸은 지정된 사람만, 지정하지 않은 칸은 관리자만 결재할 수 있습니다. 결재자 이름은 팀원 계정의 이름과 같아야 합니다.</p></section>`;
  if (!admin) { M().querySelectorAll('section.sec input, section.sec textarea, section.sec button').forEach(el => el.disabled = true); return; }
  const done = () => toast('저장했습니다.');
  const ROLE_OPTS = ['직원', '관리자'];
  const SITE_OPTS = ['본부 (6곳 모두)', ...SITES.map(x => x.name)];
  const siteFromLabel = l => l.startsWith('본부') ? null : (SITES.find(x => x.name === l) || {}).id;
  const addStaff = async name => { if (name && !(S.staff || []).includes(name)) await saveSetting('staff', [...(S.staff || []), name]); };
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
