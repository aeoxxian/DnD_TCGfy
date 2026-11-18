"""v1.2 Phase 3 material tiles (all seamless, 512 px). Usage: python -I materials_v12.py <out_dir>

Overlays (RGBA, laid over the theme's CSS gradient like leather-grain.png):
  felt-grain.png   - non-woven felt: dense short fibres, soft cloudy density, matte (숲의 펠트)
  wood-grain.png   - ebony: fine, mostly straight horizontal grain, faint light streaks, tiny pores (흑단과 은)
  stone-grain.png  - slate/granite: grains, mottling, mineral veins, small weathered pits (아케인 블루)
Full-colour page tiles:
  paper.png        - cleaner cream paper for documents on the felt and ebony boards
  stone-light.png  - pale blue-grey stone for dialogs in 아케인 블루 (dark text stays readable)
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
N = 512


def lowpass_noise(size, cutoff, seed):
    """Periodic noise: white noise filtered in frequency space (tiles seamlessly)."""
    r = np.random.default_rng(seed)
    white = r.standard_normal((size, size))
    fx = np.fft.fftfreq(size)[:, None]
    fy = np.fft.fftfreq(size)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    n = np.real(np.fft.ifft2(np.fft.fft2(white) * np.exp(-(f / cutoff) ** 2)))
    return (n - n.mean()) / (n.std() + 1e-9)


def periodic_blur(a, sigma):
    fx = np.fft.fftfreq(a.shape[0])[:, None]
    fy = np.fft.fftfreq(a.shape[1])[None, :]
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k))


def shade(h, strength):
    """Directional light from the top-left on a periodic height map."""
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    return -(gx * 0.7 + gy * 0.7) * strength


def strokes(seed, count, length, width, light_rgba, dark_rgba, light_share, angle=None, angle_sd=None, blur=0.35):
    """Short strokes drawn with wrap-around so the tile stays seamless. Returns float [-1..1] luminance offset."""
    r = np.random.default_rng(seed)
    light = Image.new('L', (N, N), 0)
    dark = Image.new('L', (N, N), 0)
    dl, dd = ImageDraw.Draw(light), ImageDraw.Draw(dark)
    for _ in range(count):
        x, y = r.random(2) * N
        a = r.uniform(0, np.pi) if angle is None else r.normal(angle, angle_sd)
        ln = r.uniform(*length)
        bend = r.normal(0, 0.35)
        pts = []
        for s in np.linspace(0, 1, 4):
            aa = a + bend * s
            pts.append((x + np.cos(aa) * ln * s, y + np.sin(aa) * ln * s))
        is_light = r.random() < light_share
        target, value = (dl, light_rgba) if is_light else (dd, dark_rgba)
        v = int(r.uniform(*value))
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                target.line([(px + ox, py + oy) for px, py in pts], fill=v, width=width)
    light = np.asarray(light.filter(ImageFilter.GaussianBlur(blur)), dtype=np.float64) / 255
    dark = np.asarray(dark.filter(ImageFilter.GaussianBlur(blur)), dtype=np.float64) / 255
    return light - dark


def overlay(val, dark_rgb, light_rgb, dark_gain, light_gain, name):
    rgba = np.zeros((N, N, 4), dtype=np.uint8)
    neg = val < 0
    for i in range(3):
        rgba[..., i] = np.where(neg, dark_rgb[i], light_rgb[i])
    alpha = np.where(neg, -val * dark_gain, val * light_gain)
    rgba[..., 3] = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(f'{OUT}/{name}', optimize=True)


def felt():
    # Non-woven: thousands of tiny fibres in every direction plus soft cloudy density (no cells, no wrinkles).
    fibres = strokes(41, 22000, (2.5, 8.0), 1, (70, 160), (80, 180), 0.45, blur=0.5)
    cloud = lowpass_noise(N, 0.05, 42) * 0.045 + lowpass_noise(N, 0.012, 43) * 0.035
    fuzz = periodic_blur(np.random.default_rng(44).standard_normal((N, N)), 0.8) * 0.12
    pills = periodic_blur((np.random.default_rng(45).random((N, N)) > 0.998).astype(float), 1.0) * 1.6
    val = fibres * 0.34 + cloud + fuzz + np.clip(pills, 0, 0.25) * 0.4
    overlay(np.clip(val, -0.45, 0.32), (4, 10, 6), (226, 240, 222), 0.80, 0.30, 'felt-grain.png')


def profile(size, parts, seed):
    """1-D periodic band profile: a sum of low-passed noises (irregular band widths, not regular sines)."""
    r = np.random.default_rng(seed)
    f = np.fft.fftfreq(size)
    out = np.zeros(size)
    for cutoff, weight in parts:
        n = np.real(np.fft.ifft(np.fft.fft(r.standard_normal(size)) * np.exp(-(f / cutoff) ** 2)))
        out += (n - n.mean()) / (n.std() + 1e-9) * weight
    return out


def sample_rows(prof, yw):
    """Look the profile up at warped rows, wrapping around (seamless)."""
    size = prof.shape[0]
    y0 = np.floor(yw).astype(int) % size
    t = yw - np.floor(yw)
    return prof[y0] * (1 - t) + prof[(y0 + 1) % size] * t


def wood():
    # Ebony: dense, almost straight grain running left-right with irregular band widths, a few paler streaks
    # and fine pores along the grain. A gentle low-frequency warp keeps it from looking ruled.
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    warp = lowpass_noise(N, 0.0035, 51) * 3.5 + lowpass_noise(N, 0.012, 52) * 0.8
    yw = yy + warp
    bands = sample_rows(profile(N, [(0.02, 0.6), (0.08, 0.5), (0.25, 0.35)], 53), yw)
    fine = sample_rows(profile(N, [(0.45, 1.0)], 57), yw + lowpass_noise(N, 0.03, 58) * 0.6)
    streak = np.clip(sample_rows(profile(N, [(0.05, 1.0)], 54), yw) - 2.1, 0, None) * (0.5 + 0.5 * lowpass_noise(N, 0.006, 59))
    pores = strokes(55, 3200, (4, 12), 1, (0, 0), (110, 210), 0.0, angle=0.0, angle_sd=0.02, blur=0.35)
    h = bands * 0.5 + fine * 0.2
    val = bands * 0.07 + fine * 0.06 + shade(periodic_blur(h, 0.7), 0.9) + np.clip(streak, 0, 1) * 0.30 + pores * 0.32         + lowpass_noise(N, 0.003, 56) * 0.04
    overlay(np.clip(val, -0.5, 0.35), (2, 2, 3), (246, 236, 222), 0.85, 0.32, 'wood-grain.png')


def stone():
    # Slate/granite: fine grains, mottled tone, thin pale mineral veins, weathered pits with a lit lower rim.
    r = np.random.default_rng(61)
    grains = periodic_blur(r.standard_normal((N, N)), 0.42) * 0.24 + periodic_blur(r.standard_normal((N, N)), 1.0) * 0.10
    crystals = periodic_blur((r.random((N, N)) > 0.985).astype(float), 0.35) * 0.9
    mottle = lowpass_noise(N, 0.012, 62) * 0.05 + lowpass_noise(N, 0.035, 63) * 0.035
    vein_noise = lowpass_noise(N, 0.0065, 64)
    veins = np.exp(-(vein_noise / 0.02) ** 2) * (0.6 + 0.4 * lowpass_noise(N, 0.02, 65))
    vein2 = np.exp(-(lowpass_noise(N, 0.012, 66) / 0.015) ** 2) * 0.5
    pits = periodic_blur((r.random((N, N)) > 0.9989).astype(float), 0.7) * 5
    h = grains * 0.5 - np.clip(pits, 0, 1) * 0.9 + mottle * 0.3
    weather = np.clip(lowpass_noise(N, 0.008, 67), 0, None) * 0.05
    val = grains + np.clip(crystals, 0, 0.6) * 0.35 + mottle + shade(periodic_blur(h, 0.5), 1.3) + veins * 0.24 + vein2 * 0.12 - weather - np.clip(pits, 0, 1) * 0.2
    overlay(np.clip(val, -0.5, 0.38), (2, 4, 10), (214, 228, 248), 0.80, 0.34, 'stone-grain.png')


def paper():
    base = np.array([241, 236, 225], dtype=np.float64)
    tint = np.array([226, 218, 202], dtype=np.float64)
    t = np.clip(0.18 + lowpass_noise(N, 0.008, 71) * 0.06 + lowpass_noise(N, 0.05, 72) * 0.03, 0, 1)
    img = base[None, None, :] * (1 - t[..., None]) + tint[None, None, :] * t[..., None]
    img += lowpass_noise(N, 0.4, 73)[..., None] * 2.0
    fib = strokes(74, 900, (4, 14), 1, (30, 70), (14, 34), 0.5, blur=0.3)
    img += fib[..., None] * 18
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB').save(f'{OUT}/paper.png', optimize=True)


def stone_light():
    base = np.array([214, 219, 226], dtype=np.float64)
    shadow = np.array([184, 191, 202], dtype=np.float64)
    t = np.clip(0.30 + lowpass_noise(N, 0.01, 81) * 0.12 + lowpass_noise(N, 0.04, 82) * 0.06, 0, 1)
    img = base[None, None, :] * (1 - t[..., None]) + shadow[None, None, :] * t[..., None]
    r = np.random.default_rng(83)
    img += periodic_blur(r.standard_normal((N, N)), 0.6)[..., None] * 4.0
    veins = np.exp(-(lowpass_noise(N, 0.007, 84) / 0.03) ** 2)
    img += veins[..., None] * np.array([10, 11, 12]) - veins[..., None] * 0
    specks = periodic_blur((r.random((N, N)) > 0.996).astype(float), 0.6) * 3
    img -= np.clip(specks, 0, 1)[..., None] * 40
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB').save(f'{OUT}/stone-light.png', optimize=True)


if __name__ == '__main__':
    felt()
    wood()
    stone()
    paper()
    stone_light()
    # Preview: each overlay over its theme colour, 2x2 tiles, plus the page tiles.
    def tile(overlay_name, rgb):
        g = Image.open(f'{OUT}/{overlay_name}')
        mat = Image.new('RGBA', (N * 2, N), rgb + (255,))
        mat.alpha_composite(g, (0, 0)); mat.alpha_composite(g, (N, 0))
        return mat.convert('RGB')
    prev = Image.new('RGB', (N * 2, N * 5))
    prev.paste(tile('felt-grain.png', (40, 62, 44)), (0, 0))
    prev.paste(tile('wood-grain.png', (38, 32, 30)), (0, N))
    prev.paste(tile('stone-grain.png', (42, 52, 68)), (0, N * 2))
    prev.paste(Image.open(f'{OUT}/paper.png'), (0, N * 3)); prev.paste(Image.open(f'{OUT}/paper.png'), (N, N * 3))
    prev.paste(Image.open(f'{OUT}/stone-light.png'), (0, N * 4)); prev.paste(Image.open(f'{OUT}/stone-light.png'), (N, N * 4))
    prev.save(f'{OUT}/materials-preview.png')
