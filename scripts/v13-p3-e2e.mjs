// v1.3 Phase 3 checks (UI-P0 layout skeleton): three columns — IN PLAY over USED | card page over HAND | ledger over
// DECK — at 1920×1080, 1366×768 and 1280×720 with 100/125/150% scaling (real device scale factor) and the minimum window;
// no overlaps or clipping, the Use seal and the recovery buttons fully visible, the IN PLAY card keeps its ratio, the
// collapsed ledger keeps the deck, the 반응 행동 quick button, stable panels when filters change, and all four themes.
// Runs on COPIES of repository-data. Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v13-p3-'));
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [] };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

async function freshData() { const dir = await mkdtemp(join(run, 'data-')); await cp(resolve('repository-data/user-data'), dir, { recursive: true }); return dir; }
async function launch(userData, scale = 1) {
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DND_TCG_DEV_URL;
  if (dev) env.DND_TCG_DEV_URL = 'http://127.0.0.1:5173';
  const args = [`--force-device-scale-factor=${scale}`];
  const app = await electron.launch({ ...(binary ? { executablePath: binary, args } : { args: ['.', ...args] }), env, cwd: process.cwd(), timeout: 45000 });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.waitForSelector('.board'); await page.waitForTimeout(500);
  return { app, page, errors };
}
async function resize(app, page, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
  await page.waitForTimeout(450);
}
async function selectCard(page) {
  const card = page.locator('.cards-area .card-button').first(); await card.scrollIntoViewIfNeeded();
  if (await card.getAttribute('aria-pressed') !== 'true') await card.click();
  await page.mouse.move(1, 1); await page.locator('.use-button').waitFor(); await page.waitForTimeout(300);
}
/** Rectangles of every zone plus the facts the layout promises. */
const measure = page => page.evaluate(() => {
  const r = sel => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const zones = { inPlay: r('.board-left > .in-play-slot'), used: r('.board-left > .used-pile'), page: r('.board-center > .detail-panel'), hand: r('.board-center > .hand-row'), ledger: r('.board-right > .resource-panel'), deck: r('.board-right > .deck-pile') };
  const card = r('.in-play-slot .detail-card'); const seal = r('.use-button'); const codex = r('.codex-page');
  const coins = [...document.querySelectorAll('.rest-buttons button')].map(el => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom }; });
  const piles = [...document.querySelectorAll('.board-column .pile')].map(el => el.getBoundingClientRect().height);
  return { zones, card, seal, codex, coins, piles, grid: r('.board-grid'), filters: r('.board-top'), vw: innerWidth, vh: innerHeight,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    collapsed: document.querySelector('.app.resources-collapsed') !== null };
});
const inside = (a, b, slack = 1) => a.x >= b.x - slack && a.y >= b.y - slack && a.r <= b.r + slack && a.b <= b.b + slack;
const overlap = (a, b) => Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1;
function assertLayout(m, label, { collapsed = false } = {}) {
  const z = m.zones; for (const [name, box] of Object.entries(z)) assert(box && box.w > 20 && box.h > 20, `${label}: ${name} is shown`);
  const view = { x: 0, y: 0, r: m.vw, b: m.vh };
  for (const [name, box] of Object.entries(z)) assert(inside(box, m.grid, 2) && inside(box, view), `${label}: ${name} inside the board and window ${JSON.stringify(box)}`);
  const names = Object.keys(z); for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) assert(!overlap(z[names[i]], z[names[j]]), `${label}: ${names[i]} and ${names[j]} do not overlap`);
  // Columns: left | centre | right; within a column: top over bottom.
  assert(z.inPlay.r <= z.page.x && z.used.r <= z.hand.x, `${label}: left column left of the centre`);
  assert(z.page.r <= z.ledger.x && z.hand.r <= z.deck.x, `${label}: right column right of the centre`);
  assert(z.used.y >= z.inPlay.b && z.hand.y >= z.page.b && z.deck.y >= z.ledger.b, `${label}: IN PLAY over USED, card page over HAND, ledger over DECK`);
  const share = z.inPlay.w / m.grid.w; assert(share > .14 && share < .27, `${label}: left column ${Math.round(share * 100)}% of the mat`);
  if (collapsed) assert(z.ledger.w < 130, `${label}: collapsed ledger is narrow`);
  assert(m.card && inside(m.card, z.inPlay, 1) && Math.abs(m.card.h / m.card.w - 1.458) < .03, `${label}: IN PLAY card keeps 1:1.458 inside its slot ${JSON.stringify(m.card)}`);
  assert(m.seal && inside(m.seal, m.codex, 1) && inside(m.seal, view), `${label}: the Use seal is fully visible ${JSON.stringify({ seal: m.seal, codex: m.codex })}`);
  if (!collapsed) { assert.equal(m.coins.length, 4); for (const coin of m.coins) assert(inside(coin, z.ledger, 1) && inside(coin, view), `${label}: recovery buttons fully visible`); }
  assert(m.piles.length === 2 && m.piles.every(h => h >= 40), `${label}: both piles visible ${JSON.stringify(m.piles)}`);
  assert(m.overflow <= 0, `${label}: no horizontal page scroll`);
}

const SIZES = [[1920, 1080, 1], [1366, 768, 1], [1280, 720, 1], [1920, 1080, 1.25], [1366, 768, 1.25], [1280, 720, 1.5]];
const results = {};
for (const scale of [1, 1.25, 1.5]) {
  const { app, page, errors } = await launch(await freshData(), scale);
  for (const [w, h] of SIZES.filter(s => s[2] === scale)) {
    await resize(app, page, Math.round(w / scale), Math.round(h / scale)); await selectCard(page);
    const m = await measure(page); assertLayout(m, `${w}×${h} @${scale * 100}%`);
    results[`${w}x${h}@${scale * 100}`] = { leftShare: +(m.zones.inPlay.w / m.grid.w).toFixed(3), viewport: `${m.vw}×${m.vh}` };
  }
  if (scale === 1) {
    await resize(app, page, 860, 440); await selectCard(page);
    assertLayout(await measure(page), 'minimum window 860×440');
  }
  assert.deepEqual(errors, []); await app.close();
}
check('Three columns at 1920×1080, 1366×768, 1280×720 × 100/125/150% and the 860×440 minimum: IN PLAY over USED | card page over HAND | ledger over DECK, no overlap or clipping, IN PLAY card at 1:1.458, Use seal, recovery buttons and both piles fully visible, no page scroll', results);

{
  const userData = await freshData();
  const { app, page, errors } = await launch(userData);
  await resize(app, page, 1366, 768); await selectCard(page);
  const before = await measure(page);
  // 반응 행동 sits with the other quick buttons and filters like them.
  const quick = page.getByRole('group', { name: '행동 빠른 선택', exact: true });
  assert.deepEqual(await quick.getByRole('button').allTextContents(), ['행동', '보너스 행동', '반응 행동']);
  const count = () => page.getByLabel('표시 카드 수', { exact: true }).textContent();
  const all = await count();
  await quick.getByRole('button', { name: '반응 행동', exact: true }).click(); await page.waitForTimeout(300);
  assert.equal(await quick.getByRole('button', { name: '반응 행동', exact: true }).getAttribute('aria-pressed'), 'true');
  const state = await page.evaluate(async () => (await window.desktop.getBootstrap()).value.libraryState.actions);
  assert.deepEqual(state, ['reaction']);
  const after = await measure(page);
  for (const name of ['page', 'hand', 'inPlay', 'ledger']) assert.deepEqual(after.zones[name], before.zones[name], `${name} does not move when a filter changes`);
  await quick.getByRole('button', { name: '반응 행동', exact: true }).click(); await page.waitForFunction(text => document.querySelector('[aria-label="표시 카드 수"]')?.textContent === text, all);
  await selectCard(page); // the filter may have hidden (and so deselected) the selected card
  check('반응 행동 joins the quick action buttons, filters through the same setting, and changing filters moves no panel');

  // Collapsing the ledger narrows the right column, keeps the deck and widens the centre.
  await page.getByRole('button', { name: '자원 패널 접기', exact: true }).click(); await page.waitForTimeout(400);
  const collapsed = await measure(page); assert(collapsed.collapsed);
  assertLayout(collapsed, 'collapsed ledger', { collapsed: true });
  assert(collapsed.zones.page.w > before.zones.page.w + 80, 'the centre widens when the ledger is collapsed');
  await page.getByRole('button', { name: '자원 패널 펼치기', exact: true }).click(); await page.waitForTimeout(400);
  assertLayout(await measure(page), 'expanded again');
  check('Collapsing the ledger narrows the right column but keeps the deck; expanding restores the layout');

  for (const theme of ['oxblood', 'ebony', 'verdant', 'abyss']) {
    await page.evaluate(async theme => { const s = (await window.desktop.getBootstrap()).value.settings; const r = await window.desktop.saveSettings({ ...s, appearance: { ...(s.appearance ?? { cardBack: { default: { type: 'builtin', id: 'dragon' }, decks: {} }, customBacks: [] }), theme } }); if (!r.ok) throw new Error(r.error); }, theme);
    await page.reload(); await page.waitForSelector('.board'); await page.waitForTimeout(400); await selectCard(page);
    assertLayout(await measure(page), `theme ${theme}`);
  }
  check('All four themes share the same three-column layout without overlap or clipping');
  assert.deepEqual(errors, []); await app.close();
}

if (server) await server.close();
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, checks: report.checks.length, run }, null, 2));
