// v1.3 Phase 3 UI-P4 checks: play UX on the three-column board.
//  1. Select → IN PLAY + card page (nothing spent) → enlarge → Use → ledger and USED follow → Undo, at 1920×1080,
//     1366×768 and 1280×720 × 100/125/150% and the 860×440 minimum. (USED keeps an undone use, as in 1.2.0.)
//  2. Keyboard: arrows / Home / End keep the focused card whole in view, Enter selects, Enter again enlarges.
//  3. Hand drag (no selection), momentum and the mouse wheel in the new hand row.
//  4. Search (Ctrl+F) and filters, an empty result, the extra-filter popover inside the window; no panel moves.
//  5. Spend every pact slot → unusable card and disabled seal → each recovery dialog fits the window → 회복 확정.
//  6. 0 / 1 / 2 / 9 / 200 cards in the hand; 7. 0 / 1 / 2 / 14 resources (up to 23 rows) in the ledger.
//  8. All four themes: the play loop and the seal's hover / pressed / disabled states.
//  Original images and card rows stay byte-identical and the database passes integrity_check.
// Runs on COPIES of repository-data. Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
// Screenshots for the report go to <run>/shots.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import { assertLayout, inside, measure } from './v13-board.mjs';
import { closeExtraFilters, openExtraFilters, showWholeLibrary } from './navigation-helpers.mjs';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v13-ux-'));
const shots = join(run, 'shots'); await mkdir(shots);
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [] };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

function readDb(path, sql, ...params) { const db = new DatabaseSync(join(path, 'data', 'app.sqlite3'), { readOnly: true }); try { return db.prepare(sql).all(...params); } finally { db.close(); } }
async function freshData() { const dir = await mkdtemp(join(run, 'data-')); await cp(resolve('repository-data/user-data'), dir, { recursive: true }); return dir; }
/** What must never change: every original image file and every original card row. */
async function fingerprint(userData) {
  const files = {}; for (const name of (await readdir(join(userData, 'assets'))).sort()) files[name] = createHash('sha256').update(await readFile(join(userData, 'assets', name))).digest('hex');
  return { files, cards: JSON.stringify(readDb(userData, 'SELECT * FROM card_definitions ORDER BY id')) };
}
async function assertPreserved(userData, before, label) {
  const after = await fingerprint(userData);
  for (const [name, hash] of Object.entries(before.files)) assert.equal(after.files[name], hash, `${label}: image ${name} unchanged`);
  const original = JSON.parse(before.cards); const now = new Map(JSON.parse(after.cards).map(row => [row.id, JSON.stringify(row)]));
  for (const row of original) assert.equal(now.get(row.id), JSON.stringify(row), `${label}: card ${row.id} unchanged`);
  assert.equal(readDb(userData, 'PRAGMA integrity_check')[0].integrity_check, 'ok', `${label}: integrity_check`);
}
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
async function capture(app, page, name) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(join(shots, `${name}.png`), Buffer.from(bytes, 'base64'));
}
const bootstrap = page => page.evaluate(async () => (await window.desktop.getBootstrap()).value);
const resources = (page, id) => page.evaluate(async id => (await window.desktop.getResources(id)).value, id);
async function activeHero(page) { const boot = await bootstrap(page); return boot.profiles.find(p => p.id === boot.libraryState.activeCharacterId); }
const pactOf = snapshot => { const pact = snapshot.resources.find(r => r.kind === 'slot_track' && r.template.slotKind === 'pact'); const level = Number(Object.keys(pact.remainingByLevel)[0]); return { pact, level, full: pact.remainingByLevel[level] }; };
const pactLeft = async (page, id, pactId, level) => (await resources(page, id)).resources.find(r => r.id === pactId).remainingByLevel[level];
async function waitPact(page, id, pactId, level, value) {
  await page.waitForFunction(({ id, pactId, level, value }) => window.desktop.getResources(id).then(r => r.value.resources.find(x => x.id === pactId).remainingByLevel[level] === value), { id, pactId, level, value });
}
const usedCount = async page => Number((await page.locator('.used-pile .pile-button').getAttribute('aria-label')).match(/최근 (\d+)건/)[1]);
const waitUsed = (page, n) => page.waitForFunction(n => /최근 (\d+)건/.exec(document.querySelector('.used-pile .pile-button')?.getAttribute('aria-label') ?? '')?.[1] === String(n), n);
const visibleCount = page => page.getByLabel('표시 카드 수', { exact: true }).textContent();
const lightbox = page => page.locator('dialog.image-lightbox');
async function settle(page) { await page.waitForFunction(() => { const f = document.querySelector('.lightbox-card'); return !f || f.getAnimations().length === 0; }, null, { polling: 'raf' }); }
async function closeLightbox(page) { await page.keyboard.press('Escape'); await lightbox(page).waitFor({ state: 'detached' }); }
async function deselect(page) { const close = page.getByRole('button', { name: '카드 선택 닫기', exact: true }); if (await close.count()) { await close.click(); await page.locator('.in-play-slot.is-empty').waitFor(); } }
/** The ledger row of a slot level prints “current / maximum” in its 현재량 label. */
async function ledgerAmount(page, name) { const text = await page.getByLabel(`${name} 현재량`, { exact: true }).textContent(); const m = text.match(/^(\d+) \/ (\d+)$/); return m ? [Number(m[1]), Number(m[2])] : text; }
/** Waits until the ledger shows `value` for that row (it repaints just after the database changes). */
const waitLedger = (page, name, value) => page.waitForFunction(({ name, value }) => [...document.querySelectorAll('.resource-status-row strong')].find(el => el.getAttribute('aria-label') === `${name} 현재량`)?.textContent.startsWith(`${value} /`), { name, value });
const zonesOnly = m => Object.fromEntries(Object.entries(m.zones).map(([k, v]) => [k, v && { x: Math.round(v.x), y: Math.round(v.y), w: Math.round(v.w), h: Math.round(v.h) }]));
async function setTheme(page, theme) {
  await page.evaluate(async theme => { const s = (await window.desktop.getBootstrap()).value.settings; const r = await window.desktop.saveSettings({ ...s, appearance: { ...(s.appearance ?? { cardBack: { default: { type: 'builtin', id: 'dragon' }, decks: {} }, customBacks: [] }), theme } }); if (!r.ok) throw new Error(r.error); }, theme);
  await page.reload(); await page.waitForSelector('.board'); await page.waitForTimeout(400);
}
async function switchCharacter(page, name) {
  const select = page.getByLabel('활성 캐릭터', { exact: true });
  if (name === undefined) await showWholeLibrary(page); else await select.selectOption({ label: name });
  await page.waitForTimeout(600);
}

// ---------------------------------------------------------------------------------------------
// 1. The play loop at every size and scale.
const SIZES = [[1920, 1080, 1], [1366, 768, 1], [1280, 720, 1], [860, 440, 1], [1920, 1080, 1.25], [1366, 768, 1.25], [1280, 720, 1.25], [1920, 1080, 1.5], [1366, 768, 1.5], [1280, 720, 1.5]];
{
  const results = {};
  for (const scale of [1, 1.25, 1.5]) {
    const userData = await freshData(); const before = await fingerprint(userData);
    const { app, page, errors } = await launch(userData, scale);
    const hero = await activeHero(page); const { pact, level, full } = pactOf(await resources(page, hero.id));
    const row = `${pact.name} ${level}레벨`;
    for (const [w, h] of SIZES.filter(s => s[2] === scale)) {
      const label = `${w}×${h} @${scale * 100}%`; const min = w === 860;
      await resize(app, page, min ? w : Math.round(w / scale), min ? h : Math.round(h / scale)); await deselect(page);
      assertLayout(await measure(page), `${label} nothing selected`, { selected: false });
      // Selecting puts the card in IN PLAY and on the card page, and spends nothing.
      const first = page.locator('.cards-area .card-button').first(); await first.scrollIntoViewIfNeeded();
      const name = (await first.getAttribute('aria-label')).replace(/ 카드 선택$/, '');
      const revision = (await resources(page, hero.id)).revision; const events = readDb(userData, 'SELECT count(*) AS n FROM play_events')[0].n;
      await first.click(); await page.mouse.move(1, 1); await page.locator('.use-button').waitFor(); await page.waitForTimeout(250);
      assert.equal(await first.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.in-play-slot .detail-card').getAttribute('aria-label'), `${name} 미리보기 확대`, `${label}: IN PLAY shows the selected card`);
      assert.equal(await page.locator('.selected-card-heading h2').textContent(), name, `${label}: the card page shows the selected card`);
      assert.equal((await resources(page, hero.id)).revision, revision, `${label}: selecting spends nothing`);
      assert.equal(readDb(userData, 'SELECT count(*) AS n FROM play_events')[0].n, events);
      const m = await measure(page); assertLayout(m, `${label} selected`);
      // Clicking the selected hand card again, or the IN PLAY card, enlarges it inside the window.
      for (const opener of [first, page.locator('.in-play-slot .detail-card')]) {
        await opener.click(); await lightbox(page).waitFor(); await settle(page);
        const box = await page.locator('.lightbox-card').boundingBox();
        assert(inside({ x: box.x, y: box.y, r: box.x + box.width, b: box.y + box.height }, { x: 0, y: 0, r: m.vw, b: m.vh }, 1), `${label}: the enlarged card fits the window ${JSON.stringify(box)}`);
        assert(box.height > m.card.h, `${label}: the enlargement is larger than the IN PLAY card`);
        if (w === 1366 && scale === 1 && opener === first) await capture(app, page, 'enlarge-1366x768');
        await closeLightbox(page);
      }
      // Use: one pact slot is spent; the ledger and the USED pile follow; Undo restores both.
      const used = await usedCount(page);
      assert.deepEqual(await ledgerAmount(page, row), [full, full]);
      await page.locator('.use-button').click(); await waitPact(page, hero.id, pact.id, level, full - 1);
      await waitLedger(page, row, full - 1);
      await waitUsed(page, used + 1);
      assertLayout(await measure(page), `${label} after Use`);
      if (scale === 1 && (w === 1366 || min)) await capture(app, page, `used-${w}x${h}`);
      await page.getByRole('button', { name: '직전 자원 변경 실행 취소', exact: true }).click(); await waitPact(page, hero.id, pact.id, level, full);
      await waitLedger(page, row, full);
      // Unchanged since 1.2.0: the pile counts card uses; Undo adds its own event and the use stays in the history.
      assert.equal(await usedCount(page), used + 1, `${label}: USED keeps the use after Undo (1.2.0 behaviour)`);
      results[label] = { card: name, viewport: `${m.vw}×${m.vh}` };
    }
    assert.deepEqual(errors, []); await app.close();
    await assertPreserved(userData, before, `play loop @${scale * 100}%`);
  }
  check('Play loop at 1920×1080 / 1366×768 / 1280×720 × 100/125/150% and the 860×440 minimum: selecting fills IN PLAY and the card page and spends nothing; the hand card or the IN PLAY card enlarges inside the window; Use spends one pact slot, the ledger and USED follow; Undo restores the slot (USED keeps the use, as in 1.2.0); layout intact at every step; images and card rows unchanged', results);
}

// ---------------------------------------------------------------------------------------------
// 2–4. Keyboard, hand drag / momentum / wheel, search and filters.
const handArea = page => page.locator('.cards-area');
const scrollLeft = page => handArea(page).evaluate(el => el.scrollLeft);
async function setScroll(page, value) { await page.waitForFunction(() => document.querySelector('.cards-area')?.dataset.gliding !== 'true', null, { timeout: 5000 }); await handArea(page).evaluate((el, value) => { el.scrollLeft = value; }, value); await page.waitForTimeout(150); }
/** A mouse drag on the hand; the release follows the last move unless `hold` rests first. */
async function drag(page, { from = .7, to = .4, steps = 4, hold = 0 } = {}) {
  const box = await handArea(page).boundingBox(); const y = box.y + Math.min(80, box.height / 2);
  await handArea(page).evaluate(el => { window.__moves = []; const move = e => window.__moves.push(e.timeStamp); el.addEventListener('pointermove', move, { capture: true }); el.addEventListener('pointerup', e => { window.__released = el.scrollLeft; window.__up = e.timeStamp; el.removeEventListener('pointermove', move, { capture: true }); }, { once: true, capture: true }); });
  await page.mouse.move(box.x + box.width * from, y); await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(box.x + box.width * (from + (to - from) * i / steps), y);
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.up();
  return page.evaluate(() => ({ released: window.__released, gap: window.__up - window.__moves.at(-1) }));
}
const cardInView = (page, button) => button.evaluate(el => { const a = el.closest('.cards-area').getBoundingClientRect(); const r = el.closest('.card-item').querySelector('.card-face').getBoundingClientRect(); return r.left >= a.left - 1 && r.right <= a.right + 1; });
{
  const userData = await freshData(); const before = await fingerprint(userData);
  const { app, page, errors } = await launch(userData);
  await resize(app, page, 1366, 768); await deselect(page);
  // 2. Keyboard.
  const buttons = page.locator('.cards-area .card-button'); const total = await buttons.count();
  await buttons.first().focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.cards-area .card-button')].indexOf(document.activeElement)), 3);
  await page.keyboard.press('End'); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.cards-area .card-button')].indexOf(document.activeElement)), total - 1);
  assert(await cardInView(page, buttons.last()), 'End brings the last card whole into view');
  await page.keyboard.press('Home'); await page.waitForTimeout(400);
  assert(await cardInView(page, buttons.first()), 'Home brings the first card whole into view');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.locator('.use-button').waitFor();
  assert.equal(await buttons.nth(1).getAttribute('aria-pressed'), 'true', 'Enter selects the focused card');
  await page.keyboard.press('Enter'); await lightbox(page).waitFor(); await settle(page); await closeLightbox(page);
  assert.equal(await page.evaluate(() => document.activeElement?.closest('.card-item') !== null), true, 'closing the enlargement gives focus back to the hand');
  check('Keyboard: ← → move the focus, Home / End bring the first / last card whole into view, Enter selects, Enter again enlarges, Esc closes and focus returns to the hand');

  // 3. Drag, momentum and wheel, on the whole library (the deck view may fit without scrolling).
  await deselect(page); await showWholeLibrary(page); await page.waitForTimeout(400);
  const drags = {};
  for (const [w, h] of [[1366, 768], [860, 440]]) {
    await resize(app, page, w, h); await setScroll(page, 0);
    const max = await handArea(page).evaluate(el => el.scrollWidth - el.clientWidth);
    assert(max > 200, `${w}×${h}: the 17-card library overflows the hand (${max})`);
    const pressed = await page.locator('.cards-area .card-button[aria-pressed="true"]').count();
    const slow = await drag(page, { hold: 250 }); await page.waitForTimeout(300);
    const afterSlow = await scrollLeft(page);
    assert(slow.released > 60 && Math.abs(afterSlow - slow.released) <= 2, `${w}×${h}: a slow drag scrolls by the drag and stops ${JSON.stringify({ slow, afterSlow })}`);
    assert.equal(await page.locator('.cards-area .card-button[aria-pressed="true"]').count(), pressed, 'dragging selects nothing');
    let glide;
    for (let attempt = 0; attempt < 4 && !glide; attempt++) { await setScroll(page, 0); const fast = await drag(page, { from: .85, to: .45, steps: 3 }); /* long and quick: well above 0.35 px/ms however the harness spaces the moves */ if (fast.gap < 50) { await page.waitForTimeout(80); await page.waitForFunction(() => document.querySelector('.cards-area')?.dataset.gliding !== 'true', null, { timeout: 5000 }); glide = { ...fast, final: await scrollLeft(page) }; } else await page.waitForTimeout(400); }
    assert(glide && glide.final - glide.released > 20, `${w}×${h}: a fast flick keeps gliding after the release ${JSON.stringify(glide)}`);
    await setScroll(page, 0); const box = await handArea(page).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 240); await page.waitForTimeout(200);
    assert(await scrollLeft(page) > 100, `${w}×${h}: the mouse wheel scrolls the hand sideways`);
    await page.mouse.move(1, 1); await page.waitForTimeout(250);
    assertLayout(await measure(page), `${w}×${h} after scrolling`, { selected: false, coins: false }); // whole library: no character, so no recovery buttons
    drags[`${w}x${h}`] = { slow: Math.round(slow.released), glide: Math.round(glide.final - glide.released) };
  }
  check('Hand row: a slow drag scrolls without selecting, a fast flick glides on, the mouse wheel scrolls sideways (1366×768 and 860×440)', drags);

  // 4. Search and filters move no panel; an empty result stays inside the hand row; the extra filters fit the window.
  const searches = {};
  for (const [w, h] of [[1366, 768], [860, 440]]) {
    await resize(app, page, w, h); await page.waitForTimeout(200);
    const all = await visibleCount(page); const base = zonesOnly(await measure(page));
    await page.locator('.board').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Control+f');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'card-name-search', 'Ctrl+F focuses the search');
    const target = (await page.locator('.cards-area .card-button').nth(2).getAttribute('aria-label')).replace(/ 카드 선택$/, '');
    await page.keyboard.type(target); await page.waitForFunction(all => document.querySelector('[aria-label="표시 카드 수"]')?.textContent !== all, all);
    const names = await page.locator('.cards-area .card-button').evaluateAll(b => b.map(x => x.getAttribute('aria-label').replace(/ 카드 선택$/, '')));
    assert(names.includes(target) && names.every(n => n.includes(target)), `search finds ${target}: ${names}`);
    assert.deepEqual(zonesOnly(await measure(page)), base, `${w}×${h}: searching moves no panel`);
    await page.keyboard.type(' 없는-이름-zz'); await page.locator('.hand-row .empty-library').waitFor();
    assert.equal(await page.locator('.hand-row .empty-library h3').textContent(), '조건에 맞는 카드가 없어요');
    assertLayout(await measure(page), `${w}×${h} empty search`, { selected: false, hand: false, coins: false });
    assert.deepEqual(zonesOnly(await measure(page)), base, `${w}×${h}: an empty result moves no panel`);
    if (w === 860) await capture(app, page, 'search-empty-860x440');
    await page.keyboard.press('Escape'); await page.waitForFunction(all => document.querySelector('[aria-label="표시 카드 수"]')?.textContent === all, all);
    // A role tab and a quick action button narrow the hand; 전체 brings it back.
    const roles = page.locator('.board-top').getByRole('button', { name: '유틸', exact: true });
    await roles.click(); await page.waitForTimeout(300); const narrowed = await visibleCount(page);
    assert.notEqual(narrowed, all, 'a role filter narrows the hand');
    assert.deepEqual(zonesOnly(await measure(page)), base, `${w}×${h}: a role filter moves no panel`);
    await page.locator('.board-top').getByRole('button', { name: '전체', exact: true }).click(); await page.waitForFunction(all => document.querySelector('[aria-label="표시 카드 수"]')?.textContent === all, all);
    const panel = await openExtraFilters(page); const pb = await panel.boundingBox(); const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    assert(pb.x >= 0 && pb.y >= 0 && pb.x + pb.width <= vp.w + 1 && pb.y + pb.height <= vp.h + 1, `${w}×${h}: the extra filters fit the window ${JSON.stringify(pb)}`);
    if (w === 860) await capture(app, page, 'extra-filters-860x440');
    await closeExtraFilters(page);
    searches[`${w}x${h}`] = { all, narrowed, found: names.length };
  }
  check('Search and filters: Ctrl+F focuses the search, results narrow the hand, an empty result shows its message inside the hand row, a role filter narrows and 전체 restores, the extra filters fit the window; no panel moves (1366×768 and 860×440)', searches);
  assert.deepEqual(errors, []); await app.close();
  await assertPreserved(userData, before, 'keyboard / drag / search');
}

// ---------------------------------------------------------------------------------------------
// 5. Spend every pact slot, then recover.
{
  const userData = await freshData(); const before = await fingerprint(userData);
  const rests = {};
  for (const [w, h, scale] of [[1366, 768, 1.25], [860, 440, 1]]) {
    const { app, page, errors } = await launch(userData, scale);
    await resize(app, page, scale === 1 ? w : Math.round(w / scale), scale === 1 ? h : Math.round(h / scale));
    const hero = await activeHero(page); const { pact, level, full } = pactOf(await resources(page, hero.id));
    const first = page.locator('.cards-area .card-button').first(); const name = (await first.getAttribute('aria-label')).replace(/ 카드 선택$/, '');
    if (await first.getAttribute('aria-pressed') !== 'true') await first.click();
    await page.mouse.move(1, 1); await page.locator('.use-button').waitFor();
    for (let left = full; left > 0; left--) { await page.locator('.use-button').click(); await waitPact(page, hero.id, pact.id, level, left - 1); await page.waitForTimeout(150); }
    await page.waitForFunction(() => document.querySelector('.use-button')?.disabled === true);
    const tile = page.getByRole('button', { name: `${name} 카드 선택`, exact: true });
    await tile.locator('.card-unusable-back').waitFor();
    assert.match(await page.locator('.use-button').evaluate(el => getComputedStyle(el).filter), /grayscale|saturate/, 'the disabled seal is greyed');
    assertLayout(await measure(page), `${w}×${h} @${scale * 100}% exhausted`);
    await capture(app, page, `exhausted-${w}x${h}`);
    // Every recovery button opens its own confirmation inside the window; Esc cancels without spending or restoring.
    for (const trigger of ['긴 휴식', '새벽 경과', '수동 회복', '짧은 휴식']) {
      await page.getByRole('button', { name: trigger, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `${trigger} 확인`, exact: true }); await dialog.waitFor();
      const box = await dialog.boundingBox(); const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.w + 1 && box.y + box.height <= vp.h + 1, `${trigger} dialog fits ${w}×${h} ${JSON.stringify(box)}`);
      const confirm = dialog.getByRole('button', { name: '회복 확정', exact: true }); await confirm.scrollIntoViewIfNeeded();
      assert(await confirm.isVisible(), `${trigger}: 회복 확정 reachable`);
      if (trigger !== '짧은 휴식') { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); assert.equal(await pactLeft(page, hero.id, pact.id, level), 0); continue; }
      if (w === 1366) await capture(app, page, 'rest-dialog-1366x768');
      await confirm.click(); await dialog.waitFor({ state: 'hidden' });
    }
    await waitPact(page, hero.id, pact.id, level, full);
    await page.waitForFunction(() => document.querySelector('.use-button')?.disabled === false);
    await tile.locator('.card-unusable-back').waitFor({ state: 'detached' });
    // Undo takes the short rest back; a long rest restores again.
    await page.getByRole('button', { name: '직전 자원 변경 실행 취소', exact: true }).click(); await waitPact(page, hero.id, pact.id, level, 0);
    await page.getByRole('button', { name: '긴 휴식', exact: true }).click();
    const long = page.getByRole('dialog', { name: '긴 휴식 확인', exact: true }); await long.getByRole('button', { name: '회복 확정', exact: true }).click(); await long.waitFor({ state: 'hidden' });
    await waitPact(page, hero.id, pact.id, level, full);
    assertLayout(await measure(page), `${w}×${h} @${scale * 100}% recovered`);
    rests[`${w}x${h}@${scale * 100}`] = { pact: `${pact.name} ${level}레벨`, spent: full };
    assert.deepEqual(errors, []); await app.close();
  }
  await assertPreserved(userData, before, 'spend and recover');
  check('Spending every pact slot greys the seal and covers the card with the card back; each recovery confirmation fits the window (1366×768 @125% and 860×440), Esc cancels, 짧은 휴식 → 회복 확정 restores, Undo takes it back, 긴 휴식 restores again', rests);
}

// ---------------------------------------------------------------------------------------------
// 6. Card counts and 7. resource counts.
{
  const userData = await freshData(); const before = await fingerprint(userData);
  let { app, page, errors } = await launch(userData);
  // 200 cards in the whole library: 17 existing + 183 sharing the existing images (no new image files).
  await page.evaluate(async () => {
    const ok = r => { if (!r.ok) throw new Error(r.error); return r.value; };
    const images = ok(await window.desktop.getBootstrap()).cards.filter(c => c.imageAssetId).map(c => c.imageAssetId);
    for (let i = 0; i < 183; i += 50) ok(await window.desktop.saveCards({ cards: Array.from({ length: Math.min(50, 183 - i) }, (_, j) => ({ name: `손패 검수 ${String(i + j + 1).padStart(3, '0')}`, kind: 'other', roles: ['utility'], actions: ['action'], range: { kind: 'self' }, tags: [], imageAssetId: images[(i + j) % images.length] })), addToDeck: false }));
    // Characters for the ledger: no resources, one counter, and many (wizard 20 = 9 slot levels + 12 counters).
    const change = async (id, action) => { const s = ok(await window.desktop.getResources(id)); return ok(await window.desktop.changeResource({ requestId: crypto.randomUUID(), characterId: id, expectedRevision: s.revision, action })); };
    for (const name of ['자원 0 검수', '자원 1 검수', '자원 많음 검수']) ok(await window.desktop.createProfile({ name }));
    const lib = ok(await window.desktop.getBootstrap()); const byName = n => lib.profiles.find(p => p.name === n);
    const hero = byName('리벨리오 반 빅토르'); /* creating a profile makes it the active one */ const heroDeck = lib.decks.find(d => d.id === hero.activeDeckId);
    for (const n of ['자원 0 검수', '자원 1 검수', '자원 많음 검수']) ok(await window.desktop.setDeckCards({ deckId: byName(n).activeDeckId, cardIds: heroDeck.cardIds }));
    await change(byName('자원 1 검수').id, { type: 'create_resource', scope: 'character', template: { name: '검수 횟수', unit: '회', kind: 'counter', capacity: { type: 'fixed', value: 3 }, recovery: [{ triggers: ['long_rest'], amount: { type: 'full' } }] } });
    const many = byName('자원 많음 검수').id; const configuration = { classId: 'wizard', level: 20 };
    const preview = ok(await window.desktop.previewClass({ characterId: many, configuration })); await change(many, { type: 'configure_class', configuration, quote: preview.quote });
    for (let i = 1; i <= 12; i++) await change(many, { type: 'create_resource', scope: 'character', template: { name: `검수 자원 ${String(i).padStart(2, '0')}`, unit: '회', kind: 'counter', capacity: { type: 'fixed', value: 4 }, recovery: [{ triggers: ['long_rest'], amount: { type: 'full' } }] } });
  });
  await page.reload(); await page.waitForSelector('.board'); await page.waitForTimeout(500);
  const counts = {}; const ledgers = {};
  let current = 1;
  for (const [w, h, scale] of [[1366, 768, 1], [1280, 720, 1.5], [860, 440, 1]]) {
    if (scale !== current) { assert.deepEqual(errors, []); await app.close(); ({ app, page, errors } = await launch(userData, scale)); current = scale; }
    await resize(app, page, Math.round(w / scale), Math.round(h / scale));
    const label = `${w}×${h} @${scale * 100}%`; const nine = {};
    for (const [who, n] of [['XYZ', 0], ['드루이드', 1], ['이븐우드', 2], ['리벨리오 반 빅토르', 9], [undefined, 200]]) {
      await switchCharacter(page, who); await deselect(page);
      assert.equal(await visibleCount(page), `${n} / 200장`, `${label}: ${who ?? '전체 라이브러리'} shows ${n} of the 200 library cards`);
      assert.match(await page.locator('.deck-pile .pile-button').getAttribute('aria-label'), new RegExp(`${n}장`), 'the DECK pile counts the same cards');
      if (!n) {
        assert.equal(await page.locator('.hand-row .empty-library h3').textContent(), '이 덱에 아직 카드가 없어요');
        assertLayout(await measure(page), `${label} 0 cards`, { selected: false, hand: false });
      } else {
        const first = page.locator('.cards-area .card-button').first(); await first.click(); await page.mouse.move(1, 1); await page.locator('.in-play-slot .detail-card').waitFor(); await page.waitForTimeout(250);
        const m = await measure(page); assertLayout(m, `${label} ${n} cards`, { coins: who !== undefined }); nine[n] = m.handCard.width;
        const tops = await page.locator('.cards-area .card-item').evaluateAll(items => [...new Set(items.map(i => Math.round(i.getBoundingClientRect().top)))]);
        assert.equal(tops.length, 1, `${label} ${n} cards: one row`);
        if (n === 200) {
          await first.focus(); await page.keyboard.press('End'); await page.waitForTimeout(600);
          assert(await cardInView(page, page.locator('.cards-area .card-button').last()), `${label}: the 200th card can be reached and shown whole`);
        }
      }
      if (scale === 1 && [0, 1, 200].includes(n)) await capture(app, page, `hand-${n}-cards`);
    }
    for (const n of [1, 2, 200]) assert(Math.abs(nine[n] - nine[9]) < 1, `${label}: hand cards keep one size whatever the count ${JSON.stringify(nine)}`);
    counts[label] = { cardWidth: Math.round(nine[9]) };
    // Resources.
    // 자원 많음: wizard 20 (one spell-slot track with nine level rows, plus its class counter) and 12 counters = 14 resources.
    for (const [who, expected] of [['자원 0 검수', 0], ['자원 1 검수', 1], ['리벨리오 반 빅토르', 2], ['자원 많음 검수', 14]]) {
      await switchCharacter(page, who); await page.locator('.cards-area .card-button').first().click(); await page.mouse.move(1, 1); await page.waitForTimeout(300);
      const snap = await resources(page, (await activeHero(page)).id); assert.equal(snap.resources.length, expected, `${who} has ${expected} resources`);
      const m = await measure(page); assertLayout(m, `${label} ${expected} resources`);
      const list = page.getByLabel('자원 목록 스크롤', { exact: true });
      const scroll = await list.count() ? await list.evaluate(el => ({ overflow: el.scrollHeight - el.clientHeight })) : { overflow: 0 };
      const rows = await page.locator('.resource-status-row').count();
      if (expected === 14) {
        assert(rows >= 21, `${label}: ${rows} ledger rows`);
        assert(scroll.overflow > 40, `${label}: many resources scroll inside the ledger ${JSON.stringify(scroll)}`);
        const lastRow = page.locator('.resource-status-row').last(); await lastRow.evaluate(el => el.scrollIntoView({ block: 'nearest' })); await page.waitForTimeout(200);
        const lb = await lastRow.boundingBox(); const view = await list.boundingBox();
        const shown = Math.min(lb.y + lb.height, view.y + view.height) - Math.max(lb.y, view.y);
        assert(view.height >= 48, `${label}: the ledger list keeps at least one row of height (${view.height})`);
        assert(shown >= Math.min(lb.height, view.height) - 1, `${label}: scrolling the ledger reaches the last resource ${JSON.stringify({ lb, view })}`);
        assertLayout(await measure(page), `${label} 14 resources scrolled`);
      }
      if (scale === 1 && [0, 14].includes(expected)) await capture(app, page, `ledger-${expected}-resources`);
      ledgers[`${label} · ${expected}`] = { rows, ledgerHeight: Math.round(m.zones.ledger.h), listOverflow: Math.round(scroll.overflow) };
    }
  }
  assert.deepEqual(errors, []); await app.close();
  await assertPreserved(userData, before, 'card and resource counts');
  check('0 / 1 / 2 / 9 / 200 cards: the hand and the DECK pile agree, 0 shows the empty-deck message inside the hand row, cards keep one size and one row, the 200th card is reachable (1366×768, 1280×720 @150% and 860×440)', counts);
  check('0 / 1 / 2 / 14 resources (up to 23 ledger rows): the layout holds, a long ledger scrolls inside with the last row reachable, recovery buttons and DECK stay visible (1366×768, 1280×720 @150% and 860×440)', ledgers);
}

// ---------------------------------------------------------------------------------------------
// 8. Themes: the play loop and the seal states.
{
  const userData = await freshData(); const before = await fingerprint(userData);
  const { app, page, errors } = await launch(userData);
  await resize(app, page, 1366, 768);
  const states = {};
  for (const theme of ['oxblood', 'ebony', 'verdant', 'abyss']) {
    await setTheme(page, theme);
    const hero = await activeHero(page); const { pact, level, full } = pactOf(await resources(page, hero.id));
    const first = page.locator('.cards-area .card-button').first(); if (await first.getAttribute('aria-pressed') !== 'true') await first.click();
    await page.mouse.move(1, 1); const seal = page.locator('.use-button'); await seal.waitFor(); await page.waitForTimeout(300);
    const look = () => seal.evaluate(el => ({ filter: getComputedStyle(el).filter, transform: getComputedStyle(el).transform, color: getComputedStyle(el).color }));
    const idle = await look();
    const sb = await seal.boundingBox(); await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.waitForTimeout(250);
    const hover = await look();
    await page.mouse.down(); await page.waitForTimeout(200); const pressed = await look();
    await page.mouse.move(2, 2); await page.mouse.up(); await page.waitForTimeout(200);
    assert.equal(await pactLeft(page, hero.id, pact.id, level), full, `${theme}: pressing and leaving the seal spends nothing`);
    const disabled = await seal.evaluate(el => { el.disabled = true; const s = getComputedStyle(el); const r = { filter: s.filter, color: s.color }; el.disabled = false; return r; });
    assert.notEqual(hover.filter, idle.filter, `${theme}: hover lights the seal`);
    assert(pressed.transform !== 'none' && pressed.transform !== hover.transform, `${theme}: the seal presses down ${JSON.stringify(pressed)}`);
    assert.match(disabled.filter, /grayscale|saturate/, `${theme}: the disabled seal is greyed`);
    // The loop: enlarge, Use, Undo.
    await first.click(); await lightbox(page).waitFor(); await settle(page); await closeLightbox(page);
    const used = await usedCount(page);
    await seal.click(); await waitPact(page, hero.id, pact.id, level, full - 1); await waitUsed(page, used + 1);
    assertLayout(await measure(page), `theme ${theme} after Use`);
    await capture(app, page, `theme-${theme}-after-use`);
    await page.getByRole('button', { name: '직전 자원 변경 실행 취소', exact: true }).click(); await waitPact(page, hero.id, pact.id, level, full);
    states[theme] = { idle: idle.filter, hover: hover.filter, pressed: pressed.transform, disabled: disabled.filter };
  }
  assert.deepEqual(errors, []); await app.close();
  await assertPreserved(userData, before, 'themes');
  check('All four themes: the seal lights on hover, presses down, greys out when disabled, and pressing then leaving it spends nothing; enlarge → Use → Undo works with the layout intact', states);
}

if (server) await server.close();
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, checks: report.checks.length, run }, null, 2));
