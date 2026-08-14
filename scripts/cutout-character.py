"""
理念代表角色去背（換班換角色時會用到）

用法：
    python3 scripts/cutout-character.py <來源圖> <輸出.png> [飽和度上限] [主色容差]
    # 例：python3 scripts/cutout-character.py ~/Secure.jpeg cut/Secure.png
    # 深色棋盤格或頭髮被吃掉時，把飽和度上限調小：... cut/Thank.png 0.09 14

    去背完成後轉成班網要的兩種尺寸（需要 cwebp）：
    cwebp -q 82 -alpha_q 92 -resize 0 600 cut/Secure.png -o assets/img/characters/<pack>/Secure.webp
    cwebp -q 84 -alpha_q 95 -resize 0 220 cut/Secure.png -o assets/img/characters/<pack>/Secure-sm.webp
    最後把 pack 寫進 data/characters.json（該檔開頭有換班三步驟）。

理念代表角色去背：原圖把「透明棋盤格」畫成實際像素（alpha 全是 255），
直接拿去用會在班網上看到一格一格的灰白方塊。

作法：
  1. 取樣四個邊界，找出棋盤格的兩個主色（淺色版 #fff/#ccc、深色版 #666/#555 都吃得到）。
  2. 從邊界做 flood fill（BFS），只要顏色接近那兩個主色之一就設為透明——
     角色身上同色的白／灰不會被誤刪，因為它們和邊界不連通。
  3. 邊緣做一圈 alpha 羽化，去掉去背常見的鋸齒。
  4. 裁到角色的實際外框，等比縮到指定高度，輸出 PNG（再由 cwebp 轉 WebP）。
"""
import sys, collections
import numpy as np
from PIL import Image, ImageFilter

TOL = 40          # 與棋盤格主色的容差（0–255）
SAT_MAX = 0.16    # 飽和度低於此值視為棋盤格背景
FEATHER = 1.2     # 邊緣羽化半徑
TARGET_H = 900    # 輸出高度（等比）

def main(src, dst, sat_max=SAT_MAX, tol=TOL):
    im = Image.open(src).convert("RGBA")
    a = np.array(im)
    rgb = a[:, :, :3].astype(np.int16)
    h, w = rgb.shape[:2]

    # 1) 邊界取樣 → 棋盤格主色（取出現次數最多的兩色，量化到 8 階降噪）
    edge = np.concatenate([
        rgb[0:3].reshape(-1, 3), rgb[h-3:h].reshape(-1, 3),
        rgb[:, 0:3].reshape(-1, 3), rgb[:, w-3:w].reshape(-1, 3),
    ])
    q = (edge // 8 * 8)
    colors, counts = np.unique(q, axis=0, return_counts=True)
    main_colors = colors[np.argsort(-counts)][:2]
    print(f"   棋盤格主色：{[tuple(int(v) for v in c) for c in main_colors]}")

    # 2) 候選背景遮罩
    #    原圖的棋盤格上還疊了一層淡淡的白霧，格子顏色並不乾淨，
    #    單用「與主色的距離」只吃得掉一小塊。改用棋盤格真正的共同特徵：**低飽和度**
    #    （灰白／灰黑一律 S≈0），角色身上雖然也有灰色盔甲，但外圍有完整的深色描邊，
    #    不會和畫面邊界連通，所以 flood fill 吃不到它。
    mx = rgb.max(axis=2); mn = rgb.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    cand = sat <= sat_max
    for c in main_colors:                      # 主色附近再放寬一點，接住格線交界
        d = np.abs(rgb - c.astype(np.int16)).max(axis=2)
        cand |= (d <= tol)

    # 從四邊 BFS，只留「與邊界連通」的候選（角色身上的白不會被吃掉）
    bg = np.zeros((h, w), dtype=bool)
    dq = collections.deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True; dq.append((ny, nx))

    alpha = np.where(bg, 0, 255).astype(np.uint8)

    # 2b) 只保留最大的一塊不透明區域＝角色本體。
    #     原圖的棋盤格上疊了不規則的白霧，霧的邊緣會擋住 flood fill，
    #     在角色旁邊留下一片和主體不相連的殘留。用連通元件一次清乾淨，
    #     順便也把去背常見的零星雜點掃掉。
    solid = alpha > 10
    seen = np.zeros_like(solid)
    best, best_n = None, 0
    ys, xs = np.nonzero(solid)
    for sy, sx in zip(ys, xs):
        if seen[sy, sx]:
            continue
        comp, dq2, n = [], collections.deque([(sy, sx)]), 0
        seen[sy, sx] = True
        while dq2:
            y, x = dq2.popleft(); comp.append((y, x)); n += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True; dq2.append((ny, nx))
        if n > best_n:
            best, best_n = comp, n
    keep = np.zeros_like(solid)
    for y, x in best:
        keep[y, x] = True
    dropped = solid.sum() - best_n
    if dropped:
        print(f"   清掉不相連的殘留 {dropped} 像素（白霧塊與雜點）")
    alpha = np.where(keep, alpha, 0)

    out = Image.fromarray(np.dstack([a[:, :, :3], alpha]), "RGBA")

    # 3) 羽化邊緣
    am = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(FEATHER))
    out.putalpha(am)

    # 4) 裁到實際外框（留 8px 邊）＋ 等比縮放
    box = out.getbbox()
    if box:
        pad = 8
        box = (max(0, box[0] - pad), max(0, box[1] - pad),
               min(w, box[2] + pad), min(h, box[3] + pad))
        out = out.crop(box)
    ratio = TARGET_H / out.height
    out = out.resize((max(1, round(out.width * ratio)), TARGET_H), Image.LANCZOS)

    out.save(dst)
    kept = 100 * (1 - bg.mean())
    print(f"   去背完成：保留 {kept:.1f}% 像素 → {out.width}×{out.height}  {dst}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2],
         float(sys.argv[3]) if len(sys.argv) > 3 else SAT_MAX,
         float(sys.argv[4]) if len(sys.argv) > 4 else TOL)
