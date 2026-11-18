// v1.2 Phase 3: per-theme frame ornaments, drawn as SVG and rasterised with sharp at 2×.
// Usage: node scripts/design/frames_v12.mjs <out_dir>
//
// Board frames (240-unit 9-slice → 480 px, 60-unit corners; CSS: border-image: url() 120 / 64px round):
//   frame-arcane.png  carved stone lip, glowing engraved groove, geometric sigil in a raised corner block (no metal)
//   frame-felt.png    darker felt binding with a running stitch, matte bronze oak-leaf corners held by tacks
//   frame-ebony.png   polished silver hairlines inlaid flush in the wood, fine filigree corners with an onyx dot
//   frame-oxblood.png leather binding with saddle stitching, heavy hammered L corner guards with domed rivets
// Panel corners for the ledger and the card page (160-unit 9-slice → 320 px, 40-unit corners):
//   panel-<theme>.png
// The edges only hold lines and periodic details (period divides the 120/80-unit edge), so `round` tiles them
// seamlessly; the band's material is the board's own textured background, never a stretched texture.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const OUT = resolve(process.argv[2] ?? 'src/assets/playmat');
await mkdir(OUT, { recursive: true });

const f = n => Number(n.toFixed(2));
const rot = (deg, size, body) => `<g transform="rotate(${deg} ${size / 2} ${size / 2})">${body}</g>`;
const four = (size, body) => [0, 90, 180, 270].map(d => rot(d, size, body)).join('');
/** Top edge pieces repeated for all four sides (each rotated about the centre). */
const sides = four;

// ── Shared filters ──────────────────────────────────────────────────────────────────────────────
/** Carved-stone relief: only the lit/shadowed bevel of the shape, as white/black alpha over the board's stone. */
function reliefFilter(id, { blur = 1.6, scale = 3, light = 0.42, dark = 0.55, elevation = 42 } = {}) {
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="-20" y="-20" width="280" height="280" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="${blur}" result="h"/>
    <feDiffuseLighting in="h" surfaceScale="${scale}" diffuseConstant="1" lighting-color="#fff" result="d"><feDistantLight azimuth="225" elevation="${elevation}"/></feDiffuseLighting>
    <feColorMatrix in="d" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${2 * light} 0 0 0 ${-light * 1.4}" result="hi"/>
    <feColorMatrix in="d" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${-2 * dark} 0 0 0 ${dark * 1.2}" result="lo"/>
    <feMerge result="m"><feMergeNode in="lo"/><feMergeNode in="hi"/></feMerge>
    <feComposite in="m" in2="SourceAlpha" operator="in"/>
  </filter>`;
}
/** Metal with diffuse + specular light. `wear` adds a noise height (hammered / worn), `matte` lowers the shine. */
function metalFilter(id, { bevel = 0.9, scale = 3.2, spec = 1.1, exp = 20, mix = 0.9, mul = 1.15, base = 0.15, noise, shadow = { blur: 1.3, dx: 1, dy: 1.6, op: 0.75 } } = {}) {
  const height = noise ? 'hn' : 'b';
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="-20" y="-20" width="280" height="280" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="${bevel}" result="b"/>
    ${noise ? `<feTurbulence type="${noise.type ?? 'fractalNoise'}" baseFrequency="${noise.freq}" numOctaves="${noise.octaves ?? 2}" seed="${noise.seed ?? 3}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${noise.amp} 0 0 0 0" result="na"/>
    <feComposite in="na" in2="b" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="hn"/>` : ''}
    <feDiffuseLighting in="${height}" surfaceScale="${scale}" diffuseConstant="1" lighting-color="#fff" result="d"><feDistantLight azimuth="225" elevation="48"/></feDiffuseLighting>
    <feSpecularLighting in="${height}" surfaceScale="${scale}" specularConstant="${spec}" specularExponent="${exp}" lighting-color="#fff" result="s"><feDistantLight azimuth="225" elevation="36"/></feSpecularLighting>
    <feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>
    <feComposite in="SourceGraphic" in2="d" operator="arithmetic" k1="${mul}" k2="${base}" k3="0" k4="0" result="l0"/>
    <feComposite in="l0" in2="s2" operator="arithmetic" k1="0" k2="1" k3="${mix}" k4="0" result="l1"/>
    <feComposite in="l1" in2="SourceAlpha" operator="in" result="lit"/>
    <feGaussianBlur in="SourceAlpha" stdDeviation="${shadow.blur}" result="sb"/><feOffset in="sb" dx="${shadow.dx}" dy="${shadow.dy}" result="so"/>
    <feFlood flood-color="#000" flood-opacity="${shadow.op}"/><feComposite in2="so" operator="in" result="sh"/>
    <feMerge><feMergeNode in="sh"/><feMergeNode in="lit"/></feMerge>
  </filter>`;
}
const glowFilter = (id, blur = 1.5, strength = 0.85) => `<filter id="${id}" filterUnits="userSpaceOnUse" x="-20" y="-20" width="280" height="280" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="g"/><feComponentTransfer in="g" result="g2"><feFuncA type="linear" slope="${strength}"/></feComponentTransfer>
  <feMerge><feMergeNode in="g2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
const metalGradient = (id, stops, x2 = 0.35) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
/** For straight strokes (a horizontal line has a zero-height bounding box): a gradient in user space across a band. */
const lineGradient = (id, stops, y1, y2) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${y1}" x2="0" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;

/** An engraved groove: dark recess with a lit lower lip and a shadowed upper lip, optional glow inside. */
function groove(d, { width = 2.2, glow = null, recess = '#05080e', lip = '#93a3c4', lipOpacity = 0.5 } = {}) {
  return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${d}" stroke="${lip}" stroke-opacity="${lipOpacity}" stroke-width="${width}" transform="translate(0.65 0.65)"/>
    <path d="${d}" stroke="#000" stroke-opacity="0.55" stroke-width="${width}" transform="translate(-0.45 -0.45)"/>
    <path d="${d}" stroke="${recess}" stroke-width="${width}"/>
    ${glow ? `<g filter="url(#${glow.filter})"><path d="${d}" stroke="${glow.color}" stroke-opacity="${glow.opacity ?? 0.9}" stroke-width="${f(width * 0.48)}"/><path d="${d}" stroke="${glow.core}" stroke-opacity="${glow.coreOpacity ?? 0.9}" stroke-width="${f(width * 0.18)}"/></g>` : ''}
  </g>`;
}
const dashes = (y, from, to, period, on, width, color, opacity = 1) => {
  let p = '';
  for (let x = from; x < to - 0.01; x += period) p += `M${f(x)} ${y} H${f(Math.min(to, x + on))} `;
  return `<path d="${p}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;
};
const svg = (size, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><defs>${defs}</defs>${body}</svg>`;
async function raster(name, size, markup, px) {
  if (process.env.FRAMES_SVG) await writeFile(join(OUT, name.replace('.png', '.svg')), markup);
  await sharp(Buffer.from(markup), { density: 72 * px / size * 1.0 }).resize(px, px).png({ compressionLevel: 9 }).toFile(join(OUT, name));
}

// ── 아케인 블루: carved stone ────────────────────────────────────────────────────────────────────
const SKY = { filter: 'glow', color: '#7fcfff', core: '#e4f7ff', opacity: 0.62, coreOpacity: 0.6 };
function arcaneSigil(cx, cy, r) {
  const diamond = `M${cx} ${cy - r * 0.72} L${cx + r * 0.72} ${cy} L${cx} ${cy + r * 0.72} L${cx - r * 0.72} ${cy} Z`;
  const ticks = [45, 135, 225, 315].map(a => { const t = a * Math.PI / 180; return `M${f(cx + Math.cos(t) * r * 0.42)} ${f(cy + Math.sin(t) * r * 0.42)} L${f(cx + Math.cos(t) * r * 0.82)} ${f(cy + Math.sin(t) * r * 0.82)}`; }).join(' ');
  const circle = `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  return { circle, diamond, ticks };
}
function boardArcane() {
  const S = 240, B = 24;
  const band = `M1 1 H${S - 1} V${S - 1} H1 Z M${B} ${B} V${S - B} H${S - B} V${B} Z`;
  // Raised corner blocks with a chamfered inner corner.
  const block = `M1 1 H38 V24 L24 38 H1 Z`;
  const { circle, diamond, ticks } = arcaneSigil(17, 17, 12);
  const edgeGroove = `M38 12 H${S - 38}`;
  const innerLine = `M24 22.6 H${S - 24}`;
  const inner = arcaneSigil(17, 17, 8.2);
  void diamond;
  const corner = groove(circle, { width: 1.5, glow: SKY }) + groove(inner.circle, { width: 1.0, glow: { ...SKY, opacity: 0.45, coreOpacity: 0.4 } })
    + groove(inner.diamond, { width: 1.2, glow: SKY }) + groove(ticks, { width: 1.0, glow: { ...SKY, opacity: 0.45 } })
    + groove('M29 12 H38', { width: 1.8, glow: SKY }) + groove('M12 29 V38', { width: 1.8, glow: SKY })
    + `<circle cx="17" cy="17" r="1.1" fill="#e2f7ff" fill-opacity="0.85" filter="url(#glow)"/>`;
  const defs = reliefFilter('relief', { blur: 1.8, scale: 3.2 }) + reliefFilter('relief2', { blur: 1.1, scale: 2.4, light: 0.35, dark: 0.5 }) + glowFilter('glow', 1.4, 0.5);
  const body = `<path d="${band}" fill="#000" fill-rule="evenodd" fill-opacity="0.24"/>
    <g filter="url(#relief)"><path d="${band}" fill="#000" fill-rule="evenodd"/></g>
    <g filter="url(#relief2)">${four(S, `<path d="${block}" fill="#000"/>`)}</g>
    ${four(S, `<path d="${block}" fill="#9fb4d8" fill-opacity="0.06"/>`)}
    ${sides(S, groove(edgeGroove, { width: 1.8, glow: SKY }) + groove(innerLine, { width: 0.9, lipOpacity: 0.35 }))}
    ${four(S, corner)}`;
  return svg(S, defs, body);
}
function panelArcane() {
  const S = 160;
  const { circle } = arcaneSigil(9, 9, 4.2);
  const corner = groove('M4.5 22 V4.5 H22', { width: 1.5, glow: SKY }) + groove(circle, { width: 1.1, glow: { ...SKY, opacity: 0.7 } })
    + groove('M9 27 V31 M27 9 H31', { width: 1.1, glow: { ...SKY, opacity: 0.6 } });
  const edge = groove(`M31 4.5 H${S - 31}`, { width: 0.9, lipOpacity: 0.35, glow: { ...SKY, opacity: 0.35, coreOpacity: 0.3 } });
  return svg(S, glowFilter('glow', 1.2, 0.5), `${sides(S, edge)}${four(S, corner)}`);
}

// ── 숲의 펠트: felt binding, running stitch, matte bronze oak leaves ───────────────────────────────
const BRONZE = metalGradient('bronze', [[0, '#c9b07a'], [0.25, '#9c8250'], [0.5, '#5f5132'], [0.58, '#7a6a43'], [0.82, '#a8925c'], [1, '#4e4428']]);
function oakLeaf(len, width) {
  // Lobed oak leaf along +x from the stalk at (0,0): seven rounded lobes per side.
  const pts = [];
  const lobes = 4.5;
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    const env = Math.sin(Math.PI * Math.pow(t, 0.85)) * width * (1 - 0.15 * t);
    const lobe = 0.74 + 0.26 * Math.cos(2 * Math.PI * lobes * t);
    pts.push([t * len, -env * lobe]);
  }
  for (let i = 120; i >= 0; i--) {
    const t = i / 120;
    const env = Math.sin(Math.PI * Math.pow(t, 0.85)) * width * (1 - 0.15 * t);
    const lobe = 0.74 + 0.26 * Math.cos(2 * Math.PI * lobes * t + 0.9);
    pts.push([t * len, env * lobe]);
  }
  const outline = 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L') + ' Z';
  let veins = `M0 0 L${f(len * 0.95)} 0`;
  for (let k = 1; k <= 6; k++) { const x = len * k / 7.2; veins += ` M${f(x)} 0 L${f(x + len * 0.08)} ${f(-width * 0.6)} M${f(x + len * 0.02)} 0 L${f(x + len * 0.1)} ${f(width * 0.6)}`; }
  return { outline, veins };
}
function acorn(x, y, a) {
  return `<g transform="translate(${x} ${y}) rotate(${a})"><ellipse cx="0" cy="3.4" rx="3.1" ry="4.2"/><path d="M-3.9 0.6 Q0 -3.6 3.9 0.6 L3.4 1.8 Q0 0.6 -3.4 1.8 Z"/><path d="M0 -2.2 L0.4 -4.2" stroke="#000" stroke-width="0" /></g>`;
}
function feltCorner(scale = 1) {
  const leaf = oakLeaf(34 * scale, 9 * scale);
  const s = scale;
  return `<g transform="translate(${f(5 * s)} ${f(5 * s)}) rotate(45)"><path d="${leaf.outline}"/></g>
    <path d="M${f(4 * s)} ${f(13 * s)} C${f(10 * s)} ${f(9 * s)} ${f(20 * s)} ${f(8.5 * s)} ${f(30 * s)} ${f(9.5 * s)} M${f(13 * s)} ${f(4 * s)} C${f(9 * s)} ${f(10 * s)} ${f(8.5 * s)} ${f(20 * s)} ${f(9.5 * s)} ${f(30 * s)}" fill="none" stroke="url(#bronze)" stroke-width="${f(2.2 * s)}" stroke-linecap="round"/>
    ${acorn(f(31 * s), f(11.5 * s), -80)}${acorn(f(11.5 * s), f(31 * s), -10)}`;
}
const tack = (x, y, r = 2.3) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#tackG)"/><circle cx="${f(x - r * 0.35)}" cy="${f(y - r * 0.4)}" r="${f(r * 0.35)}" fill="#e9dcb4" fill-opacity="0.55"/>`;
function boardFelt() {
  const S = 240, B = 22;
  const band = `M1 1 H${S - 1} V${S - 1} H1 Z M${B} ${B} V${S - B} H${S - B} V${B} Z`;
  const leaf = oakLeaf(34, 9);
  const veins = `<g transform="translate(5 5) rotate(45)"><path d="${leaf.veins}" fill="none" stroke="#2b2614" stroke-opacity="0.5" stroke-width="0.7"/></g>`;
  const edge = `${dashes(5.5, 40, S - 40, 8, 4.6, 1.15, '#2a2414', 0.5).replace('stroke-linecap="round"', 'stroke-linecap="round" transform="translate(0.5 0.6)"')}${dashes(5.5, 40, S - 40, 8, 4.6, 1.1, '#b7a57a', 0.85)}
    <path d="M40 ${B + 0.6} H${S - 40}" stroke="#d8e6cf" stroke-opacity="0.10" stroke-width="1.2"/><path d="M40 ${B - 0.4} H${S - 40}" stroke="#000" stroke-opacity="0.35" stroke-width="0.9"/>
    <path d="M40 12.5 H${S - 40}" stroke="url(#bronzeLine)" stroke-width="1.9" filter="url(#matteLine)"/>`;
  const cornerStitch = `${dashes(5.5, 1, 40, 8, 4.6, 1.1, '#b7a57a', 0.85)}`;
  const defs = BRONZE + lineGradient('bronzeLine', [[0, '#b39a62'], [0.45, '#7a6840'], [1, '#4e4428']], 11.5, 13.5) + `<radialGradient id="tackG" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#d7c48f"/><stop offset="0.5" stop-color="#8d7647"/><stop offset="1" stop-color="#3f3520"/></radialGradient>`
    + metalFilter('matte', { bevel: 0.8, scale: 2.6, spec: 0.32, exp: 9, mix: 0.6, mul: 1.05, base: 0.1, noise: { freq: 0.9, amp: 0.35, seed: 8 }, shadow: { blur: 1.1, dx: 0.7, dy: 1.2, op: 0.6 } })
    + metalFilter('matteLine', { bevel: 0.5, scale: 1.6, spec: 0.25, exp: 8, mix: 0.5, mul: 1.05, base: 0.12, shadow: { blur: 0.8, dx: 0.4, dy: 0.8, op: 0.55 } })
    + reliefFilter('soft', { blur: 2.4, scale: 2, light: 0.16, dark: 0.32 });
  const body = `<path d="${band}" fill="#000" fill-rule="evenodd" fill-opacity="0.32"/>
    <g filter="url(#soft)"><path d="${band}" fill="#000" fill-rule="evenodd"/></g>
    ${sides(S, edge)}${four(S, cornerStitch + `<g transform="rotate(90 0 0) scale(1 -1)">${''}</g>`)}
    ${four(S, `<g fill="url(#bronze)" filter="url(#matte)">${feltCorner()}</g>${veins}${tack(9.5, 9.5)}${tack(21, 21, 1.8)}`)}`;
  return svg(S, defs, body);
}
function panelFelt() {
  const S = 160;
  // A matte bronze photo-corner clip with an embossed leaf, holding the paper to the felt, plus one tack.
  const clip = `<path d="M0.5 0.5 H26 L0.5 26 Z"/>`;
  const leaf = oakLeaf(13, 3.6);
  const defs = BRONZE + `<radialGradient id="tackG" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#d7c48f"/><stop offset="0.5" stop-color="#8d7647"/><stop offset="1" stop-color="#3f3520"/></radialGradient>`
    + metalFilter('matte', { bevel: 0.9, scale: 2.4, spec: 0.3, exp: 9, mix: 0.55, mul: 1.05, base: 0.1, noise: { freq: 1.1, amp: 0.3, seed: 12 }, shadow: { blur: 1.4, dx: 0.8, dy: 1.4, op: 0.55 } });
  const corner = `<g fill="url(#bronze)" filter="url(#matte)">${clip}</g>
    <g transform="translate(5 5) rotate(45)"><path d="${leaf.outline}" fill="#2f2914" fill-opacity="0.38"/><path d="${leaf.veins}" stroke="#e5d6a6" stroke-opacity="0.3" stroke-width="0.5" fill="none"/></g>
    <path d="M26 0.5 L0.5 26" stroke="#2b2614" stroke-opacity="0.45" stroke-width="0.8"/>${tack(6.5, 6.5, 1.8)}`;
  return svg(S, defs, four(S, corner));
}

// ── 흑단과 은: flush silver inlay, filigree ──────────────────────────────────────────────────────
const SILVER = metalGradient('silver', [[0, '#ffffff'], [0.2, '#d9dde3'], [0.46, '#8b929c'], [0.53, '#c9ced6'], [0.78, '#f3f5f8'], [1, '#7c838d']], 0.6);
function spiral(cx, cy, r0, turns, dir = 1, start = 0) {
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, a = start + dir * t * turns * 2 * Math.PI, r = r0 * (1 - 0.8 * t);
    pts.push(`${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`);
  }
  return 'M' + pts.join(' L');
}
function filigree(s = 1) {
  // Two mirrored S-scrolls from the mitred corner, ending in small curls; a lozenge at the corner.
  const a = `M${f(7 * s)} ${f(15 * s)} C${f(12 * s)} ${f(8 * s)} ${f(22 * s)} ${f(6 * s)} ${f(30 * s)} ${f(10 * s)} C${f(36 * s)} ${f(13 * s)} ${f(37 * s)} ${f(19 * s)} ${f(33 * s)} ${f(20 * s)}`;
  const b = `M${f(15 * s)} ${f(7 * s)} C${f(8 * s)} ${f(12 * s)} ${f(6 * s)} ${f(22 * s)} ${f(10 * s)} ${f(30 * s)} C${f(13 * s)} ${f(36 * s)} ${f(19 * s)} ${f(37 * s)} ${f(20 * s)} ${f(33 * s)}`;
  const curls = spiral(31.5 * s, 17 * s, 3.2 * s, 0.9, -1, Math.PI * 0.6) + ' ' + spiral(17 * s, 31.5 * s, 3.2 * s, 0.9, 1, Math.PI * 0.9);
  const inner = `M${f(16 * s)} ${f(16 * s)} C${f(20 * s)} ${f(18 * s)} ${f(22 * s)} ${f(22 * s)} ${f(25 * s)} ${f(25 * s)}`;
  // Secondary tendrils branching off each scroll, ending in small curls, and almond leaves along them.
  const tendrils = `M${f(22 * s)} ${f(7.4 * s)} C${f(25 * s)} ${f(3.5 * s)} ${f(31 * s)} ${f(3 * s)} ${f(35 * s)} ${f(5.5 * s)} M${f(7.4 * s)} ${f(22 * s)} C${f(3.5 * s)} ${f(25 * s)} ${f(3 * s)} ${f(31 * s)} ${f(5.5 * s)} ${f(35 * s)}`
    + ' ' + spiral(36.6 * s, 7.6 * s, 2.1 * s, 0.85, 1, Math.PI * 1.2) + ' ' + spiral(7.6 * s, 36.6 * s, 2.1 * s, 0.85, -1, Math.PI * 0.3);
  const leaf = (x, y, a, l = 4.2) => `<ellipse cx="${f(x * s)}" cy="${f(y * s)}" rx="${f(l * s)}" ry="${f(l * 0.36 * s)}" transform="rotate(${a} ${f(x * s)} ${f(y * s)})"/>`;
  const leaves = leaf(24.5, 12.2, 28) + leaf(12.2, 24.5, 62) + leaf(27.5, 5.2, -14, 3) + leaf(5.2, 27.5, 104, 3) + leaf(21, 21, 45, 3.4);
  return { a, b, curls, inner, tendrils, leaves };
}
function boardEbony() {
  const S = 240, B = 24;
  const band = `M1 1 H${S - 1} V${S - 1} H1 Z M${B} ${B} V${S - B} H${S - B} V${B} Z`;
  const fil = filigree();
  const lines = (from, to) => `<path d="M${from} 6.5 H${to} M${from} 9.4 H${to} M${from} 19.5 H${to}" stroke="url(#silverH)" fill="none" stroke-width="1"/>`;
  const edge = `<g filter="url(#inlay)"><path d="M6.5 6.5 H233.5" stroke="url(#silverH)" stroke-width="1.15"/><path d="M9.4 9.4 H230.6" stroke="url(#silverH)" stroke-width="0.55"/><path d="M19.5 19.5 H220.5" stroke="url(#silverH)" stroke-width="0.75"/></g>
    <path d="M0 ${B} H240" stroke="#f4ecdf" stroke-opacity="0.13" stroke-width="0.8"/><path d="M0 ${B + 0.9} H240" stroke="#000" stroke-opacity="0.45" stroke-width="1"/>`;
  void lines;
  const corner = `<g filter="url(#inlay)" fill="none" stroke="url(#silver)" stroke-linecap="round">
      <path d="${fil.a}" stroke-width="1.15"/><path d="${fil.b}" stroke-width="1.15"/><path d="${fil.curls}" stroke-width="0.9"/><path d="${fil.inner}" stroke-width="0.7"/>
      <path d="${fil.tendrils}" stroke-width="0.75"/><path d="M6.5 6.5 H14 M6.5 6.5 V14" stroke-width="1.15"/></g>
    <g filter="url(#inlay)" fill="url(#silver)">${fil.leaves}</g>
    <g filter="url(#inlay)"><path d="M12 6.8 L17.2 12 L12 17.2 L6.8 12 Z" fill="url(#silver)"/></g>
    <path d="M12 9.3 L14.7 12 L12 14.7 L9.3 12 Z" fill="#07080a"/><path d="M11.3 10.4 L12 9.9 L12.4 10.9 Z" fill="#fff" fill-opacity="0.55"/>`;
  const defs = SILVER + lineGradient('silverH', [[0, '#f7f9fb'], [0.5, '#aeb4bd'], [1, '#e9ecf0']], 5, 21)
    + `<filter id="inlay" filterUnits="userSpaceOnUse" x="-20" y="-20" width="280" height="280" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="0.35" result="b"/>
      <feSpecularLighting in="b" surfaceScale="1.6" specularConstant="1.25" specularExponent="38" lighting-color="#fff" result="s"><feDistantLight azimuth="225" elevation="40"/></feSpecularLighting>
      <feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>
      <feComposite in="SourceGraphic" in2="s2" operator="arithmetic" k1="0" k2="1" k3="0.8" k4="0" result="lit"/>
      <feMorphology in="SourceAlpha" operator="dilate" radius="0.45" result="groove"/><feFlood flood-color="#000" flood-opacity="0.75"/><feComposite in2="groove" operator="in" result="g2"/>
      <feMerge><feMergeNode in="g2"/><feMergeNode in="lit"/></feMerge></filter>`;
  const body = `<path d="${band}" fill="#000" fill-rule="evenodd" fill-opacity="0.30"/>${sides(S, edge)}${four(S, `<rect x="1" y="1" width="23" height="23" fill="#000" fill-opacity="0"/>` + corner)}`;
  return svg(S, defs, body);
}
function panelEbony() {
  const S = 160;
  const fil = filigree(0.62);
  const defs = SILVER + lineGradient('silverP', [[0, '#f4f6f9'], [1, '#aab1ba']], 3.5, 7.5) + `<filter id="inlay" filterUnits="userSpaceOnUse" x="-20" y="-20" width="280" height="280" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="0.3" result="b"/>
      <feSpecularLighting in="b" surfaceScale="1.4" specularConstant="1.2" specularExponent="36" lighting-color="#fff" result="s"><feDistantLight azimuth="225" elevation="40"/></feSpecularLighting>
      <feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>
      <feComposite in="SourceGraphic" in2="s2" operator="arithmetic" k1="0" k2="1" k3="0.8" k4="0" result="lit"/>
      <feMorphology in="SourceAlpha" operator="dilate" radius="0.4" result="groove"/><feFlood flood-color="#2a2622" flood-opacity="0.55"/><feComposite in2="groove" operator="in" result="g2"/>
      <feMerge><feMergeNode in="g2"/><feMergeNode in="lit"/></feMerge></filter>`;
  const edge = `<g filter="url(#inlay)"><path d="M4.5 4.5 H155.5" stroke="url(#silverP)" stroke-width="0.9"/><path d="M6.6 6.6 H153.4" stroke="url(#silverP)" stroke-width="0.4"/></g>`;
  const corner = `<g filter="url(#inlay)" fill="none" stroke="url(#silver)" stroke-linecap="round"><path d="${fil.a}" stroke-width="0.85"/><path d="${fil.b}" stroke-width="0.85"/><path d="${fil.curls}" stroke-width="0.65"/><path d="${fil.tendrils}" stroke-width="0.55"/></g>
    <g filter="url(#inlay)" fill="url(#silver)">${fil.leaves}</g>
    <g filter="url(#inlay)"><path d="M7 3.6 L10.4 7 L7 10.4 L3.6 7 Z" fill="url(#silver)"/></g><path d="M7 5.4 L8.6 7 L7 8.6 L5.4 7 Z" fill="#07080a"/>`;
  return svg(S, defs, `${sides(S, edge)}${four(S, corner)}`);
}

// ── 적갈 가죽: saddle stitching, hammered L corner guards with domed rivets ─────────────────────────
const BRASS = metalGradient('brass', [[0, '#d9c596'], [0.2, '#a98d55'], [0.45, '#5c4a2a'], [0.52, '#80693f'], [0.78, '#b89f68'], [1, '#4a3a1e']]);
const rivet = (x, y, r = 2.9) => `<circle cx="${x}" cy="${y}" r="${f(r + 0.7)}" fill="#000" fill-opacity="0.55"/><circle cx="${x}" cy="${y}" r="${r}" fill="url(#rivetG)"/><ellipse cx="${f(x - r * 0.35)}" cy="${f(y - r * 0.4)}" rx="${f(r * 0.38)}" ry="${f(r * 0.26)}" fill="#fff8e2" fill-opacity="0.8" transform="rotate(-35 ${f(x - r * 0.35)} ${f(y - r * 0.4)})"/>`;
function boardOxblood() {
  const S = 240, B = 24;
  const band = `M1 1 H${S - 1} V${S - 1} H1 Z M${B} ${B} V${S - B} H${S - B} V${B} Z`;
  const guard = `M1 1 H44 Q46 1 46 3 V9 Q46 11 44 12 L22 17 Q18 18 17.5 22 L12 44 Q11 46 9 46 H3 Q1 46 1 44 Z`;
  const stitches = (from, to) => `${dashes(4.2, from, to, 7.5, 4, 1.15, '#000', 0.45).replace('<path ', '<path transform="translate(0.4 0.6)" ')}${dashes(4.2, from, to, 7.5, 4, 1.05, '#c8b083', 0.9)}
    ${dashes(20.2, from, to, 7.5, 4, 1.15, '#000', 0.45).replace('<path ', '<path transform="translate(0.4 0.6)" ')}${dashes(20.2, from, to, 7.5, 4, 1.05, '#c8b083', 0.9)}`;
  const edge = `${stitches(45, S - 45)}<path d="M45 ${B + 0.4} H${S - 45}" stroke="#000" stroke-opacity="0.5" stroke-width="1.2"/><path d="M45 ${B - 0.8} H${S - 45}" stroke="#ffe7c4" stroke-opacity="0.08" stroke-width="0.9"/>
    ${rivet(120, 12, 2.2)}`;
  const defs = BRASS + `<radialGradient id="rivetG" cx="38%" cy="34%" r="70%"><stop offset="0" stop-color="#fff3cf"/><stop offset="0.35" stop-color="#c9ad6e"/><stop offset="0.8" stop-color="#5e4a24"/><stop offset="1" stop-color="#2b2010"/></radialGradient>`
    + metalFilter('hammered', { bevel: 1.2, scale: 4.6, spec: 0.85, exp: 12, mix: 0.75, mul: 1.05, base: 0.12, noise: { type: 'turbulence', freq: 0.26, amp: 0.85, seed: 4, octaves: 2 }, shadow: { blur: 1.8, dx: 1.4, dy: 2.2, op: 0.8 } })
    + reliefFilter('soft', { blur: 2.2, scale: 2.4, light: 0.14, dark: 0.35 });
  const corner = `<g fill="url(#brass)" filter="url(#hammered)"><path d="${guard}"/></g>
    <path d="M3 3 H43 M3 3 V43" stroke="#3a2a12" stroke-opacity="0.35" stroke-width="0.8" fill="none" transform="translate(2.5 2.5)"/>
    ${rivet(9.5, 9.5)}${rivet(34, 6.8, 2.5)}${rivet(6.8, 34, 2.5)}`;
  const body = `<path d="${band}" fill="#000" fill-rule="evenodd" fill-opacity="0.30"/>
    <g filter="url(#soft)"><path d="${band}" fill="#000" fill-rule="evenodd"/></g>
    ${sides(S, edge)}${four(S, corner)}`;
  return svg(S, defs, body);
}
function panelOxblood() {
  const S = 160;
  const guard = `M0.5 0.5 H25 Q26.5 0.5 26.5 2 V6 Q26.5 7.5 25 8 L11 11 L8 25 Q7.5 26.5 6 26.5 H2 Q0.5 26.5 0.5 25 Z`;
  const defs = BRASS + `<radialGradient id="rivetG" cx="38%" cy="34%" r="70%"><stop offset="0" stop-color="#fff3cf"/><stop offset="0.35" stop-color="#c9ad6e"/><stop offset="0.8" stop-color="#5e4a24"/><stop offset="1" stop-color="#2b2010"/></radialGradient>`
    + metalFilter('hammered', { bevel: 1, scale: 3.6, spec: 1.0, exp: 14, mix: 0.85, mul: 1.1, base: 0.12, noise: { type: 'turbulence', freq: 0.4, amp: 0.5, seed: 6, octaves: 2 }, shadow: { blur: 1.5, dx: 1, dy: 1.8, op: 0.7 } });
  return svg(S, defs, four(S, `<g fill="url(#brass)" filter="url(#hammered)"><path d="${guard}"/></g>${rivet(6, 6, 2.2)}`));
}

const jobs = [
  ['frame-arcane.png', 240, boardArcane(), 480], ['frame-felt.png', 240, boardFelt(), 480], ['frame-ebony.png', 240, boardEbony(), 480], ['frame-oxblood.png', 240, boardOxblood(), 480],
  ['panel-arcane.png', 160, panelArcane(), 320], ['panel-felt.png', 160, panelFelt(), 320], ['panel-ebony.png', 160, panelEbony(), 320], ['panel-oxblood.png', 160, panelOxblood(), 320],
];
for (const [name, size, markup, px] of jobs) await raster(name, size, markup, px);
console.log(jobs.map(([name]) => name).join(' '));
