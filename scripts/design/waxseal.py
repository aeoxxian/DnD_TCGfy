"""Physically-shaded wax seal from a height map. Usage: python waxseal.py <out_png>"""
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1]
N = 512
c = N / 2
rng = np.random.default_rng(12)
yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
dx, dy = xx - c, yy - c
r = np.hypot(dx, dy)
th = np.arctan2(dy, dx)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def angular_noise(k, amp, seed):
    g = np.random.default_rng(seed)
    out = np.zeros_like(th)
    for f in range(2, k):
        out += g.normal(0, 1) / f ** 1.3 * np.cos(f * th + g.uniform(0, 2 * np.pi))
    return out * amp


def blur(a, s):
    fx = np.fft.fftfreq(N)[:, None]; fy = np.fft.fftfreq(N)[None, :]
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * (np.pi * s) ** 2 * (fx * fx + fy * fy))))


# Outline: a puddle of wax with irregular lobes where it spread.
R = 196 + angular_noise(18, 9, 3)
for ang, size, width in [(0.7, 16, 0.22), (2.4, 11, 0.18), (3.9, 18, 0.25), (5.3, 9, 0.15)]:
    d = np.angle(np.exp(1j * (th - ang)))
    R = R + size * np.exp(-(d / width) ** 2)
edge = R - r

# Body: thick rounded rim falling to the table, plus the stamped impression.
h = smooth(0, 34, edge) ** 0.7 * 1.0
Ri = 132
press = smooth(Ri + 3, Ri - 6, r)                         # 1 inside the stamp
h -= press * 0.42
h += np.exp(-((r - (Ri + 9)) / 8.5) ** 2) * 0.16          # wax pushed up around the stamp
h += np.exp(-((r - (Ri - 14)) / 2.2) ** 2) * 0.05 * press # stamp's raised inner ring
beads = (np.cos(th * 36) > 0.55) * np.exp(-((r - (Ri - 25)) / 3.2) ** 2) * 0.06
h += beads * press
h += np.exp(-((r - (Ri - 33)) / 1.6) ** 2) * -0.03 * press  # fine groove
# Surface life: slow ripples, a few dents and bubbles.
h += blur(rng.standard_normal((N, N)), 11) * 0.55 * smooth(0, 30, edge) * (1 - press * 0.85)
for _ in range(14):
    bx, by = rng.uniform(80, N - 80, 2)
    br = rng.uniform(2, 5)
    h -= np.exp(-(((xx - bx) ** 2 + (yy - by) ** 2) / (br * br))) * 0.04
h = blur(h, 0.8)

# Shading.
gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
k = 26.0
nx, ny, nz = -gx * k, -gy * k, np.ones_like(h)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
nx, ny, nz = nx / ln, ny / ln, nz / ln
L = np.array([-0.55, -0.62, 0.56]); L /= np.linalg.norm(L)
H = L + np.array([0, 0, 1.0]); H /= np.linalg.norm(H)
diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
spec = np.clip(nx * H[0] + ny * H[1] + nz * H[2], 0, 1) ** 70
sheen = np.clip(nx * H[0] + ny * H[1] + nz * H[2], 0, 1) ** 12

base = np.array([112, 38, 33], dtype=np.float64)        # low-saturation oxblood wax
deep = np.array([58, 16, 14], dtype=np.float64)
thin = smooth(14, 0, edge)                               # translucent near the edge
ao = 1 - 0.35 * smooth(0.0, 0.25, -np.minimum(h - blur(h, 6), 0))
col = deep[None, None, :] + (base - deep)[None, None, :] * (0.25 + 0.95 * diff[..., None])
col *= ao[..., None]
col += np.array([150, 60, 50])[None, None, :] * (thin * 0.22)[..., None]
col += (np.array([255, 232, 222]) * 0.75)[None, None, :] * spec[..., None]
col += (np.array([255, 220, 210]) * 0.08)[None, None, :] * sheen[..., None]
alpha = smooth(-1.2, 1.2, edge)
img = np.dstack([np.clip(col, 0, 255), alpha * 255]).astype(np.uint8)
Image.fromarray(img, 'RGBA').resize((384, 384), Image.LANCZOS).save(OUT, optimize=True)
