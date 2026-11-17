"""Generate seamless leather-grain and parchment tiles plus a deckled-edge polygon.

Usage: python -I textures.py <out_dir>
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
N = 512
rng = np.random.default_rng(7)


def lowpass_noise(size, cutoff, seed):
    """Periodic noise: white noise filtered in frequency space (tiles seamlessly)."""
    r = np.random.default_rng(seed)
    white = r.standard_normal((size, size))
    fx = np.fft.fftfreq(size)[:, None]
    fy = np.fft.fftfreq(size)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    spectrum = np.fft.fft2(white) * np.exp(-(f / cutoff) ** 2)
    n = np.real(np.fft.ifft2(spectrum))
    return (n - n.mean()) / (n.std() + 1e-9)


def worley(size, cells, seed):
    """Periodic Worley F1/F2 with one jittered point per grid cell."""
    r = np.random.default_rng(seed)
    step = size / cells
    pts = (np.arange(cells)[:, None, None] + r.random((cells, cells, 2))) * step  # [gy, gx, (y,x)]
    pts[..., 1] = (np.arange(cells)[None, :] + r.random((cells, cells))) * step
    pts[..., 0] = (np.arange(cells)[:, None] + r.random((cells, cells))) * step
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    gy = (yy // step).astype(int)
    gx = (xx // step).astype(int)
    f1 = np.full((size, size), 1e9)
    f2 = np.full((size, size), 1e9)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cy = (gy + dy) % cells
            cx = (gx + dx) % cells
            py = pts[cy, cx, 0] + ((gy + dy) - cy) * step * 0 + np.where(gy + dy < 0, -size, np.where(gy + dy >= cells, size, 0))
            px = pts[cy, cx, 1] + np.where(gx + dx < 0, -size, np.where(gx + dx >= cells, size, 0))
            d = np.hypot(yy - py, xx - px)
            f2 = np.where(d < f1, f1, np.minimum(f2, d))
            f1 = np.minimum(f1, d)
    return f1, f2


def periodic_blur(a, sigma):
    fx = np.fft.fftfreq(a.shape[0])[:, None]
    fy = np.fft.fftfreq(a.shape[1])[None, :]
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k))


def save_leather():
    a1, a2 = worley(N, 40, 11)
    b1, b2 = worley(N, 64, 12)
    ea, eb = a2 - a1, b2 - b1
    h = 0.65 * np.clip(ea / 5.0, 0, 1) ** 0.5 + 0.35 * np.clip(eb / 3.5, 0, 1) ** 0.5
    wr = lowpass_noise(N, 0.01, 5)
    wrinkle = np.exp(-(wr / 0.07) ** 2)
    h -= wrinkle * 0.25
    h = periodic_blur(h, 0.7)
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    shade = -(gx * 0.7 + gy * 0.7) * 5.0
    crease = periodic_blur(1 - np.clip(ea / 2.2, 0, 1), 0.6) * 0.28 + periodic_blur(1 - np.clip(eb / 1.8, 0, 1), 0.5) * 0.12
    pores = periodic_blur((rng.random((N, N)) > 0.988).astype(float), 0.5) * 0.5
    broad = lowpass_noise(N, 0.004, 9) * 0.10 + lowpass_noise(N, 0.015, 10) * 0.04
    val = shade * 0.45 - crease - pores * 0.4 - wrinkle * 0.12 + broad
    val = np.clip(val, -0.6, 0.4)
    rgba = np.zeros((N, N, 4), dtype=np.uint8)
    dark = val < 0
    rgba[..., 0] = np.where(dark, 14, 255)
    rgba[..., 1] = np.where(dark, 7, 226)
    rgba[..., 2] = np.where(dark, 2, 186)
    alpha = np.where(dark, -val * 0.85, val * 0.30)
    rgba[..., 3] = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(f'{OUT}/leather-grain.png', optimize=True)


def save_parchment():
    base = np.array([233, 229, 220], dtype=np.float64)
    stain = np.array([204, 196, 181], dtype=np.float64)
    blot = lowpass_noise(N, 0.006, 21)
    broad2 = lowpass_noise(N, 0.003, 24)
    mott = lowpass_noise(N, 0.05, 22)
    fine = lowpass_noise(N, 0.35, 23)
    t = np.clip(0.26 + blot * 0.10 + broad2 * 0.08 + mott * 0.035, 0, 1)
    img = base[None, None, :] * (1 - t[..., None]) + stain[None, None, :] * t[..., None]
    img += fine[..., None] * 3.2
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')
    # Fibres, drawn with wrap-around so the tile stays seamless.
    layer = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for _ in range(520):
        x, y = rng.random(2) * N
        ang = rng.normal(0.25, 0.9)
        length = rng.uniform(6, 26)
        bend = rng.normal(0, 0.25)
        pts = []
        for s in np.linspace(0, 1, 6):
            a = ang + bend * s
            pts.append((x + np.cos(a) * length * s, y + np.sin(a) * length * s))
        light = rng.random() < 0.4
        col = (255, 250, 235, int(rng.uniform(40, 90))) if light else (104, 88, 68, int(rng.uniform(22, 55)))
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                draw.line([(px + ox, py + oy) for px, py in pts], fill=col, width=1)
    for _ in range(140):  # specks
        x, y = rng.random(2) * N
        rad = rng.uniform(0.4, 1.2)
        col = (90, 72, 54, int(rng.uniform(40, 110)))
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                draw.ellipse([x + ox - rad, y + oy - rad, x + ox + rad, y + oy + rad], fill=col)
    layer = layer.filter(ImageFilter.GaussianBlur(0.35))
    im = Image.alpha_composite(im.convert('RGBA'), layer).convert('RGB')
    im.save(f'{OUT}/parchment.png', optimize=True)


def deckle_polygon(per_side=26, depth=(1.0, 4.5), seed=31):
    """clip-path polygon with px-deep tears so it reads the same at any panel size."""
    r = np.random.default_rng(seed)
    pts = []
    def j():
        return round(float(r.uniform(*depth)), 1)
    for i in range(per_side):  # top, left to right
        pts.append(f'{100 * i / per_side:.2f}% {j()}px')
    for i in range(per_side):  # right, top to bottom
        pts.append(f'calc(100% - {j()}px) {100 * i / per_side:.2f}%')
    for i in range(per_side):  # bottom, right to left
        pts.append(f'{100 - 100 * i / per_side:.2f}% calc(100% - {j()}px)')
    for i in range(per_side):  # left, bottom to top
        pts.append(f'{j()}px {100 - 100 * i / per_side:.2f}%')
    return 'polygon(' + ', '.join(pts) + ')'


if __name__ == '__main__':
    save_leather()
    save_parchment()
    with open(f'{OUT}/deckle.txt', 'w', encoding='utf-8') as fh:
        fh.write(deckle_polygon())
    # Preview: grain over the mat brown, and two parchment tiles side by side.
    grain = Image.open(f'{OUT}/leather-grain.png')
    mat = Image.new('RGBA', (N * 2, N), (62, 43, 28, 255))
    mat.alpha_composite(grain, (0, 0)); mat.alpha_composite(grain, (N, 0))
    parch = Image.open(f'{OUT}/parchment.png')
    prev = Image.new('RGB', (N * 2, N * 2))
    prev.paste(mat.convert('RGB'), (0, 0)); prev.paste(parch, (0, N)); prev.paste(parch, (N, N))
    prev.save(f'{OUT}/preview.png')
