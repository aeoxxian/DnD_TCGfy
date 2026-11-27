// Board checks: full-height IN PLAY | card page over HAND | ledger over USED and DECK,
// at 1920×1080, 1366×768 and 1280×720 with forced Electron scaling, plus the default and minimum windows;
// no overlaps or clipping, the Use seal and the recovery buttons fully visible, the IN PLAY card keeps its ratio, the
// collapsed ledger keeps the deck, the 반응 행동 quick button, stable panels when filters change, and all four themes.
// UI-P1: five to seven hand cards, DECK shuffle (display only), USED clear/undo (display only), card backs from
// 관리 → 캐릭터·덱, and transparent PNG cards.
// Runs on COPIES of repository-data. Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { createServer } from 'vite';
import { assertLayout, inside, measure, overlap } from './v13-board.mjs';
import { closeExtraFilters, openExtraFilters } from './navigation-helpers.mjs';

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
const SIZES = [1, 1.25, 1.5].flatMap(scale => [[1920, 1080], [1366, 768], [1280, 720]].map(([w, h]) => [w, h, scale]));
SIZES.push([1440, 900, 1]);
const results = {};
for (const scale of [1, 1.25, 1.5]) {
  const { app, page, errors } = await launch(await freshData(), scale);
  for (const [w, h] of SIZES.filter(s => s[2] === scale)) {
    await resize(app, page, Math.round(w / scale), Math.round(h / scale)); await selectCard(page);
    const m = await measure(page); assertLayout(m, `${w}×${h} @${scale * 100}%`);
    const widths = ['inPlay', 'page', 'ledger'].map(zone => m.zones[zone].w);
    results[`${w}x${h}@${scale * 100}`] = { widths, inPlayCard: m.card, viewport: `${m.vw}×${m.vh}` };
  }
  if (scale === 1) {
    await resize(app, page, 860, 440); await selectCard(page);
    assertLayout(await measure(page), 'minimum window 860×440');
  }
  assert.deepEqual(errors, []); await app.close();
}
check('24:52:24 after gaps and full-height IN PLAY at the nine size/scale combinations, default and minimum windows; fixed right pile row, whole cards and reachable controls', results);

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
  const actions = () => page.evaluate(async () => (await window.desktop.getBootstrap()).value.libraryState.actions);
  const roleState = () => page.evaluate(async () => (await window.desktop.getBootstrap()).value.libraryState.roles);
  const extra = page.locator('.extra-filters-toggle');
  const reaction = quick.getByRole('button', { name: '반응 행동', exact: true });
  const reactionBox = await reaction.boundingBox();
  const extraBox = await extra.boundingBox();
  assert(extraBox.x >= reactionBox.x + reactionBox.width && extraBox.x - reactionBox.x - reactionBox.width <= 12,
    'extra filters immediately follow reaction');
  await quick.getByRole('button', { name: '행동', exact: true }).click();
  await quick.getByRole('button', { name: '보너스 행동', exact: true }).click();
  assert.deepEqual(await actions(), ['bonus_action']);
  await openExtraFilters(page);
  const extraActions = page.locator('#extra-filters-panel').getByRole('group', { name: '행동 경제 필터' });
  await extraActions.getByRole('button', { name: '행동', exact: true }).click();
  assert.deepEqual((await actions()).sort(), ['action', 'bonus_action']);
  assert.equal(await quick.locator('[aria-pressed="true"]').count(), 0, 'multi-action filter leaves quick shortcuts unpressed');
  assert.match(await extra.getAttribute('title'), /또는/);
  await closeExtraFilters(page);
  const rolesBefore = await roleState();
  await quick.getByRole('button', { name: '반응 행동', exact: true }).click(); await page.waitForTimeout(300);
  assert.equal(await quick.getByRole('button', { name: '반응 행동', exact: true }).getAttribute('aria-pressed'), 'true');
  const state = await page.evaluate(async () => (await window.desktop.getBootstrap()).value.libraryState.actions);
  assert.deepEqual(state, ['reaction']);
  assert.deepEqual(await roleState(), rolesBefore);
  const after = await measure(page);
  for (const name of ['page', 'hand', 'inPlay', 'ledger']) assert.deepEqual(after.zones[name], before.zones[name], `${name} does not move when a filter changes`);
  await quick.getByRole('button', { name: '반응 행동', exact: true }).click(); await page.waitForFunction(text => document.querySelector('[aria-label="표시 카드 수"]')?.textContent === text, all);
  await selectCard(page); // the filter may have hidden (and so deselected) the selected card
  check('Quick actions replace or clear one action without moving panels; the adjacent popover supports multiple OR actions');

  // Folding the ledger keeps the hand and both piles in place.
  await page.getByRole('button', { name: '자원 패널 접기', exact: true }).click(); await page.waitForTimeout(400);
  const collapsed = await measure(page); assert(collapsed.collapsed);
  assertLayout(collapsed, 'collapsed ledger', { collapsed: true });
  for (const zone of ['inPlay', 'hand', 'used', 'deck']) assert.deepEqual(collapsed.zones[zone], before.zones[zone], `${zone} stays in place`);
  await page.getByRole('button', { name: '자원 패널 펼치기', exact: true }).click(); await page.waitForTimeout(400);
  assertLayout(await measure(page), 'expanded again');
  check('Collapsing the ledger preserves the hand and both piles; expanding restores the ledger controls');

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
  const tooltip = page.locator('.deck-pile .pile-tooltip');
  await deck.hover(); await tooltip.waitFor();
  const hint = await tooltip.boundingBox();
  const controls = await measure(page);
  for (const button of [...controls.coins, controls.undo]) {
    assert(!overlap({ x: hint.x, y: hint.y, r: hint.x + hint.width, b: hint.y + hint.height }, button),
      'the pile hint keeps recovery and Undo uncovered');
  }
  let shuffled = original;
  for (let i = 0; i < 6 && shuffled.join() === original.join(); i++) { await deck.click(); await page.waitForTimeout(250); shuffled = await handOrder(page); }
  assert.notDeepEqual(shuffled, original); assert.deepEqual([...shuffled].sort(), [...original].sort());
  assert.equal(dbCards(), cardsBefore); assert.equal(dbDecks(), decksBefore);
  assert.equal(JSON.stringify(readDb(userData, 'SELECT * FROM settings ORDER BY key')), settingsBefore, 'shuffling writes nothing');
  await deck.focus(); await page.keyboard.press('Shift+F10');
  const restoreOrder = page.getByRole('group', { name: 'DECK 더미 메뉴' }).getByRole('button', { name: '원래 순서', exact: true });
  await restoreOrder.waitFor();
  assert(await restoreOrder.evaluate(el => el === document.activeElement), 'the context action receives keyboard focus');
  const menuRect = await restoreOrder.boundingBox();
  const board = await measure(page);
  assert(inside({ x: menuRect.x, y: menuRect.y, r: menuRect.x + menuRect.width, b: menuRect.y + menuRect.height }, { x: 0, y: 0, r: board.vw, b: board.vh }));
  await page.keyboard.press('Escape'); await restoreOrder.waitFor({ state: 'hidden' });
  assert(await deck.evaluate(el => el === document.activeElement), 'Escape returns focus to the pile');
  await page.mouse.move(1, 1); await tooltip.waitFor();
  await page.keyboard.press('Shift+F10');
  await restoreOrder.click();
  assert.deepEqual(await handOrder(page), original);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await deck.click(); await page.waitForTimeout(200);
  assert.equal(await page.locator('.deck-pile .pile > img').last().evaluate(el => getComputedStyle(el).animationName), 'none',
    'reduced motion disables the shuffle animation');
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
  const usedPile = page.locator('.used-pile .pile-button');
  await usedPile.click({ button: 'right' });
  await page.getByRole('button', { name: '최근 사용 더미 비우기', exact: true }).click();
  await page.waitForFunction(() => /최근 0건/.test(document.querySelector('.used-pile .pile-button')?.getAttribute('aria-label') ?? ''));
  assert.equal(events(), eventsBefore, 'clearing the pile keeps every play event');
  await usedPile.focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await page.waitForFunction(n => /최근 (\d+)건/.exec(document.querySelector('.used-pile .pile-button')?.getAttribute('aria-label') ?? '')?.[1] === String(n), before + 1);
  await usedPile.click({ button: 'right' });
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
  const userData = await freshData();
  const { app, page, errors } = await launch(userData);
  try {
    await resize(app, page, 1366, 768);
    const transparent = join(run, 'transparent-card.png');
    const opaque = join(run, 'opaque-card.png');
    const jpeg = join(run, 'opaque-card.jpg');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="612"><rect x="24" y="24" width="372" height="564" rx="60" fill="#2a3b5c" stroke="#e2c98f" stroke-width="10"/><circle cx="210" cy="250" r="90" fill="#d9a441"/></svg>';
    await sharp(Buffer.from(svg)).png().toFile(transparent);
    await sharp(Buffer.from(svg)).flatten({ background: '#2a3b5c' }).png().toFile(opaque);
    await sharp(Buffer.from(svg)).flatten({ background: '#2a3b5c' }).jpeg().toFile(jpeg);
    const names = ['알파 검수 투명 PNG', '알파 검수 불투명 PNG', '알파 검수 JPEG', '알파 검수 기본 카드'];
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file'; input.multiple = true; input.id = 'alpha-fixtures';
      document.body.append(input);
    });
    await page.locator('#alpha-fixtures').setInputFiles([transparent, opaque, jpeg]);
    const fixtures = await page.evaluate(async names => {
      const ok = result => { if (!result.ok) throw new Error(result.error); return result.value; };
      const assets = ok(await window.desktop.importImages([...document.getElementById('alpha-fixtures').files])).assets;
      if (assets.length !== 3) throw new Error('Missing PNG/JPEG fixtures');
      const boot = ok(await window.desktop.getBootstrap());
      const hero = boot.profiles.find(profile => profile.id === boot.libraryState.activeCharacterId);
      let snapshot = ok(await window.desktop.getResources(hero.id));
      const change = async action => {
        snapshot = ok(await window.desktop.changeResource({ characterId: hero.id, requestId: crypto.randomUUID(), expectedRevision: snapshot.revision, action })).snapshot;
      };
      const resourceName = '알파 검수 회복 횟수';
      await change({ type: 'create_resource', scope: 'character',
        template: { name: resourceName, unit: '회', kind: 'counter', capacity: { type: 'fixed', value: 1 }, recovery: [{ triggers: ['short_rest'], amount: { type: 'full' } }] } });
      const resource = snapshot.resources.find(entry => entry.name === resourceName);
      await change({ type: 'adjust', resourceId: resource.id, delta: -1 });
      const cards = names.map((name, index) => ({ name, imageAssetId: assets[index]?.id, kind: 'other', roles: ['utility'],
        actions: ['action'], range: { kind: 'self' }, tags: [] }));
      const library = ok(await window.desktop.saveCards({ cards, registrationTarget: { characterId: hero.id, deckId: hero.activeDeckId },
        initialRules: { requestId: crypto.randomUUID(), configured: true, scope: 'character', characterId: hero.id, expectedRevision: snapshot.revision,
          castOptions: [{ id: crypto.randomUUID(), label: '일반 사용', costs: [{ type: 'fixed', costKey: 'alpha-count', amount: 1 }] }],
          bindings: [{ costKey: 'alpha-count', resourceInstanceId: resource.id }] } }));
      return { card: { ...cards[0], id: library.cards.find(card => card.name === cards[0].name).id }, opaqueId: assets[1].id };
    }, names);

    await page.reload(); await page.waitForSelector('.board');
    await page.locator('#card-name-search').fill('알파 검수');
    const cardButton = name => page.getByRole('button', { name: `${name} 카드 선택`, exact: true });
    const face = name => cardButton(name).locator('.card-face');
    await face(names[0]).and(page.locator('.has-alpha')).waitFor();
    await page.mouse.move(1, 1);
    for (const [index, name] of names.entries()) {
      const surface = face(name);
      const back = surface.locator('.card-unusable-back');
      await surface.scrollIntoViewIfNeeded();
      await cardButton(name).locator('.card-resource-note', { hasText: '자원 부족' }).waitFor();
      await page.waitForFunction(el => el.complete && el.naturalWidth > 0, await back.elementHandle());
      const alpha = index === 0;
      if (index < 3) await page.waitForFunction(el => el.complete && el.naturalWidth > 0,
        await surface.locator('img:not(.card-unusable-back)').elementHandle());
      if (alpha) await page.waitForFunction(el => getComputedStyle(el).boxShadow === 'none', await surface.elementHandle());
      const appearance = await surface.evaluate(el => ({ alpha: el.classList.contains('has-alpha'),
        shadow: getComputedStyle(el).boxShadow, front: el.querySelector('img:not(.card-unusable-back)')?.currentSrc,
        mask: getComputedStyle(el.querySelector('.card-unusable-back')).maskImage }));
      assert.equal(appearance.alpha, alpha);
      assert.equal(!!appearance.front, index < 3);
      if (alpha) {
        assert.equal(appearance.shadow, 'none');
        assert.match(appearance.mask, /url\("#/);
      } else assert.equal(appearance.mask, 'none');
      const capture = async (suffix) => {
        const png = await surface.screenshot({ animations: 'disabled', path: join(run, `overlay-${index}-${suffix}.png`) });
        return sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      };
      const visible = await capture('visible');
      await back.evaluate(el => { el.style.opacity = '0'; });
      const hidden = await capture('hidden');
      await back.evaluate(el => { el.style.removeProperty('opacity'); });
      assert.deepEqual(visible.info, hidden.info);
      const { width, height, channels } = visible.info;
      function diff(x0, x1, y0, y1) {
        let changed = 0; let sampled = 0;
        for (let y = Math.ceil(y0 * height); y < y1 * height; y++) {
          for (let x = Math.ceil(x0 * width); x < x1 * width; x++) {
            const offset = (y * width + x) * channels;
            const delta = visible.data.subarray(offset, offset + 3).reduce((sum, value, channel) => sum + Math.abs(value - hidden.data[offset + channel]), 0);
            if (delta > 10) changed++;
            sampled++;
          }
        }
        return changed / sampled;
      }
      assert(diff(.25, .75, .25, .75) > .25, `${name}: the back visibly changes the interior`);
      if (alpha) assert(diff(.01, .035, .2, .8) < .03, 'the left transparent edge remains unchanged');
    }

    const loadedFace = face(names[0]);
    const asset = readDb(userData, 'SELECT relative_path FROM assets WHERE id=?', fixtures.card.imageAssetId)[0];
    const localImage = join(userData, asset.relative_path);
    const missingImage = localImage + '.missing';
    await rename(localImage, missingImage);
    try {
      await page.reload(); await page.waitForSelector('.board');
      await loadedFace.locator('.dc-broken').waitFor();
      await cardButton(names[0]).locator('.card-resource-note', { hasText: '자원 부족' }).waitFor();
    } finally {
      await rename(missingImage, localImage);
    }
    await page.reload(); await page.waitForSelector('.board');
    await loadedFace.and(page.locator('.has-alpha')).waitFor();
    await page.evaluate(async ({ card, opaqueId }) => {
      const result = await window.desktop.saveCards({ cards: [{ ...card, imageAssetId: opaqueId }] });
      if (!result.ok) throw new Error(result.error);
    }, fixtures);
    await page.reload(); await page.waitForSelector('.board');
    await loadedFace.locator('img').first().waitFor();
    assert(!await loadedFace.evaluate(el => el.classList.contains('has-alpha')), 'an opaque replacement drops the previous mask');
    await cardButton(names[0]).click(); await page.mouse.move(1, 1);
    await page.locator('.in-play-slot .detail-card').waitFor();
    await page.getByRole('button', { name: '짧은 휴식', exact: true }).click();
    await page.getByRole('button', { name: '회복 확정', exact: true }).click();
    for (const name of names) await face(name).locator('.card-unusable-back').waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    check('Real pixel comparison: overlay paints transparent PNG, opaque PNG, JPEG and generated face; the transparent edge stays clear and shortage labels survive broken images, replacement and resource recovery');
  } finally {
    await app.close();
  }
}

if (server) await server.close();
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, checks: report.checks.length, run }, null, 2));
