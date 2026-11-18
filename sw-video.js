/* CastSlate video cache (2026-11-17). Registered ONLY for visitors who opened the hidden ?videos=new switch;
   ?videos=old unregisters it. It touches nothing but the homepage's .mp4 clips: everything else passes
   straight to the network untouched.
   First time a clip is requested it goes to the network as normal (nothing waits) and the WHOLE file is
   fetched once in the background and saved; from then on the browser's byte-range requests are answered
   from the saved copy, so return visits play every clip from the device, even on terrible wifi or none. */
var CACHE = 'cs-video-v1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
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
  if (!/\/(video-formats\/reel5(-lite)?|assets\/banner|assets\/video)\/[^?]+\.mp4(\?|$)/.test(u)) return;
  var key = u.split('?')[0];
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(key).then(function (hit) {
      if (hit) return req.headers.get('range') ? rangeFrom(hit, req.headers.get('range')) : hit;
      saveWhole(key);
      return fetch(req);
    });
  }));
});
