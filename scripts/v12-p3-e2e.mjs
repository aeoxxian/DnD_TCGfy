// v1.2 Phase 3 checks: four themes with their own materials/ornaments. Theme switching and persistence, every theme
// asset loads (also in the packaged EXE), no leather/parchment where the brief forbids it, text contrast on the
// reading pages and buttons, top buttons keep their size/hit area and have hover/pressed/disabled states, card images
// untouched. Runs on COPIES of repository-data. Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v12-p3-'));
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [], contrast: {} };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

const THEMES = { oxblood: '적갈 가죽', ebony: '흑단과 은', verdant: '숲의 펠트', abyss: '아케인 블루' };
const MATERIAL = { oxblood: 'leather-grain', ebony: 'wood-grain', verdant: 'felt-grain', abyss: 'stone-grain' };
const FRAME = { oxblood: 'frame-oxblood', ebony: 'frame-ebony', verdant: 'frame-felt', abyss: 'frame-arcane' };
const PANEL = { oxblood: 'panel-oxblood', ebony: 'panel-ebony', verdant: 'panel-felt', abyss: 'panel-arcane' };
const PAGE = { oxblood: 'parchment', ebony: 'paper', verdant: 'paper', abyss: 'stone-light' };

async function freshData() { const dir = await mkdtemp(join(run, 'data-')); await cp(resolve('repository-data/user-data'), dir, { recursive: true }); return dir; }
async function launch(userData, { width = 1366, height = 768, zoom = 1 } = {}) {
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DND_TCG_DEV_URL;
  if (dev) env.DND_TCG_DEV_URL = 'http://127.0.0.1:5173';
  const app = await electron.launch({ ...(binary ? { executablePath: binary, args: [] } : { args: ['.'] }), env, cwd: process.cwd(), timeout: 45000 });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  const failed = []; page.on('requestfailed', request => failed.push(request.url()));
  await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(size.width, size.height); win.webContents.setZoomFactor(size.zoom); }, { width, height, zoom });
  await page.waitForSelector('.board'); await page.waitForTimeout(700);
  return { app, page, errors, failed };
}
async function chooseTheme(page, id) {
  if (await page.locator('.app').getAttribute('data-theme') === id) return;
  await page.getByRole('button', { name: '테마', exact: true }).click();
  const menu = page.getByRole('menu', { name: '테마 선택' });
  await menu.getByRole('menuitemradio', { name: new RegExp(`^${THEMES[id]}`) }).click();
  await page.waitForFunction(id => document.querySelector('.app')?.dataset.theme === id, id);
  await page.getByRole('status').filter({ hasText: '환경 설정 저장됨' }).waitFor(); await page.waitForTimeout(300);
}
async function assetHashes(userData) { const dir = join(userData, 'assets'); const out = {}; for (const name of await readdir(dir)) out[name] = createHash('sha256').update(await readFile(join(dir, name))).digest('hex'); return out; }

// Everything the theme paints with: CSS variables, the board and page ornaments, and the computed backgrounds.
const inspect = page => page.evaluate(async () => {
  const app = document.querySelector('.app'); const css = getComputedStyle(app);
  const urls = value => [...String(value).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(m => m[1]);
  // Custom properties keep the URL as written (relative to the stylesheet), so resolve it against that sheet.
  const sheet = [...document.styleSheets].map(sheet => sheet.href).find(href => href && /\.css(\?|$)/.test(href)) ?? document.baseURI;
  const vars = Object.fromEntries(['--grain', '--frame-img', '--panel-img', '--parchment'].map(name => [name, new URL(urls(css.getPropertyValue(name))[0], sheet).href]));
  const bg = selector => { const el = document.querySelector(selector); return el ? urls(getComputedStyle(el).backgroundImage).join(' ') : ''; };
  const backgrounds = Object.fromEntries(['.topbar', '.nameplate', '.top-actions > button', '.resource-panel', '.board', '.ledger-page', '.codex-page', '.role-filter > button'].map(s => [s, bg(s)]));
  const borderImages = { board: urls(getComputedStyle(document.querySelector('.board')).borderImageSource)[0], ledger: urls(getComputedStyle(document.querySelector('.ledger-sheet'), '::after').borderImageSource)[0], codex: urls(getComputedStyle(document.querySelector('.codex'), '::after').borderImageSource)[0] };
  const all = [...new Set([...Object.values(vars), ...Object.values(borderImages), ...Object.values(backgrounds).flatMap(v => v.split(' ')).filter(Boolean)])];
  const loads = await Promise.all(all.map(src => new Promise(done => { const img = new Image(); img.onload = () => done({ src, ok: img.naturalWidth > 0, width: img.naturalWidth }); img.onerror = () => done({ src, ok: false }); img.src = src; })));
  return { vars, backgrounds, borderImages, loads };
});
// WCAG contrast of the text colours on each surface against that surface's base colour.
const contrast = page => page.evaluate(() => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); const [r, g, b] = m[1].split(',').map(Number); return [r, g, b]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const theme = document.querySelector('.app').dataset.theme;
  // Base colours sampled from the page materials (gradient middles / tile averages).
  const pageBase = { oxblood: [229, 222, 205], ebony: [234, 228, 216], verdant: [234, 228, 216], abyss: [40, 48, 64] }[theme];
  const buttonBase = { oxblood: [40, 27, 23], ebony: [36, 31, 28], verdant: [28, 44, 33], abyss: [44, 53, 70] }[theme];
  const color = selector => { const el = document.querySelector(selector); return el ? parse(getComputedStyle(el).color) : undefined; };
  const items = { ledgerTitle: '.ledger-heading strong', resourceName: '.resource-name', groupTitle: '.resource-group > summary', cardTitle: '.selected-card-heading h2', properties: '.selected-properties', description: '.description-content p', costLine: '.card-use .cost-preview' };
  const out = {};
  for (const [name, selector] of Object.entries(items)) { const c = color(selector); if (c) out[name] = Number(ratio(c, pageBase).toFixed(2)); }
  out.topButton = Number(ratio(color('.top-actions > button'), buttonBase).toFixed(2));
  return out;
});
const buttonBoxes = page => page.locator('.top-actions > button').evaluateAll(list => list.map(el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; }));

const userData = await freshData();
const imagesBefore = await assetHashes(userData);
let { app, page, errors, failed } = await launch(userData);
await page.locator('.cards-area .card-button').nth(1).click(); await page.waitForTimeout(300);

// 1–4. Each theme: materials, ornaments, assets, forbidden materials, contrast, buttons.
const seen = { grain: new Set(), frame: new Set(), panel: new Set() };
const boxes = {};
for (const id of Object.keys(THEMES)) {
  await chooseTheme(page, id);
  const info = await inspect(page);
  assert(info.vars['--grain'].includes(MATERIAL[id]), `${id} material ${info.vars['--grain']}`);
  assert(info.borderImages.board.includes(FRAME[id]) && info.borderImages.ledger.includes(PANEL[id]) && info.borderImages.codex.includes(PANEL[id]), `${id} ornaments ${JSON.stringify(info.borderImages)}`);
  assert(info.vars['--parchment'].includes(PAGE[id]), `${id} dialog page ${info.vars['--parchment']}`);
  assert(info.loads.length >= 4 && info.loads.every(load => load.ok), `${id} assets load ${JSON.stringify(info.loads.filter(l => !l.ok))}`);
  seen.grain.add(info.vars['--grain']); seen.frame.add(info.borderImages.board); seen.panel.add(info.borderImages.ledger);
  const surfaces = Object.values(info.backgrounds).join(' ');
  if (id !== 'oxblood') assert(!surfaces.includes('leather-grain'), `${id} keeps no leather ${JSON.stringify(info.backgrounds)}`);
  if (id === 'abyss') {
    for (const selector of ['.ledger-page', '.codex-page']) assert(info.backgrounds[selector].includes('stone-grain') && !/parchment|paper|leather/.test(info.backgrounds[selector]), `${selector} is stone`);
    assert(!/frame-(gold|silver)|panel-(oxblood|felt|ebony)/.test(JSON.stringify(info.borderImages)), 'no metal ornaments in 아케인 블루');
  }
  const c = await contrast(page); report.contrast[id] = c;
  for (const [name, value] of Object.entries(c)) assert(value >= 4.5, `${id} ${name} contrast ${value}`);
  boxes[id] = await buttonBoxes(page);
  // States: hover and pressed change the trim; disabled dims it.
  const button = page.locator('.top-actions > button').nth(2);
  const idle = await button.evaluate(el => ({ filter: getComputedStyle(el).filter, ring: getComputedStyle(el, '::before').borderTopColor }));
  await button.hover(); await page.waitForTimeout(250);
  const hover = await button.evaluate(el => ({ filter: getComputedStyle(el).filter, ring: getComputedStyle(el, '::before').borderTopColor }));
  assert.notDeepEqual(hover, idle, `${id} hover state`);
  const box = await button.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(200);
  const pressed = await button.evaluate(el => ({ transform: getComputedStyle(el).transform, shadow: getComputedStyle(el).boxShadow }));
  await page.mouse.move(5, 760); await page.mouse.up(); await page.waitForTimeout(200);
  assert(pressed.transform !== 'none' || /inset/.test(pressed.shadow), `${id} pressed state`);
  const disabled = await page.locator('.top-actions > button').first().evaluate(el => { el.disabled = true; const o = getComputedStyle(el).opacity; el.disabled = false; return Number(o); });
  assert(disabled < 0.8, `${id} disabled state`);
  await page.screenshot({ path: join(run, `${id}.png`) });
}
assert.equal(seen.grain.size, 4); assert.equal(seen.frame.size, 4); assert.equal(seen.panel.size, 4);
check('Four distinct materials, board frames and page ornaments; every theme asset loads; dialogs use parchment / paper / paper / pale stone');
check('Felt, ebony and Arcane Blue keep no leather texture; Arcane Blue ledger and card page are stone and use no metal ornament images');
check('Reading pages and top buttons keep ≥4.5:1 text contrast in every theme', { contrast: report.contrast });
for (const id of Object.keys(THEMES)) assert.deepEqual(boxes[id], boxes.oxblood, `${id} button sizes ${JSON.stringify(boxes[id])}`);
check('Top buttons (카드 등록 · 테마 · 관리 · 환경 설정) keep identical size and hit area in all themes, with hover / pressed / disabled states', { sizes: boxes.oxblood });

// 5. Names, persistence and the buttons still work.
await page.getByRole('button', { name: '테마', exact: true }).click();
const names = await page.getByRole('menu', { name: '테마 선택' }).getByRole('menuitemradio').locator('strong').allTextContents();
assert.deepEqual(names, Object.values(THEMES)); await page.keyboard.press('Escape');
const saved = await page.evaluate(async () => (await window.desktop.getBootstrap()).value.settings.appearance.theme);
assert.equal(saved, 'abyss');
await app.close(); ({ app, page, errors, failed } = await launch(userData));
assert.equal(await page.locator('.app').getAttribute('data-theme'), 'abyss');
await page.getByRole('button', { name: '환경 설정', exact: true }).click(); await page.getByRole('dialog', { name: '환경 설정' }).waitFor(); await page.keyboard.press('Escape');
await page.getByRole('button', { name: '관리', exact: true }).click(); await page.getByRole('dialog', { name: '관리 메뉴' }).waitFor(); await page.keyboard.press('Escape');
await page.getByRole('button', { name: '카드 등록', exact: true }).first().click(); await page.getByRole('dialog', { name: '카드 등록' }).waitFor(); await page.keyboard.press('Escape');
check('Theme names (아케인 블루 replaces 심연의 남색, id stays abyss), the choice persists across restart, top buttons still open their windows');

// 6. Card images untouched; no overflow at 125/150%.
await app.close();
for (const zoom of [1.25, 1.5]) {
  const scaled = await launch(userData, { width: 1280, height: 720, zoom });
  for (const id of Object.keys(THEMES)) { await chooseTheme(scaled.page, id); assert(await scaled.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${id} overflow at ${zoom}`); }
  assert.equal(await scaled.page.evaluate(() => getComputedStyle(document.querySelector('.cards-area .card-face img')).objectFit), 'contain');
  assert.deepEqual(scaled.errors, []); await scaled.app.close();
}
assert.deepEqual(await assetHashes(userData), imagesBefore);
assert.deepEqual(errors, []);
assert.deepEqual(failed.filter(url => !url.startsWith('devtools')), []);
check('Card images byte-identical and still object-fit: contain; all four themes without horizontal overflow at 1280×720 125%/150%');

if (server) await server.close();
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, checks: report.checks.length, contrast: report.contrast, run }, null, 2));
