"""郡山市のお店を OpenStreetMap から自動で集めて shops.js に保存するプログラム。

使い方:  tools フォルダの update_shops.bat をダブルクリック（または python update_shops.py）
OpenStreetMap はみんなで作る無料の地図。登録もAPIキーもいりません。
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

CITY = "郡山市"  # 郡山市（文字化け防止のため記号で書いています）

# 集めるお店の種類（OpenStreetMap での呼び名）
AMENITIES = "restaurant|cafe|fast_food|bar|pub|izakaya|food_court|ice_cream"

QUERY = (
    '[out:json][timeout:180];'
    'area["name"="%s"]["boundary"="administrative"]["admin_level"="7"]->.a;'
    'nwr["amenity"~"^(%s)$"]["name"](area.a);'
    'out center tags;' % (CITY, AMENITIES)
)

# 混んでいたら次のサーバーを試す
SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# 「ラーメン店」のように、お店の名前ではなく種類しか書かれていないデータは除く
GENERIC_NAMES = {
    "ラーメン店", "ラーメン", "居酒屋", "食堂",
    "レストラン", "カフェ", "喫茶店", "寿司",
    "焼肉", "そば", "うどん", "中華料理",
}  # ラーメン店, ラーメン, 居酒屋, 食堂, レストラン, カフェ, 喫茶店, 寿司, 焼肉, そば, うどん, 中華料理

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shops.js")


def download():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    for attempt in range(3):
        for url in SERVERS:
            print("取得中:", url)
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "gohan-kuji/1.0"})
                with urllib.request.urlopen(req, timeout=240) as res:
                    return json.load(res)["elements"]
            except Exception as e:
                print("  失敗:", e)
        print("全部混んでいるので30秒待ってやり直します…")
        time.sleep(30)
    sys.exit("お店を取得できませんでした。時間をおいてもう一度試してください。")


def simplify(e):
    """必要な情報だけを取り出す"""
    t = e["tags"]
    lat = e.get("lat") or e["center"]["lat"]
    lon = e.get("lon") or e["center"]["lon"]
    addr = "".join(t.get(k, "") for k in ("addr:city", "addr:quarter", "addr:neighbourhood", "addr:block_number", "addr:housenumber"))
    shop = {
        "name": t["name"],
        "type": t["amenity"],
        "cuisine": t.get("cuisine", ""),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
    }
    if t.get("brand") or t.get("brand:wikidata"):
        shop["chain"] = True
    if addr:
        shop["address"] = addr
    if t.get("opening_hours"):
        shop["hours"] = t["opening_hours"]
    return shop


def main():
    elements = download()
    shops = [s for s in map(simplify, elements) if s["name"].strip() not in GENERIC_NAMES]
    shops = sorted({(s["name"], s["lat"]): s for s in shops}.values(), key=lambda s: s["name"])
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// このファイルは tools/update_shops.py が自動で作りました（手で直さなくてOK）\n")
        f.write("// データ: (c) OpenStreetMap contributors / ODbL\n")
        f.write("const SHOPS_UPDATED = %s;\n" % json.dumps(time.strftime("%Y-%m-%d")))
        f.write("const SHOPS = %s;\n" % json.dumps(shops, ensure_ascii=False, indent=0))
    print("完了！ %d 軒のお店を shops.js に保存しました。" % len(shops))


if __name__ == "__main__":
    main()
