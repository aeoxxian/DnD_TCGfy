"""Turn the supplied black-on-white dragon into lit metal emblems, logo cards and a card back.

Usage: python emblem.py <source_image> <out_dir>
"""
import base64
import io
import sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
METALS = {
    'gold': [(0, '#f3ecda'), (0.22, '#c3b08a'), (0.48, '#6b5d44'), (0.54, '#9a8a68'), (0.78, '#dacfb2'), (1, '#574b34')],
    'silver': [(0, '#f7f8fa'), (0.22, '#c4c8ce'), (0.48, '#5c6169'), (0.54, '#8f959e'), (0.78, '#e1e4e8'), (1, '#464a51')],
}
BORDER = {'gold': ['#eee6d2', '#c3b08a', '#6b5d44', '#9a8a68', '#dacfb2', '#574b34'],
          'silver': ['#f7f8fa', '#c4c8ce', '#5c6169', '#8f959e', '#e1e4e8', '#464a51']}


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64)


def gradient(stops, n):
    t = np.linspace(0, 1, n)
    out = np.zeros((n, 3))
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        m = (t >= t0) & (t <= t1)
        f = ((t[m] - t0) / (t1 - t0))[:, None]
        out[m] = hexrgb(c0) * (1 - f) + hexrgb(c1) * f
    return out


def blur(a, s):
    fx = np.fft.fftfreq(a.shape[0])[:, None]; fy = np.fft.fftfreq(a.shape[1])[None, :]
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * (np.pi * s) ** 2 * (fx * fx + fy * fy))))


def alpha_mask():
    g = np.asarray(Image.open(SRC).convert('L'), dtype=np.float64)
    a = np.clip((215 - g) / 170, 0, 1)
    ys, xs = np.where(a > 0.1)
    pad = 16
    a = a[max(ys.min() - pad, 0):ys.max() + pad, max(xs.min() - pad, 0):xs.max() + pad]
    # pad to avoid FFT wrap-around artefacts in the blur
    return np.pad(a, 24)


def metal_emblem(a, metal):
    h = blur(a, 2.6)
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    k = 9.0
    nx, ny, nz = -gx * k, -gy * k, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz); nx, ny, nz = nx / ln, ny / ln, nz / ln
    L = np.array([-0.55, -0.6, 0.58]); L /= np.linalg.norm(L)
    H = L + np.array([0, 0, 1.0]); H /= np.linalg.norm(H)
    diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    spec = np.clip(nx * H[0] + ny * H[1] + nz * H[2], 0, 1) ** 36
    grad = gradient(METALS[metal], a.shape[0])[:, None, :]
    col = grad * (0.42 + 0.78 * diff[..., None]) + 235 * spec[..., None] * 0.85
    rgba = np.dstack([np.clip(col, 0, 255), a * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    w = 600
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def b64(im):
    buf = io.BytesIO(); im.save(buf, 'PNG'); return base64.b64encode(buf.getvalue()).decode()


def metal_svg_defs(c):
    return (f'<linearGradient id="m" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="{c[0]}"/><stop offset="0.22" stop-color="{c[1]}"/>'
            f'<stop offset="0.48" stop-color="{c[2]}"/><stop offset="0.54" stop-color="{c[3]}"/><stop offset="0.78" stop-color="{c[4]}"/><stop offset="1" stop-color="{c[5]}"/></linearGradient>'
            '<filter id="bevel" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">'
            '<feGaussianBlur in="SourceAlpha" stdDeviation="0.9" result="b"/>'
            '<feSpecularLighting in="b" surfaceScale="2.2" specularConstant="1.1" specularExponent="22" lighting-color="#fff" result="s"><feDistantLight azimuth="225" elevation="40"/></feSpecularLighting>'
            '<feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>'
            '<feComposite in="SourceGraphic" in2="s2" operator="arithmetic" k1="0" k2="1" k3="0.85" k4="0" result="lit"/>'
            '<feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="sb"/><feOffset in="sb" dx="1" dy="1.5" result="so"/>'
            '<feFlood flood-color="#000" flood-opacity="0.75"/><feComposite in2="so" operator="in" result="shadow"/>'
            '<feMerge><feMergeNode in="shadow"/><feMergeNode in="lit"/></feMerge></filter>'
            '<filter id="drop" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="0.8"/><feOffset dx="0.6" dy="1" result="o"/>'
            '<feFlood flood-color="#000" flood-opacity="0.8"/><feComposite in2="o" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>')


def save_svg(name, body, w, h):
    with open(f'{OUT}/{name}', 'w', encoding='utf-8') as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>')


def logo_card(metal, emb):
    ew, eh = 24.5, 24.5 * emb.height / emb.width
    body = ('<defs>' + metal_svg_defs(BORDER[metal]) +
            '<linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#241614"/><stop offset="1" stop-color="#0e0807"/></linearGradient></defs>'
            '<g transform="rotate(-8 22 24)">'
            '<rect x="8" y="4" width="28" height="40" rx="3.5" fill="url(#face)"/>'
            '<rect x="8" y="4" width="28" height="40" rx="3.5" fill="none" stroke="url(#m)" stroke-width="2" filter="url(#bevel)"/>'
            f'<image x="{22 - ew / 2:.2f}" y="{24 - eh / 2:.2f}" width="{ew:.2f}" height="{eh:.2f}" href="data:image/png;base64,{b64(emb)}" filter="url(#drop)"/></g>')
    save_svg(f'logo-{metal}.svg', body, 44, 48)


def card_back(metal, emb):
    w, h = 240, 350
    ew = 150; eh = ew * emb.height / emb.width
    body = ('<defs><radialGradient id="bg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#33201c"/><stop offset="0.7" stop-color="#1d110e"/><stop offset="1" stop-color="#0b0605"/></radialGradient>'
            + metal_svg_defs(BORDER[metal]) + '</defs>'
            f'<rect width="{w}" height="{h}" rx="12" fill="url(#bg)"/>'
            f'<g fill="none" stroke="url(#m)" filter="url(#bevel)"><rect x="9" y="9" width="{w - 18}" height="{h - 18}" rx="7" stroke-width="2.2"/><rect x="16" y="16" width="{w - 32}" height="{h - 32}" rx="4" stroke-width="0.9"/></g>'
            f'<image x="{w / 2 - ew / 2:.1f}" y="{h / 2 - eh / 2:.1f}" width="{ew}" height="{eh:.1f}" href="data:image/png;base64,{b64(emb)}" filter="url(#drop)"/>')
    save_svg(f'card-back-emblem-{metal}.svg', body, w, h)


if __name__ == '__main__':
    a = alpha_mask()
    for metal in ('gold', 'silver'):
        emb = metal_emblem(a, metal)
        emb.save(f'{OUT}/emblem-{metal}.png', optimize=True)
        logo_card(metal, emb)
    card_back('gold', metal_emblem(a, 'gold'))
