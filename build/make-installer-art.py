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

import json, math
VER = json.load(open('package.json'))['version']
BG = (13, 16, 22)
SS = 2  # supersample: everything is drawn at 2x and downsampled, so every edge is anti-aliased

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def vgrad(w, h, top, bot):
    y = np.linspace(0, 1, h)[:, None, None]
    a = np.array(top)[None, None, :] * (1 - y) + np.array(bot)[None, None, :] * y
    return Image.fromarray(np.clip(a * np.ones((h, w, 3)), 0, 255).astype('uint8')).convert('RGBA')

def glow(img, cx, cy, r, alpha, col=ACCENT):
    g = Image.new('RGBA', img.size, (0, 0, 0, 0)); ImageDraw.Draw(g).ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*col, alpha))
    return Image.alpha_composite(img, g.filter(ImageFilter.GaussianBlur(r * 0.55)))

def lattice(img, x0, y0, x1, y1, s, fade):
    """Isometric cube-edge lattice. fade(y) -> 0..1 opacity."""
    L = Image.new('RGBA', img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(L)
    ax, row = s * 0.866, s * 1.5
    r = 0
    y = y0
    while y < y1:
        x = x0 - (ax if r % 2 else 0)
        while x < x1:
            a = int(255 * fade(y)); 
            if a > 3:
                col = (*ACCENT, a)
                d.line([(x, y - s), (x + ax, y - s / 2), (x + ax, y + s / 2), (x, y + s), (x - ax, y + s / 2), (x - ax, y - s / 2), (x, y - s)], fill=col, width=SS)
                d.line([(x, y), (x + ax, y - s / 2)], fill=col, width=SS); d.line([(x, y), (x - ax, y - s / 2)], fill=col, width=SS); d.line([(x, y), (x, y + s)], fill=col, width=SS)
            x += ax * 2
        y += row; r += 1
    return Image.alpha_composite(img, L)

def cube(img, cx, cy, s, top, left, right, edge=None):
    L = Image.new('RGBA', img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(L); ax = s * 0.866
    d.polygon([(cx, cy - s), (cx + ax, cy - s / 2), (cx, cy), (cx - ax, cy - s / 2)], fill=top)
    d.polygon([(cx - ax, cy - s / 2), (cx, cy), (cx, cy + s), (cx - ax, cy + s / 2)], fill=left)
    d.polygon([(cx + ax, cy - s / 2), (cx, cy), (cx, cy + s), (cx + ax, cy + s / 2)], fill=right)
    if edge:
        for pts in ([(cx, cy - s), (cx + ax, cy - s / 2), (cx + ax, cy + s / 2), (cx, cy + s), (cx - ax, cy + s / 2), (cx - ax, cy - s / 2), (cx, cy - s)],):
            d.line(pts, fill=edge, width=SS)
    return Image.alpha_composite(img, L)

def accent_cube(img, cx, cy, s, k=1.0):
    t = tuple(min(255, int(c * (1.2 * k))) for c in ACCENT); l = tuple(int(c * 0.62 * k) for c in ACCENT); r = tuple(int(c * 0.40 * k) for c in ACCENT)
    return cube(img, cx, cy, s, (*t, 255), (*l, 255), (*r, 255), (255, 255, 255, 40))

def txt(d, xy, s, f, fill, anchor='la', spacing=0):
    if not spacing: return d.text(xy, s, font=f, fill=fill, anchor=anchor)
    x, y = xy
    total = sum(d.textlength(c, font=f) for c in s) + spacing * (len(s) - 1)
    if anchor[0] == 'm': x -= total / 2
    for ch in s:
        d.text((x, y), ch, font=f, fill=fill, anchor='l' + anchor[1]); x += d.textlength(ch, font=f) + spacing

def edge_line(img, side):
    d = ImageDraw.Draw(img); w, h = img.size
    for y in range(h):
        t = y / h; c = lerp((9, 11, 16), ACCENT, (1 - t) ** 1.4)
        d.line([(0, y), (SS * 2, y)] if side == 'l' else [(w - SS * 2, y), (w, y)], fill=c)

def finish(img, size): return img.resize(size, Image.LANCZOS).convert('RGB')

# ---------------------------------------------------------------- sidebar 164x314 (welcome + finish pages)
W, H = 164, 314
sb = vgrad(W * SS, H * SS, (22, 28, 41), (9, 11, 16))
sb = glow(sb, -10 * SS, 330 * SS, 120 * SS, 120)
sb = lattice(sb, 14 * SS, 150 * SS, (W + 30) * SS, (H + 30) * SS, 15 * SS, lambda y: max(0, (y / SS - 160) / 154) ** 1.5 * 0.55)
m = mark(88 * SS); sb.paste(m, (38 * SS, 28 * SS), m)
d = ImageDraw.Draw(sb)
txt(d, (82 * SS, 140 * SS), 'Wares', font(FW, 38 * SS), (236, 240, 246, 255), 'mm')
txt(d, (82 * SS, 168 * SS), 'LAUNCHER', font(FW, 16 * SS), (*ACCENT, 255), 'mm', spacing=3 * SS)
for i, t in enumerate(['Profiles', 'Modrinth mods', 'Skins & capes', 'Native fast downloads']):
    y = (198 + i * 16) * SS
    d.rectangle([18 * SS, y - 2 * SS, 22 * SS, y + 2 * SS], fill=(*ACCENT, 255)); txt(d, (30 * SS, y), t, font(FB, 11 * SS), (170, 178, 192, 255), 'lm')
txt(d, (18 * SS, 296 * SS), f'v{VER}  -  by VisdomXD', font(FB, 9 * SS), (120, 130, 148, 255), 'lm')
edge_line(sb, 'r')
finish(sb, (W, H)).save('build/installerSidebar.bmp'); finish(sb, (W, H)).save('build/uninstallerSidebar.bmp')

# ---------------------------------------------------------------- header 150x57
hd = vgrad(150 * SS, 57 * SS, (24, 31, 45), (12, 15, 21))
hd = lattice(hd, 70 * SS, 6 * SS, 170 * SS, 70 * SS, 9 * SS, lambda y: 0.5 * (1 - y / (57 * SS)))
mm = mark(36 * SS); hd.paste(mm, (10 * SS, 10 * SS), mm)
d = ImageDraw.Draw(hd)
txt(d, (54 * SS, 24 * SS), 'Wares', font(FW, 23 * SS), (236, 240, 246, 255), 'lm')
txt(d, (54 * SS, 41 * SS), 'LAUNCHER', font(FW, 11 * SS), (*ACCENT, 255), 'lm', spacing=2 * SS)
d.rectangle([0, 55 * SS, 150 * SS, 57 * SS], fill=(*ACCENT, 200))
finish(hd, (150, 57)).save('build/installerHeader.bmp')

# ---------------------------------------------------------------- splash 520x300 (fades in while the installer starts)
SW, SH = 520, 300
sp = vgrad(SW * SS, SH * SS, (20, 26, 38), (8, 10, 15))
sp = glow(sp, 130 * SS, 60 * SS, 150 * SS, 90); sp = glow(sp, 430 * SS, 280 * SS, 170 * SS, 60)
sp = lattice(sp, 0, 0, (SW + 40) * SS, (SH + 40) * SS, 22 * SS, lambda y: 0.30 + 0.25 * (y / (SH * SS)))
for (cx, cy, s, k) in [(150, 150, 38, 1.0), (150 + 33, 150 - 19 - 38 + 38, 0, 0)]:
    if s: sp = accent_cube(sp, cx * SS, cy * SS, s * SS, k)
sp = accent_cube(sp, 118 * SS, 190 * SS, 30 * SS, 0.8); sp = accent_cube(sp, 178 * SS, 176 * SS, 24 * SS, 0.65)
d = ImageDraw.Draw(sp)
txt(d, (250 * SS, 120 * SS), 'Wares', font(FW, 78 * SS), (238, 242, 248, 255), 'lm')
txt(d, (252 * SS, 172 * SS), 'L A U N C H E R', font(FW, 20 * SS), (*ACCENT, 255), 'lm')
txt(d, (252 * SS, 206 * SS), 'Fast. Clean. Native-accelerated.', font(FB, 13 * SS), (150, 160, 178, 255), 'lm')
d.rounded_rectangle([40 * SS, 268 * SS, (SW - 40) * SS, 272 * SS], radius=2 * SS, fill=(36, 44, 60))
d.rounded_rectangle([40 * SS, 268 * SS, 190 * SS, 272 * SS], radius=2 * SS, fill=(*ACCENT, 255))
d.rectangle([0, 0, SW * SS - 1, SH * SS - 1], outline=(40, 48, 64), width=SS)
finish(sp, (SW, SH)).save('build/installerSplash.bmp')

# ---------------------------------------------------------------- options page art 120x214 (blends into the page colour on its right edge)
OW, OH = 120, 214
op = vgrad(OW * SS, OH * SS, (22, 29, 43), BG)
op = glow(op, 40 * SS, 150 * SS, 70 * SS, 100)
op = lattice(op, 6 * SS, 10 * SS, (OW + 20) * SS, (OH + 20) * SS, 13 * SS, lambda y: 0.45 * (1 - abs(y / SS - 120) / 120))
for (cx, cy, s, k) in [(44, 150, 24, 1.0), (76, 132, 20, 0.8), (50, 108, 17, 0.62)]: op = accent_cube(op, cx * SS, cy * SS, s * SS, k)
arr = np.array(op.convert('RGB')).astype('float32'); fw = 34 * SS
ramp = np.clip(np.linspace(0, 1, fw), 0, 1)[None, :, None]
arr[:, -fw:, :] = arr[:, -fw:, :] * (1 - ramp) + np.array(BG, dtype='float32') * ramp
Image.fromarray(arr.astype('uint8')).resize((OW, OH), Image.LANCZOS).save('build/installerOptions.bmp')

big = mark(512)
big.save('build/icon.png')
big.save('build/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
big.save('build/installerIcon.ico', sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
big.save('build/uninstallerIcon.ico', sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
print('installer art written')
