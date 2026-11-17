"""Metal frame (9-slice), faceted gems, coins, dragon mark and card backs. Usage: python ornaments2.py <out_dir>"""
import math
import sys

OUT = sys.argv[1]

METALS = {
    'gold': ['#eee6d2', '#c3b08a', '#6b5d44', '#9a8a68', '#dacfb2', '#574b34'],
    'silver': ['#f7f8fa', '#c4c8ce', '#5c6169', '#8f959e', '#e1e4e8', '#464a51'],
}

DRAGON = ('M22 94 L25 80 L13 76 L28 71 L17 62 L32 59 L24 49 L38 48 '
          'C40 44 41 41 43 39 C34 34 22 28 8 22 C24 24 38 29 48 34 '
          'C47 30 42 24 32 16 C44 20 52 27 56 33 '
          'C62 32 67 32 71 35 C76 37 84 40 92 43 C95 44 97 46 96 49 '
          'C95 50 93 51 91 51 L88 51 L86 54 L84 51 L81 51 L79 54 L77 51 L70 53 '
          'C73 55 76 56 78 57 L80 55 L82 58 L84 56 L86 59 C86 61 85 63 83 64 '
          'C78 66 72 67 67 68 L55 77 L59 70 C55 72 51 76 49 80 C47 84 46 89 46 94 Z')
EYE = 'M62 40 L71 39.5 L65 43 Z'


def write(name, body, w, h, extra=''):
    with open(f'{OUT}/{name}', 'w', encoding='utf-8') as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"{extra}>{body}</svg>')


def metal_defs(m, gid='m', fid='bevel', scale=3.5):
    c = METALS[m]
    return (f'<linearGradient id="{gid}" x1="0" y1="0" x2="0.35" y2="1">'
            f'<stop offset="0" stop-color="{c[0]}"/><stop offset="0.22" stop-color="{c[1]}"/>'
            f'<stop offset="0.48" stop-color="{c[2]}"/><stop offset="0.54" stop-color="{c[3]}"/>'
            f'<stop offset="0.78" stop-color="{c[4]}"/><stop offset="1" stop-color="{c[5]}"/></linearGradient>'
            f'<filter id="{fid}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">'
            '<feGaussianBlur in="SourceAlpha" stdDeviation="0.9" result="b"/>'
            f'<feSpecularLighting in="b" surfaceScale="{scale}" specularConstant="1.15" specularExponent="22" lighting-color="#ffffff" result="s"><feDistantLight azimuth="225" elevation="38"/></feSpecularLighting>'
            '<feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>'
            '<feComposite in="SourceGraphic" in2="s2" operator="arithmetic" k1="0" k2="1" k3="0.9" k4="0" result="lit"/>'
            '<feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="sb"/><feOffset in="sb" dx="1.2" dy="1.8" result="so"/>'
            '<feFlood flood-color="#000" flood-opacity="0.8"/><feComposite in2="so" operator="in" result="shadow"/>'
            '<feMerge><feMergeNode in="shadow"/><feMergeNode in="lit"/></feMerge></filter>')


def frame(m):
    """240x240 frame, 60px corner slices, edge motif repeats every 40px (120px middle = 3 units)."""
    S = 240
    side = []
    side.append(f'<rect x="2" y="2" width="{S - 4}" height="3.2" />')          # outer rail
    side.append(f'<rect x="10" y="11" width="{S - 20}" height="1.6" />')       # band rails
    side.append(f'<rect x="10" y="30" width="{S - 20}" height="1.6" />')
    side.append(f'<rect x="36" y="37" width="{S - 72}" height="1" />')          # inner hairline
    for u in range(-1, 7):
        cx = 60 + u * 40 + 20
        side.append(f'<path d="M{cx} 14 L{cx + 7.5} 21.4 L{cx} 28.8 L{cx - 7.5} 21.4 Z"/>')
        side.append(f'<path d="M{cx + 7.5} 21.4 C{cx + 11} 15.5 {cx + 15.5} 15.5 {cx + 17} 19.4 C{cx + 18} 22.6 {cx + 14.6} 23.6 {cx + 13.6} 21.2" fill="none" stroke="url(#m)" stroke-width="1.7" stroke-linecap="round"/>')
        side.append(f'<path d="M{cx - 7.5} 21.4 C{cx - 11} 27.3 {cx - 15.5} 27.3 {cx - 17} 23.4 C{cx - 18} 20.2 {cx - 14.6} 19.2 {cx - 13.6} 21.6" fill="none" stroke="url(#m)" stroke-width="1.7" stroke-linecap="round"/>')
        side.append(f'<circle cx="{cx + 20}" cy="21.4" r="1.9"/>')
    side_g = ''.join(side)
    insets = ''.join(
        f'<path d="M{cx} 17.6 L{cx + 3.6} 21.4 L{cx} 25.2 L{cx - 3.6} 21.4 Z" fill="#1a0e0b"/>' for cx in [60 + u * 40 + 20 for u in range(-1, 7)])
    clip = f'<clipPath id="edge"><path d="M60 0 H180 L240 60 V180 L180 240 H60 L0 180 V60 Z M0 0"/></clipPath>'
    sides = ''.join(
        f'<g transform="rotate({r} {S / 2} {S / 2})" clip-path="url(#edgeTop)">{side_g}</g>' for r in (0, 90, 180, 270))
    insets_all = ''.join(
        f'<g transform="rotate({r} {S / 2} {S / 2})" clip-path="url(#edgeTop)">{insets}</g>' for r in (0, 90, 180, 270))
    edge_top = '<clipPath id="edgeTop"><rect x="48" y="0" width="144" height="60"/></clipPath>'

    def corner_shapes():
        p = []
        p.append('<path d="M2 2 H50 V5.2 H5.2 V50 H2 Z"/>')
        p.append('<path d="M10 11 H50 V12.6 H11.6 V50 H10 Z"/><path d="M30 30 H50 V31.6 H31.6 V50 H30 Z"/>')
        p.append('<path d="M36 37 H50 V38 H37 V50 H36 Z"/>')
        p.append('<circle cx="21" cy="21" r="13.5"/>')
        p.append('<path d="M29 31 Q42 33 50 50 Q33 42 31 29 Z"/>')                 # inner leaf
        p.append('<path d="M31 18 C37 14 43 15 46 19 C42 18 38 19 34 22 Z"/>')      # rail curls
        p.append('<path d="M18 31 C14 37 15 43 19 46 C18 42 19 38 22 34 Z"/>')
        p.append('<path d="M9 9 L1 1 L6 9 Z M9 9 L1 1 L9 6 Z"/>')                    # outer thorn
        return ''.join(p)
    cs = corner_shapes()
    corners = ''.join(f'<g transform="rotate({r} {S / 2} {S / 2})">{cs}</g>' for r in (0, 90, 180, 270))
    gems = ''.join(
        f'<g transform="rotate({r} {S / 2} {S / 2})"><circle cx="21" cy="21" r="9.6" fill="#140b08"/><circle cx="21" cy="21" r="7.4" fill="url(#garnet)"/>'
        f'<path d="M17.5 18.2 L19.6 17.2 L18.6 19.4 Z" fill="#fff" opacity="0.85"/></g>' for r in (0, 90, 180, 270))
    defs = (metal_defs(m) + edge_top +
            '<radialGradient id="garnet" cx="38%" cy="34%" r="70%"><stop offset="0" stop-color="#ffb3a6"/><stop offset="0.35" stop-color="#c22a3a"/><stop offset="0.8" stop-color="#5a0a16"/><stop offset="1" stop-color="#2a0409"/></radialGradient>')
    body = (f'<defs>{defs}</defs>'
            f'<g fill="url(#m)" filter="url(#bevel)">{sides}{corners}</g>{insets_all}{gems}')
    write(f'frame-{m}.svg', body, S, S)


def gem(name, cols):
    """Faceted lozenge, 16x16. cols: lightest..darkest (5)."""
    a, b, c, d, e = cols
    o = [(8, 0.6), (15.4, 8), (8, 15.4), (0.6, 8)]
    t = [(8, 4.4), (11.6, 8), (8, 11.6), (4.4, 8)]
    def tri(p1, p2, p3, f):
        return f'<path d="M{p1[0]} {p1[1]} L{p2[0]} {p2[1]} L{p3[0]} {p3[1]} Z" fill="{f}"/>'
    facets = ''.join([
        tri(o[0], t[0], t[3], a), tri(o[0], o[3], t[3], b),
        tri(o[0], t[0], t[1], b), tri(o[0], o[1], t[1], c),
        tri(o[1], t[1], t[2], d), tri(o[1], o[2], t[2], e),
        tri(o[3], t[3], t[2], c), tri(o[3], o[2], t[2], d),
    ])
    body = (f'<defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{a}"/><stop offset="0.55" stop-color="{c}"/><stop offset="1" stop-color="{d}"/></linearGradient></defs>'
            f'<path d="M8 0 L16 8 L8 16 L0 8 Z" fill="{e}"/>{facets}'
            f'<path d="M{t[0][0]} {t[0][1]} L{t[1][0]} {t[1][1]} L{t[2][0]} {t[2][1]} L{t[3][0]} {t[3][1]} Z" fill="url(#t)"/>'
            '<path d="M8 0.6 L15.4 8 L8 15.4 L0.6 8 Z" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="0.8"/>'
            '<path d="M6.1 4.6 L6.7 6.1 L8.2 6.7 L6.7 7.3 L6.1 8.8 L5.5 7.3 L4 6.7 L5.5 6.1 Z" fill="#fff"/>'
            '<path d="M2.4 8 L8 2.4" stroke="#fff" stroke-opacity="0.7" stroke-width="0.6"/>')
    write(name, body, 16, 16)


def socket():
    body = ('<path d="M8 0.8 L15.2 8 L8 15.2 L0.8 8 Z" fill="#6e5236" fill-opacity="0.16"/>'
            '<path d="M0.8 8 L8 0.8 L15.2 8" fill="none" stroke="#3e2a16" stroke-opacity="0.75" stroke-width="1.1"/>'
            '<path d="M15.2 8 L8 15.2 L0.8 8" fill="none" stroke="#fffaf0" stroke-opacity="0.85" stroke-width="1"/>'
            '<path d="M8 4.6 L11.4 8 L8 11.4 L4.6 8 Z" fill="none" stroke="#3e2a16" stroke-opacity="0.25" stroke-width="0.6"/>')
    write('gem-socket.svg', body, 16, 16)


def coin(m):
    c = METALS[m]
    rings = ''.join(f'<circle cx="24" cy="24" r="{r:.1f}" fill="none" stroke="{"#fff" if i % 2 else "#000"}" stroke-opacity="0.07" stroke-width="0.6"/>'
                    for i, r in enumerate([x * 0.9 for x in range(2, 21)]))
    body = (f'<defs><linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c[0]}"/><stop offset="0.35" stop-color="{c[1]}"/><stop offset="0.7" stop-color="{c[2]}"/><stop offset="1" stop-color="{c[5]}"/></linearGradient>'
            f'<linearGradient id="face" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c[3]}"/><stop offset="0.45" stop-color="{c[4]}"/><stop offset="0.6" stop-color="{c[1]}"/><stop offset="1" stop-color="{c[0]}"/></linearGradient>'
            '<radialGradient id="spec" cx="34%" cy="28%" r="45%"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>'
            '<circle cx="24" cy="24" r="23.4" fill="#000" fill-opacity="0.55"/>'
            '<circle cx="24" cy="24" r="22.5" fill="url(#rim)"/>'
            '<circle cx="24" cy="24" r="18.6" fill="url(#face)"/>'
            '<circle cx="24" cy="24" r="18.6" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="0.9"/>'
            '<circle cx="24.4" cy="24.4" r="19.4" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="0.6"/>'
            f'{rings}<ellipse cx="17" cy="14" rx="9" ry="5.5" fill="url(#spec)" transform="rotate(-35 17 14)"/>')
    write(f'coin-{m}.svg', body, 48, 48)


def dragon_back():
    w, h = 240, 350
    body = ('<defs><radialGradient id="bg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#3a1714"/><stop offset="0.7" stop-color="#1f0c0a"/><stop offset="1" stop-color="#0c0504"/></radialGradient>'
            + metal_defs('gold', 'm', 'bevel', 2.5) + '</defs>'
            f'<rect width="{w}" height="{h}" rx="12" fill="url(#bg)"/>'
            f'<g fill="none" stroke="url(#m)" filter="url(#bevel)"><rect x="9" y="9" width="{w - 18}" height="{h - 18}" rx="7" stroke-width="2.2"/><rect x="16" y="16" width="{w - 32}" height="{h - 32}" rx="4" stroke-width="0.9"/>'
            f'<circle cx="{w / 2}" cy="{h / 2}" r="62" stroke-width="2"/><circle cx="{w / 2}" cy="{h / 2}" r="54" stroke-width="0.8"/></g>'
            f'<g transform="translate({w / 2 - 46} {h / 2 - 48}) scale(0.92)" filter="url(#bevel)"><path d="{DRAGON}" fill="url(#m)"/><path d="{EYE}" fill="#3a1714"/></g>')
    write('card-back-dragon.svg', body, w, h)


def stars_back():
    w, h = 240, 350
    import random
    random.seed(9)
    dots = ''.join(f'<circle cx="{random.uniform(20, w - 20):.1f}" cy="{random.uniform(20, h - 20):.1f}" r="{random.uniform(0.5, 1.3):.1f}" fill="#e8ecff" opacity="{random.uniform(0.3, 0.9):.2f}"/>' for _ in range(90))
    cons = [(62, 92), (92, 76), (120, 98), (152, 84), (178, 112), (150, 140)]
    cons2 = [(70, 250), (96, 232), (128, 258), (160, 240), (182, 268)]
    lines = ''.join(f'<path d="M' + ' L'.join(f'{x} {y}' for x, y in c) + '" fill="none" stroke="#c4c8ce" stroke-width="0.7" opacity="0.7"/>' + ''.join(f'<circle cx="{x}" cy="{y}" r="2.2" fill="#f7f8fa"/>' for x, y in c) for c in (cons, cons2))
    body = ('<defs><radialGradient id="bg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#1d2740"/><stop offset="0.7" stop-color="#0f1526"/><stop offset="1" stop-color="#070a13"/></radialGradient>'
            + metal_defs('silver', 'm', 'bevel', 2.5) + '</defs>'
            f'<rect width="{w}" height="{h}" rx="12" fill="url(#bg)"/>{dots}{lines}'
            f'<g fill="none" stroke="url(#m)" filter="url(#bevel)"><rect x="9" y="9" width="{w - 18}" height="{h - 18}" rx="7" stroke-width="2.2"/><rect x="16" y="16" width="{w - 32}" height="{h - 32}" rx="4" stroke-width="0.9"/>'
            f'<circle cx="{w / 2}" cy="{h / 2}" r="30" stroke-width="1.6"/><path d="M{w / 2} {h / 2 - 44} L{w / 2 + 10} {h / 2} L{w / 2} {h / 2 + 44} L{w / 2 - 10} {h / 2} Z M{w / 2 - 44} {h / 2} L{w / 2} {h / 2 - 10} L{w / 2 + 44} {h / 2} L{w / 2} {h / 2 + 10} Z" stroke-width="1.2"/></g>')
    write('card-back-stars.svg', body, w, h)


def dragon_mark(m):
    """Brand mark: a small card with a dragon stamped on it."""
    c = METALS[m]
    body = ('<defs>' + metal_defs(m, 'm', 'bevel', 2) +
            '<linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1612"/><stop offset="1" stop-color="#120807"/></linearGradient></defs>'
            '<g transform="rotate(-8 22 24)">'
            '<rect x="8" y="4" width="28" height="40" rx="3.5" fill="url(#face)"/>'
            '<rect x="8" y="4" width="28" height="40" rx="3.5" fill="none" stroke="url(#m)" stroke-width="2" filter="url(#bevel)"/>'
            '<rect x="11.5" y="7.5" width="21" height="33" rx="1.8" fill="none" stroke="url(#m)" stroke-width="0.6" opacity="0.8"/>'
            f'<g transform="translate(9.5 10) scale(0.25)" filter="url(#bevel)"><path d="{DRAGON}" fill="url(#m)"/></g></g>')
    write(f'dragon-mark-{m}.svg', body, 44, 48)


if __name__ == '__main__':
    for m in METALS:
        frame(m); coin(m); dragon_mark(m)
    gem('gem-sapphire.svg', ['#f2f5ff', '#a9bbff', '#5b78ff', '#2a3bc0', '#0e1458'])
    gem('gem-amber.svg', ['#fff7d6', '#ffd56a', '#f39a1c', '#b25a08', '#4f2402'])
    socket(); dragon_back(); stars_back()


# --- v3: corner-only frame and a front-facing dragon ---------------------------------

def frame_corners(m):
    """240x240, 60-unit corner slices. Edges carry only two plain rails; ornament lives in the corners."""
    S = 240
    rails = (f'<rect x="2" y="2" width="{S - 4}" height="3"/>'
             f'<rect x="9" y="9" width="{S - 18}" height="1.2"/>')
    side = ''.join(f'<g transform="rotate({r} {S / 2} {S / 2})">{rails}</g>' for r in (0, 90, 180, 270))
    corner = (
        '<path d="M14 17 C22 9.5 35 9.5 43 15 C49 19.5 46.5 27 40.5 26 C36 25.2 36 19.6 40.4 19.8" fill="none" stroke="url(#m)" stroke-width="2.4" stroke-linecap="round"/>'
        '<path d="M17 14 C9.5 22 9.5 35 15 43 C19.5 49 27 46.5 26 40.5 C25.2 36 19.6 36 19.8 40.4" fill="none" stroke="url(#m)" stroke-width="2.4" stroke-linecap="round"/>'
        '<path d="M45 13 C50 9.5 55 10 58 13.5" fill="none" stroke="url(#m)" stroke-width="1.5" stroke-linecap="round"/>'
        '<path d="M13 45 C9.5 50 10 55 13.5 58" fill="none" stroke="url(#m)" stroke-width="1.5" stroke-linecap="round"/>'
        '<path d="M17.5 17.5 Q29 21 33.5 33.5 Q21 29 17.5 17.5 Z"/>'
        '<path d="M22 13 Q27 15.5 26 20 Q23 16.5 19 16.8 Z"/><path d="M13 22 Q15.5 27 20 26 Q16.5 23 16.8 19 Z"/>'
        '<circle cx="12.5" cy="9.2" r="2.7"/><circle cx="9.2" cy="12.5" r="2.7"/><circle cx="15.2" cy="15.2" r="2.7"/><circle cx="12.2" cy="12.2" r="2.2"/>'
        '<path d="M3 3 L9 6.5 L6.5 9 Z"/>'
    )
    corners = ''.join(f'<g transform="rotate({r} {S / 2} {S / 2})">{corner}</g>' for r in (0, 90, 180, 270))
    body = f'<defs>{metal_defs(m)}</defs><g fill="url(#m)" filter="url(#bevel)">{side}{corners}</g>'
    write(f'frame-corners-{m}.svg', body, S, S)


def mirror(points):
    return points + [(100 - x, y) for x, y in reversed(points)]


def front_dragon():
    """Symmetric dragon head seen from the front (100x100)."""
    right = [(50, 13), (54, 25), (60, 27), (66, 24), (75, 16), (86, 11), (96, 10), (88, 17), (78, 25), (70, 32),
             (79, 33), (93, 31), (81, 39), (90, 46), (77, 47), (87, 56), (73, 57), (70, 65), (67, 71), (66.5, 81), (62.5, 72),
             (60, 77), (58.5, 86), (61.5, 90), (56, 95.5), (50, 97)]
    pts = mirror(right)
    d = 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts) + ' Z'
    eye = 'M55 45 L69 39 L64.5 48 Z'
    eyes = eye + ' ' + 'M45 45 L31 39 L35.5 48 Z'
    nostrils = 'M54 88 L58 85 L57 89.5 Z M46 88 L42 85 L43 89.5 Z'
    return d, eyes, nostrils


def dragon_mark_front(m):
    d, eyes, nostrils = front_dragon()
    body = ('<defs>' + metal_defs(m, 'm', 'bevel', 2) +
            '<linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1612"/><stop offset="1" stop-color="#120807"/></linearGradient></defs>'
            '<g transform="rotate(-8 22 24)">'
            '<rect x="8" y="4" width="28" height="40" rx="3.5" fill="url(#face)"/>'
            '<rect x="8" y="4" width="28" height="40" rx="3.5" fill="none" stroke="url(#m)" stroke-width="2" filter="url(#bevel)"/>'
            '<rect x="11.5" y="7.5" width="21" height="33" rx="1.8" fill="none" stroke="url(#m)" stroke-width="0.6" opacity="0.8"/>'
            f'<g transform="translate(9.6 10.6) scale(0.248)"><g filter="url(#bevel)"><path d="{d}" fill="url(#m)"/></g>'
            f'<path d="{eyes}" fill="#1a0c08"/><path d="{nostrils}" fill="#1a0c08"/>'
            '<path d="M50 52 L50 80" stroke="#1a0c08" stroke-opacity="0.55" stroke-width="1.6"/></g></g>')
    write(f'dragon-front-{m}.svg', body, 44, 48)
    big = ('<defs>' + metal_defs(m, 'm', 'bevel', 3) + '</defs>'
           f'<g filter="url(#bevel)"><path d="{d}" fill="url(#m)"/></g><path d="{eyes}" fill="#1a0c08"/><path d="{nostrils}" fill="#1a0c08"/>'
           '<path d="M50 52 L50 80" stroke="#1a0c08" stroke-opacity="0.55" stroke-width="1.6"/>')
    write(f'dragon-front-big-{m}.svg', f'<rect width="100" height="100" fill="#1c110e"/>{big}', 100, 100)


if __name__ == '__main__':
    for m in METALS:
        frame_corners(m); dragon_mark_front(m)
