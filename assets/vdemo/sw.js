/* Video demo offline cache (2026-11-17). Scope: /assets/vdemo/ only - it never touches the real site.
   Cache-first for the demo's stream playlists, segments, stills and hls.js, so after one visit every
   video plays from the device even on terrible wifi or none at all. */
var CACHE = 'vdemo-v1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  var u = e.request.url;
  if (e.request.method !== 'GET') return;
  var ours = /\/assets\/vdemo\//.test(u) || /cdn\.jsdelivr\.net\/npm\/hls\.js/.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u);
  if (!ours) return;
  /* The page itself: network first (so demo updates show), cache only when offline. */
  if (e.request.mode === 'navigate' || /\.html(\?|$)/.test(u) || /\/assets\/vdemo\/(\?|$)/.test(u)) {
    e.respondWith(fetch(e.request).then(function (r) {
      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return r;
    }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (r) {
        if (r && (r.ok || r.type === 'opaque') && r.status !== 206) c.put(e.request, r.clone());
        return r;
      }).catch(function () { return hit || Response.error(); });
    });
  }));
});
