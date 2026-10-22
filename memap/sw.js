// ===== サービスワーカー =====
// スマホにアプリとして入れたとき、電波がなくても開けるようにファイルを保存しておく係。
// （地図の画像だけはネットが必要。写真はスマホの中に保存されているので見られる）
// アプリを更新したら VERSION の数字を1つ上げる（古い保存を捨てて新しいものに入れ替わる）
const VERSION = "memap-v1";
const FILES = [
  "./", "index.html", "style.css", "app.js", "manifest.webmanifest",
  "lib/leaflet.js", "lib/leaflet.css", "lib/exifr.lite.js", "lib/images/layers.png", "lib/images/layers-2x.png",
  "lib/images/marker-icon.png", "lib/images/marker-icon-2x.png", "lib/images/marker-shadow.png",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

// インストールされたとき：ファイルを保存
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

// 新しいバージョンになったとき：古い保存を削除（このアプリの分だけ）
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("memap-") && k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ファイルを読むとき：まずネットから最新を取り、ダメなら保存しておいたものを使う
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
