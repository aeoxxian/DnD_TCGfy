"""Write the play-mat SVG ornaments. Usage: python ornaments.py <out_dir>"""
import math
import random
import sys

OUT = sys.argv[1]
GOLD = '#c8a464'


def write(name, body, w, h):
    with open(f'{OUT}/{name}', 'w', encoding='utf-8') as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>')


def corner():
    # Gold-tooled scrollwork for the top-left corner; rotate it for the others.
    tool = (
        '<path d="M6 92 V30 C6 16 16 6 30 6 H92" />'
        '<path d="M12 92 V34 C12 22 22 12 34 12 H92" stroke-width="0.8"/>'
        '<path d="M18 52 C18 34 30 22 46 20 C56 19 62 26 58 33 C55 38 47 37 47 31 C47 27 52 26 53 29" />'
        '<path d="M52 18 C34 18 22 30 20 46 C19 56 26 62 33 58 C38 55 37 47 31 47 C27 47 26 52 29 53" />'
        '<path d="M58 33 C64 40 72 42 80 40" stroke-width="0.9"/>'
        '<path d="M33 58 C40 64 42 72 40 80" stroke-width="0.9"/>'
        '<path d="M66 37 C70 32 76 32 79 36 C74 37 70 38 66 37 Z" fill="currentColor" stroke="none"/>'
        '<path d="M37 66 C32 70 32 76 36 79 C37 74 38 70 37 66 Z" fill="currentColor" stroke="none"/>'
    )
    gem = '<path d="M22 14 L30 22 L22 30 L14 22 Z" fill="currentColor" stroke="none"/>'
    body = (
        f'<g fill="none" stroke="#1a0f06" stroke-width="1.6" stroke-linecap="round" transform="translate(0.8 1)" opacity="0.7" color="#1a0f06">{tool}{gem}</g>'
        f'<g fill="none" stroke="{GOLD}" stroke-width="1.4" stroke-linecap="round" color="{GOLD}">{tool}{gem}</g>'
    )
    write('corner.svg', body, 96, 96)


def emblem(cx, cy, s, stroke, fill_op):
    pts = lambda r: f'M{cx} {cy - r} L{cx + r} {cy} L{cx} {cy + r} L{cx - r} {cy} Z'
    rays = ''.join(
        f'<line x1="{cx + math.cos(a) * s * 1.18:.1f}" y1="{cy + math.sin(a) * s * 1.18:.1f}" x2="{cx + math.cos(a) * s * 1.42:.1f}" y2="{cy + math.sin(a) * s * 1.42:.1f}"/>'
        for a in [i * math.pi / 8 for i in range(16)])
    return (f'<g fill="none" stroke="{stroke}" stroke-width="1.4">'
            f'<circle cx="{cx}" cy="{cy}" r="{s * 1.1}"/><circle cx="{cx}" cy="{cy}" r="{s * 0.98}" stroke-width="0.6"/>'
            f'<path d="{pts(s * 0.9)}"/><path d="{pts(s * 0.5)}" fill="{stroke}" fill-opacity="{fill_op}"/>{rays}</g>')


def card_back():
    w, h = 240, 350
    body = (
        '<defs><radialGradient id="cb" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#5e2c1b"/><stop offset="0.7" stop-color="#3a1a0f"/><stop offset="1" stop-color="#241009"/></radialGradient>'
        '<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.35 0"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs>'
        f'<rect width="{w}" height="{h}" rx="12" fill="url(#cb)"/>'
        f'<rect width="{w}" height="{h}" rx="12" fill="#000" filter="url(#g)"/>'
        f'<rect x="9" y="9" width="{w - 18}" height="{h - 18}" rx="7" fill="none" stroke="{GOLD}" stroke-width="1.6"/>'
        f'<rect x="15" y="15" width="{w - 30}" height="{h - 30}" rx="4" fill="none" stroke="{GOLD}" stroke-width="0.6" opacity="0.8"/>'
        + ''.join(f'<path d="M{x} {y - 6} L{x + 6} {y} L{x} {y + 6} L{x - 6} {y} Z" fill="{GOLD}"/>' for x, y in [(15, 15), (w - 15, 15), (15, h - 15), (w - 15, h - 15)])
        + f'<line x1="40" y1="{h / 2}" x2="64" y2="{h / 2}" stroke="{GOLD}" stroke-width="0.8"/><line x1="{w - 64}" y1="{h / 2}" x2="{w - 40}" y2="{h / 2}" stroke="{GOLD}" stroke-width="0.8"/>'
        + emblem(w / 2, h / 2, 46, GOLD, 0.35)
    )
    write('card-back.svg', body, w, h)


def wax_seal():
    random.seed(4)
    cx = cy = 60
    pts = []
    n = 40
    for i in range(n):
        a = i * 2 * math.pi / n
        r = 50 + random.uniform(-2.6, 2.6) + (5 if i in (7, 8, 23, 31) else 0)
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    d = f'M{(pts[0][0] + pts[-1][0]) / 2:.1f} {(pts[0][1] + pts[-1][1]) / 2:.1f} '
    for i, p in enumerate(pts):
        q = pts[(i + 1) % n]
        d += f'Q{p[0]:.1f} {p[1]:.1f} {(p[0] + q[0]) / 2:.1f} {(p[1] + q[1]) / 2:.1f} '
    body = (
        '<defs><radialGradient id="w" cx="42%" cy="36%" r="70%"><stop offset="0" stop-color="#c2493a"/><stop offset="0.55" stop-color="#8e2a1d"/><stop offset="1" stop-color="#5e170f"/></radialGradient>'
        '<radialGradient id="p" cx="50%" cy="50%" r="50%"><stop offset="0.75" stop-color="#7a2216"/><stop offset="1" stop-color="#9c3324"/></radialGradient></defs>'
        f'<path d="{d}Z" fill="url(#w)"/>'
        f'<circle cx="{cx}" cy="{cy}" r="39" fill="url(#p)"/>'
        f'<circle cx="{cx}" cy="{cy}" r="39" fill="none" stroke="#4a110a" stroke-width="2.4" opacity="0.8"/>'
        f'<circle cx="{cx - 0.8}" cy="{cy - 0.8}" r="40.6" fill="none" stroke="#f0a08c" stroke-width="0.9" opacity="0.45"/>'
        f'<circle cx="{cx}" cy="{cy}" r="33" fill="none" stroke="#5a140c" stroke-width="0.8" stroke-dasharray="1.5 3" opacity="0.8"/>'
        '<ellipse cx="44" cy="30" rx="14" ry="6" fill="#fff" opacity="0.12" transform="rotate(-25 44 30)"/>'
    )
    write('wax-seal.svg', body, 120, 120)


def arcane_circle():
    c = 300
    g = []
    for r, w in [(292, 1.6), (282, 0.8), (236, 1.2), (150, 1.2), (140, 0.6), (60, 1)]:
        g.append(f'<circle cx="{c}" cy="{c}" r="{r}" stroke-width="{w}"/>')
    for i in range(72):
        a = i * math.pi / 36
        r1 = 270 if i % 6 else 252
        g.append(f'<line x1="{c + math.cos(a) * r1:.1f}" y1="{c + math.sin(a) * r1:.1f}" x2="{c + math.cos(a) * 282:.1f}" y2="{c + math.sin(a) * 282:.1f}" stroke-width="{1.2 if i % 6 == 0 else 0.7}"/>')
    star = [(c + math.cos(-math.pi / 2 + k * 2 * math.pi / 12) * 236, c + math.sin(-math.pi / 2 + k * 2 * math.pi / 12) * 236) for k in range(12)]
    order = [(k * 5) % 12 for k in range(12)]
    g.append('<path d="M' + ' L'.join(f'{star[k][0]:.1f} {star[k][1]:.1f}' for k in order) + ' Z" stroke-width="0.9"/>')
    for k in range(0, 12, 2):
        x, y = star[k]
        g.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="11" stroke-width="1"/><path d="M{x:.1f} {y - 6:.1f} L{x + 6:.1f} {y:.1f} L{x:.1f} {y + 6:.1f} L{x - 6:.1f} {y:.1f} Z" stroke-width="0.8"/>')
    hexa = [(c + math.cos(k * math.pi / 3) * 150, c + math.sin(k * math.pi / 3) * 150) for k in range(6)]
    g.append('<path d="M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in hexa) + ' Z" stroke-width="0.8"/>')
    for i in range(24):  # rune-like notches on the inner band
        a = i * math.pi / 12 + math.pi / 24
        x, y = c + math.cos(a) * 145, c + math.sin(a) * 145
        g.append(f'<path d="M{x:.1f} {y:.1f} l{math.cos(a + 2.4) * 4:.1f} {math.sin(a + 2.4) * 4:.1f} M{x:.1f} {y:.1f} l{math.cos(a - 2.4) * 4:.1f} {math.sin(a - 2.4) * 4:.1f}" stroke-width="0.8"/>')
    shapes = ''.join(g)
    body = (f'<g fill="none" stroke="#f3d9a6" opacity="0.22" transform="translate(1.2 1.4)">{shapes}</g>'
            f'<g fill="none" stroke="#0c0703" opacity="0.6">{shapes}</g>')
    write('arcane-circle.svg', body, 600, 600)


if __name__ == '__main__':
    corner(); card_back(); wax_seal(); arcane_circle()
