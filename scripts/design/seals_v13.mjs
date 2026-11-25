// v1.3 Phase 3 (UI-P3, memo 5): per-theme Use seals as vector SVG. 적갈 가죽 keeps its approved red wax seal
// (wax-seal.png); the other themes get their own:
//   seal-ebony.svg   ebony lacquer medallion in a fine milled silver bezel (흑단과 은)
//   seal-felt.svg    deep green wax pressed with an oak-leaf ring (숲의 펠트, matte bronze tone, no shine)
//   seal-arcane.svg  carved stone disc with a glowing engraved rune ring (아케인 블루, no metal)
// 120-unit squares, shown at 92 / 72 / 58 / 48 px. The button text ("사용 확정") is HTML on top.
// Usage: node scripts/design/seals_v13.mjs <out_dir> [preview_dir]
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const OUT = resolve(process.argv[2] ?? 'src/assets/playmat');
const PREVIEW = process.argv[3] ? resolve(process.argv[3]) : null;
await mkdir(OUT, { recursive: true }); if (PREVIEW) await mkdir(PREVIEW, { recursive: true });
const f = n => Number(n.toFixed(2));
const svg = (id, defs, body) => `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><defs>${defs}</defs>${body}</svg>`;
const stops = list => list.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('');
const radial = (id, list, cx = '38%', cy = '32%', r = '75%') => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops(list)}</radialGradient>`;
const linear = (id, list, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`;
const U = ' filterUnits="userSpaceOnUse" x="-10" y="-10" width="140" height="140" color-interpolation-filters="sRGB"';
const grain = (id, freq, amp, seed) => `<filter id="${id}"${U}><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}" result="n"/>
  <feColorMatrix in="n" type="matrix" values="${amp} 0 0 0 ${1 - amp * .5}  ${amp} 0 0 0 ${1 - amp * .5}  ${amp} 0 0 0 ${1 - amp * .5}  0 0 0 0 1" result="g"/>
  <feComposite in="SourceGraphic" in2="g" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="m"/><feComposite in="m" in2="SourceAlpha" operator="in"/></filter>`;
const glow = (id, blur, strength) => `<filter id="${id}"${U}><feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="g"/><feComponentTransfer in="g" result="g2"><feFuncA type="linear" slope="${strength}"/></feComponentTransfer><feMerge><feMergeNode in="g2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
/** A pressed-wax outline: a circle with soft, seeded bulges, as a smooth closed path. */
function blob(cx, cy, r, seed, wobble = .055) {
  let s = seed; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const n = 28; const pts = Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; const k = r * (1 + wobble * (Math.sin(a * 3 + seed) * .6 + (rnd() - .5) * 1.4)); return [cx + Math.cos(a) * k, cy + Math.sin(a) * k]; });
  let d = `M${f((pts[0][0] + pts[1][0]) / 2)} ${f((pts[0][1] + pts[1][1]) / 2)}`;
  for (let i = 1; i <= n; i++) { const p = pts[i % n], q = pts[(i + 1) % n]; d += ` Q${f(p[0])} ${f(p[1])} ${f((p[0] + q[0]) / 2)} ${f((p[1] + q[1]) / 2)}`; }
  return `${d}Z`;
}
const around = (n, r, fn) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2 - Math.PI / 2; return fn(f(60 + Math.cos(a) * r), f(60 + Math.sin(a) * r), f(a * 180 / Math.PI + 90)); }).join('');

// 흑단과 은: lacquered ebony disc, milled silver bezel, a fine engraved silver line inside.
const ebony = svg('seal-ebony',
  radial('eb-face', [[0, '#3a3431'], [.55, '#1b1715'], [1, '#070505']]) +
  linear('eb-silver', [[0, '#fbfcfd'], [.35, '#c3c9d1'], [.6, '#6d737c'], [.8, '#d9dee4'], [1, '#4e535a']], 0, 0, 1, 1) +
  linear('eb-shine', [[0, '#ffffff', .32], [.5, '#ffffff', 0]], 0, 0, 0, 1) + grain('eb-grain', '.9 .05', .18, 7),
  `<circle cx="60" cy="62" r="54" fill="#000" opacity=".35"/>` +
  `<circle cx="60" cy="60" r="54" fill="url(#eb-silver)"/>` +
  around(60, 52.6, (x, y, a) => `<rect x="${f(x - .5)}" y="${f(y - 1.4)}" width="1" height="2.8" fill="#2a2d32" opacity=".55" transform="rotate(${a} ${x} ${y})"/>`) +
  `<circle cx="60" cy="60" r="47.5" fill="#0b0909"/><circle cx="60" cy="60" r="46.5" fill="url(#eb-face)" filter="url(#eb-grain)"/>` +
  `<circle cx="60" cy="60" r="40" fill="none" stroke="url(#eb-silver)" stroke-width="1"/><circle cx="60" cy="60" r="37.6" fill="none" stroke="#c3c9d1" stroke-width=".5" opacity=".55"/>` +
  around(8, 40, (x, y) => `<circle cx="${x}" cy="${y}" r="1.4" fill="url(#eb-silver)"/>`) +
  `<ellipse cx="60" cy="40" rx="34" ry="20" fill="url(#eb-shine)"/>`);

// 숲의 펠트: deep green wax, an oak-leaf ring pressed into it (matte, no shine).
const leaf = (x, y, a) => `<path d="M0 -6 C3.2 -3.6 3.4 2.2 0 6 C-3.4 2.2 -3.2 -3.6 0 -6Z M0 -5 L0 5" transform="translate(${x} ${y}) rotate(${a})" fill="#5f7a43" stroke="#21331b" stroke-width=".6"/>`;
const felt = svg('seal-felt',
  radial('fe-wax', [[0, '#4d6b3f'], [.55, '#2e4a28'], [1, '#162414']]) + radial('fe-press', [[0, '#1f3219'], [.8, '#2b4524'], [1, '#3d5a33']], '50%', '50%', '60%') + grain('fe-grain', '.55', .16, 11),
  `<path d="${blob(60, 62, 52, 5)}" fill="#000" opacity=".35"/>` +
  `<path d="${blob(60, 60, 52, 5)}" fill="url(#fe-wax)" filter="url(#fe-grain)"/>` +
  `<circle cx="60" cy="60" r="41" fill="url(#fe-press)"/><circle cx="60" cy="60" r="41" fill="none" stroke="#5f7a43" stroke-width="1.2" opacity=".65"/>` +
  around(14, 35.5, (x, y, a) => leaf(x, y, a + 30)) +
  `<circle cx="60" cy="60" r="29" fill="none" stroke="#7f9459" stroke-width=".9" opacity=".7"/>`);

// 아케인 블루: carved stone disc; an engraved ring and runes that glow sky blue. No metal anywhere.
const rune = (x, y, a, i) => { const shapes = ['M-2 -3 L2 3 M2 -3 L0 0', 'M-2 -3 L-2 3 L2 0', 'M0 -3 L0 3 M-2 -1 L2 1', 'M-2 3 L0 -3 L2 3', 'M-2 -3 L2 -3 L-2 3 L2 3']; return `<path d="${shapes[i % shapes.length]}" transform="translate(${x} ${y}) rotate(${a})" fill="none" stroke="#bfe6ff" stroke-width="1.1" stroke-linecap="round"/>`; };
let runeIndex = 0;
const arcane = svg('seal-arcane',
  radial('ar-stone', [[0, '#3d4a5e'], [.6, '#273041'], [1, '#141a24']]) + radial('ar-inner', [[0, '#1b2230'], [1, '#2a3446']], '50%', '45%', '65%') + grain('ar-grain', '.8', .22, 3) + glow('ar-glow', 2.2, 1.6),
  `<circle cx="60" cy="62" r="54" fill="#000" opacity=".4"/>` +
  `<circle cx="60" cy="60" r="54" fill="url(#ar-stone)" filter="url(#ar-grain)"/>` +
  `<circle cx="60" cy="60" r="53" fill="none" stroke="#0b0f16" stroke-width="2"/><circle cx="60" cy="60" r="51.5" fill="none" stroke="#5d8cb0" stroke-width=".7" opacity=".5"/>` +
  `<circle cx="60" cy="60" r="42" fill="url(#ar-inner)" stroke="#0b0f16" stroke-width="1.6"/>` +
  `<g filter="url(#ar-glow)"><circle cx="60" cy="60" r="38.5" fill="none" stroke="#8fd4ff" stroke-width="1.3"/>` +
  around(12, 46.8, (x, y, a) => rune(x, y, a, runeIndex++)) +
  `<circle cx="60" cy="60" r="33" fill="none" stroke="#8fd4ff" stroke-width=".6" stroke-dasharray="2 3.2" opacity=".75"/></g>`);

const seals = { 'seal-ebony': ebony, 'seal-felt': felt, 'seal-arcane': arcane };
for (const [name, text] of Object.entries(seals)) {
  await writeFile(join(OUT, `${name}.svg`), text);
  if (PREVIEW) await sharp(Buffer.from(text), { density: 288 }).resize(240, 240).png().toFile(join(PREVIEW, `${name}.png`));
}
console.log(JSON.stringify({ out: OUT, seals: Object.keys(seals) }));
