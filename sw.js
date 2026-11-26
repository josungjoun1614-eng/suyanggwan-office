// 앱 설치용 서비스워커: 캐시하지 않고 항상 최신 사이트를 불러옵니다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response('<!doctype html><meta charset="utf-8"><title>연결 안 됨</title><body style="font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>인터넷에 연결할 수 없습니다</h2><p>연결을 확인한 뒤 다시 시도하세요.</p><button onclick="location.reload()" style="font-size:16px;padding:10px 24px;border:0;border-radius:10px;background:#ff4a1c;color:#fff">다시 시도</button></div>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
