"""Downscale + WebP-compress approved art into the game's public/art folder.

Usage:  python optimize.py <src.png> <dest-name> <role>
role: splash (1280w) | backdrop (640w) | boss (1024w)
"""
import sys, os
from PIL import Image, ImageEnhance

DEST = r'G:\ClaudesFolder\dungeon-crawlers\public\art'
WIDTHS = {'splash': 1280, 'backdrop': 640, 'boss': 1024}
QUALITY = {'splash': 82, 'backdrop': 80, 'boss': 84}

src, name, role = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(DEST, exist_ok=True)

im = Image.open(src).convert('RGB')

# Vignette backdrops render under a 42% dark scrim (see skills.js _draw), which
# crushes already-dark scenes to mud. Lift them so they survive it.
if role == 'backdrop':
    im = ImageEnhance.Brightness(im).enhance(1.28)
    im = ImageEnhance.Contrast(im).enhance(1.06)

w = WIDTHS[role]
if im.width > w:
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)

out = os.path.join(DEST, name + '.webp')
im.save(out, 'WEBP', quality=QUALITY[role], method=6)
print(f'{name}.webp  {im.width}x{im.height}  {os.path.getsize(out)/1024:.0f} KB '
      f'(from {os.path.getsize(src)/1048576:.2f} MB)')
