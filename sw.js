// ===== サービスワーカー =====
// スマホにアプリとして入れたとき、電波がなくても開けるようにファイルを保存しておく係。
// アプリを更新したら VERSION の数字を1つ上げる（古い保存を捨てて新しいものに入れ替わる）
const VERSION = "v1";
const FILES = [
  "./", "index.html", "style.css", "app.js", "config.js", "shops.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

// インストールされたとき：ファイルを保存
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

// 新しいバージョンになったとき：古い保存を削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
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
