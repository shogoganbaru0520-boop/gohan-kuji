// ===== MeMap 本体 =====
// 流れ: 写真を追加 → 写真の中の位置情報(EXIF)か、いまの GPS で場所を出す
//       → 航空写真をぐっと拡大して、ピンを「撮った正確な場所」に合わせる → 保存
// 「ユニバで撮った」ではなく「ユニバのどこで撮ったか」まで残すのが目的。
// 写真はスマホの中(IndexedDB)だけに保存され、どこにも送られない。

// ---------- 1. 写真の保存係（IndexedDB） ----------
const db = (() => {
  let opening;
  function open() {
    opening ||= new Promise((resolve, reject) => {
      const req = indexedDB.open("memap", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("photos", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return opening;
  }
  async function run(mode, action) {
    const conn = await open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction("photos", mode);
      const req = action(tx.objectStore("photos"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  return {
    all: () => run("readonly", (store) => store.getAll()),
    put: (photo) => run("readwrite", (store) => store.put(photo)),
    remove: (id) => run("readwrite", (store) => store.delete(id)),
  };
})();

// ---------- 2. 地図の背景（拡大したときに細かく見える航空写真がポイント） ----------
function makeMap(elementId, firstLayer) {
  const layers = {
    "航空写真": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 19, maxZoom: 21, attribution: "Tiles &copy; Esri",
    }),
    "地図": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxNativeZoom: 19, maxZoom: 21, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }),
    "国土地理院 写真": L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", {
      maxNativeZoom: 18, maxZoom: 21, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
    }),
  };
  const map = L.map(elementId, { maxZoom: 21, zoomControl: false });
  layers[firstLayer].addTo(map);
  L.control.layers(layers, null, { position: "topright" }).addTo(map);
  return map;
}

const JAPAN = [36.2, 138.25];
const DETAIL_ZOOM = 19; // ピン合わせのときの拡大率（建物の入り口や乗り物が見分けられるくらい）

// ---------- 3. 状態 ----------
let photos = [];             // 保存済みの写真ぜんぶ
const thumbUrls = new Map(); // 写真ID → 小さい画像のURL
let fullUrl = null;          // 詳細で表示中の大きい画像のURL
let openId = null;           // 詳細で表示中の写真ID
let activeTag = "";

const $ = (id) => document.getElementById(id);
const mainMap = makeMap("main-map", "地図");
mainMap.setView(JAPAN, 5);
const markers = L.layerGroup().addTo(mainMap);

// ---------- 4. 小さな道具 ----------
function toast(text) {
  const box = $("toast");
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (box.hidden = true), 2600);
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2);
}

function thumbUrl(photo) {
  if (!thumbUrls.has(photo.id)) thumbUrls.set(photo.id, URL.createObjectURL(photo.thumb));
  return thumbUrls.get(photo.id);
}

function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}

// 方角(0〜360度)を「北東」のような言葉に
function directionName(deg) {
  return ["北", "北東", "東", "南東", "南", "南西", "西", "北西"][Math.round(deg / 45) % 8];
}

const SOURCE_LABEL = { exif: "写真のGPS", gps: "撮影時のGPS", manual: "手で指定" };

function coordText(photo) {
  let text = `${photo.lat.toFixed(6)}, ${photo.lng.toFixed(6)}`;
  if (photo.adjusted) text += "（手で微調整済み）";
  else if (photo.source) text += `（${SOURCE_LABEL[photo.source]}${photo.accuracy ? ` ±${Math.round(photo.accuracy)}m` : ""}）`;
  if (photo.direction != null) text += ` ・ ${directionName(photo.direction)}向きに撮影`;
  return text;
}

function matches(photo, words) {
  const text = [photo.place, photo.memo, ...photo.tags].join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
}

function filterPhotos(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return photos.filter((p) => matches(p, words) && (!activeTag || p.tags.includes(activeTag)));
}

// ---------- 5. 写真ファイルから情報を取り出す ----------
async function readExif(file) {
  try {
    const x = await exifr.parse(file);
    if (!x) return {};
    const date = x.DateTimeOriginal || x.CreateDate || x.ModifyDate;
    return {
      lat: typeof x.latitude === "number" ? x.latitude : null,
      lng: typeof x.longitude === "number" ? x.longitude : null,
      accuracy: typeof x.GPSHPositioningError === "number" ? x.GPSHPositioningError : null,
      direction: typeof x.GPSImgDirection === "number" ? x.GPSImgDirection : null,
      takenAt: date instanceof Date && !isNaN(date) ? date.toISOString() : null,
    };
  } catch {
    return {};
  }
}

// 一覧や地図のピンに使う小さい画像を作る（長い辺 400px）
async function makeThumb(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function photoFromFile(file, live) {
  const meta = await readExif(file);
  const photo = {
    id: newId(),
    blob: file,
    thumb: await makeThumb(file),
    lat: meta.lat, lng: meta.lng,
    accuracy: meta.accuracy,
    source: meta.lat != null ? "exif" : null,
    direction: meta.direction,
    takenAt: meta.takenAt || new Date(file.lastModified || Date.now()).toISOString(),
    place: "", memo: "", tags: [],
    adjusted: false,
    createdAt: Date.now(),
  };
  // 写真に位置情報がなく、いま撮ったばかりなら GPS の位置を使う
  if (photo.lat == null && live) {
    Object.assign(photo, { lat: live.lat, lng: live.lng, accuracy: live.accuracy, source: "gps" });
  }
  return photo;
}

// ---------- 6. GPS ----------
// 撮影ボタンを押した瞬間から GPS を温めておき、いちばん精度のよい値を使う
let watchId = null;
let bestFix = null;

function startGps() {
  if (!navigator.geolocation || watchId != null) return;
  bestFix = null;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, time: Date.now() };
      if (!bestFix || fix.accuracy <= bestFix.accuracy || fix.time - bestFix.time > 30000) bestFix = fix;
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
  );
}

function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function getPositionOnce() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  });
}

// ---------- 7. 地図タブ ----------
function renderMarkers() {
  markers.clearLayers();
  const shown = filterPhotos($("map-search").value).filter((p) => p.lat != null);
  for (const p of shown) {
    const icon = L.divIcon({
      className: "photo-pin",
      html: `<div class="photo-pin-in"><img src="${thumbUrl(p)}" alt=""></div>`,
      iconSize: [52, 60],
      iconAnchor: [26, 60],
    });
    L.marker([p.lat, p.lng], { icon, riseOnHover: true })
      .on("click", () => openDetail(p.id))
      .addTo(markers);
  }
  $("map-empty").hidden = photos.length > 0;
  return shown;
}

function fitAll() {
  const shown = filterPhotos($("map-search").value).filter((p) => p.lat != null);
  if (shown.length === 1) mainMap.setView([shown[0].lat, shown[0].lng], 18);
  else if (shown.length > 1) mainMap.fitBounds(shown.map((p) => [p.lat, p.lng]), { padding: [60, 60], maxZoom: 18 });
}

$("map-search").addEventListener("input", renderMarkers);
$("map-fit").addEventListener("click", fitAll);

// ---------- 8. アルバムタブ ----------
function renderAlbum() {
  const allTags = [...new Set(photos.flatMap((p) => p.tags))].sort();
  if (activeTag && !allTags.includes(activeTag)) activeTag = "";
  const chips = $("tag-chips");
  chips.replaceChildren();
  for (const tag of ["", ...allTags]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (tag === activeTag ? " active" : "");
    chip.textContent = tag || "すべて";
    chip.addEventListener("click", () => {
      activeTag = tag;
      renderAll();
    });
    chips.appendChild(chip);
  }

  const grid = $("album-grid");
  grid.replaceChildren();
  const shown = filterPhotos($("album-search").value);
  for (const p of shown) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    const img = document.createElement("img");
    img.src = thumbUrl(p);
    img.alt = "";
    img.loading = "lazy";
    const label = document.createElement("span");
    label.textContent = p.place || formatDate(p.takenAt).split(" ")[0];
    card.append(img, label);
    card.addEventListener("click", () => openDetail(p.id));
    grid.appendChild(card);
  }
  $("album-empty").hidden = shown.length > 0;
}

$("album-search").addEventListener("input", renderAlbum);

function renderAll() {
  renderMarkers();
  renderAlbum();
}

// タブの切りかえ
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => showView(tab.dataset.view));
}

function showView(viewId) {
  for (const view of document.querySelectorAll(".view")) view.hidden = view.id !== viewId;
  for (const tab of document.querySelectorAll(".tab")) tab.classList.toggle("active", tab.dataset.view === viewId);
  if (viewId === "view-map") mainMap.invalidateSize();
}

// ---------- 9. 詳細シート ----------
let detailMap = null;
let detailMarker = null;

function openDetail(id) {
  const p = photos.find((x) => x.id === id);
  if (!p) return;
  openId = id;
  if (fullUrl) URL.revokeObjectURL(fullUrl);
  fullUrl = URL.createObjectURL(p.blob);
  $("dt-photo").src = fullUrl;
  $("dt-place").textContent = p.place || "名前のない場所";
  $("dt-date").textContent = formatDate(p.takenAt);
  $("dt-memo").textContent = p.memo;
  const tags = $("dt-tags");
  tags.replaceChildren(...p.tags.map((t) => Object.assign(document.createElement("span"), { className: "chip", textContent: t })));
  const hasPlace = p.lat != null;
  $("dt-map").hidden = !hasPlace;
  $("dt-show").hidden = !hasPlace;
  $("dt-google").hidden = !hasPlace;
  $("dt-coord").textContent = hasPlace ? coordText(p) : "場所がまだ決まっていません";
  $("detail").hidden = false;

  if (hasPlace) {
    $("dt-google").href = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
    if (!detailMap) {
      detailMap = makeMap("dt-map", "航空写真");
      detailMarker = L.marker([p.lat, p.lng]).addTo(detailMap);
    }
    detailMap.invalidateSize();
    detailMap.setView([p.lat, p.lng], 19);
    detailMarker.setLatLng([p.lat, p.lng]);
  }
}

function closeSheets() {
  $("detail").hidden = true;
  $("add-menu").hidden = true;
  openId = null;
}

for (const back of document.querySelectorAll(".sheet-back")) {
  back.addEventListener("click", (e) => {
    if (e.target === back || e.target.closest("[data-close]")) closeSheets();
  });
}

$("dt-show").addEventListener("click", () => {
  const p = photos.find((x) => x.id === openId);
  closeSheets();
  showView("view-map");
  mainMap.setView([p.lat, p.lng], 20);
});

$("dt-edit").addEventListener("click", () => {
  const p = photos.find((x) => x.id === openId);
  closeSheets();
  openEditor([{ ...p, tags: [...p.tags] }], false);
});

$("dt-delete").addEventListener("click", async () => {
  if (!confirm("この写真を削除しますか？（元に戻せません）")) return;
  const id = openId;
  await db.remove(id);
  photos = photos.filter((p) => p.id !== id);
  if (thumbUrls.has(id)) URL.revokeObjectURL(thumbUrls.get(id));
  thumbUrls.delete(id);
  closeSheets();
  renderAll();
  toast("削除しました");
});

// ---------- 10. 写真の追加 ----------
$("add-btn").addEventListener("click", () => ($("add-menu").hidden = false));

$("add-camera").addEventListener("click", () => {
  startGps(); // カメラを開いている間に GPS の精度を上げておく
  $("add-menu").hidden = true;
  $("file-camera").click();
});

$("add-library").addEventListener("click", () => {
  $("add-menu").hidden = true;
  $("file-library").click();
});

$("file-camera").addEventListener("change", (e) => addFiles([...e.target.files], true));
$("file-library").addEventListener("change", (e) => addFiles([...e.target.files], false));

async function addFiles(files, fromCamera) {
  $("add-menu").hidden = true;
  $("file-camera").value = "";
  $("file-library").value = "";
  if (!files.length) return stopGps();
  toast("写真を読みこみ中…");
  let live = null;
  if (fromCamera) {
    live = bestFix || (await getPositionOnce().catch(() => null));
    stopGps();
  }
  const queue = [];
  for (const file of files) {
    try {
      queue.push(await photoFromFile(file, live));
    } catch {
      toast(`「${file.name}」は読みこめませんでした`);
    }
  }
  if (queue.length) openEditor(queue, true);
}

// ---------- 11. ピン合わせ画面 ----------
// 画面のまん中にピンが固定されていて、地図のほうを動かして合わせる方式。
// 指でピンをつまむより、指でピンが隠れないぶん正確に合わせられる。
const editor = { queue: [], photo: null, isNew: true, total: 0, map: null, refLayer: null };

function openEditor(queue, isNew) {
  editor.queue = queue;
  editor.total = queue.length;
  editor.isNew = isNew;
  $("editor").hidden = false;
  if (!editor.map) {
    editor.map = makeMap("ed-map", "航空写真");
    editor.refLayer = L.layerGroup().addTo(editor.map);
    editor.map.on("move", updateEditorCoord);
  }
  editor.map.invalidateSize();
  loadNextInEditor();
}

async function loadNextInEditor() {
  const p = editor.queue.shift();
  editor.photo = p;
  const done = editor.total - editor.queue.length;
  $("ed-count").textContent = editor.total > 1 ? `(${done}/${editor.total})` : "";
  $("ed-save").textContent = editor.queue.length ? "保存して次へ" : "保存";
  if (editor.photoUrl) URL.revokeObjectURL(editor.photoUrl);
  editor.photoUrl = URL.createObjectURL(p.thumb);
  $("ed-photo").src = editor.photoUrl;
  $("ed-place").value = p.place;
  $("ed-memo").value = p.memo;
  $("ed-tags").value = p.tags.join(" ");
  $("ed-q").value = "";
  $("ed-results").hidden = true;

  // 写真の向き（コンパスの方角）が分かれば、扇形で表示
  $("ed-dir").hidden = p.direction == null;
  if (p.direction != null) $("ed-dir").style.transform = `translate(-50%, -100%) rotate(${p.direction}deg)`;

  // 元の位置（写真やGPSが示した場所）と、その誤差の範囲を薄く表示しておく
  editor.refLayer.clearLayers();
  const origin = p.origin || (p.lat != null ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy } : null);
  editor.origin = origin;
  if (origin) {
    if (origin.accuracy) {
      L.circle([origin.lat, origin.lng], { radius: origin.accuracy, color: "#4da3ff", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(editor.refLayer);
    }
    L.circleMarker([origin.lat, origin.lng], { radius: 5, color: "#fff", weight: 2, fillColor: "#4da3ff", fillOpacity: 1, interactive: false }).addTo(editor.refLayer);
  }

  if (p.lat != null) {
    editor.map.setView([p.lat, p.lng], DETAIL_ZOOM);
  } else {
    // 位置情報がない写真：最後に保存した場所 → 現在地 → 日本全体 の順で地図を出す
    const last = photos.find((x) => x.lat != null);
    if (last) editor.map.setView([last.lat, last.lng], 16);
    else editor.map.setView(JAPAN, 5);
    getPositionOnce()
      .then((pos) => editor.photo === p && editor.map.setView([pos.lat, pos.lng], 17))
      .catch(() => {});
    toast("この写真には位置情報がありません。地図を動かしてピンを合わせてね");
  }
  updateEditorCoord();
}

function updateEditorCoord() {
  if (!editor.map || !editor.photo) return;
  const c = editor.map.getCenter();
  let text = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
  if (editor.origin) {
    const moved = editor.map.distance(c, [editor.origin.lat, editor.origin.lng]);
    text += moved < 1 ? `（${SOURCE_LABEL[editor.photo.source] || "元の位置"}のまま）` : `（元の位置から ${formatDistance(moved)} 移動）`;
  }
  $("ed-coord").textContent = text;
  const zoom = editor.map.getZoom();
  $("ed-hint").textContent = zoom < 17 ? "もっと拡大すると、撮った場所をピンポイントで合わせられます" : "地図を動かして、まん中のピンを撮った場所に合わせよう";
}

function closeEditor() {
  $("editor").hidden = true;
  editor.queue = [];
  editor.photo = null;
}

$("ed-cancel").addEventListener("click", () => {
  if (editor.isNew && !confirm("保存せずに閉じますか？")) return;
  closeEditor();
});

$("ed-reset").addEventListener("click", () => {
  if (editor.origin) editor.map.setView([editor.origin.lat, editor.origin.lng], Math.max(editor.map.getZoom(), DETAIL_ZOOM));
  else toast("元の位置情報がない写真です");
});

$("ed-locate").addEventListener("click", async () => {
  try {
    const pos = await getPositionOnce();
    editor.map.setView([pos.lat, pos.lng], Math.max(editor.map.getZoom(), 18));
  } catch {
    toast("現在地が取れませんでした（位置情報の許可を確認してね）");
  }
});

// スポット検索（OpenStreetMap の Nominatim を使う。いま見ている地図の近くを優先）
$("ed-search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("ed-q").value.trim();
  if (!q) return;
  const b = editor.map.getBounds().pad(2);
  const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
    q, format: "jsonv2", limit: "6", "accept-language": "ja",
    viewbox: [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].join(","),
  });
  const list = $("ed-results");
  list.replaceChildren();
  try {
    const res = await fetch(url);
    const items = await res.json();
    if (!items.length) {
      toast("見つかりませんでした。別の言い方で探してみてね");
      list.hidden = true;
      return;
    }
    for (const item of items) {
      const li = document.createElement("li");
      const name = document.createElement("b");
      name.textContent = item.name || item.display_name.split(",")[0];
      const sub = document.createElement("small");
      sub.textContent = item.display_name;
      li.append(name, sub);
      li.addEventListener("click", () => {
        editor.map.setView([+item.lat, +item.lon], Math.max(18, editor.map.getZoom()));
        if (!$("ed-place").value) $("ed-place").value = name.textContent;
        list.hidden = true;
      });
      list.appendChild(li);
    }
    list.hidden = false;
  } catch {
    toast("検索できませんでした（電波を確認してね）");
  }
});

// ピンのいる場所の名前を調べる（アトラクション名・建物名などが返ってくることが多い）
$("ed-lookup").addEventListener("click", async () => {
  const c = editor.map.getCenter();
  const url = "https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({
    lat: c.lat, lon: c.lng, zoom: "18", format: "jsonv2", "accept-language": "ja",
  });
  try {
    const res = await fetch(url);
    const item = await res.json();
    const a = item.address || {};
    const name = item.name || a.attraction || a.tourism || a.building || a.amenity || a.road;
    const area = a.theme_park || a.park || a.suburb || a.city || a.town || a.village;
    const text = [area, name].filter((x, i, arr) => x && arr.indexOf(x) === i).join(" ");
    if (text) $("ed-place").value = text;
    else toast("名前が見つかりませんでした");
  } catch {
    toast("調べられませんでした（電波を確認してね）");
  }
});

$("ed-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = editor.photo;
  const c = editor.map.getCenter();
  if (editor.map.getZoom() < 12 && !confirm("地図がかなり縮小されています。この位置で保存しますか？")) return;
  if (!p.origin && editor.origin) p.origin = editor.origin; // 元の位置は残しておく（あとで戻せるように）
  const moved = editor.origin ? editor.map.distance(c, [editor.origin.lat, editor.origin.lng]) : Infinity;
  p.lat = c.lat;
  p.lng = c.lng;
  if (moved >= 1) {
    p.adjusted = true;
    if (!p.source) p.source = "manual";
  }
  p.place = $("ed-place").value.trim();
  p.memo = $("ed-memo").value.trim();
  p.tags = [...new Set($("ed-tags").value.split(/[\s　,、#]+/).filter(Boolean))];
  try {
    await db.put(p);
  } catch {
    toast("保存できませんでした（スマホの空き容量を確認してね）");
    return;
  }
  photos = [p, ...photos.filter((x) => x.id !== p.id)].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  renderAll();
  if (editor.queue.length) {
    loadNextInEditor();
  } else {
    closeEditor();
    showView("view-map");
    mainMap.setView([p.lat, p.lng], 19);
    toast("保存しました");
  }
});

// ---------- 12. スタート ----------
(async () => {
  navigator.storage?.persist?.(); // スマホが勝手に保存データを消さないようにお願いする
  photos = (await db.all()).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  renderAll();
  fitAll();
})();
