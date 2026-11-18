/* Video demo offline cache (2026-11-17). Scope: /assets/vdemo/ only - it controls the demo pages and never
   the real site. After one visit every video plays from the device, even on terrible wifi or none at all.
   - Streams (.m3u8 playlists, .ts segments), stills, hls.js, fonts: cache first.
   - Reel .mp4 clips: the video element asks for byte RANGES. The first time, the request goes to the
     network as usual (nothing waits) and the WHOLE file is fetched once in the background and saved; from
     then on every range is cut from the saved copy and answered locally with a 206.
   - The demo pages themselves: network first, saved copy only when offline. */
var CACHE = 'vdemo-v2';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('vdemo-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
var pending = {};
function saveWhole(url) {
  if (pending[url]) return;
  pending[url] = fetch(url, { credentials: 'omit' }).then(function (r) {
    if (r.ok && r.status === 200) return caches.open(CACHE).then(function (c) { return c.put(url, r); });
  }).catch(function () {}).then(function () { delete pending[url]; });
}
function rangeFrom(resp, rangeHeader) {
  return resp.arrayBuffer().then(function (buf) {
    var size = buf.byteLength, m = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '');
    var start = m && m[1] ? parseInt(m[1], 10) : 0, end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (m && !m[1] && m[2]) { start = size - parseInt(m[2], 10); end = size - 1; }
    end = Math.min(end, size - 1);
    return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
      'Content-Type': 'video/mp4', 'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
  });
}
self.addEventListener('fetch', function (e) {
  var req = e.request, u = req.url;
  if (req.method !== 'GET') return;
  var clip = /\/video-formats\/reel5(-lite)?\/[^/]+\.mp4(\?|$)/.test(u);
  var ours = clip || /\/assets\/vdemo\//.test(u) || /cdn\.jsdelivr\.net\/npm\/hls\.js/.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u) || /\/video-formats\/reel5\/[^/]+\.jpg/.test(u);
  if (!ours) return;
  if (clip) {
    var key = u.split('?')[0];
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(key).then(function (hit) {
        if (hit) return req.headers.get('range') ? rangeFrom(hit, req.headers.get('range')) : hit;
        saveWhole(key);
        return fetch(req);
      });
    }));
    return;
  }
  if (req.mode === 'navigate' || /\.html(\?|$)/.test(u)) {
    e.respondWith(fetch(req).then(function (r) {
      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return r;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }); }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) {
        if (r && (r.ok || r.type === 'opaque') && r.status !== 206) c.put(req, r.clone());
        return r;
      }).catch(function () { return Response.error(); });
    });
  }));
});
