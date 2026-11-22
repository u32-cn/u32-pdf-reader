"""
生成应用图标 build/icon.ico（供 electron-builder 打包使用）。

视觉语言与界面一致：赭红 #8b3a2e 底、米白纸面、无渐变。
1024 画布绘制后按尺寸下采样，天然带抗锯齿。

运行：python scripts/make-icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

S = 1024
INK = (139, 58, 46, 255)      # 强调色（赭红）
PAPER = (255, 253, 248, 255)  # 纸面
FOLD = (232, 223, 210, 255)   # 折角背面
RULE = (216, 207, 192, 255)   # 文本行

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角底板
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=INK)

# 文档纸面
left, top, right, bottom = S * 0.26, S * 0.17, S * 0.74, S * 0.83
d.rounded_rectangle([left, top, right, bottom], radius=int(S * 0.035), fill=PAPER)

# 右上折角
fold = S * 0.155
d.polygon(
    [(right - fold, top), (right, top + fold), (right - fold, top + fold)],
    fill=FOLD,
)

# 文本行（两行，长度不同，模拟正文）
rule_h = S * 0.034
for i, w in enumerate((0.40, 0.30)):
    x = left + S * 0.075
    y = top + S * 0.21 + i * S * 0.115
    d.rounded_rectangle([x, y, x + S * w, y + rule_h], radius=rule_h / 2, fill=RULE)

# 音波（三条竖向，长度递减，表示内嵌音频）
cx = left + S * 0.075
base_y = bottom - S * 0.135
bar_w = S * 0.038
for i, h in enumerate((0.075, 0.135, 0.10)):
    x = cx + i * S * 0.062
    d.rounded_rectangle(
        [x, base_y - S * h / 2, x + bar_w, base_y + S * h / 2],
        radius=bar_w / 2,
        fill=INK,
    )

out = Path(__file__).resolve().parent.parent / 'build' / 'icon.ico'
out.parent.mkdir(parents=True, exist_ok=True)
img.save(out, sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
img.resize((512, 512), Image.LANCZOS).save(out.with_name('icon.png'))
print(f'icon written: {out} ({out.stat().st_size} bytes)')
