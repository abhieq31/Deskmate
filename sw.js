// Offline support: cache the app shell, serve cache-first, refresh in the background.
const CACHE = 'deskmate-v9';
const ASSETS = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'assets/icon.svg',
  'js/app.js', 'js/board.js', 'js/game.js', 'js/storage.js', 'js/sound.js', 'js/confetti.js', 'js/remote.js', 'js/live.js', 'js/engine.js', 'js/analysis.js',
  'js/office.js',
  'vendor/chess.js', 'vendor/secp256k1.js',
  ...['K', 'Q', 'R', 'B', 'N', 'P'].flatMap((r) => [`assets/pieces/cburnett/w${r}.svg`, `assets/pieces/cburnett/b${r}.svg`]),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
