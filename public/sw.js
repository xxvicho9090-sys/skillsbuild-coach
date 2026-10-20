// SkillsBuild Coach · service worker. CACHE lo actualiza scripts/release.mjs.
const CACHE = 'sbc-1.4.0';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'lib/dom.js', 'lib/store.js', 'lib/ollama.js', 'lib/text.js', 'lib/files.js', 'lib/ai.js', 'lib/srs.js', 'lib/ocr.js', 'lib/reader.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// Red primero (así las actualizaciones llegan solas) y caché si no hay conexión.
// Ollama y otros orígenes quedan fuera: ni se interceptan ni se guardan.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (req.method !== 'GET' || (url.origin !== location.origin && !isFont)) return;
  if (url.pathname.includes('/ollama/') || url.pathname.endsWith('/ollama')) return; // puente local a Ollama: nunca en caché
  if (url.pathname.endsWith('/version.json')) return; // siempre directo a la red: es lo que detecta las actualizaciones
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
