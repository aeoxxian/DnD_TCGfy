// v1.1 Phase 1 checks: overlay filter popover, fixed layout, selected-state marks and action quick filters.
// Runs on a COPY of repository-data. Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { showWholeLibrary } from './navigation-helpers.mjs';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v11-p1-'));
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', matrix: [], checks: [] };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

async function launch(scale = 1, width = 1366, height = 768) {
  const userData = await mkdtemp(join(run, 'data-'));
  await cp(resolve('repository-data/user-data'), userData, { recursive: true });
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DND_TCG_DEV_URL;
  if (dev) env.DND_TCG_DEV_URL = 'http://127.0.0.1:5173';
  const args = [`--force-device-scale-factor=${scale}`];
  const app = await electron.launch({ ...(binary ? { executablePath: binary, args } : { args: ['.', ...args] }), env, cwd: process.cwd(), timeout: 45000 });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(Math.round(size.width / size.scale), Math.round(size.height / size.scale)), { width, height, scale });
  await page.waitForSelector('.board'); await page.waitForTimeout(600);
  return { app, page };
}
const layout = page => page.evaluate(() => Object.fromEntries(['.board-top', '.detail-panel', '.hand-row'].map(sel => {
  const r = document.querySelector(sel).getBoundingClientRect(); return [sel, [Math.round(r.top), Math.round(r.left), Math.round(r.width), Math.round(r.height)]];
})));
const isOpen = page => page.locator('#extra-filters-panel').evaluate(el => el.matches(':popover-open'));
async function openPanel(page) { if (!await isOpen(page)) await page.locator('.extra-filters-toggle').click(); await page.locator('#extra-filters-panel').waitFor({ state: 'visible' }); }
const panelGroup = (page, name) => page.locator('#extra-filters-panel').getByRole('group', { name, exact: true });
const visibleCount = page => page.locator('[aria-label="표시 카드 수"]').textContent();

// 1. Layout never moves and the popover stays on screen, across sizes and Windows scaling.
for (const [width, height] of [[1366, 768], [1920, 1080], [1280, 720]]) for (const scale of [1, 1.25, 1.5]) {
  const { app, page } = await launch(scale, width, height);
  const base = await layout(page);
  await openPanel(page);
  const opened = await layout(page);
  const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const panel = await page.locator('#extra-filters-panel').evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, scroll: el.scrollHeight > el.clientHeight, overflowY: getComputedStyle(el).overflowY }; });
  assert(panel.left >= 0 && panel.top >= 0 && panel.right <= viewport.w + 0.5 && panel.bottom <= viewport.h + 0.5, `popover inside viewport ${JSON.stringify({ panel, viewport })}`);
  assert.equal(panel.overflowY, 'auto');
  await panelGroup(page, '행동 경제 필터').getByRole('button', { name: '반응 행동', exact: true }).click();
  await panelGroup(page, '카드 유형 필터').getByRole('button', { name: '주문', exact: true }).click();
  await panelGroup(page, '사거리 필터').getByRole('button', { name: '원거리', exact: true }).click();
  assert.equal(await isOpen(page), true, 'popover stays open while choosing filters');
  const selected = await layout(page);
  await page.keyboard.press('Escape');
  await page.getByRole('group', { name: '역할 필터' }).getByRole('button', { name: '공격', exact: true }).click();
  await page.getByRole('group', { name: '행동 빠른 선택' }).getByRole('button', { name: '보너스 행동', exact: true }).click();
  await page.waitForTimeout(250);
  const applied = await layout(page);
  for (const state of [opened, selected, applied]) assert.deepEqual(state, base, `layout unchanged at ${width}x${height}@${scale}`);
  report.matrix.push({ width, height, scale, viewport, base, panelScrolls: panel.scroll });
  await app.close();
}
check('popover overlays without moving the filter bar, IN PLAY zone or hand; it stays on screen at 1280x720, 1366x768 and 1920x1080 with 100/125/150% scaling', { runs: report.matrix.length });

// 2. Interaction details at 1366x768.
const { app, page } = await launch(1);
await openPanel(page);
await page.locator('.hand-header').click({ position: { x: 5, y: 5 } });
assert.equal(await isOpen(page), false);
check('clicking outside closes the popover');
await page.locator('.extra-filters-toggle').focus(); await page.keyboard.press('Enter');
await page.locator('#extra-filters-panel').waitFor({ state: 'visible' });
await page.keyboard.press('Tab');
assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#extra-filters-panel')), true, 'Tab moves into the popover');
await page.keyboard.press('Escape');
assert.equal(await isOpen(page), false);
assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('extra-filters-toggle')), true, 'focus returns to the toggle');
check('keyboard: Enter opens, Tab enters, Escape closes and returns focus to the toggle');

await page.locator('.card-button').first().click();
await page.waitForSelector('.codex-page:not(.empty-selection)');
await openPanel(page); await page.keyboard.press('Escape');
assert.equal(await isOpen(page), false);
assert.equal(await page.locator('.card-button').first().getAttribute('aria-pressed'), 'true');
assert.equal(await page.locator('.empty-selection').count(), 0);
check('Escape on the popover closes only the popover; the selected card stays selected');

await openPanel(page);
const spell = panelGroup(page, '카드 유형 필터').getByRole('button', { name: '주문', exact: true });
const item = panelGroup(page, '카드 유형 필터').getByRole('button', { name: '아이템', exact: true });
await spell.click();
const marks = await page.evaluate(() => {
  const [on, off] = ['주문', '아이템'].map(name => document.querySelector(`#extra-filters-panel [data-filter-group="카드 유형 필터"] button[aria-label="${name}"]`));
  return { onMark: getComputedStyle(on, '::before').content, offMark: getComputedStyle(off, '::before').content, onBg: getComputedStyle(on).backgroundColor, offBg: getComputedStyle(off).backgroundColor, onWeight: getComputedStyle(on).fontWeight };
});
assert.equal(marks.onMark, '"✓"'); assert.equal(marks.offMark, 'none'); assert.notEqual(marks.onBg, marks.offBg); assert.equal(marks.onWeight, '700');
assert.equal(await item.getAttribute('aria-pressed'), 'false');
await page.keyboard.press('Escape'); await openPanel(page);
assert.equal(await spell.getAttribute('aria-pressed'), 'true');
check('selected extra filters show a check mark, a dark fill and bold text (not colour alone) and stay marked after reopening', marks);
await page.keyboard.press('Escape');
await page.getByRole('button', { name: '필터 초기화' }).click();
await openPanel(page);
assert.equal(await page.locator('#extra-filters-panel button[aria-pressed="true"]').count(), 0);
await page.keyboard.press('Escape');
check('필터 초기화 clears every selected mark immediately');

const quickBonus = page.getByRole('group', { name: '행동 빠른 선택' }).getByRole('button', { name: '보너스 행동', exact: true });
await quickBonus.click(); await page.waitForTimeout(200);
const viaQuick = await visibleCount(page);
await openPanel(page);
assert.equal(await panelGroup(page, '행동 경제 필터').getByRole('button', { name: '보너스 행동', exact: true }).getAttribute('aria-pressed'), 'true');
await panelGroup(page, '행동 경제 필터').getByRole('button', { name: '보너스 행동', exact: true }).click();
assert.equal(await quickBonus.getAttribute('aria-pressed'), 'false');
await panelGroup(page, '행동 경제 필터').getByRole('button', { name: '보너스 행동', exact: true }).click();
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
assert.equal(await quickBonus.getAttribute('aria-pressed'), 'true');
assert.equal(await visibleCount(page), viaQuick);
await page.getByRole('group', { name: '역할 필터' }).getByRole('button', { name: '공격', exact: true }).click(); await page.waitForTimeout(200);
const withRole = await visibleCount(page);
assert(Number(withRole.split(' ')[0]) <= Number(viaQuick.split(' ')[0]), 'role AND action narrows the result');
check('quick 행동/보너스 행동 and the extra action-economy filter are one state; combined with roles as AND', { viaQuick, withRole });
await app.close();

// 3. Hand scroll position, in a window where the hand overflows well past its width (1366x768 at 150%).
// v1.3: whole (smaller) cards fit more of the 9-card deck there, so this check uses the whole library to overflow.
{
  const { app, page } = await launch(1.5);
  await showWholeLibrary(page);
  const hand = page.locator('.cards-area');
  const scrollState = () => hand.evaluate(el => ({ left: Math.round(el.scrollLeft), max: el.scrollWidth - el.clientWidth }));
  const reset = async () => { await page.getByRole('button', { name: '필터 초기화' }).click(); await page.waitForTimeout(250); };
  const start = await hand.evaluate(el => { el.scrollLeft = Math.floor((el.scrollWidth - el.clientWidth) / 2); return { left: Math.round(el.scrollLeft), max: el.scrollWidth - el.clientWidth }; });
  assert(start.max > 100 && start.left > 0, `hand overflows for this check ${JSON.stringify(start)}`);
  await openPanel(page); await page.locator('.extra-filters-close').click();
  await openPanel(page); await page.keyboard.press('Escape');
  assert.equal((await scrollState()).left, start.left, 'opening and closing the popover keeps the hand scroll');
  // A filter that removes some cards but still leaves the hand scrollable: the position must not move at all.
  const total = Number((await visibleCount(page)).split(' ')[0]);
  const names = locator => locator.locator('button').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label') ?? b.textContent.trim()));
  await openPanel(page);
  const candidates = [
    ...(await names(page.getByRole('group', { name: '역할 필터', exact: true }))).map(name => ({ group: '역할 필터', name, inPanel: false })),
    ...(await names(page.getByRole('group', { name: '행동 빠른 선택', exact: true }))).map(name => ({ group: '행동 빠른 선택', name, inPanel: false })),
    ...(await Promise.all(['행동 경제 필터', '카드 유형 필터', '사거리 필터', '태그 필터'].map(async group => (await names(panelGroup(page, group))).map(name => ({ group, name, inPanel: true }))))).flat(),
  ];
  await page.keyboard.press('Escape');
  const apply = async ({ group, name, inPanel }) => {
    if (inPanel) { await openPanel(page); await panelGroup(page, group).getByRole('button', { name, exact: true }).click(); await page.keyboard.press('Escape'); }
    else await page.getByRole('group', { name: group, exact: true }).getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(250);
  };
  let chosen; const tried = [];
  for (const candidate of candidates) {
    await apply(candidate);
    const narrowed = { ...candidate, count: Number((await visibleCount(page)).split(' ')[0]), ...(await scrollState()) }; tried.push(narrowed); await reset();
    if (narrowed.count < total && narrowed.max > 40) { chosen = narrowed; break; }
  }
  assert(chosen, `a filter that removes cards but keeps the hand scrollable ${JSON.stringify(tried)}`);
  const before = await hand.evaluate((el, target) => { el.scrollLeft = target; return Math.round(el.scrollLeft); }, Math.floor(chosen.max / 2));
  await apply(chosen);
  const afterFilter = await scrollState();
  assert(Math.abs(afterFilter.left - before) <= 1, `hand scroll kept after a filter change ${JSON.stringify({ before, afterFilter })}`);
  check('opening the popover or changing a filter keeps the hand scroll position', { start, filter: `${chosen.group} · ${chosen.name} (${chosen.count}/${total}장)`, before, afterFilter });
  await app.close();
}
if (server) await server.close();
await writeFile(join(run, 'v11-p1-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outcome: 'PASS', mode: report.mode, checks: report.checks.length, artifacts: run }));
