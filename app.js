// ===== 福島のごはん屋さんくじ 本体 =====
// 流れ: ジャンルを入力 → お店リスト(shops.js)から探す → ランダムに1軒選ぶ → 表示
// お店リストは tools/update_shops.py が OpenStreetMap から自動で集めたもの（APIキー不要）

// ---------- 1. 画面の部品をつかまえておく ----------
const form = document.getElementById("search-form");
const genreInput = document.getElementById("genre");
const chipsBox = document.getElementById("chips");
const noChainBox = document.getElementById("no-chain");
const resultBox = document.getElementById("result");

// ---------- 2. 最初の表示を整える ----------
document.getElementById("area-name").textContent = CONFIG.AREA_NAME;
document.getElementById("shop-count").textContent = SHOPS.length;
document.getElementById("updated").textContent = SHOPS_UPDATED;
noChainBox.checked = CONFIG.EXCLUDE_CHAINS;

// ジャンルボタンを並べる（最初の8個）
for (const genre of Object.keys(CONFIG.GENRES).slice(0, 8)) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.textContent = genre;
  chip.addEventListener("click", () => {
    genreInput.value = genre;
    highlightChip();
  });
  chipsBox.appendChild(chip);
}
genreInput.addEventListener("input", highlightChip);

// 入力中の文字と同じボタンに色をつける
function highlightChip() {
  for (const chip of chipsBox.children) {
    chip.classList.toggle("active", chip.textContent === genreInput.value.trim());
  }
}

// ---------- 3. 「くじを引く」が押されたとき ----------
form.addEventListener("submit", async (event) => {
  event.preventDefault(); // ページの再読み込みを止める
  const word = genreInput.value.trim();
  genreInput.blur(); // スマホのキーボードを閉じる

  const shops = findShops(word);
  if (shops.length === 0) {
    showMessage(`「${word}」のお店が見つかりませんでした。別の言葉や、「チェーン店を除く」を外して試してみてね。`);
    return;
  }
  const winner = await spinSlot(shops);
  showShop(winner, word, shops.length);
});

// ---------- 4. お店を探す ----------
function findShops(word) {
  let shops = SHOPS;
  if (noChainBox.checked) {
    shops = shops.filter((shop) => !shop.chain);
  }
  if (word === "") return shops; // 空欄なら全部のお店から

  const genre = findGenre(word);
  return shops.filter((shop) => (genre ? matchGenre(shop, genre) : matchWord(shop, word)));
}

// 入力された言葉が、どのジャンルのことかを調べる（例：「居酒屋」→「飲み屋」）
function findGenre(word) {
  for (const [name, rule] of Object.entries(CONFIG.GENRES)) {
    if (name === word || rule.words.some((w) => w === word)) return rule;
  }
  return null;
}

// お店がジャンルに当てはまるか
function matchGenre(shop, rule) {
  const cuisines = shop.cuisine.split(";"); // "ramen;chinese" のように複数入っていることがある
  return (
    rule.types.includes(shop.type) ||
    rule.cuisines.some((c) => cuisines.includes(c)) ||
    rule.words.some((w) => shop.name.toLowerCase().includes(w.toLowerCase()))
  );
}

// ジャンル表に無い言葉なら、お店の名前や料理の種類に含まれるかで探す
function matchWord(shop, word) {
  const w = word.toLowerCase();
  return shop.name.toLowerCase().includes(w) || shop.cuisine.includes(w);
}

// ---------- 5. くじの演出（名前がくるくる変わる） ----------
function spinSlot(shops) {
  return new Promise((resolve) => {
    const winner = shops[Math.floor(Math.random() * shops.length)]; // ここで当たりが決まる！
    resultBox.innerHTML = `<div class="slot"><span class="slot-name"></span><span class="slot-note">${shops.length}軒の中から抽選中…</span></div>`;
    const nameEl = resultBox.querySelector(".slot-name");
    let count = 0;
    const timer = setInterval(() => {
      nameEl.textContent = shops[Math.floor(Math.random() * shops.length)].name;
      count++;
      if (count > 18) {
        clearInterval(timer);
        resolve(winner);
      }
    }, 80);
  });
}

// ---------- 6. 当たったお店を表示 ----------
// Google マップの検索ページのURL（APIキーなしで使える普通のリンク）
function mapUrl(shop) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${shop.name} ${CONFIG.AREA_NAME}`);
}

function showShop(shop, word, poolSize) {
  const label = genreLabel(shop);
  resultBox.innerHTML = `
    <article class="card">
      <div class="card-body">
        <div class="card-hit">🎉 今日のごはんはここ！</div>
        <h2 class="card-name">${escapeHtml(shop.name)}</h2>
        ${label ? `<div class="card-tag">${escapeHtml(label)}</div>` : ""}
        ${shop.address ? `<div class="card-address">📍 ${escapeHtml(shop.address)}</div>` : ""}
        ${shop.hours ? `<div class="card-address">🕒 ${escapeHtml(shop.hours)}（参考）</div>` : ""}
        <div class="card-pool">「${escapeHtml(word || "なんでも")}」${poolSize}軒から抽選</div>
        <div class="actions">
          <a class="btn primary" href="${mapUrl(shop)}" target="_blank" rel="noopener">⭐ Googleマップで★と場所を見る</a>
          <button class="btn" type="button" id="again-btn">🔄 もう一回</button>
          <button class="btn" type="button" id="share-btn">📤 友達に送る</button>
        </div>
      </div>
    </article>`;

  document.getElementById("again-btn").addEventListener("click", () => form.requestSubmit());
  document.getElementById("share-btn").addEventListener("click", () => shareShop(shop));
}

// お店の種類を日本語にする
function genreLabel(shop) {
  for (const [name, rule] of Object.entries(CONFIG.GENRES)) {
    if (matchGenre(shop, rule)) return name;
  }
  return { restaurant: "レストラン", cafe: "カフェ", fast_food: "ファストフード", bar: "バー", pub: "パブ" }[shop.type] || "";
}

// ---------- 7. 友達に送る ----------
async function shareShop(shop) {
  const text = `今日のごはんくじの結果👉 ${shop.name}\n${mapUrl(shop)}`;
  if (navigator.share) {
    // スマホなら共有メニュー（LINEなど）が開く
    try { await navigator.share({ title: "福島のごはん屋さんくじ", text }); } catch (e) { /* キャンセル */ }
  } else {
    // パソコンなら LINE の送信画面を開く
    window.open("https://line.me/R/msg/text/?" + encodeURIComponent(text), "_blank");
  }
}

// ---------- 小さな道具 ----------
function showMessage(text) {
  resultBox.innerHTML = `<p class="message">${escapeHtml(text)}</p>`;
}

// お店の名前などに < > が入っていても画面が壊れないようにする
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
