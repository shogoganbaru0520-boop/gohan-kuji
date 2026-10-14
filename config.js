// ===== 設定ファイル =====
// アプリの「ルール表」です。コードを触らずに条件やジャンルを変えられます。

const CONFIG = {
  // 対象の町（お店データは tools/update_shops.py で集めます）
  AREA_NAME: "郡山市",

  // 最初から「チェーン店を除く」にチェックを入れておくか
  EXCLUDE_CHAINS: true,

  // ジャンルの決まり
  //   types    … お店の種類（OpenStreetMap での呼び名。cafe=カフェ、bar=バー など）
  //   cuisines … 料理の種類（ramen=ラーメン、sushi=寿司 など）
  //   words    … お店の名前にこの言葉が入っていたら、そのジャンルとみなす
  // 上から8個がボタンとして表示されます
  GENRES: {
    "ラーメン": { types: [], cuisines: ["ramen", "noodle"], words: ["ラーメン", "らーめん", "拉麺", "中華そば", "麺屋", "麺処", "つけ麺"] },
    "飲み屋": { types: ["bar", "pub", "izakaya"], cuisines: ["izakaya", "yakitori"], words: ["居酒屋", "酒場", "バー", "炉端", "焼鳥", "やきとり", "飲み"] },
    "カフェ": { types: ["cafe"], cuisines: ["coffee_shop"], words: ["カフェ", "珈琲", "コーヒー", "喫茶", "cafe", "coffee"] },
    "焼肉": { types: [], cuisines: ["yakiniku", "barbecue", "korean"], words: ["焼肉", "ホルモン"] },
    "寿司": { types: [], cuisines: ["sushi"], words: ["寿司", "鮨", "すし"] },
    "定食": { types: [], cuisines: ["japanese", "teishoku", "tonkatsu"], words: ["定食", "食堂", "とんかつ"] },
    "スイーツ": { types: ["ice_cream"], cuisines: ["cake", "dessert", "ice_cream", "crepe", "pancake"], words: ["ケーキ", "洋菓子", "スイーツ", "クレープ", "パティスリー"] },
    "中華": { types: [], cuisines: ["chinese"], words: ["中華", "餃子", "飯店"] },
    "そば・うどん": { types: [], cuisines: ["soba", "udon"], words: ["そば", "蕎麦", "うどん"] },
    "カレー": { types: [], cuisines: ["curry", "indian", "nepalese"], words: ["カレー"] },
    "ハンバーガー": { types: [], cuisines: ["burger"], words: ["バーガー"] },
    "イタリアン": { types: [], cuisines: ["italian", "pizza", "pasta"], words: ["イタリア", "ピザ", "パスタ", "トラットリア"] },
  },
};
