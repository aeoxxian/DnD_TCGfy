// v1.2 Phase 2 checks: hand momentum after a mouse drag (fast/slow, re-input, ends, filters/view switch, card
// selection, option + restart, reduced motion, 20/50/200 cards) and the wider tilt zone of the enlarged card.
// Runs on COPIES of repository-data. Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v12-p2-'));
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [], performance: [] };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

async function freshData() { const dir = await mkdtemp(join(run, 'data-')); await cp(resolve('repository-data/user-data'), dir, { recursive: true }); return dir; }
async function launch(userData, { width = 1366, height = 768, zoom = 1 } = {}) {
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DND_TCG_DEV_URL;
  if (dev) env.DND_TCG_DEV_URL = 'http://127.0.0.1:5173';
  const app = await electron.launch({ ...(binary ? { executablePath: binary, args: [] } : { args: ['.'] }), env, cwd: process.cwd(), timeout: 45000 });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(size.width, size.height); win.webContents.setZoomFactor(size.zoom); }, { width, height, zoom });
  await page.waitForSelector('.board'); await page.waitForTimeout(600);
  return { app, page, errors };
}
const saved = page => page.getByRole('status').filter({ hasText: '필터 저장됨' }).waitFor();
async function wholeLibrary(page) { const select = page.getByLabel('활성 캐릭터', { exact: true }); if (await select.inputValue()) { await select.selectOption(''); await saved(page); } await page.waitForTimeout(300); }
const hand = page => page.locator('.cards-area');
const scroll = page => hand(page).evaluate(el => el.scrollLeft);
const maxScroll = page => hand(page).evaluate(el => el.scrollWidth - el.clientWidth);
const gliding = page => hand(page).evaluate(el => el.dataset.gliding === 'true');
const pressedCount = page => page.locator('.cards-area .card-button[aria-pressed="true"]').count();
async function setScroll(page, value) { await page.waitForFunction(() => document.querySelector('.cards-area')?.dataset.gliding !== 'true', null, { timeout: 5000 }); await hand(page).evaluate((el, value) => { el.scrollLeft = value; }, value); await page.waitForTimeout(150); }
/** Records scrollLeft every frame for `ms` (started before the release so nothing is missed). */
const recordFrames = (page, ms) => hand(page).evaluate((el, ms) => new Promise(done => { const start = performance.now(), points = []; const tick = now => { points.push({ t: now - start, x: el.scrollLeft, gliding: el.dataset.gliding === 'true' }); if (now - start < ms) requestAnimationFrame(tick); else done(points); }; requestAnimationFrame(tick); }), ms);
/** Mouse drag on the hand. `pause` waits between moves (slow drag), `hold` rests before releasing. The release
 *  follows the last move immediately; the scroll position at release is read inside the page (pointerup). */
async function drag(page, { from = .75, to = .45, steps = 4, pause = 0, hold = 0, record = 1600 } = {}) {
  const box = await hand(page).boundingBox(); const y = box.y + Math.min(110, box.height / 2);
  const fromX = box.x + box.width * from, toX = box.x + box.width * to;
  // Also note when the page saw the last move and the release: a gap means the harness, not the user, paused.
  await hand(page).evaluate(el => { window.__released = undefined; window.__moves = []; const move = event => window.__moves.push({ t: event.timeStamp, x: event.clientX }); el.addEventListener('pointermove', move, { capture: true }); el.addEventListener('pointerup', event => { window.__released = el.scrollLeft; window.__up = event.timeStamp; el.removeEventListener('pointermove', move, { capture: true }); }, { once: true, capture: true }); });
  const frames = record ? recordFrames(page, record + steps * pause + hold) : undefined;
  await page.mouse.move(fromX, y); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(fromX + (toX - fromX) * i / steps, y); if (pause) await page.waitForTimeout(pause); }
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.up();
  const points = frames ? await frames : [];
  // `speed`: the pointer speed (px/ms) the app sees at release, over its 100 ms sample window (hand-inertia.ts).
  const { released, gap, speed } = await page.evaluate(() => { const moves = window.__moves, last = moves.at(-1); const first = moves.find(m => last.t - m.t <= 100) ?? last; const from = first === last ? moves.at(-2) ?? last : first;
    return { released: window.__released, gap: window.__up - last.t, speed: last.t > from.t ? Math.abs(last.x - from.x) / (last.t - from.t) : 0 }; });
  const final = points.length ? points.at(-1).x : await scroll(page);
  return { released, final, gap, speed, travelled: final - released, points: points.filter(p => p.x !== undefined) };
}
/** A quick flick from scroll position `start`. Playwright sometimes delivers moves late or spread out while the page is
 *  busy (e.g. loading 200 thumbnails); then the app rightly sees a paused or slow pointer. Such attempts are repeated,
 *  so every "fast" case really is a fast release: last move < 50 ms before the release (app threshold 80 ms) and a
 *  pointer speed ≥ 0.5 px/ms over the app's 100 ms window (app threshold 0.35 px/ms). */
async function flick(page, start, options = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await setScroll(page, start);
    const result = await drag(page, { from: .7, to: .55, steps: 3, ...options });
    if (result.gap < 50 && result.speed >= 0.5) return { ...result, attempt };
    await page.waitForTimeout(400);
  }
  throw new Error('the test harness could not deliver a fast flick (last move ≥ 50 ms before release, or slower than 0.5 px/ms)');
}
async function warmUp(page) { await page.waitForTimeout(800); await drag(page, { record: 0 }); await setScroll(page, 0); }
const monotonic = (points, sign) => points.every((p, i) => i === 0 || sign * (p.x - points[i - 1].x) >= -0.5);
async function openSettings(page) { await page.getByRole('button', { name: '환경 설정', exact: true }).click(); return page.getByRole('dialog', { name: '환경 설정', exact: true }); }
async function setOption(page, name, value) { const dialog = await openSettings(page); const box = dialog.getByRole('checkbox', { name, exact: true }); if (await box.isChecked() !== value) { await box.click(); await page.getByRole('status').filter({ hasText: '환경 설정 저장됨' }).waitFor(); } await dialog.getByRole('button', { name: '환경 설정 닫기', exact: true }).click(); }
function addCards(page, count) {
  return page.evaluate(async count => {
    const ok = r => { if (!r.ok) throw new Error(r.error); return r.value; };
    const lib = ok(await window.desktop.getBootstrap()); const images = lib.cards.filter(c => c.imageAssetId).map(c => c.imageAssetId);
    const start = lib.cards.filter(c => c.name.startsWith('관성 검수')).length;
    for (let i = 0; i < count; i += 50) ok(await window.desktop.saveCards({ cards: Array.from({ length: Math.min(50, count - i) }, (_, j) => ({ name: `관성 검수 ${String(start + i + j + 1).padStart(3, '0')}`, kind: 'other', roles: ['utility'], actions: ['action'], range: { kind: 'self' }, tags: [], imageAssetId: images[(start + i + j) % images.length] })) }));
  }, count);
}

// ---------------------------------------------------------------------------------------------
// 1. Momentum: fast vs slow drag, both ends, direction.
const userData = await freshData();
let { app, page, errors } = await launch(userData);
await wholeLibrary(page); await warmUp(page);
assert(await maxScroll(page) > 300, 'the whole library overflows the hand');
{
  const fast = await flick(page, 0);
  assert(fast.travelled > 40, `fast drag keeps moving after release: ${JSON.stringify({ released: fast.released, final: fast.final })}`);
  assert(monotonic(fast.points, 1), 'glide keeps the drag direction and never bounces back');
  assert(fast.points.some(p => p.gliding), 'glide starts');
  // The recording window is fixed; when Playwright delivers the moves late the glide can outlast it, so wait for its end.
  if (fast.points.at(-1).gliding) await page.waitForFunction(() => document.querySelector('.cards-area')?.dataset.gliding !== 'true', null, { timeout: 3000 });
  assert.equal(await gliding(page), false, 'glide ends');
  const speeds = fast.points.slice(1).map((p, i) => (p.x - fast.points[i].x) / Math.max(1, p.t - fast.points[i].t)).filter(v => v > 0);
  assert(speeds.length > 3 && speeds.at(-1) < speeds[0], `glide decelerates: ${speeds[0]?.toFixed(2)} → ${speeds.at(-1)?.toFixed(2)} px/ms`);
  await setScroll(page, 0);
  const slow = await drag(page, { from: .7, to: .55, steps: 15, pause: 30, hold: 150 });
  assert(Math.abs(slow.travelled) <= 1, `slow drag stops where it was released: ${slow.travelled}`);
  // Still moving, but slowly (about 0.15 px/ms, under the 0.35 px/ms threshold): no momentum either.
  await setScroll(page, 0);
  const slowMoving = await drag(page, { from: .7, to: .55, steps: 30, pause: 40 });
  assert(slowMoving.gap < 80 && Math.abs(slowMoving.travelled) <= 1, `slow moving release stops: ${JSON.stringify({ gap: slowMoving.gap, travelled: slowMoving.travelled })}`);
  // Towards the end: stops exactly at the last card, no overshoot; towards the start: stops at 0.
  const max = await maxScroll(page);
  const end = await flick(page, Math.max(0, max - 120), { to: .45 });
  assert(Math.abs(end.final - max) <= 1 && end.points.every(p => p.x <= max + 0.5), `stops at the end ${end.final}/${max}`);
  const start = await flick(page, 150, { from: .4, to: .7 });
  assert(start.final <= 1 && start.points.every(p => p.x >= -0.5), `stops at the start ${start.final}`);
  assert(monotonic(start.points, -1));
  check('Fast drag glides on in the same direction and eases out; slow/paused drag stops at release; glide stops exactly at either end of the hand', { fastAfterRelease: Math.round(fast.travelled), slowAfterRelease: Math.round(slow.travelled), slowMovingAfterRelease: Math.round(slowMoving.travelled), max });
}

// 2. Re-input during a glide and conflicts with selection/enlargement.
{
  await setScroll(page, 0); assert.equal(await pressedCount(page), 0);
  // A press while gliding stops it and does not pick the card under the pointer.
  const box = await hand(page).boundingBox(); const y = box.y + Math.min(110, box.height / 2);
  await flick(page, 0, { to: .6, steps: 2, record: 0 });
  await page.waitForTimeout(40); assert(await gliding(page), 'still gliding');
  await page.mouse.move(box.x + box.width * .5, y); await page.mouse.down();
  const caught = await scroll(page); await page.waitForTimeout(250);
  assert(Math.abs(await scroll(page) - caught) <= 1 && !await gliding(page), 'press stops the glide');
  await page.mouse.up(); await page.waitForTimeout(150);
  assert.equal(await pressedCount(page), 0, 'the stopping press did not select a card');
  // The next click on a card selects it, clicking it again enlarges it; a drag starting on it does neither.
  const card = page.locator('.cards-area .card-button').nth(3); const name = (await card.getAttribute('aria-label')).replace(/ 카드 선택$/, '');
  await card.click(); assert.equal(await card.getAttribute('aria-pressed'), 'true');
  const cardBox = await card.boundingBox();
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 60); await page.mouse.down();
  for (let i = 1; i <= 3; i++) await page.mouse.move(cardBox.x + cardBox.width / 2 - 70 * i, cardBox.y + 60);
  await page.mouse.up(); await page.waitForTimeout(700);
  assert.equal(await page.locator('.image-lightbox').count(), 0, 'a drag from the selected card never enlarges it');
  await page.getByRole('button', { name: `${name} 카드 선택`, exact: true }).click();
  await page.locator('.image-lightbox').waitFor(); await page.keyboard.press('Escape'); await page.locator('.image-lightbox').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '카드 선택 닫기', exact: true }).click();
  // Wheel during a glide: the glide stops, the wheel scroll still applies.
  await flick(page, 0, { to: .6, steps: 2, record: 0 }); await page.waitForTimeout(40); assert(await gliding(page));
  await page.mouse.move(box.x + box.width * .5, y); await page.mouse.wheel(0, 120); await page.waitForTimeout(30);
  assert(!await gliding(page), 'wheel stops the glide');
  const afterWheel = await scroll(page); await page.waitForTimeout(300); assert(Math.abs(await scroll(page) - afterWheel) <= 1);
  // Arrow-key navigation during a glide stops it too.
  await page.locator('.cards-area .card-button').first().focus();
  await flick(page, 0, { to: .6, steps: 2, record: 0 }); await page.waitForTimeout(40); assert(await gliding(page));
  await page.locator('.cards-area .card-button').first().focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(30);
  assert(!await gliding(page), 'arrow keys stop the glide');
  check('A press during a glide stops it without selecting; next click selects and re-click enlarges; drag from the selected card never enlarges; wheel and arrow keys stop the glide');
}

// 3. Filter change and view switch clear the glide.
{
  await flick(page, 0, { to: .6, steps: 2, record: 0 }); await page.waitForTimeout(30); assert(await gliding(page));
  await page.getByRole('searchbox', { name: '카드 이름 검색' }).fill('의'); await page.waitForTimeout(60);
  assert(!await gliding(page), 'filter change stops the glide');
  const filtered = await scroll(page); await page.waitForTimeout(250); assert(Math.abs(await scroll(page) - filtered) <= 1);
  await page.getByRole('button', { name: '필터 초기화' }).click(); await page.waitForTimeout(300);
  await flick(page, 0, { to: .6, steps: 2, record: 0 }); await page.waitForTimeout(30); assert(await gliding(page));
  await page.getByRole('button', { name: '격자', exact: true }).click(); await page.waitForTimeout(60);
  assert(!await gliding(page), 'switching to the grid stops the glide');
  await page.getByRole('button', { name: '손패', exact: true }).click(); await page.getByRole('status').filter({ hasText: '환경 설정 저장됨' }).waitFor();
  check('Changing a filter or switching hand/grid during a glide stops it immediately');
}

// 4. Option: off = immediate stop, persisted across restart; reduced motion (app and OS) turns it off.
{
  await setOption(page, '손패 관성 스크롤', false);
  let fast = await flick(page, 0);
  assert(Math.abs(fast.travelled) <= 1, 'option off: no momentum');
  const db = new DatabaseSync(join(userData, 'data', 'app.sqlite3'), { readOnly: true });
  const stored = db.prepare("SELECT key, value_json FROM settings WHERE key IN ('hand_scroll','effects')").all(); db.close();
  assert.deepEqual(JSON.parse(stored.find(row => row.key === 'hand_scroll').value_json), { inertia: false });
  assert.equal(stored.find(row => row.key === 'effects'), undefined, 'effects untouched');
  await app.close(); ({ app, page, errors } = await launch(userData));
  await wholeLibrary(page); await warmUp(page);
  let dialog = await openSettings(page); assert.equal(await dialog.getByRole('checkbox', { name: '손패 관성 스크롤' }).isChecked(), false); await dialog.getByRole('button', { name: '환경 설정 닫기' }).click();
  fast = await flick(page, 0); assert(Math.abs(fast.travelled) <= 1, 'still off after restart');
  await setOption(page, '손패 관성 스크롤', true);
  fast = await flick(page, 0); assert(fast.travelled > 40, 'on again');
  await setOption(page, '모션 줄이기', true);
  dialog = await openSettings(page); const box = dialog.getByRole('checkbox', { name: '손패 관성 스크롤' });
  assert.equal(await box.isChecked(), false); assert.equal(await box.isDisabled(), true); await dialog.getByRole('button', { name: '환경 설정 닫기' }).click();
  fast = await flick(page, 0); assert(Math.abs(fast.travelled) <= 1, 'app reduced motion: no momentum');
  await setOption(page, '모션 줄이기', false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  fast = await flick(page, 0); assert(Math.abs(fast.travelled) <= 1, 'Windows reduced motion: no momentum');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  fast = await flick(page, 0); assert(fast.travelled > 40);
  assert.deepEqual(errors, []);
  check('“손패 관성 스크롤” off stops at release and survives restart (own hand_scroll key, effects untouched); 모션 줄이기 and the Windows reduced-motion setting both turn momentum off');
}

// 5. Enlarged card: wider tilt zone, outside click still closes, option and reduced motion respected.
async function enlarge(page) {
  const card = page.locator('.cards-area .card-button').first();
  if (await card.getAttribute('aria-pressed') !== 'true') { await card.click(); await page.waitForTimeout(300); }
  await card.click(); const frame = page.locator('.image-lightbox .lightbox-card'); await frame.waitFor();
  // Tilt only starts once the opening animation has settled; under load that can take longer than a fixed wait.
  await page.waitForFunction(() => { const el = document.querySelector('.image-lightbox .lightbox-card'); return el && el.getAnimations().length === 0 && document.querySelector('.image-lightbox').getAnimations().length === 0; });
  await page.waitForTimeout(150);
  return frame.boundingBox();
}
const transformAt = async (page, x, y, wait = 400) => { await page.mouse.move(x, y, { steps: 5 }); await page.waitForTimeout(wait); return page.locator('.image-lightbox img').evaluate(img => ({ inline: img.style.transform, computed: getComputedStyle(img).transform })); };
const rotateY = inline => Number(inline.match(/rotateY\(([-\d.]+)deg\)/)?.[1] ?? 0);
{
  await setScroll(page, 0);
  let card = await enlarge(page); const cy = card.y + card.height / 2;
  const margin = await page.evaluate(() => Math.round(Math.max(60, Math.min(100, Math.min(innerWidth, innerHeight) * 0.08))));
  const inside = await transformAt(page, card.x + card.width - 20, cy);
  const near = await transformAt(page, card.x + card.width + margin - 15, cy);
  assert(rotateY(inside.inline) > 4 && rotateY(near.inline) === 6, `held near the edge ${JSON.stringify({ inside, near, margin })}`);
  const left = await transformAt(page, card.x - margin + 15, cy); assert.equal(rotateY(left.inline), -6);
  // Leaving the zone eases back (still leaning shortly after, flat once the 350 ms return is over).
  await page.mouse.move(card.x + card.width + margin + 60, cy);
  const mid = await page.locator('.image-lightbox img').evaluate(img => new Promise(done => setTimeout(() => done({ inline: img.style.transform, transition: img.style.transition, computed: getComputedStyle(img).transform }), 90)));
  assert.equal(mid.inline, ''); assert.match(mid.transition, /350ms/); assert.notEqual(mid.computed, 'none', 'returns with a transition, not a jump');
  await page.waitForTimeout(450); assert.equal(await page.locator('.image-lightbox img').evaluate(img => getComputedStyle(img).transform), 'none');
  // A click inside the tilt zone but outside the card still closes; clicking the card does not.
  await page.mouse.click(card.x + card.width / 2, cy); await page.waitForTimeout(300); assert.equal(await page.locator('.image-lightbox').count(), 1, 'card click keeps it open');
  await transformAt(page, card.x + card.width + 30, cy, 200);
  await page.mouse.click(card.x + card.width + 30, cy); await page.locator('.image-lightbox').waitFor({ state: 'detached' });
  // Tilt option off and reduced motion: no lean anywhere.
  await setOption(page, '확대 카드 3D 기울임', false);
  card = await enlarge(page); let off = await transformAt(page, card.x + card.width - 20, card.y + card.height / 2); assert.equal(off.inline, '');
  await page.keyboard.press('Escape'); await page.locator('.image-lightbox').waitFor({ state: 'detached' });
  await setOption(page, '확대 카드 3D 기울임', true); await setOption(page, '모션 줄이기', true);
  card = await enlarge(page); off = await transformAt(page, card.x + card.width + 30, card.y + card.height / 2); assert.equal(off.inline, '');
  await page.keyboard.press('Escape'); await page.locator('.image-lightbox').waitFor({ state: 'detached' });
  await setOption(page, '모션 줄이기', false);
  check('Tilt follows the pointer up to the margin outside the card (held at the 6° edge value), eases back over 350 ms beyond it; outside clicks inside the zone still close, card clicks do not; tilt off / reduced motion = no lean', { margin });
  await app.close();
}

// 6. Tilt margin at other window sizes and scales (CSS px).
for (const [width, height, zoom] of [[1920, 1080, 1], [1280, 720, 1.25], [1280, 720, 1.5]]) {
  const run2 = await launch(await freshData(), { width, height, zoom });
  await wholeLibrary(run2.page);
  const card = await enlarge(run2.page);
  const { margin, w } = await run2.page.evaluate(() => ({ w: innerWidth, margin: Math.round(Math.max(60, Math.min(100, Math.min(innerWidth, innerHeight) * 0.08))) }));
  const x = card.x + card.width;
  const within = await transformAt(run2.page, Math.min(w - 2, x + margin - 8), card.y + card.height / 2);
  assert.equal(rotateY(within.inline), 6, `lean within ${margin}px at ${width}x${height}@${zoom}`);
  if (x + margin + 10 < w) { const beyond = await transformAt(run2.page, x + margin + 10, card.y + card.height / 2, 450); assert.equal(beyond.computed, 'none'); }
  report.checks.at(-1)[`margin_${width}x${height}@${zoom}`] = margin;
  await run2.app.close();
}
check('Tilt margin follows the window: 86 px at 1920×1080, 60 px at 1280×720 125%/150% (CSS px), lean held inside it and released beyond');

// 7. 20 / 50 / 200 cards: glide frames and no React re-render of the cards during a glide.
{
  const perfData = await freshData();
  let perf = await launch(perfData, { width: 1920, height: 1080 });
  await wholeLibrary(perf.page);
  for (const target of [20, 50, 200]) {
    const have = (await perf.page.evaluate(async () => (await window.desktop.getBootstrap()).value.cards.length));
    if (have < target) { await addCards(perf.page, target - have); await perf.app.close(); perf = await launch(perfData, { width: 1920, height: 1080 }); await wholeLibrary(perf.page); }
    await perf.page.waitForFunction(n => document.querySelectorAll('.cards-area .card-button').length === n, target);
    await warmUp(perf.page);
    // Count DOM changes under the hand during the glide (anything except the glide flag means React re-rendered cards).
    await hand(perf.page).evaluate(el => { window.__mutations = []; window.__observer = new MutationObserver(list => { for (const m of list) window.__mutations.push({ at: performance.now(), type: m.type, attribute: m.attributeName, target: m.target === el ? 'cards-area' : (m.target.className?.baseVal ?? m.target.className ?? m.target.nodeName), value: m.attributeName ? m.target.getAttribute?.(m.attributeName) : undefined }); }); window.__observer.observe(el, { subtree: true, childList: true, attributes: true, characterData: true }); });
    const result = await flick(perf.page, 0, { from: .75, to: .6, record: 1400 });
    // From the first glide frame on, the only allowed DOM change is the glide flag and the drag class leaving the hand itself.
    const changes = await perf.page.evaluate(() => { window.__observer.disconnect(); return window.__mutations; });
    const firstGlide = changes.find(m => m.attribute === 'data-gliding')?.at ?? Infinity;
    const during = changes.filter(m => m.at >= firstGlide && !(m.attribute === 'data-gliding') && !(m.target === 'cards-area' && m.attribute === 'class'));
    const mutations = during.length; if (mutations) console.log(JSON.stringify(during.slice(0, 12)));
    const glide = result.points.filter(p => p.gliding); const gaps = glide.slice(1).map((p, i) => p.t - glide[i].t).sort((a, b) => a - b);
    const entry = { cards: target, travelledAfterReleasePx: Math.round(result.travelled), glideFrames: glide.length, frameMedianMs: Number(gaps[Math.floor(gaps.length / 2)]?.toFixed(1)), frameP95Ms: Number(gaps[Math.floor(gaps.length * .95)]?.toFixed(1)), frameMaxMs: Number(gaps.at(-1)?.toFixed(1)), domMutationsDuringGlide: mutations };
    report.performance.push(entry); console.log(JSON.stringify(entry));
    assert(result.travelled > 40, `glides with ${target} cards`); assert.equal(mutations, 0, 'no card re-render during the glide'); assert(entry.frameMedianMs <= 25, `smooth glide with ${target} cards`);
  }
  assert.deepEqual(perf.errors, []);
  await perf.app.close();
  check('20/50/200 cards: glide frame times recorded, no DOM change under the hand during a glide (no React re-render)', { performance: report.performance });
}

if (server) await server.close();
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, checks: report.checks.length, run }, null, 2));
