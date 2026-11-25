// v1.3 Phase 3 checks (UI-P0 layout skeleton): three columns — IN PLAY over USED | card page over HAND | ledger over
// DECK — at 1920×1080, 1366×768 and 1280×720 with 100/125/150% scaling (real device scale factor) and the minimum window;
// no overlaps or clipping, the Use seal and the recovery buttons fully visible, the IN PLAY card keeps its ratio, the
// collapsed ledger keeps the deck, the 반응 행동 quick button, stable panels when filters change, and all four themes.
// UI-P1: five to seven hand cards, DECK shuffle (display only), USED clear/undo (display only), card backs from
// 관리 → 캐릭터·덱, and transparent PNG cards.
// Runs on COPIES of repository-data. Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { createServer } from 'vite';
import { assertLayout, measure } from './v13-board.mjs';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v13-p3-'));
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [] };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

function readDb(path, sql, ...params) { const db = new DatabaseSync(join(path, 'data', 'app.sqlite3'), { readOnly: true }); try { return db.prepare(sql).all(...params); } finally { db.close(); } }
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
const SIZES = [[1920, 1080, 1], [1366, 768, 1], [1280, 720, 1], [1920, 1080, 1.25], [1366, 768, 1.25], [1280, 720, 1.25], [1280, 720, 1.5]];
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

  const seals = {};
  for (const theme of ['oxblood', 'ebony', 'verdant', 'abyss']) {
    await page.evaluate(async theme => { const s = (await window.desktop.getBootstrap()).value.settings; const r = await window.desktop.saveSettings({ ...s, appearance: { ...(s.appearance ?? { cardBack: { default: { type: 'builtin', id: 'dragon' }, decks: {} }, customBacks: [] }), theme } }); if (!r.ok) throw new Error(r.error); }, theme);
    await page.reload(); await page.waitForSelector('.board'); await page.waitForTimeout(400); await selectCard(page);
    assertLayout(await measure(page), `theme ${theme}`);
    // UI-P3 (memo 5): each theme draws its own Use seal, and it loads.
    const seal = await page.locator('.use-button').evaluate(el => getComputedStyle(el).backgroundImage);
    seals[theme] = seal.includes('seal-ebony') ? 'ebony' : seal.includes('seal-felt') ? 'felt' : seal.includes('seal-arcane') ? 'arcane' : seal.includes('wax-seal') || seal.includes('data:image/png') ? 'wax' : seal;
    const loaded = await page.evaluate(src => new Promise(done => { const img = new Image(); img.onload = () => done(img.naturalWidth > 0); img.onerror = () => done(false); img.src = src; }), seal.match(/url\(\s*["']?(.+?)["']?\s*\)$/)[1]);
    assert(loaded, `${theme} seal loads`);
  }
  assert.deepEqual(seals, { oxblood: 'wax', ebony: 'ebony', verdant: 'felt', abyss: 'arcane' });
  check('All four themes share the same three-column layout without overlap or clipping; each draws its own Use seal (wax · ebony · felt · arcane) and it loads', seals);
  assert.deepEqual(errors, []); await app.close();
}

// ---------------------------------------------------------------------------------------------
// UI-P1: the card area.
const visibleHandCards = page => page.evaluate(() => {
  const area = document.querySelector('.cards-area').getBoundingClientRect();
  return [...document.querySelectorAll('.cards-area .card-item .card-face')].filter(face => { const r = face.getBoundingClientRect(); return r.left >= area.left - 1 && r.right <= area.right + 1; }).length;
});
const handOrder = page => page.locator('.cards-area .card-button').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label')));
{
  const counts = {};
  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    const { app, page } = await launch(await freshData());
    await resize(app, page, w, h); await page.evaluate(() => { document.querySelector('.cards-area').scrollLeft = 0; });
    counts[`${w}x${h}`] = await visibleHandCards(page);
    await app.close();
  }
  for (const [size, n] of Object.entries(counts)) assert(n >= 5 && n <= 8, `about five to seven hand cards at ${size}: ${n}`);
  check('The hand shows about five to seven whole cards at 1920×1080 and 1366×768', counts);
}
{
  const userData = await freshData();
  let { app, page, errors } = await launch(userData);
  await resize(app, page, 1366, 768);
  const dbCards = () => readDb(userData, 'SELECT id FROM card_definitions ORDER BY rowid').map(r => r.id).join();
  const dbDecks = () => JSON.stringify(readDb(userData, 'SELECT deck_id, card_id, position FROM deck_cards ORDER BY deck_id, position'));
  const [cardsBefore, decksBefore, settingsBefore] = [dbCards(), dbDecks(), JSON.stringify(readDb(userData, 'SELECT * FROM settings ORDER BY key'))];
  const original = await handOrder(page);
  const deck = page.getByRole('button', { name: /눌러서 손패 순서 섞기$/ });
  let shuffled = original;
  for (let i = 0; i < 6 && shuffled.join() === original.join(); i++) { await deck.click(); await page.waitForTimeout(250); shuffled = await handOrder(page); }
  assert.notDeepEqual(shuffled, original); assert.deepEqual([...shuffled].sort(), [...original].sort());
  assert.equal(dbCards(), cardsBefore); assert.equal(dbDecks(), decksBefore);
  assert.equal(JSON.stringify(readDb(userData, 'SELECT * FROM settings ORDER BY key')), settingsBefore, 'shuffling writes nothing');
  await page.getByRole('button', { name: '원래 순서', exact: true }).click();
  assert.deepEqual(await handOrder(page), original);
  await deck.click(); await page.waitForTimeout(200);
  await app.close(); ({ app, page, errors } = await launch(userData)); await resize(app, page, 1366, 768);
  assert.deepEqual(await handOrder(page), original, 'a restart shows the registration order again');
  check('DECK pile shuffles the hand order only (cards, deck rows and settings untouched); 원래 순서 and a restart bring back the registration order');

  // USED: a use shows in the pile; 비우기 hides it (display only), 되돌리기 restores, a cleared pile stays cleared after a restart.
  const boot = await page.evaluate(async () => (await window.desktop.getBootstrap()).value);
  const hero = boot.profiles.find(p => p.id === boot.libraryState.activeCharacterId);
  await page.evaluate(async hero => {
    const ok = r => { if (!r.ok) throw new Error(r.error); return r.value; };
    const revision = ok(await window.desktop.getResources(hero.id)).revision;
    ok(await window.desktop.saveCards({ cards: [{ name: 'USED 검수 카드', kind: 'other', roles: ['utility'], actions: ['action'], range: { kind: 'self' }, tags: [] }], registrationTarget: { characterId: hero.id, deckId: hero.activeDeckId },
      initialRules: { requestId: crypto.randomUUID(), configured: true, scope: 'character', characterId: hero.id, expectedRevision: revision, castOptions: [{ id: crypto.randomUUID(), label: '일반 사용', costs: [] }], bindings: [] } }));
  }, hero);
  await page.reload(); await page.waitForSelector('.board'); await resize(app, page, 1366, 768);
  const usedCount = async () => Number((await page.getByRole('button', { name: /^사용한 카드 더미 · 최근 \d+건/ }).getAttribute('aria-label')).match(/최근 (\d+)건/)[1]);
  const before = await usedCount();
  const card = page.getByRole('button', { name: 'USED 검수 카드 카드 선택', exact: true }); await card.scrollIntoViewIfNeeded(); await card.click();
  await page.waitForFunction(() => !document.querySelector('.use-button')?.disabled); await page.getByRole('button', { name: '사용 확정', exact: true }).click();
  await page.waitForFunction(n => /최근 (\d+)건/.exec(document.querySelector('.used-pile .pile-button')?.getAttribute('aria-label') ?? '')?.[1] === String(n), before + 1);
  const events = () => readDb(userData, 'SELECT count(*) AS n FROM play_events')[0].n; const eventsBefore = events();
  await page.getByRole('button', { name: '최근 사용 더미 비우기', exact: true }).click();
  await page.waitForFunction(() => /최근 0건/.test(document.querySelector('.used-pile .pile-button')?.getAttribute('aria-label') ?? ''));
  assert.equal(events(), eventsBefore, 'clearing the pile keeps every play event');
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await page.waitForFunction(n => /최근 (\d+)건/.exec(document.querySelector('.used-pile .pile-button')?.getAttribute('aria-label') ?? '')?.[1] === String(n), before + 1);
  await page.getByRole('button', { name: '최근 사용 더미 비우기', exact: true }).click();
  await page.waitForFunction(() => /최근 0건/.test(document.querySelector('.used-pile .pile-button')?.getAttribute('aria-label') ?? ''));
  assert(JSON.parse(readDb(userData, "SELECT value_json FROM settings WHERE key='used_view'")[0].value_json)[hero.id]);
  // The pile still opens the full history, which keeps the use.
  await page.locator('.used-pile .pile-button').click();
  const history = page.getByRole('dialog', { name: /카드 사용 기록/ }); await history.waitFor();
  assert((await history.textContent()).includes('USED 검수 카드'));
  await page.keyboard.press('Escape'); await history.waitFor({ state: 'hidden' });
  await app.close(); ({ app, page, errors } = await launch(userData)); await resize(app, page, 1366, 768);
  assert.equal(await usedCount(), 0, 'the cleared pile stays cleared after a restart');
  check('USED: a use adds to the pile; 비우기 empties it without touching play events, 되돌리기 restores it, the full history keeps the use, and a cleared pile stays cleared after a restart');

  // Card backs (memo 6): 관리 → 캐릭터·덱.
  const backBefore = await page.locator('.deck-pile img').first().getAttribute('src');
  await page.getByRole('button', { name: '관리', exact: true }).click();
  await page.getByRole('dialog', { name: '관리 메뉴', exact: true }).getByRole('button', { name: '캐릭터·덱', exact: true }).click();
  await page.getByRole('button', { name: /^카드 뒷면 바꾸기 · / }).click();
  const backs = page.getByRole('dialog', { name: '카드 뒷면 · 슬리브', exact: true }); await backs.waitFor();
  await backs.locator('label', { hasText: '별자리' }).click(); assert(await backs.getByRole('radio', { name: '별자리', exact: true }).isChecked()); await backs.getByRole('button', { name: '적용', exact: true }).click(); await backs.waitFor({ state: 'hidden' });
  await page.waitForFunction(src => document.querySelector('.deck-pile img')?.getAttribute('src') !== src, backBefore);
  check('Card backs are chosen from 관리 → 캐릭터·덱 and the DECK pile shows the new back');
  assert.deepEqual(errors, []);
  await app.close();
}
{
  // Transparent PNG (memo 1): no dark backing, alpha-following shadow, the card-back overlay masked to the image.
  const userData = await freshData();
  const { app, page, errors } = await launch(userData); await resize(app, page, 1366, 768);
  const png = join(run, 'transparent-card.png');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="612"><rect x="24" y="24" width="372" height="564" rx="60" fill="#2a3b5c" stroke="#e2c98f" stroke-width="10"/><circle cx="210" cy="250" r="90" fill="#d9a441"/></svg>';
  await writeFile(png, await sharp(Buffer.from(svg)).png().toBuffer());
  await page.locator('.top-actions').getByRole('button', { name: '카드 등록', exact: true }).click();
  const form = page.getByRole('dialog', { name: '카드 등록', exact: true }); await form.waitFor();
  await form.getByLabel('카드 이미지 파일').setInputFiles(png); await form.getByRole('img', { name: /등록 미리보기$/ }).waitFor();
  await form.getByLabel('카드 이름', { exact: true }).fill('투명 검수 카드');
  await form.getByRole('button', { name: '카드 저장', exact: true }).click(); await form.waitFor({ state: 'hidden' });
  const button = page.getByRole('button', { name: '투명 검수 카드 카드 선택', exact: true }); await button.scrollIntoViewIfNeeded();
  const face = button.locator('.card-face'); await page.waitForFunction(el => el.classList.contains('has-alpha'), await face.elementHandle());
  await page.waitForTimeout(400); // the face's shadow eases out (200 ms transition) once the image is known to be see-through
  const look = await face.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, shadow: getComputedStyle(el).boxShadow, filter: getComputedStyle(el.querySelector('img')).filter, overlay: (() => { const o = el.querySelector('.card-unusable-back'); return o ? getComputedStyle(o).maskImage : null; })() }));
  assert.equal(look.bg, 'rgba(0, 0, 0, 0)'); assert.equal(look.shadow, 'none'); assert.match(look.filter, /drop-shadow/);
  assert(look.overlay && look.overlay.includes('url('), `the card-back overlay is masked to the image: ${look.overlay}`);
  await button.click(); await page.mouse.move(1, 1); await page.waitForTimeout(300);
  assert.match(await face.evaluate(el => getComputedStyle(el.querySelector('img')).filter), /drop-shadow/);
  const opaque = page.locator('.cards-area .card-item .card-face.image-face:not(.has-alpha)').first();
  assert.notEqual(await opaque.evaluate(el => getComputedStyle(el).boxShadow), 'none', 'opaque cards keep the box shadow');
  assert.deepEqual(errors, []); await app.close();
  check('A transparent PNG card has no dark backing; its shadow, selection glow and the unusable card-back overlay follow the image shape; opaque cards keep their box shadow');
}

if (server) await server.close();
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, checks: report.checks.length, run }, null, 2));
