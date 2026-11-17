// v1.1 Phase 3 checks: re-click enlargement, drag vs click, unusable-card overlay, selection/enlargement motion,
// 3D tilt option and reduced motion. Runs on COPIES of repository-data.
// Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { expandResource } from './navigation-helpers.mjs';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v11-p3-'));
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
async function assetHashes(userData) {
  const dir = join(userData, 'assets'); const out = {};
  for (const name of (await readdir(dir)).sort()) out[name] = createHash('sha256').update(await readFile(join(dir, name))).digest('hex');
  return out;
}
const boot = page => page.evaluate(async () => (await window.desktop.getBootstrap()).value);
const resourcesOf = (page, id) => page.evaluate(async id => (await window.desktop.getResources(id)).value, id);
const card = (page, name) => page.getByRole('button', { name: `${name} 카드 선택`, exact: true });
const lightbox = page => page.locator('dialog.image-lightbox');
const openDialogs = page => page.evaluate(() => document.querySelectorAll('dialog[open]').length);
async function settle(page) { await page.waitForFunction(() => { const f = document.querySelector('.lightbox-card'); return !f || f.getAnimations().length === 0; }, null, { polling: 'raf' }); }
async function closeLightbox(page) { await page.keyboard.press('Escape'); await lightbox(page).waitFor({ state: 'detached' }); }
async function setSetting(page, label, value) {
  await page.getByRole('button', { name: '환경 설정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '환경 설정', exact: true });
  const box = dialog.getByRole('checkbox', { name: label, exact: true });
  if (await box.isChecked() !== value) { await box.click(); await page.getByRole('status').filter({ hasText: '환경 설정 저장됨' }).waitFor(); }
  const state = { checked: await box.isChecked(), disabled: await box.isDisabled() };
  await dialog.getByRole('button', { name: '환경 설정 닫기', exact: true }).click();
  return state;
}

const userData = await freshData();
const assetsBefore = await assetHashes(userData);
let { app, page } = await launch(userData);
const initial = await boot(page);
const profile = initial.profiles.find(p => p.id === initial.libraryState.activeCharacterId);
const deck = initial.decks.find(d => d.id === profile.activeDeckId);
const hand = initial.cards.filter(c => deck.cardIds.includes(c.id) && c.imageAssetId);
const [A, B, C] = hand.map(c => c.name);
const before = await resourcesOf(page, profile.id);

// 1. Click selects, re-click enlarges; ESC keeps the selection; another card only changes the selection.
await card(page, A).click();
assert.equal(await card(page, A).getAttribute('aria-pressed'), 'true');
await page.waitForTimeout(300); assert.equal(await openDialogs(page), 0, 'first click only selects');
await card(page, A).click();
await page.getByRole('dialog', { name: `${A} 원본 보기`, exact: true }).waitFor();
await settle(page); await closeLightbox(page);
assert.equal(await card(page, A).getAttribute('aria-pressed'), 'true');
assert.equal(await card(page, A).evaluate(el => document.activeElement === el), true, 'focus back on the card');
await card(page, B).click(); await page.waitForTimeout(300);
assert.equal(await openDialogs(page), 0); assert.equal(await card(page, B).getAttribute('aria-pressed'), 'true'); assert.equal(await card(page, A).getAttribute('aria-pressed'), 'false');
await page.getByRole('button', { name: `${B} 미리보기 확대`, exact: true }).click();
await page.getByRole('dialog', { name: `${B} 원본 보기`, exact: true }).waitFor(); await settle(page); await closeLightbox(page);
await card(page, B).focus(); await page.keyboard.press('Enter');
await page.getByRole('dialog', { name: `${B} 원본 보기`, exact: true }).waitFor(); await settle(page); await closeLightbox(page);
await card(page, B).press('ArrowRight'); await page.keyboard.press('Space');
const keyed = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-pressed')), 'true', `Space selects the focused card ${keyed}`);
assert.equal(await openDialogs(page), 0);
let after = await resourcesOf(page, profile.id);
assert.deepEqual({ revision: after.revision, events: after.events.length }, { revision: before.revision, events: before.events.length }, 'clicking and enlarging never spends');
check('click selects, re-click (mouse, Enter) enlarges, IN PLAY preview enlarges in one click, ESC returns with the card still selected and focused, Space/another card only selects, no resource change');

// 2. A drag on the selected card is not a re-click.
await card(page, A).click();
const box = await card(page, A).boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 70, cy, { steps: 6 }); await page.mouse.move(cx, cy, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(500);
assert.equal(await openDialogs(page), 0, 'drag is not a re-click'); assert.equal(await card(page, A).getAttribute('aria-pressed'), 'true');
check('dragging the hand from the selected card and releasing on it does not enlarge');

// 3. Motion: selection rises; the enlargement grows from the card and shrinks back to it.
const lift = await page.waitForFunction(name => { const b = document.querySelector(`[aria-label="${name} 카드 선택"]`); const m = new DOMMatrix(getComputedStyle(b).transform); return Math.abs(m.m42 + 12) < .5 ? m.m42 : false; }, A);
await card(page, A).click();
const opening = await page.waitForFunction(() => { const f = document.querySelector('.lightbox-card'); const a = f?.getAnimations()[0]; return a ? a.effect.getKeyframes().map(k => k.transform) : false; }, null, { polling: 'raf' });
const [from, to] = await opening.jsonValue();
assert(/translate\(.+\) scale\(0\.\d+\)/.test(from) && to === 'none', `grows from the card: ${from} → ${to}`);
await settle(page);
await page.keyboard.press('Escape');
const closing = await page.waitForFunction(() => { const f = document.querySelector('.lightbox-card'); const a = f?.getAnimations()[0]; return a ? a.effect.getKeyframes().map(k => k.transform) : false; }, null, { polling: 'raf' });
const shrink = await closing.jsonValue();
assert(/scale\(0\.\d+\)/.test(shrink[1]), `shrinks back to the card: ${shrink[1]}`);
await lightbox(page).waitFor({ state: 'detached' });
check('selected card rises 12px; enlargement grows from the hand card and shrinks back into it on close', { lift: await lift.jsonValue(), from, shrinkTo: shrink[1] });

// 4. Fast clicking never tangles state.
for (const name of [B, A, B]) await card(page, name).click();
await card(page, B).click(); await page.keyboard.press('Escape');
await page.waitForTimeout(600);
assert.equal(await page.locator('dialog.image-lightbox').count(), 0, 'ESC during the opening transition closes cleanly');
const target = await card(page, C).boundingBox();
for (let i = 0; i < 3; i++) await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2, { delay: 20 });
await page.waitForTimeout(900);
assert(await page.locator('dialog.image-lightbox').count() <= 1);
assert.equal(await card(page, C).getAttribute('aria-pressed'), 'true');
if (await lightbox(page).count()) await closeLightbox(page);
await card(page, C).click(); await page.getByRole('dialog', { name: `${C} 원본 보기`, exact: true }).waitFor(); await settle(page); await closeLightbox(page);
assert.equal(await openDialogs(page), 0);
check('rapid selection changes, ESC mid-opening and a triple click leave one consistent selection and a working enlargement');

// 5. Tilt: leans toward the pointer within 6°, returns when the pointer leaves, and never changes what closes the view.
await card(page, C).click(); await settle(page);
const frame = page.locator('.lightbox-card');
const fb = await frame.boundingBox();
await page.mouse.move(fb.x + fb.width * .9, fb.y + fb.height * .1, { steps: 4 });
const leaning = await page.locator('.lightbox-card > img').evaluate(el => el.style.transform);
const angles = [...leaning.matchAll(/rotate[XY]\((-?[\d.]+)deg\)/g)].map(m => Number(m[1]));
assert(angles.length === 2 && angles.every(a => Math.abs(a) <= 6) && angles.some(a => Math.abs(a) > 2), `tilt ${leaning}`);
await page.mouse.click(fb.x + 3, fb.y + 3); await page.waitForTimeout(300);
assert.equal(await lightbox(page).count(), 1, 'a click on the tilted card corner keeps the view open');
await page.mouse.move(fb.x - 30, fb.y + fb.height / 2);
assert.equal(await page.locator('.lightbox-card > img').evaluate(el => el.style.transform), '', 'returns flat when the pointer leaves');
await page.mouse.click(Math.max(2, fb.x - 30), fb.y + fb.height / 2); await lightbox(page).waitFor({ state: 'detached' });
check('3D tilt follows the pointer (max 6°), resets on leave, and clicks on the card frame never close the view', { leaning });

let state = await setSetting(page, '확대 카드 3D 기울임', false);
assert.deepEqual(state, { checked: false, disabled: false });
await card(page, C).click(); await settle(page);
await page.mouse.move(fb.x + fb.width * .9, fb.y + fb.height * .1, { steps: 4 });
assert.equal(await page.locator('.lightbox-card > img').evaluate(el => el.style.transform), '');
await closeLightbox(page);
await app.close(); ({ app, page } = await launch(userData));
await page.getByRole('button', { name: '환경 설정', exact: true }).click();
assert.equal(await page.getByRole('checkbox', { name: '확대 카드 3D 기울임', exact: true }).isChecked(), false, 'tilt off survives a restart');
await page.getByRole('button', { name: '환경 설정 닫기', exact: true }).click();
state = await setSetting(page, '확대 카드 3D 기울임', true);
assert.deepEqual(state, { checked: true, disabled: false });
check('tilt can be switched off and on in 환경 설정 and the choice survives a restart');

// 6. Reduced motion: no transitions, no rise, no tilt (and the tilt option is locked off).
await setSetting(page, '모션 줄이기', true);
await page.getByRole('button', { name: '환경 설정', exact: true }).click();
const locked = page.getByRole('checkbox', { name: '확대 카드 3D 기울임', exact: true });
assert.equal(await locked.isChecked(), false); assert.equal(await locked.isDisabled(), true);
await page.getByRole('button', { name: '환경 설정 닫기', exact: true }).click();
await card(page, A).click(); await page.waitForTimeout(250);
assert.equal(await card(page, A).evaluate(el => getComputedStyle(el).transform), 'none');
await card(page, A).click(); await lightbox(page).waitFor();
assert.equal(await page.evaluate(() => document.querySelector('.lightbox-card')?.getAnimations().length ?? 0), 0, 'opens without a transition');
const rb = await page.locator('.lightbox-card').boundingBox(); await page.mouse.move(rb.x + rb.width * .9, rb.y + rb.height * .1, { steps: 3 });
assert.equal(await page.locator('.lightbox-card > img').evaluate(el => el.style.transform), '');
await page.keyboard.press('Escape'); await page.waitForTimeout(50);
assert.equal(await lightbox(page).count(), 0, 'closes at once');
await setSetting(page, '모션 줄이기', false);
check('모션 줄이기 turns off the selection rise, the enlargement transitions and the tilt (option shown off and locked)');

// 7. Unusable overlay follows the resources: spend → card back at 75%, recover → removed. Originals untouched.
const deckBack = await page.locator('.deck-pile img').first().getAttribute('src');
assert(deckBack, 'DECK pile shows a card back');
assert.equal(await page.locator('.card-unusable-back').count(), 0, 'all cards usable at full resources');
const deselect = page.getByRole('button', { name: '카드 선택 닫기', exact: true });
if (await deselect.count()) await deselect.click();
await expandResource(page, '계약 마법 슬롯', 5);
for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: '계약 마법 슬롯 5레벨 1 감소', exact: true }).click(); await page.waitForTimeout(300); }
await page.getByRole('button', { name: '계약 마법 슬롯 5레벨 상태·수정', exact: true }).click();
await page.waitForSelector('.card-item[data-usability="insufficient"] .card-unusable-back');
const blocked = await page.locator('.card-item.is-unusable').evaluateAll(items => items.map(item => ({ name: item.querySelector('.card-button').getAttribute('aria-label').replace(/ 카드 선택$/, ''), state: item.dataset.usability, opacity: getComputedStyle(item.querySelector('.card-unusable-back')).opacity, back: item.querySelector('.card-unusable-back').getAttribute('src'), original: item.querySelector('.card-face img:not(.card-unusable-back)')?.getAttribute('src'), described: item.querySelector('.card-button').getAttribute('aria-description') })));
assert(blocked.length > 0 && blocked.every(b => b.state === 'insufficient' && b.opacity === '0.75' && b.described === '사용 불가 · 자원 부족'), JSON.stringify(blocked));
assert(blocked.every(b => b.back === deckBack), 'uses the DECK pile card back');
const pact = blocked[0].name;
const pactCard = initial.cards.find(c => c.name === pact);
assert(blocked.every(b => b.original === `app://assets/${encodeURIComponent(initial.cards.find(c => c.name === b.name).imageAssetId)}/thumbnail`), 'original image kept under the overlay');
await card(page, pact).click();
await page.waitForFunction(name => getComputedStyle(document.querySelector(`[aria-label="${name} 카드 선택"]`).closest('.card-item').querySelector('.card-unusable-back')).opacity === '0', pact);
assert.equal(await page.locator('.in-play-slot .card-unusable-back').count(), 0, 'IN PLAY shows the original');
await card(page, pact).click(); await page.getByRole('dialog', { name: `${pact} 원본 보기`, exact: true }).waitFor();
assert.equal(await page.locator('.lightbox-card > img').getAttribute('src'), `app://assets/${encodeURIComponent(pactCard.imageAssetId)}`);
await settle(page); await closeLightbox(page);
check('spending the pact slots lays the deck card back (75%) over the now-unusable cards; selecting and enlarging still show the untouched original', { cards: blocked.map(b => b.name) });

await page.getByRole('button', { name: '긴 휴식', exact: true }).click();
const rest = page.getByRole('dialog', { name: /긴 휴식 확인/ });
await rest.getByRole('button', { name: '회복 확정', exact: true }).click(); await rest.waitFor({ state: 'hidden' });
await page.waitForFunction(() => document.querySelectorAll('.card-unusable-back').length === 0);
assert.equal(await page.locator(`.card-item[data-usability="usable"]`).count() > 0, true);
if (await card(page, pact).getAttribute('aria-pressed') !== 'true') await card(page, pact).click();
// Spend the slots by actually using the card: once the last slot is gone the overlay comes back.
const uses = [];
while (await page.getByRole('button', { name: '사용 확정', exact: true }).isEnabled() && !(await page.locator(`.card-item[data-usability="insufficient"]`).count())) {
  const latest = (await resourcesOf(page, profile.id)).events[0]?.id;
  await page.getByRole('button', { name: '사용 확정', exact: true }).click();
  await page.waitForFunction(async ({ id, latest }) => { const e = (await window.desktop.getResources(id)).value.events[0]; return e && e.id !== latest && e.type === 'card_used'; }, { id: profile.id, latest });
  uses.push(latest); await page.waitForTimeout(200);
  assert(uses.length <= 6, 'slots run out within a few uses');
}
await page.waitForSelector('.card-item.is-unusable:not(.is-selected) .card-unusable-back');
assert.equal(await card(page, pact).evaluate(el => el.closest('.card-item').dataset.usability), 'insufficient');
check('a long rest removes the overlay at once; using the card until the pact slots run out brings the overlay back', { uses: uses.length });

await app.close();
assert.deepEqual(await assetHashes(userData), assetsBefore, 'every image file is byte-for-byte unchanged');
check('original card image files are byte-for-byte unchanged after all of the above', { files: Object.keys(assetsBefore).length });

// 8. The enlargement fits the screen at 125% and 150%.
const fits = [];
for (const scale of [1.25, 1.5]) {
  ({ app, page } = await launch(await freshData(), scale));
  const name = (await boot(page)).cards.find(c => c.imageAssetId && c.name === A).name;
  await card(page, name).click(); await card(page, name).click(); await settle(page);
  const r = await page.locator('.lightbox-card').boundingBox(); const v = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  assert(r.x >= 0 && r.y >= 0 && r.x + r.width <= v.w + .5 && r.y + r.height <= v.h + .5, JSON.stringify({ r, v }));
  fits.push({ scale, viewport: v, card: { w: Math.round(r.width), h: Math.round(r.height) } });
  await closeLightbox(page); await app.close();
}
check('the enlarged card stays inside the window at 125% and 150%', { fits });
if (server) await server.close();
await writeFile(join(run, 'v11-p3-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outcome: 'PASS', mode: report.mode, checks: report.checks.length, artifacts: run }));
