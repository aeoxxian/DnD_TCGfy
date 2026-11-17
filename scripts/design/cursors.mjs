// v1.1 Phase 4 cursor DRAFTS (not applied to the app until the user approves one).
// Writes docs/design/cursors/{a,b}-{default,pointer,grab,grabbing}.svg and a self-contained preview page.
// Usage: node scripts/design/cursors.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const out = resolve('docs/design/cursors');
const SIZE = 24; // CSS px at 100%; Windows scales it with the display like the system cursor.
const palettes = {
  a: { name: '시안 A · 철과 금', note: '어두운 철 바탕에 금테. 가죽 매트·금속 장식과 같은 계열.', fill: '#2a1c12', edge: '#d9b86c', cuff: '#8a6a2f', shine: '#f4e2b0' },
  b: { name: '시안 B · 상아와 잉크', note: '상아색 바탕에 잉크 테와 루비 소매. 양피지 계열이라 어두운 가죽 위에서 더 잘 보임.', fill: '#f3ead6', edge: '#2a1c12', cuff: '#a3283a', shine: '#ffffff' },
};
// Hotspots are the exact pixel the click lands on: arrow tip, fingertip, centre of the hand.
const shapes = {
  default: { label: '기본', hotspot: [1, 1], body: p => `<path d="M1 1 L1 18.6 L5.6 14.2 L8.8 20.9 L12.4 19.4 L9.3 12.9 L15.5 12.9 Z" fill="${p.edge}"/><path d="M2.3 3.9 L2.3 15.8 L6 12.3 L9.4 19.2 L11 18.5 L7.8 11.7 L12.6 11.7 Z" fill="${p.fill}"/><path d="M3.1 5.6 L3.1 9.5" stroke="${p.shine}" stroke-opacity=".55" stroke-width=".9" stroke-linecap="round"/>` },
  pointer: { label: '클릭 가능', hotspot: [8, 1], body: p => hand(p, `
    <rect x="2.8" y="11.6" width="5.6" height="3.4" rx="1.7" transform="rotate(28 5.6 13.3)"/>
    <rect x="10.3" y="8.8" width="3.4" height="5.2" rx="1.7"/><rect x="13.4" y="9.6" width="3.4" height="5.2" rx="1.7"/><rect x="16.4" y="10.8" width="3.1" height="4.8" rx="1.55"/>
    <rect x="6.2" y="10.4" width="13.4" height="8.4" rx="3"/>
    <rect x="6.3" y="1.55" width="3.6" height="12" rx="1.8"/>`, '<rect x="7.4" y="18.2" width="11.4" height="4.6" rx=".9"/>', '<path d="M7.4 3.6 V8.2"/>') },
  grab: { label: '손패 드래그 가능', hotspot: [12, 12], body: p => hand(p, `
    <rect x="2" y="10.5" width="6.5" height="3.3" rx="1.65" transform="rotate(32 5.2 12.1)"/>
    <rect x="5.6" y="3" width="3.3" height="9.5" rx="1.65" transform="rotate(-12 7.2 7.7)"/><rect x="9" y="1.6" width="3.3" height="10.5" rx="1.65"/>
    <rect x="12.4" y="2" width="3.3" height="10.2" rx="1.65" transform="rotate(5 14 7)"/><rect x="15.6" y="4.2" width="3" height="8.6" rx="1.5" transform="rotate(14 17 8.5)"/>
    <rect x="5.8" y="9.2" width="12.6" height="9.6" rx="3.6"/>`, '<rect x="7.6" y="17.8" width="9.2" height="4.6" rx=".9"/>', '<path d="M10.1 3.4 V7.6"/>') },
  grabbing: { label: '드래그 중', hotspot: [12, 12], body: p => hand(p, `
    <rect x="5.8" y="6" width="3.4" height="5.2" rx="1.7"/><rect x="8.9" y="5.4" width="3.4" height="5.6" rx="1.7"/><rect x="12" y="5.5" width="3.4" height="5.5" rx="1.7"/><rect x="15.1" y="6.4" width="3.2" height="5" rx="1.6"/>
    <rect x="5.2" y="8" width="13.6" height="10.2" rx="3.6"/>
    <rect x="4.4" y="11.6" width="8.6" height="3.3" rx="1.65"/>`, '<rect x="7.4" y="17.6" width="9.6" height="4.6" rx=".9"/>', '<path d="M9.4 9.4 H13.6"/>') },
};
function hand(p, parts, cuff, shine) {
  return `<g fill="${p.fill}" stroke="${p.edge}" stroke-width="1.1" stroke-linejoin="round">${parts}</g>`
    + `<g fill="${p.cuff}" stroke="${p.edge}" stroke-width="1.1" stroke-linejoin="round">${cuff}</g>`
    + `<g fill="none" stroke="${p.shine}" stroke-opacity=".5" stroke-width=".8" stroke-linecap="round">${shine}</g>`;
}
const svg = (p, s) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">${s.body(p)}</svg>`;
const dataUri = text => `data:image/svg+xml,${encodeURIComponent(text)}`;
const css = (p, kind) => `url("${dataUri(svg(p, shapes[kind]))}") ${shapes[kind].hotspot.join(' ')}`;

await mkdir(out, { recursive: true });
for (const [id, p] of Object.entries(palettes)) for (const kind of Object.keys(shapes)) await writeFile(join(out, `${id}-${kind}.svg`), svg(p, shapes[kind]) + '\n');

const sheet = (id, p) => `<section class="draft" aria-labelledby="t-${id}">
  <h2 id="t-${id}">${p.name}</h2><p class="note">${p.note}</p>
  <div class="grid">${Object.entries(shapes).map(([kind, s]) => `<figure>
    <div class="scales">${[1, 1.25, 1.5].map(k => `<div class="tile ${kind === 'default' ? '' : ''}"><span class="img" style="width:${SIZE * k}px;height:${SIZE * k}px">${svg(p, s).replace(`width="${SIZE}" height="${SIZE}"`, `width="${SIZE * k}" height="${SIZE * k}"`)}<i class="hot" style="left:${s.hotspot[0] * k}px;top:${s.hotspot[1] * k}px"></i></span><small>${k * 100}%</small></div>`).join('')}</div>
    <figcaption><strong>${s.label}</strong><span>클릭 지점 (${s.hotspot.join(', ')})</span></figcaption></figure>`).join('')}</div>
</section>`;
const cursorRules = Object.entries(palettes).map(([id, p]) => `
  .try.${id} { cursor: ${css(p, 'default')}, auto; }
  .try.${id} :is(button, .card, a) { cursor: ${css(p, 'pointer')}, pointer; }
  .try.${id} .hand { cursor: ${css(p, 'grab')}, grab; }
  .try.${id} .hand:active, .try.${id} .hand.dragging { cursor: ${css(p, 'grabbing')}, grabbing; }
  .try.${id} input { cursor: text; }`).join('\n');
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>커서 시안</title>
<style>
  :root { --leather: #2b1a14; --leather-2: #3a231b; --parchment: #e9e1cf; --ink: #2a1c12; --gold: #d9b86c; --muted: #6b5a48; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 40px; background: var(--leather); color: #f1e6cf; font: 14px/1.6 "Malgun Gothic", system-ui, sans-serif; }
  main { max-width: 980px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font: 700 22px "Palatino Linotype", Batang, serif; color: var(--gold); }
  .lead { margin: 0 0 20px; color: #d8c8a8; }
  .draft { margin: 0 0 18px; padding: 16px; border-radius: 8px; background: var(--parchment); color: var(--ink); box-shadow: 0 8px 20px rgba(0,0,0,.45); }
  .draft h2 { margin: 0; font: 700 17px "Palatino Linotype", Batang, serif; }
  .note { margin: 2px 0 12px; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  figure { margin: 0; padding: 10px; border-radius: 6px; background: linear-gradient(90deg, var(--leather) 50%, #f6f0e2 50%); }
  .scales { display: flex; justify-content: space-around; align-items: flex-end; gap: 6px; min-height: 64px; }
  .tile { display: grid; justify-items: center; gap: 2px; }
  .tile small { font-size: 10px; color: #a8957a; }
  .img { position: relative; display: block; }
  .img svg { display: block; }
  .hot { position: absolute; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%; background: #ff2d55; box-shadow: 0 0 0 1px #fff; }
  figcaption { display: flex; justify-content: space-between; margin-top: 8px; padding: 4px 6px; border-radius: 4px; background: var(--parchment); font-size: 12px; }
  figcaption span { color: var(--muted); }
  .test { padding: 16px; border-radius: 8px; background: var(--leather-2); box-shadow: inset 0 0 0 1px #000; }
  .test h2 { margin: 0 0 8px; font: 700 17px "Palatino Linotype", Batang, serif; color: var(--gold); }
  .switch { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .switch label { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: #1a100c; cursor: pointer; }
  .try { display: grid; gap: 12px; padding: 14px; border-radius: 6px; background: #20140f; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .try button { padding: 8px 14px; border: 0; border-radius: 4px; background: linear-gradient(#4a2f22, #2b1a14); color: var(--gold); font-weight: 700; box-shadow: 0 0 0 1px #000, inset 0 1px 0 rgba(255,220,160,.2); }
  .try input { width: 220px; padding: 7px 10px; border: 0; border-radius: 4px; background: var(--parchment); color: var(--ink); font: inherit; }
  .hand { display: flex; gap: 10px; overflow-x: auto; padding: 12px; border-radius: 6px; background: repeating-linear-gradient(90deg, #2b1a14 0 40px, #301d16 40px 80px); user-select: none; }
  .card { flex: none; width: 70px; height: 102px; border-radius: 6px; background: linear-gradient(160deg, #7a1d27, #2a0d12); box-shadow: 0 0 0 1px #000, 0 6px 12px rgba(0,0,0,.6); display: grid; place-items: end center; padding-bottom: 6px; color: #f1e6cf; font-size: 11px; }
  .target { position: relative; width: 120px; height: 60px; border-radius: 4px; background: var(--parchment); color: var(--ink); display: grid; place-items: center; font-size: 12px; }
  .target::before, .target::after { content: ''; position: absolute; left: 50%; top: 50%; background: #a3283a; }
  .target::before { width: 1px; height: 100%; top: 0; } .target::after { height: 1px; width: 100%; left: 0; }
  .hint { margin: 0; color: #c9b893; font-size: 12px; }
  @media (max-width: 600px) { .try input { width: 100%; } }
  ${cursorRules}
</style></head>
<body><main>
  <h1>DnD TCG-fy 커서 시안</h1>
  <p class="lead">아직 앱에 적용하지 않은 시안입니다. 네 가지 상태(기본·클릭 가능·손패 드래그 가능·드래그 중)를 같은 모양 두 색으로 만들었습니다. 빨간 점이 실제 클릭 지점(핫스팟)이며, 100·125·150% 크기로 가죽(왼쪽)·양피지(오른쪽) 위에 놓았습니다.</p>
  ${Object.entries(palettes).map(([id, p]) => sheet(id, p)).join('\n')}
  <section class="test" aria-labelledby="t-try"><h2 id="t-try">직접 움직여 보기</h2>
    <div class="switch" role="radiogroup" aria-label="미리 볼 커서">
      <label><input type="radio" name="c" value="a" checked> 시안 A</label><label><input type="radio" name="c" value="b"> 시안 B</label><label><input type="radio" name="c" value="system"> 시스템 커서</label>
    </div>
    <div class="try a" id="try">
      <div class="row"><button type="button">사용 확정</button><button type="button">긴 휴식</button><input type="search" placeholder="카드 이름 검색 (텍스트 커서 유지)"></div>
      <div class="hand" id="hand">${['차원참', '참철세', '응보의 흑영', '주박', '지옥문', '혼백참', '섬뜩한 영창', '추영섬'].map(name => `<div class="card" role="button" tabindex="0">${name}</div>`).join('')}</div>
      <div class="row"><div class="target">정중앙 클릭</div><p class="hint">클릭 지점 확인: 십자선 가운데를 커서 끝으로 눌러 보세요. 아래에 누른 좌표가 표시됩니다.</p><output id="hit" class="hint"></output></div>
    </div>
  </section>
</main>
<script>
  const area = document.getElementById('try');
  for (const input of document.querySelectorAll('input[name=c]')) input.addEventListener('change', () => { area.className = 'try ' + (input.value === 'system' ? '' : input.value); });
  const hand = document.getElementById('hand'); let drag;
  hand.addEventListener('pointerdown', e => { drag = { x: e.clientX, s: hand.scrollLeft }; hand.classList.add('dragging'); hand.setPointerCapture(e.pointerId); });
  hand.addEventListener('pointermove', e => { if (drag) hand.scrollLeft = drag.s - (e.clientX - drag.x); });
  const end = () => { drag = undefined; hand.classList.remove('dragging'); };
  hand.addEventListener('pointerup', end); hand.addEventListener('pointercancel', end);
  const target = document.querySelector('.target'), hit = document.getElementById('hit');
  target.addEventListener('click', e => { const r = target.getBoundingClientRect(); hit.textContent = '중심에서 ' + Math.round(e.clientX - r.left - r.width / 2) + 'px, ' + Math.round(e.clientY - r.top - r.height / 2) + 'px'; });
</script>
</body></html>
`;
await writeFile(join(out, 'preview.html'), html);
console.log(JSON.stringify({ out, files: Object.keys(palettes).length * Object.keys(shapes).length + 1 }));
