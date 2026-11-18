// v1.2 Phase 4 checks: per-theme bookmark and recovery tokens. Assets are the theme's own vector files and load (also in
// the packaged EXE); the bookmark never covers the title, kicker, close button or description at several sizes/scales;
// recovery buttons keep their size, show hover / pressed / disabled / focus states, are readable, and still recover
// (mouse and keyboard) in every theme. Runs on COPIES of repository-data. Modes: built bundle, `--dev`, DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import sharp from 'sharp';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v12-p4-'));
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [], contrast: {} };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

const THEMES = ['oxblood', 'ebony', 'verdant', 'abyss'];
const FILE = { oxblood: 'oxblood', ebony: 'ebony', verdant: 'felt', abyss: 'arcane' };
// The colour behind the icon: the token SVG rendered at 96 px, averaged over the ring just around the icon (r 23–30).
const CENTRE = {};
for (const theme of THEMES) {
  const { data, info } = await sharp(resolve(`src/assets/playmat/rest-${FILE[theme]}.svg`)).resize(96, 96).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0]; let n = 0;
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) { const d = Math.hypot(x - 47.5, y - 47.5); if (d < 23 || d > 30) continue; const i = (y * info.width + x) * 3; sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; n++; }
  CENTRE[theme] = sum.map(v => Math.round(v / n));
}

async function freshData() { const dir = await mkdtemp(join(run, 'data-')); await cp(resolve('repository-data/user-data'), dir, { recursive: true }); return dir; }
async function launch(userData, { width = 1366, height = 768, zoom = 1 } = {}) {
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DND_TCG_DEV_URL;
  if (dev) env.DND_TCG_DEV_URL = 'http://127.0.0.1:5173';
  const app = await electron.launch({ ...(binary ? { executablePath: binary, args: [] } : { args: ['.'] }), env, cwd: process.cwd(), timeout: 45000 });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(size.width, size.height); win.webContents.setZoomFactor(size.zoom); }, { width, height, zoom });
  await page.waitForSelector('.board'); await page.waitForTimeout(700);
  return { app, page, errors };
}
async function setTheme(page, theme) {
  await page.evaluate(async theme => { const r = await window.desktop.getBootstrap(); const s = r.value.settings; await window.desktop.saveSettings({ ...s, appearance: { ...(s.appearance ?? { cardBack: { default: { type: 'builtin', id: 'dragon' }, decks: {} }, customBacks: [] }), theme } }); }, theme);
  await page.reload(); await page.waitForSelector('.board'); await page.waitForTimeout(600);
  await page.locator('.cards-area .card-button').nth(1).click(); await page.mouse.move(5, 5); await page.waitForTimeout(400);
}
async function assetHashes(userData) { const dir = join(userData, 'assets'); const out = {}; for (const name of await readdir(dir)) out[name] = createHash('sha256').update(await readFile(join(dir, name))).digest('hex'); return out; }
/** The bookmark (a ::before box) and what it must not cover, in viewport coordinates. */
const layout = page => page.evaluate(() => {
  const pageEl = document.querySelector('.codex-page'); const p = pageEl.getBoundingClientRect(); const cs = getComputedStyle(pageEl, '::before');
  const width = parseFloat(cs.width), height = parseFloat(cs.height), right = parseFloat(cs.right), top = parseFloat(cs.top);
  const mark = { left: p.right - right - width, top: p.top + top, right: p.right - right, bottom: p.top + top + height };
  const rect = selector => { const el = pageEl.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; };
  // Text boxes: use the text's own extent (inline range), not the block's full width.
  const textRect = selector => { const el = pageEl.querySelector(selector); if (!el) return null; const range = document.createRange(); range.selectNodeContents(el); const r = range.getBoundingClientRect(); return r.width ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; };
  return { mark, url: cs.backgroundImage, others: { title: textRect('.selected-card-heading h2'), kicker: textRect('.codex-kicker'), properties: textRect('.selected-properties'), tags: rect('.detail-tags'), close: rect('.codex-close'), description: rect('.description-pane') } };
});
const overlaps = (a, b) => !!b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
// Small SVGs may be inlined as data URIs by the bundler (they keep their root id, e.g. id="rest-oxblood").
const loads = (page, cssUrl) => page.evaluate(src => new Promise(done => { const img = new Image(); img.onload = () => done(img.naturalWidth > 0); img.onerror = () => done(false); img.src = src; }), cssUrl.match(/url\(\s*["']?(.+?)["']?\s*\)$/)[1]);
const contrast = (a, b) => { const lum = ([r, g, bl]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(bl); }; const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

const userData = await freshData();
const imagesBefore = await assetHashes(userData);
let { app, page, errors } = await launch(userData);
const hero = await page.evaluate(async () => (await window.desktop.getBootstrap()).value.libraryState.activeCharacterId);
const sizes = {};
for (const theme of THEMES) {
  await setTheme(page, theme);
  // 1. Bookmark: the theme's own vector file, loaded, clear of the text and the close button.
  const l = await layout(page);
  assert(decodeURIComponent(l.url).includes(`bookmark-${FILE[theme]}`), `${theme} bookmark ${l.url.slice(0, 80)}`); assert(await loads(page, l.url), `${theme} bookmark loads`);
  for (const [name, box] of Object.entries(l.others)) assert(!overlaps(l.mark, box), `${theme} bookmark covers ${name}: ${JSON.stringify({ mark: l.mark, box })}`);
  // 2. Tokens: the theme's vector token, same box sizes, readable icon.
  const token = await page.locator('.rest-buttons .coin').first().evaluate(el => ({ bg: getComputedStyle(el).backgroundImage, color: getComputedStyle(el).color }));
  assert(decodeURIComponent(token.bg).includes(`rest-${FILE[theme]}`), `${theme} token ${token.bg.slice(0, 80)}`); assert(await loads(page, token.bg), `${theme} token loads`);
  const icon = token.color.match(/\d+/g).slice(0, 3).map(Number);
  report.contrast[theme] = Number(contrast(icon, CENTRE[theme]).toFixed(2)); assert(report.contrast[theme] >= 4.5, `${theme} icon contrast ${report.contrast[theme]}`);
  sizes[theme] = await page.locator('.rest-buttons button').evaluateAll(list => list.map(el => { const r = el.getBoundingClientRect(); const c = el.querySelector('.coin').getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10, Math.round(c.width), Math.round(c.height)]; }));
  // 3. States: hover lifts, press sinks, disabled dims, keyboard focus is outlined.
  const buttons = page.locator('.rest-buttons button');
  const coinState = index => buttons.nth(index).locator('.coin').evaluate(el => ({ transform: getComputedStyle(el).transform, filter: getComputedStyle(el).filter }));
  const idle = await coinState(0);
  await buttons.nth(0).hover(); await page.waitForTimeout(250); const hover = await coinState(0);
  assert.notDeepEqual(hover, idle, `${theme} hover`);
  const b = await buttons.nth(1).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + 18); await page.mouse.down(); await page.waitForTimeout(220);
  const pressed = await coinState(1); await page.mouse.move(5, 5); await page.mouse.up(); await page.waitForTimeout(200);
  assert(pressed.transform !== 'none' && pressed.transform !== idle.transform, `${theme} pressed ${JSON.stringify(pressed)}`);
  const disabled = await buttons.nth(2).evaluate(el => { el.disabled = true; const f = getComputedStyle(el.querySelector('.coin')).filter; el.disabled = false; return f; });
  assert.match(disabled, /grayscale/, `${theme} disabled`);
  await buttons.nth(3).focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  assert.notEqual(await buttons.nth(3).evaluate(el => getComputedStyle(el).outlineStyle), 'none', `${theme} focus outline`);
  // 4. Recovery still works: spend a pact slot, then 짧은 휴식 (mouse) restores it; 긴 휴식 opens from the keyboard.
  const before = await page.evaluate(async id => (await window.desktop.getResources(id)).value, hero);
  const pact = before.resources.find(r => r.kind === 'slot_track' && r.template.slotKind === 'pact');
  const level = Object.keys(pact.remainingByLevel)[0];
  await page.evaluate(async ({ id, revision, resourceId, level }) => window.desktop.changeResource({ requestId: crypto.randomUUID(), characterId: id, expectedRevision: revision, action: { type: 'adjust', resourceId, delta: -1, slotLevel: Number(level) } }), { id: hero, revision: before.revision, resourceId: pact.id, level });
  await page.reload(); await page.waitForSelector('.board'); await page.waitForTimeout(500);
  const spent = (await page.evaluate(async id => (await window.desktop.getResources(id)).value, hero)).resources.find(r => r.id === pact.id).remainingByLevel[level];
  assert.equal(spent, pact.remainingByLevel[level] - 1);
  await page.getByRole('button', { name: '짧은 휴식', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '짧은 휴식 확인', exact: true }); await dialog.getByRole('button', { name: '회복 확정', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(({ id, rid, level, value }) => window.desktop.getResources(id).then(r => r.value.resources.find(x => x.id === rid).remainingByLevel[level] === value), { id: hero, rid: pact.id, level, value: pact.remainingByLevel[level] });
  await page.getByRole('button', { name: '긴 휴식', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: '긴 휴식 확인', exact: true }).waitFor(); await page.keyboard.press('Escape');
  await page.screenshot({ path: join(run, `${theme}.png`) });
}
for (const theme of THEMES) assert.deepEqual(sizes[theme], sizes.oxblood, `${theme} recovery button sizes`);
check('Each theme draws its own vector bookmark and recovery tokens (bookmark-/rest-<theme>.svg) and they load', { files: Object.values(FILE) });
check('The bookmark never covers the title, kicker, properties, tags, close button or description', {});
check('Recovery buttons keep identical size in all themes; hover / pressed / disabled / keyboard-focus states; icon contrast ≥4.5:1', { sizes: sizes.oxblood, contrast: report.contrast });
check('Recovery works through the buttons in every theme: a spent pact slot comes back after 짧은 휴식 → 회복 확정; 긴 휴식 opens from the keyboard', {});
await app.close();

// 5. Smaller windows and higher scales: the bookmark stays clear, recovery labels are not clipped.
for (const [width, height, zoom] of [[1280, 720, 1.25], [1280, 720, 1.5], [1100, 700, 1], [1366, 768, 2]]) {
  const scaled = await launch(userData, { width, height, zoom });
  for (const theme of THEMES) {
    await setTheme(scaled.page, theme);
    const l = await layout(scaled.page);
    for (const [name, box] of Object.entries(l.others)) assert(!overlaps(l.mark, box), `${theme} @${width}x${height}x${zoom} bookmark covers ${name}`);
    const clipped = await scaled.page.locator('.rest-buttons button').evaluateAll(list => list.filter(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).map(el => el.textContent));
    assert.deepEqual(clipped, [], `${theme} @${zoom} clipped labels`);
    if (zoom === 2) await scaled.page.locator('.resource-footer').screenshot({ path: join(run, `${theme}-footer-200.png`) });
  }
  assert.deepEqual(scaled.errors, []); await scaled.app.close();
}
check('At 1280×720 125%/150%, 1100×700 and 200% the bookmark stays clear of the text and recovery labels are not clipped (tokens are vector, so they stay sharp)');

assert.deepEqual(await assetHashes(userData), imagesBefore);
assert.deepEqual(errors, []);
check('Card images byte-identical; no page errors');
if (server) await server.close();
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, checks: report.checks.length, contrast: report.contrast, run }, null, 2));
