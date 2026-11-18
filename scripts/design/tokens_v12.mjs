// v1.2 Phase 4: per-theme recovery-button tokens and card-page bookmarks as vector SVG (sharp at any scale).
// Usage: node scripts/design/tokens_v12.mjs <out_dir> [preview_dir]
//   rest-{oxblood,ebony,felt,arcane}.svg      96-unit round tokens behind the recovery icons (shown at 44 / 38 px)
//   bookmark-{oxblood,ebony,felt,arcane}.svg  40×100-unit bookmarks at the top of the card page (shown at 20×50 px)
// Oxblood: hammered brass boss with a riveted rim; leather strap with saddle stitching and a brass eyelet.
// Ebony: milled silver bezel around an ebony disc; dark silk ribbon with a silver aglet.
// Felt: matte bronze with an oak-leaf wreath; pinked felt tab held by a bronze tack.
// Arcane: carved stone disc with a glowing engraved ring; a tab engraved into the stone tablet with a glowing mark (no metal).
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const OUT = resolve(process.argv[2] ?? 'src/assets/playmat');
const PREVIEW = process.argv[3] ? resolve(process.argv[3]) : null;
await mkdir(OUT, { recursive: true });
if (PREVIEW) await mkdir(PREVIEW, { recursive: true });
const f = n => Number(n.toFixed(2));
const svg = (w, h, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs>${defs}</defs>${body}</svg>`;
const radial = (id, stops, cx = '38%', cy = '32%', r = '75%') => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
const linear = (id, stops, x1 = 0, y1 = 0, x2 = 1, y2 = 1, units = '') => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${units}>${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
const around = (n, r, cx, cy, fn) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return fn(f(cx + Math.cos(a) * r), f(cy + Math.sin(a) * r), a * 180 / Math.PI + 90, i); }).join('');
const U = ' filterUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120"';
/** Surface relief for metal: noise height lit from the top-left, multiplied onto the fill. */
const relief = (id, { freq, amp, scale, spec, exp, seed = 3, type = 'fractalNoise' }) => `<filter id="${id}"${U} color-interpolation-filters="sRGB">
  <feTurbulence type="${type}" baseFrequency="${freq}" numOctaves="2" seed="${seed}" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${amp} 0 0 0 0" result="h"/>
  <feDiffuseLighting in="h" surfaceScale="${scale}" diffuseConstant="1" lighting-color="#fff" result="d"><feDistantLight azimuth="225" elevation="52"/></feDiffuseLighting>
  <feSpecularLighting in="h" surfaceScale="${scale}" specularConstant="${spec}" specularExponent="${exp}" lighting-color="#fff" result="s"><feDistantLight azimuth="225" elevation="40"/></feSpecularLighting>
  <feComposite in="SourceGraphic" in2="d" operator="arithmetic" k1="1.12" k2="0.08" k3="0" k4="0" result="l"/>
  <feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>
  <feComposite in="l" in2="s2" operator="arithmetic" k1="0" k2="1" k3="0.55" k4="0" result="lit"/>
  <feComposite in="lit" in2="SourceAlpha" operator="in"/></filter>`;
/** Grain multiply for leather/felt/stone fills (no lighting). */
const grainFilter = (id, { freq, amp, seed = 5, octaves = 3 }) => `<filter id="${id}"${U} color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}" result="n"/>
  <feColorMatrix in="n" type="matrix" values="${amp} 0 0 0 ${1 - amp * 0.5}  ${amp} 0 0 0 ${1 - amp * 0.5}  ${amp} 0 0 0 ${1 - amp * 0.5}  0 0 0 0 1" result="g"/>
  <feComposite in="SourceGraphic" in2="g" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="m"/>
  <feComposite in="m" in2="SourceAlpha" operator="in"/></filter>`;
const glow = (id, blur, strength) => `<filter id="${id}" filterUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="130" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="g"/><feComponentTransfer in="g" result="g2"><feFuncA type="linear" slope="${strength}"/></feComponentTransfer>
  <feMerge><feMergeNode in="g2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
/** An engraved line: shadowed upper lip, dark recess, lit lower lip; optional glow inside. */
const groove = (d, w, glowFill) => `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
  <path d="${d}" stroke="#a3b5d4" stroke-opacity="0.38" stroke-width="${w}" transform="translate(0.7 0.7)"/>
  <path d="${d}" stroke="#000" stroke-opacity="0.6" stroke-width="${w}" transform="translate(-0.5 -0.5)"/>
  <path d="${d}" stroke="#070a10" stroke-width="${w}"/>
  ${glowFill ? `<g filter="url(#glow)"><path d="${d}" stroke="#7fcfff" stroke-opacity="${glowFill}" stroke-width="${f(w * 0.45)}"/><path d="${d}" stroke="#e6f8ff" stroke-opacity="${glowFill * 0.85}" stroke-width="${f(w * 0.16)}"/></g>` : ''}</g>`;
const circle = (cx, cy, r) => `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;

// ── Recovery tokens (96 units) ─────────────────────────────────────────────────────────────────
function restOxblood() {
  const defs = radial('rim', [[0, '#f2e1b4'], [0.35, '#c7a86c'], [0.75, '#7a6037'], [1, '#3d2e17']], '32%', '26%', '85%')
    + radial('dome', [[0, '#f6e8c2'], [0.3, '#cdb279'], [0.72, '#8a6e3f'], [1, '#4f3c1f']], '36%', '30%', '78%')
    + radial('rivet', [[0, '#fff6dc'], [0.35, '#d1b57a'], [0.8, '#5f4a25'], [1, '#2a1f0f']], '36%', '32%', '70%')
    + relief('hammer', { freq: 0.2, amp: 0.45, scale: 2.2, spec: 0.55, exp: 16, seed: 4, type: 'fractalNoise' })
    + relief('worn', { freq: 0.5, amp: 0.4, scale: 1.4, spec: 0.5, exp: 12, seed: 9 });
  const rivets = around(8, 39.5, 48, 48, (x, y) => `<circle cx="${x}" cy="${y}" r="3.4" fill="#000" fill-opacity="0.5"/><circle cx="${x}" cy="${y}" r="2.7" fill="url(#rivet)"/><circle cx="${f(x - 0.9)}" cy="${f(y - 1)}" r="0.8" fill="#fff8e6" fill-opacity="0.85"/>`);
  return svg(96, 96, defs, `<circle cx="48" cy="48" r="47" fill="#140c06"/>
    <circle cx="48" cy="48" r="45" fill="url(#rim)" filter="url(#worn)"/>
    <circle cx="48" cy="48" r="44.4" fill="none" stroke="#fff1cc" stroke-opacity="0.45" stroke-width="0.9" transform="translate(-0.6 -0.6)"/>
    <circle cx="48" cy="48" r="34.6" fill="#1c1208" fill-opacity="0.75"/>
    <circle cx="48" cy="48" r="33.4" fill="url(#dome)" filter="url(#hammer)"/>
    <circle cx="48" cy="48" r="33.4" fill="none" stroke="#2a1d0c" stroke-opacity="0.55" stroke-width="1"/>
    <ellipse cx="38" cy="34" rx="12" ry="7" fill="#fff8e2" fill-opacity="0.22" transform="rotate(-35 38 34)"/>${rivets}`);
}
function restEbony() {
  const defs = linear('bezel', [[0, '#ffffff'], [0.25, '#d6dbe1'], [0.5, '#8a919b'], [0.62, '#c7ccd3'], [0.85, '#f2f4f7'], [1, '#7a818b']])
    + radial('wood', [[0, '#3a3330'], [0.7, '#1f1b19'], [1, '#0e0c0b']], '40%', '35%', '80%')
    + `<clipPath id="disc"><circle cx="48" cy="48" r="37"/></clipPath>`;
  const milling = around(84, 44.6, 48, 48, (x, y, deg) => `<rect x="${f(x - 0.45)}" y="${f(y - 1.8)}" width="0.9" height="3.6" fill="#3e444c" fill-opacity="0.55" transform="rotate(${f(deg)} ${x} ${y})"/>`);
  let grain = '';
  for (let i = 0; i < 26; i++) { const y = 11 + i * 2.9 + (i % 3) * 0.6; const amp = 0.8 + (i % 4) * 0.35; grain += `<path d="M8 ${f(y)} C30 ${f(y - amp)} 62 ${f(y + amp)} 88 ${f(y - amp * 0.5)}" stroke="${i % 5 === 0 ? '#5a504a' : '#000'}" stroke-opacity="${i % 5 === 0 ? 0.35 : 0.3}" stroke-width="${i % 2 ? 0.5 : 0.8}" fill="none"/>`; }
  const studs = around(4, 33, 48, 48, (x, y) => `<circle cx="${x}" cy="${y}" r="1.35" fill="#e9ecf0"/><circle cx="${f(x - 0.4)}" cy="${f(y - 0.4)}" r="0.5" fill="#fff"/>`);
  return svg(96, 96, defs, `<circle cx="48" cy="48" r="47" fill="#050505"/>
    <circle cx="48" cy="48" r="46" fill="url(#bezel)"/>${milling}
    <circle cx="48" cy="48" r="40.6" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="1"/>
    <circle cx="48" cy="48" r="39.4" fill="none" stroke="#2c3036" stroke-width="1.2"/>
    <circle cx="48" cy="48" r="38" fill="url(#wood)"/>
    <g clip-path="url(#disc)">${grain}<rect x="10" y="10" width="76" height="12" fill="#000" fill-opacity="0.35"/></g>
    <circle cx="48" cy="48" r="38" fill="none" stroke="#000" stroke-opacity="0.6" stroke-width="1.4"/>${studs}
    <path d="M14 30 A38 38 0 0 1 40 11" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1.2" fill="none"/>`);
}
function restFelt() {
  const defs = linear('bronze', [[0, '#c6b386'], [0.45, '#97845a'], [1, '#5e5236']])
    + linear('field', [[0, '#cbb991'], [0.55, '#ad9a6d'], [1, '#86754f']])
    + relief('matte', { freq: 0.35, amp: 0.55, scale: 1.8, spec: 0.22, exp: 8, seed: 12 })
    + grainFilter('patina', { freq: 0.07, amp: 0.25, seed: 13, octaves: 2 });
  const leaf = (x, y, deg) => `<g transform="translate(${x} ${y}) rotate(${f(deg + 62)})"><path d="M0 -5.2 C3.2 -3.6 3.6 -0.6 2.3 1.4 C3.2 2.6 1.6 4.6 0 5.2 C-1.6 4.6 -3.2 2.6 -2.3 1.4 C-3.6 -0.6 -3.2 -3.6 0 -5.2 Z" fill="#6d5f3e"/><path d="M0 -5.2 C3.2 -3.6 3.6 -0.6 2.3 1.4 C3.2 2.6 1.6 4.6 0 5.2" fill="none" stroke="#d6c69a" stroke-opacity="0.45" stroke-width="0.6" transform="translate(-0.4 -0.4)"/><path d="M0 -4.4 V4.6" stroke="#3b3320" stroke-opacity="0.6" stroke-width="0.5"/></g>`;
  const wreath = around(16, 39.5, 48, 48, (x, y, deg) => leaf(x, y, deg));
  return svg(96, 96, defs, `<circle cx="48" cy="48" r="47" fill="#14140c"/>
    <g filter="url(#patina)"><circle cx="48" cy="48" r="45.5" fill="url(#bronze)" filter="url(#matte)"/></g>
    <g filter="url(#matte)">${wreath}</g>
    <circle cx="48" cy="48" r="32.5" fill="#2a2414" fill-opacity="0.55"/>
    <g filter="url(#patina)"><circle cx="48" cy="48" r="31" fill="url(#field)" filter="url(#matte)"/></g>
    <path d="M22 36 A28 28 0 0 1 48 20" stroke="#2a2414" stroke-opacity="0.45" stroke-width="2" fill="none"/>
    <circle cx="48" cy="48" r="45.5" fill="none" stroke="#e1d3a8" stroke-opacity="0.25" stroke-width="1" transform="translate(-0.5 -0.5)"/>`);
}
function restArcane() {
  const defs = radial('stone', [[0, '#4a5870'], [0.6, '#303a4c'], [1, '#1c2330']], '38%', '30%', '85%')
    + grainFilter('grain', { freq: 0.9, amp: 0.55, seed: 21 }) + glow('glow', 1.4, 0.7);
  const marks = around(8, 41.5, 48, 48, (x, y, deg) => `<g transform="rotate(${f(deg)} ${x} ${y})">${groove(`M${x} ${f(y - 2)} V${f(y + 2)}`, 1.3, 0.55)}</g>`);
  return svg(96, 96, defs, `<circle cx="48" cy="48" r="47" fill="#06080c"/>
    <g filter="url(#grain)"><circle cx="48" cy="48" r="45.5" fill="url(#stone)"/></g>
    <path d="M14 38 A35 35 0 0 1 38 13" stroke="#c5d6f2" stroke-opacity="0.22" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M82 58 A35 35 0 0 1 58 83" stroke="#000" stroke-opacity="0.45" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    ${groove(circle(48, 48, 36), 2.6, 0.6)}${marks}
    <circle cx="48" cy="48" r="31.5" fill="#0b0f16" fill-opacity="0.32"/>
    <path d="M22 40 A27 27 0 0 1 40 22" stroke="#000" stroke-opacity="0.35" stroke-width="2" fill="none"/>`);
}

// ── Bookmarks (40×100 units) ────────────────────────────────────────────────────────────────────
function bookmarkOxblood() {
  const defs = linear('strap', [[0, '#2b120d'], [0.18, '#5a2a21'], [0.45, '#74372b'], [0.75, '#55261d'], [1, '#22100b']], 0, 0, 1, 0)
    + grainFilter('hide', { freq: 0.75, amp: 0.4, seed: 31 })
    + radial('eye', [[0, '#fff2cf'], [0.4, '#c9a96a'], [0.85, '#5d4824'], [1, '#2a1f0f']], '35%', '30%', '75%');
  const strap = 'M6 0 H34 V98 L20 86 L6 98 Z';
  return svg(40, 100, defs, `<g filter="url(#hide)"><path d="${strap}" fill="url(#strap)"/></g>
    <path d="M10 4 V86" stroke="#000" stroke-opacity="0.4" stroke-width="1.1" stroke-dasharray="3.4 2.4" transform="translate(0.4 0.5)"/><path d="M10 4 V86" stroke="#ccb486" stroke-width="1" stroke-dasharray="3.4 2.4"/>
    <path d="M30 4 V86" stroke="#000" stroke-opacity="0.4" stroke-width="1.1" stroke-dasharray="3.4 2.4" transform="translate(0.4 0.5)"/><path d="M30 4 V86" stroke="#ccb486" stroke-width="1" stroke-dasharray="3.4 2.4"/>
    <path d="M6 0 H34 V6 H6 Z" fill="#000" fill-opacity="0.35"/>
    <circle cx="20" cy="20" r="5" fill="#000" fill-opacity="0.45"/><circle cx="20" cy="19.5" r="4.4" fill="url(#eye)"/><circle cx="20" cy="19.5" r="2" fill="#1a0a06"/>
    <path d="M33.2 0 V97" stroke="#000" stroke-opacity="0.35" stroke-width="1.2"/><path d="M6.8 0 V97" stroke="#d7a08a" stroke-opacity="0.18" stroke-width="0.8"/>`);
}
function bookmarkEbony() {
  const defs = linear('silk', [[0, '#15181c'], [0.22, '#3b424c'], [0.38, '#626b77'], [0.5, '#2b3037'], [0.72, '#4d5561'], [1, '#14171b']], 0, 0, 1, 0)
    + linear('aglet', [[0, '#7c838d'], [0.3, '#ffffff'], [0.55, '#aab1ba'], [0.8, '#eef0f3'], [1, '#6f767f']], 0, 0, 1, 0);
  let weave = '';
  for (let y = 2; y < 80; y += 1.3) weave += `<path d="M11 ${f(y)} H29" stroke="#000" stroke-opacity="${y % 2.6 < 1.3 ? 0.16 : 0.08}" stroke-width="0.45"/>`;
  return svg(40, 100, defs, `<path d="M11 0 H29 V82 H11 Z" fill="url(#silk)"/>${weave}
    <path d="M11 0 H29 V5 H11 Z" fill="#000" fill-opacity="0.4"/>
    <path d="M10.4 78 H29.6 V90 L20 99 L10.4 90 Z" fill="url(#aglet)"/>
    <path d="M10.4 78 H29.6 V90 L20 99 L10.4 90 Z" fill="none" stroke="#2c3036" stroke-opacity="0.7" stroke-width="0.6"/>
    <path d="M10.6 82 H29.4 M10.6 85.5 H29.4" stroke="#4b5159" stroke-opacity="0.75" stroke-width="0.6"/>
    <path d="M20 88 L22.4 91 L20 94 L17.6 91 Z" fill="#0b0c0e"/>`);
}
function bookmarkFelt() {
  const defs = linear('felt', [[0, '#2c4231'], [0.5, '#3e5a43'], [1, '#253829']], 0, 0, 1, 0)
    + grainFilter('fibre', { freq: 1.6, amp: 0.55, seed: 41, octaves: 2 })
    + radial('tack', [[0, '#d9c895'], [0.5, '#9a875a'], [1, '#4e4329']], '36%', '32%', '72%')
    + `<filter id="soft" filterUnits="userSpaceOnUse" x="-10" y="-10" width="60" height="120"><feGaussianBlur stdDeviation="0.35"/></filter>`;
  let pinked = 'M5 0 H35 V86';
  for (let x = 35; x > 5.01; x -= 3.75) pinked += ` L${f(x - 1.875)} 91 L${f(x - 3.75)} 86`;
  pinked += ' Z';
  return svg(40, 100, defs, `<g filter="url(#soft)"><g filter="url(#fibre)"><path d="${pinked}" fill="url(#felt)"/></g></g>
    <path d="M5 0 H35 V5 H5 Z" fill="#000" fill-opacity="0.3"/>
    <path d="M8.5 6 V82 M31.5 6 V82" stroke="#cfc39a" stroke-opacity="0.38" stroke-width="0.8" stroke-dasharray="2.6 2.2"/>
    <circle cx="20" cy="12" r="5.4" fill="#000" fill-opacity="0.4" transform="translate(0.6 0.8)"/><circle cx="20" cy="12" r="5" fill="url(#tack)"/>
    <circle cx="18.6" cy="10.6" r="1.4" fill="#efe2b8" fill-opacity="0.5"/>`);
}
function bookmarkArcane() {
  const defs = glow('glow', 1.2, 0.65) + linear('recess', [[0, '#0d1118', 0.62], [1, '#151b26', 0.42]], 0, 0, 0, 1);
  const tab = 'M8 0 V80 L20 93 L32 80 V0';
  return svg(40, 100, defs, `<path d="${tab} Z" fill="url(#recess)"/>
    <path d="M8.6 0 V80" stroke="#000" stroke-opacity="0.65" stroke-width="1.6"/><path d="M8.6 80 L20 92" stroke="#000" stroke-opacity="0.5" stroke-width="1.2"/>
    <path d="M31.4 0 V80 L20 92.4" stroke="#a9bddc" stroke-opacity="0.3" stroke-width="1.2" fill="none"/>
    ${groove('M12 4 V78 L20 86.5 L28 78 V4', 1, 0.42)}
    ${groove('M20 22 L25 30 L20 38 L15 30 Z', 1.3, 0.9)}${groove('M20 44 V60', 1.2, 0.75)}${groove(circle(20, 68, 3.4), 1.1, 0.75)}`);
}

const files = {
  'rest-oxblood.svg': restOxblood(), 'rest-ebony.svg': restEbony(), 'rest-felt.svg': restFelt(), 'rest-arcane.svg': restArcane(),
  'bookmark-oxblood.svg': bookmarkOxblood(), 'bookmark-ebony.svg': bookmarkEbony(), 'bookmark-felt.svg': bookmarkFelt(), 'bookmark-arcane.svg': bookmarkArcane(),
};
for (const [name, raw] of Object.entries(files)) {
  // The root id names the asset, so it can be recognised even when the bundler inlines it as a data URI.
  const markup = raw.replace('<svg xmlns', `<svg id="${name.replace('.svg', '')}" xmlns`);
  await writeFile(join(OUT, name), markup);
  if (PREVIEW) await sharp(Buffer.from(markup), { density: 72 * 4 }).png().toFile(join(PREVIEW, name.replace('.svg', '@4x.png')));
}
console.log(Object.keys(files).join(' '));
