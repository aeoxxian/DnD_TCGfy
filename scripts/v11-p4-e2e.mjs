// v1.1 Phase 4 checks: per-character spell slot colours (display only) and the table cursors (approved draft A).
// Runs on COPIES of repository-data.
// Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { createServer } from 'vite';
import { expandResource, openManagement } from './navigation-helpers.mjs';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v11-p4-'));
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [] };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

async function freshData() { const dir = await mkdtemp(join(run, 'data-')); await cp(resolve('repository-data/user-data'), dir, { recursive: true }); return dir; }
async function launch(userData, scale = 1, width = 1366, height = 768) {
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
const boot = page => page.evaluate(async () => (await window.desktop.getBootstrap()).value);
const resourcesOf = (page, id) => page.evaluate(async id => (await window.desktop.getResources(id)).value, id);
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
/** Colour actually painted on each filled gem of a ledger row, plus the row's numbers. */
const ledgerRow = (page, label) => page.getByRole('button', { name: `${label} 상태·수정`, exact: true }).evaluate(row => ({
  colors: [...row.querySelectorAll('.gem.filled')].map(gem => getComputedStyle(gem, '::after').backgroundColor),
  filled: row.querySelectorAll('.gem.filled').length, empty: row.querySelectorAll('.gem:not(.filled)').length,
  text: row.querySelector('strong')?.textContent, lowContrast: row.querySelector('.resource-gems')?.classList.contains('low-contrast') ?? false,
}));
async function openEditor(page) {
  await openManagement(page, '자원 관리');
  const manager = page.getByRole('dialog', { name: '자원 관리', exact: true });
  const region = manager.getByRole('region', { name: '주문 슬롯 색상', exact: true }); await region.waitFor();
  return { manager, region, close: async () => { await manager.getByRole('button', { name: '자원 관리 닫기', exact: true }).click(); await manager.waitFor({ state: 'hidden' }); } };
}
const saved = page => page.getByRole('status').filter({ hasText: '환경 설정 저장됨' }).waitFor();

const userData = await freshData();
let { app, page } = await launch(userData);
const initial = await boot(page);
const first = initial.profiles.find(p => p.id === initial.libraryState.activeCharacterId);
let snap = await resourcesOf(page, first.id);
const pact = snap.resources.find(r => r.kind === 'slot_track' && r.template.slotKind === 'pact');
assert(pact, 'the active character has pact slots');
const pactLevel = Number(Object.keys(pact.capacityByLevel).find(level => pact.capacityByLevel[level] > 0));
const pactRow = `${pact.name} ${pactLevel}레벨`;
const baseline = { revision: snap.revision, events: snap.events.map(e => e.id), resources: snap.resources };
let row = await ledgerRow(page, pactRow);
assert(row.colors.length > 0 && row.colors.every(c => c === rgb('#4d62ad')), JSON.stringify(row));
check('unchanged characters keep the default sapphire slot gems', { row });

// Kind colour, then a level colour.
let editor = await openEditor(page);
await editor.region.getByRole('radio', { name: '계약 마법 슬롯 · 루비', exact: true }).click(); await saved(page);
row = await ledgerRow(page, pactRow);
assert(row.colors.every(c => c === rgb('#a3283a')), JSON.stringify(row));
await editor.region.getByRole('checkbox', { name: '계약 마법 슬롯 레벨별로 지정', exact: true }).check();
await editor.region.getByRole('radio', { name: `계약 마법 슬롯 ${pactLevel}레벨 · 에메랄드`, exact: true }).click(); await saved(page);
await editor.close();
row = await ledgerRow(page, pactRow);
assert(row.colors.every(c => c === rgb('#2f7d4f')), JSON.stringify(row));
const groupIcon = await page.locator('.resource-group[data-group=pact] > summary').evaluate(el => getComputedStyle(el, '::before').backgroundColor);
assert.equal(groupIcon, rgb('#a3283a'), 'the group gem uses the kind colour');
const counterGems = await page.locator('.resource-gems.amber .gem.filled').evaluateAll(gems => gems.map(el => ({ image: getComputedStyle(el).backgroundImage, overlay: getComputedStyle(el, '::after').content })));
assert(counterGems.every(g => /bd8840|gem-amber/.test(g.image) && g.overlay === 'none'), `counters keep their amber gems: ${JSON.stringify(counterGems)}`);
snap = await resourcesOf(page, first.id);
assert.deepEqual({ revision: snap.revision, events: snap.events.map(e => e.id), resources: snap.resources }, baseline, 'colours never touch resources, revision or history');
check('pact slots take the kind colour (루비) and a per-level colour (에메랄드); counters, revision, events and amounts are untouched', { groupIcon });

// Readability while spending: numbers, filled vs empty sockets and the exhausted label stay.
await expandResource(page, '계약 마법 슬롯', pactLevel);
const decrease = page.getByRole('button', { name: `${pactRow} 1 감소`, exact: true });
await decrease.click(); await page.waitForTimeout(300);
row = await ledgerRow(page, pactRow);
assert.equal(row.text, `${pact.remainingByLevel[pactLevel] - 1} / ${pact.capacityByLevel[pactLevel]}`); assert.equal(row.empty, 1);
while (await decrease.isEnabled()) { await decrease.click(); await page.waitForTimeout(250); }
row = await ledgerRow(page, pactRow);
assert.equal(row.filled, 0); assert.equal(row.text, `0 / ${pact.capacityByLevel[pactLevel]}`);
assert(await page.locator('.exhausted-label').first().isVisible(), 'exhausted label still shown');
await page.getByRole('button', { name: '직전 자원 변경 실행 취소', exact: true }).click(); await page.waitForTimeout(300);
await page.getByRole('button', { name: `${pactRow} 상태·수정`, exact: true }).click();
check('with a colour set, “2 / 3”-style counts, empty sockets and the 소진 label still carry the state; spending and Undo work as before');

// A custom colour that is hard to read gets a warning and a dark rim.
editor = await openEditor(page);
await editor.region.getByLabel('계약 마법 슬롯 직접 색상', { exact: true }).fill('#e0d8c0'); await saved(page);
await editor.region.getByRole('note').filter({ hasText: '대비가 낮습니다' }).waitFor();
await editor.region.getByRole('checkbox', { name: '계약 마법 슬롯 레벨별로 지정', exact: true }).uncheck(); await saved(page);
await editor.close();
row = await ledgerRow(page, pactRow);
assert(row.lowContrast && row.colors.every(c => c === rgb('#e0d8c0')), JSON.stringify(row));
assert.notEqual(await page.getByRole('button', { name: `${pactRow} 상태·수정`, exact: true }).locator('.gem.filled').first().evaluate(el => getComputedStyle(el).filter), 'none');
check('a low-contrast custom colour is accepted with a warning and drawn with a dark rim');

// Per-character: another character with standard slots keeps its own colours.
let second;
for (const profile of initial.profiles.filter(p => p.id !== first.id)) {
  const resources = (await resourcesOf(page, profile.id)).resources;
  const standard = resources.find(r => r.kind === 'slot_track' && r.template.slotKind === 'standard');
  if (standard) { second = { profile, standard }; break; }
}
assert(second, 'another character with standard slots');
await page.getByLabel('활성 캐릭터').selectOption(second.profile.id); await page.waitForTimeout(800);
const level = Number(Object.keys(second.standard.capacityByLevel).find(l => second.standard.capacityByLevel[l] > 0));
const secondRow = `${second.standard.name} ${level}레벨`;
if (!(await page.getByRole('button', { name: `${secondRow} 상태·수정`, exact: true }).isVisible())) await page.locator('.resource-group[data-group=standard] > summary').click();
assert((await ledgerRow(page, secondRow)).colors.every(c => c === rgb('#4d62ad')), 'second character starts at the default');
editor = await openEditor(page);
await editor.region.getByRole('radio', { name: '일반 주문 슬롯 · 자수정', exact: true }).click(); await saved(page);
await editor.close();
assert((await ledgerRow(page, secondRow)).colors.every(c => c === rgb('#7547a3')));
await page.getByLabel('활성 캐릭터').selectOption(first.id); await page.waitForTimeout(800);
assert((await ledgerRow(page, pactRow)).colors.every(c => c === rgb('#e0d8c0')), 'first character unchanged');
check('each character keeps its own slot colours', { second: second.profile.name });

// Restart, then restore defaults for the first character only.
await app.close(); ({ app, page } = await launch(userData));
assert((await ledgerRow(page, pactRow)).colors.every(c => c === rgb('#e0d8c0')), 'kept after restart');
let settings = (await boot(page)).settings.slotColors;
assert.deepEqual(settings, { [first.id]: { pact: { base: '#e0d8c0' } }, [second.profile.id]: { standard: { base: '#7547a3' } } });
editor = await openEditor(page);
await editor.region.getByRole('button', { name: '기본 색상으로 복원', exact: true }).click(); await saved(page);
await editor.close();
assert((await ledgerRow(page, pactRow)).colors.every(c => c === rgb('#4d62ad')));
settings = (await boot(page)).settings.slotColors;
assert.deepEqual(settings, { [second.profile.id]: { standard: { base: '#7547a3' } } });
check('colours survive a restart; 기본 색상으로 복원 clears only the active character');
await app.close();

// Layout at 125% and 150%: the editor fits the dialog and its controls stay usable.
const layouts = [];
for (const scale of [1.25, 1.5]) {
  ({ app, page } = await launch(await freshData(), scale));
  editor = await openEditor(page);
  const overflow = await editor.manager.evaluate(el => el.scrollWidth - el.clientWidth);
  await editor.region.getByRole('radio', { name: '계약 마법 슬롯 · 황옥', exact: true }).click(); await saved(page);
  await editor.close();
  const colors = (await ledgerRow(page, pactRow)).colors;
  assert(overflow <= 1 && colors.every(c => c === rgb('#946010')), JSON.stringify({ overflow, colors }));
  layouts.push({ scale, overflow });
  await app.close();
}
check('the colour editor fits without horizontal scrolling and works at 125% and 150%', { layouts });
// Cursors: what Electron actually hands to Windows (type, image, scale, hotspot) for each kind of element.
const hot = JSON.parse(await readFile(resolve('src/assets/cursors/hotspots.json'), 'utf8')).hotspots;
async function watchCursor(app) {
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__cursor = [];
    BrowserWindow.getAllWindows()[0].webContents.on('cursor-changed', (event, type, image, scale, size, hotspot) => globalThis.__cursor.push({ type, scale, size, hotspot, png: image && !image.isEmpty() ? image.toPNG().toString('base64') : null }));
  });
}
/** Waits until cursor events stop arriving (Chromium may report an intermediate cursor first), then returns the last one. */
async function settledCursor(app, page) {
  let count = -1;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const now = await app.evaluate(() => globalThis.__cursor.length);
    if (now > 0 && now === count) break; count = now;
  }
  return app.evaluate(() => globalThis.__cursor.at(-1));
}
/** Moves through the search field first (system I-beam) so the target always produces a fresh cursor change. */
async function cursorAt(app, page, target) {
  const search = await page.locator('#card-name-search').boundingBox();
  await page.mouse.move(search.x + search.width / 2, search.y + search.height / 2); await page.waitForTimeout(80);
  await app.evaluate(() => { globalThis.__cursor.length = 0; });
  await page.mouse.move(target.x, target.y, { steps: 3 });
  return settledCursor(app, page);
}
const centre = async (page, locator) => { const b = await page.locator(locator).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
/** Centre of the part of the first card that the hand actually shows (cards can be clipped at high scaling). */
const cardPoint = page => page.evaluate(() => { const card = document.querySelector('.cards-area .card-button').getBoundingClientRect(); const area = document.querySelector('.cards-area').getBoundingClientRect(); const top = Math.max(card.top, area.top), bottom = Math.min(card.bottom, area.bottom); return { x: card.left + card.width / 2, y: (top + bottom) / 2 }; });
/** The hotspot pixel must be the drawn tip: painted, with nothing painted just above/left of a tip (arrow, fingertip). */
async function tipCheck(cursor, kind, where) {
  const { data, info } = await sharp(Buffer.from(cursor.png, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (x, y) => (x < 0 || y < 0 ? 0 : data[(y * info.width + x) * 4 + 3]);
  const { x, y } = cursor.hotspot;
  assert.deepEqual([x, y], hot[kind].map(v => Math.round(v * cursor.scale)), `${where}: ${kind} hotspot scales with the image`);
  assert(alpha(x, y) > 0, `${kind} hotspot pixel is painted`);
  if (kind === 'default' || kind === 'pointer') assert.equal(alpha(x, y - 1) + alpha(x - 1, y - 1), 0, `${kind} hotspot is the tip`);
}
const cursorRuns = [];
for (const scale of [1, 1.25, 1.5]) {
  ({ app, page } = await launch(await freshData(), scale));
  await watchCursor(app);
  const seen = {};
  const label = await page.locator('.deck-label strong').boundingBox();
  seen.default = await cursorAt(app, page, { x: label.x + 4, y: label.y + label.height / 2 });
  seen.button = await cursorAt(app, page, await centre(page, '.top-actions button'));
  seen.card = await cursorAt(app, page, await cardPoint(page));
  const hand = await page.locator('.cards-area.hand').boundingBox();
  seen.grab = await cursorAt(app, page, { x: hand.x + 4, y: hand.y + 6 });
  await page.mouse.down(); await app.evaluate(() => { globalThis.__cursor.length = 0; });
  await page.mouse.move(hand.x + 40, hand.y + 6, { steps: 6 });
  seen.grabbing = await settledCursor(app, page); await page.mouse.up();
  seen.disabled = await cursorAt(app, page, await centre(page, '.filter-reset'));
  const search = await page.locator('#card-name-search').boundingBox();
  await page.mouse.move(label.x + 4, label.y + 4); await page.waitForTimeout(80); await app.evaluate(() => { globalThis.__cursor.length = 0; });
  await page.mouse.move(search.x + search.width / 2, search.y + search.height / 2, { steps: 3 });
  seen.text = await settledCursor(app, page);
  for (const [key, kind] of [['default', 'default'], ['button', 'pointer'], ['card', 'pointer'], ['grab', 'grab'], ['grabbing', 'grabbing']]) {
    assert.equal(seen[key]?.type, 'custom', `${key} at ${scale}: ${JSON.stringify(seen[key] && { ...seen[key], png: undefined })}`);
    await tipCheck(seen[key], kind, `${key} at ${scale}`);
  }
  assert.equal(seen.text?.type, 'text', 'text fields keep the system I-beam');
  assert.equal(seen.disabled?.type, 'not-allowed', 'disabled buttons keep the system not-allowed cursor');
  // Clicks land where the tip points: select a card and press a button with the custom cursor in place.
  const cardCentre = await cardPoint(page);
  await page.mouse.click(cardCentre.x, cardCentre.y);
  assert.equal(await page.locator('.cards-area .card-button').first().getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '카드 선택 닫기', exact: true }).click();
  assert.equal(await page.locator('.cards-area .card-button[aria-pressed=true]').count(), 0);
  cursorRuns.push({ scale, ...Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v?.type === 'custom' ? `${v.size.width}px @${v.scale} hot ${v.hotspot.x},${v.hotspot.y}` : v?.type])) });
  await app.close();
}
check('table cursors reach Windows as drawn: arrow, glove (buttons, cards), open hand (hand), fist (dragging), with the hotspot on the drawn tip at 100/125/150%; text fields and disabled buttons keep system cursors; clicks select and close as before', { cursorRuns });

// The system-cursor option, kept after a restart.
const cursorData = await freshData();
({ app, page } = await launch(cursorData));
await page.getByRole('button', { name: '환경 설정', exact: true }).click();
const systemBox = page.getByRole('checkbox', { name: '시스템 기본 커서 사용', exact: true });
assert.equal(await systemBox.isChecked(), false);
await systemBox.check(); await saved(page);
await page.getByRole('button', { name: '환경 설정 닫기', exact: true }).click();
assert.equal(await page.locator('.app.custom-cursor').count(), 0);
await app.close(); ({ app, page } = await launch(cursorData));
await watchCursor(app);
const plain = await cursorAt(app, page, await centre(page, '.top-actions button'));
const plainHand = await page.locator('.cards-area.hand').boundingBox();
const plainGrab = await cursorAt(app, page, { x: plainHand.x + 4, y: plainHand.y + 6 });
assert.deepEqual([plain?.type, plainGrab?.type], ['hand', 'grab'], `system cursors after restart: ${plain?.type}, ${plainGrab?.type}`);
await page.getByRole('button', { name: '환경 설정', exact: true }).click();
await page.getByRole('checkbox', { name: '시스템 기본 커서 사용', exact: true }).uncheck(); await saved(page);
await page.getByRole('button', { name: '환경 설정 닫기', exact: true }).click();
assert.equal((await cursorAt(app, page, await centre(page, '.top-actions button')))?.type, 'custom');
await app.close();
check('시스템 기본 커서 사용 switches to the Windows cursors, survives a restart, and switching back restores the table cursors');

if (server) await server.close();
await writeFile(join(run, 'v11-p4-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outcome: 'PASS', mode: report.mode, checks: report.checks.length, artifacts: run }));
