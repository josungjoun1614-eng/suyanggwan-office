/* ================= 앱 설치 (PC·휴대폰) ================= */
(() => {
  const btn = document.getElementById('installBtn'); if (!btn) return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (standalone) return;
  let ev = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); ev = e; btn.hidden = false; });
  addEventListener('appinstalled', () => { btn.hidden = true; window.toast ? toast('앱을 설치했습니다. 바탕화면·시작 메뉴에서 열 수 있습니다.') : 0; });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios) btn.hidden = false;
  btn.onclick = async () => {
    if (ev) { ev.prompt(); const r = await ev.userChoice; if (r.outcome === 'accepted') btn.hidden = true; ev = null; return; }
    const msg = ios ? 'Safari 아래쪽 공유 버튼(□↑) → 홈 화면에 추가 → 추가를 누르세요.' : '브라우저 오른쪽 위 메뉴(⋯ 또는 ⋮) → 앱 → 이 사이트를 앱으로 설치를 누르세요.';
    if (!window.openModal) return alert(msg);
    openModal('앱으로 설치하기', ios
      ? '<p>Safari 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b> → <b>추가</b>를 누르세요.</p>'
      : '<p>브라우저 오른쪽 위 메뉴(⋯ 또는 ⋮) → <b>앱</b> → <b>이 사이트를 앱으로 설치</b>를 누르세요.</p>', [{ label: '확인', cls: 'pri' }]);
  };
})();
