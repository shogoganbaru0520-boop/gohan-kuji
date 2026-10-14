"""アプリのアイコン（PNG）を作るプログラム。追加の部品なしで動きます。
オレンジの背景に、ごはん茶わんの絵を描きます。
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")

BG = (255, 122, 69)      # オレンジ
BOWL = (178, 34, 52)     # 茶わん（赤）
BOWL_RIM = (140, 22, 40)
RICE = (255, 255, 255)   # ごはん
RICE_SHADE = (242, 236, 228)


def color_at(x, y):
    """0〜1 の座標 (x, y) の色を返す（絵の設計図）"""
    cx = 0.5
    # 茶わん：下半分の半円
    if y >= 0.52 and (x - cx) ** 2 + (y - 0.52) ** 2 <= 0.30 ** 2:
        return BOWL_RIM if y < 0.56 else BOWL
    # 茶わんの台
    if 0.80 <= y <= 0.86 and abs(x - cx) <= 0.12:
        return BOWL_RIM
    # ごはん：上のふくらみ
    if y < 0.52 and ((x - cx) / 0.28) ** 2 + ((y - 0.52) / 0.24) ** 2 <= 1:
        # 右下を少し影にして立体的に
        return RICE_SHADE if (x - 0.42) ** 2 + (y - 0.36) ** 2 > 0.17 ** 2 else RICE
    return BG


def make_png(size, path, scale=1.0):
    """size×size の PNG を作る。scale<1 だと絵を小さめに（Android の丸型アイコン用の余白）"""
    ss = 3  # なめらかにするため 1ピクセルを 3×3 に分けて平均する
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            r = g = b = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = ((px + (sx + 0.5) / ss) / size - 0.5) / scale + 0.5
                    y = ((py + (sy + 0.5) / ss) / size - 0.5) / scale + 0.5
                    c = color_at(x, y)
                    r += c[0]; g += c[1]; b += c[2]
            n = ss * ss
            row += bytes((r // n, g // n, b // n))
        rows.append(bytes(row))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("作成:", os.path.basename(path))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    make_png(192, os.path.join(OUT, "icon-192.png"))
    make_png(512, os.path.join(OUT, "icon-512.png"))
    make_png(512, os.path.join(OUT, "icon-maskable-512.png"), scale=0.8)
    make_png(180, os.path.join(OUT, "apple-touch-icon.png"))
