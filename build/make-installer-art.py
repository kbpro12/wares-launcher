"""Regenerates the installer artwork (run from the project root: python build/make-installer-art.py).
Needs: pip install pillow numpy, and `npm install` (for the Barlow font files)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

FW = 'node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff'
FB = 'node_modules/@fontsource/barlow/files/barlow-latin-400-normal.woff'
ACCENT = (111, 163, 224)
font = lambda p, s: ImageFont.truetype(p, s)

def metal(w, h, seed=3):
    rng = np.random.default_rng(seed)
    y = np.linspace(0, 1, h)[:, None]
    base = np.stack([34 - 14 * y, 38 - 15 * y, 44 - 16 * y], -1) * np.ones((h, w, 3))
    img = base + rng.normal(0, 1, (h, 1, 1)) * 2.2 * np.ones((1, w, 1)) + rng.normal(0, 1.1, (h, w, 3))
    return Image.fromarray(np.clip(img, 0, 255).astype('uint8'))

def mark(s):
    S = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    grad = Image.new('RGBA', (s, s)); gd = ImageDraw.Draw(grad)
    for yy in range(s):
        t = yy / s
        gd.line([(0, yy), (s, yy)], fill=tuple(min(255, int(c * k)) for c, k in zip(ACCENT, (1.25 - .5 * t, 1.2 - .45 * t, 1.12 - .4 * t))) + (255,))
    m = Image.new('L', (s, s), 0); ImageDraw.Draw(m).rounded_rectangle([s * .03, s * .03, s * .97, s * .97], radius=s * .17, fill=255)
    S.paste(grad, (0, 0), m)
    hl = Image.new('RGBA', (s, s), (0, 0, 0, 0)); ImageDraw.Draw(hl).rounded_rectangle([s * .06, s * .06, s * .94, s * .48], radius=s * .14, fill=(255, 255, 255, 38))
    S = Image.alpha_composite(S, hl)
    ImageDraw.Draw(S).line([(s * .22, s * .33), (s * .36, s * .70), (s * .50, s * .43), (s * .64, s * .70), (s * .78, s * .33)], fill=(12, 17, 24, 255), width=int(s * .095), joint='curve')
    return S

W, H = 164, 314
sb = metal(W, H).convert('RGBA')
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(glow).ellipse([-70, 170, 120, 360], fill=(*ACCENT, 70))
sb = Image.alpha_composite(sb, glow.filter(ImageFilter.GaussianBlur(28)))
m = mark(84); sb.paste(m, (40, 34), m)
d = ImageDraw.Draw(sb)
d.text((82, 146), 'Wares', font=font(FW, 34), fill=(224, 228, 233, 255), anchor='mm')
d.text((82, 178), 'LAUNCHER', font=font(FW, 19), fill=(*ACCENT, 255), anchor='mm')
d.line([(34, 204), (130, 204)], fill=(255, 255, 255, 40))
for i, t in enumerate(['Profiles', 'Modrinth mods', 'Skins & capes', 'One-click FPS']):
    d.text((82, 226 + i * 17), t, font=font(FB, 12), fill=(150, 158, 168, 255), anchor='mm')
sb.convert('RGB').save('build/installerSidebar.bmp'); sb.convert('RGB').save('build/uninstallerSidebar.bmp')

hd = metal(150, 57, 5).convert('RGBA'); mm = mark(36); hd.paste(mm, (10, 10), mm)
d = ImageDraw.Draw(hd)
d.text((54, 22), 'Wares', font=font(FW, 22), fill=(224, 228, 233, 255), anchor='lm')
d.text((54, 40), 'LAUNCHER', font=font(FW, 12), fill=(*ACCENT, 255), anchor='lm')
hd.convert('RGB').save('build/installerHeader.bmp')

big = mark(512)
big.save('build/icon.png')
big.save('build/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
big.save('build/installerIcon.ico', sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
big.save('build/uninstallerIcon.ico', sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
print('installer art written')
