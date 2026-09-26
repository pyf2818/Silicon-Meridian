# scripts/icon-to-ico.py — 应用图标后处理：512 PNG → 多尺寸 ICO + 256 PNG
# 用法：python scripts/icon-to-ico.py
# 依赖：Pillow（Miniconda base 已带 PIL 12.x）
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'build', 'icon-512.png')
OUT_ICO = os.path.join(ROOT, 'build', 'icon.ico')
OUT_PNG = os.path.join(ROOT, 'build', 'icon.png')

def main():
    img = Image.open(SRC).convert('RGBA')
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    img.save(OUT_ICO, format='ICO', sizes=sizes)
    img.resize((256, 256), Image.LANCZOS).save(OUT_PNG, format='PNG', optimize=True)
    print('[icon-to-ico] OK →', OUT_ICO, '(%d bytes)' % os.path.getsize(OUT_ICO))
    print('[icon-to-ico] OK →', OUT_PNG, '(%d bytes)' % os.path.getsize(OUT_PNG))

if __name__ == '__main__':
    main()
