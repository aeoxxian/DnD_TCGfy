// v1.3 Phase 1 checks: the reorganised single-card registration (live preview, frequent fields first, deck link,
// image cleanup on cancel) and the default face of cards without an image (hand, IN PLAY, enlargement, use, themes).
// Runs on COPIES of repository-data. Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v13-p1-'));
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [] };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

const imageDir = resolve('artifacts/p4-b-input');
const images = (await readdir(imageDir)).filter(name => /\.(png|jpe?g|webp)$/i.test(name)).map(name => join(imageDir, name));
assert(images.length >= 2, 'run scripts/prepare-p4-b-fixtures.mjs first');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function freshData() { const dir = await mkdtemp(join(run, 'data-')); await cp(resolve('repository-data/user-data'), dir, { recursive: true }); return dir; }
async function launch(userData, { width = 1366, height = 768, zoom = 1 } = {}) {
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DND_TCG_DEV_URL;
  if (dev) env.DND_TCG_DEV_URL = 'http://127.0.0.1:5173';
  const args = ['--force-device-scale-factor=1'];
  const app = await electron.launch({ ...(binary ? { executablePath: binary, args } : { args: ['.', ...args] }), env, cwd: process.cwd(), timeout: 45000 });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(size.width, size.height); win.webContents.setZoomFactor(size.zoom); }, { width, height, zoom });
  await page.waitForSelector('.board'); await page.waitForTimeout(600);
  return { app, page, errors };
}
const boot = page => page.evaluate(async () => (await window.desktop.getBootstrap()).value);
const resourcesOf = (page, id) => page.evaluate(async id => (await window.desktop.getResources(id)).value, id);
function readDb(path, sql, ...params) { const db = new DatabaseSync(join(path, 'data', 'app.sqlite3'), { readOnly: true }); try { return db.prepare(sql).all(...params); } finally { db.close(); } }
async function assetHashes(userData) { const dir = join(userData, 'assets'); const out = {}; for (const name of await readdir(dir)) out[name] = sha(await readFile(join(dir, name))); return out; }
const exists = path => stat(path).then(() => true, () => false);
async function until(test, what, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return; await new Promise(r => setTimeout(r, 100)); } assert.fail(`timed out: ${what}`); }
const setTheme = (page, theme) => page.evaluate(async theme => { const s = (await window.desktop.getBootstrap()).value.settings; const r = await window.desktop.saveSettings({ ...s, appearance: { ...(s.appearance ?? { cardBack: { default: { type: 'builtin', id: 'dragon' }, decks: {} }, customBacks: [] }), theme } }); if (!r.ok) throw new Error(r.error); }, theme);
async function selectCard(page, name) { const button = page.getByRole('button', { name: `${name} 카드 선택`, exact: true }); await button.scrollIntoViewIfNeeded(); if (await button.getAttribute('aria-pressed') !== 'true') await button.click(); return button; }
async function openRegistration(page) {
  await page.locator('.top-actions').getByRole('button', { name: '카드 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '카드 등록', exact: true }); await dialog.waitFor(); return dialog;
}
async function checks(dialog, group, names) { const set = dialog.getByRole('group', { name: group, exact: true }); for (const box of await set.getByRole('checkbox').all()) { const label = (await box.evaluate(el => el.closest('label').textContent.trim())); if (names.includes(label)) await box.check(); else await box.uncheck(); } }
const userData = await freshData();
const originalAssets = await assetHashes(userData);
const originalCards = readDb(userData, 'SELECT * FROM card_definitions ORDER BY id');

// ---------------------------------------------------------------------------------------------
// 1. The form: preview column beside the fields, frequent fields first, rare ones folded; fits at 100/125/150%.
{
  const { app, page, errors } = await launch(userData);
  const dialog = await openRegistration(page);
  const preview = dialog.getByRole('complementary', { name: '카드 미리보기', exact: true });
  const basics = dialog.getByRole('region', { name: '카드 기본 정보', exact: true });
  const [p, b] = [await preview.boundingBox(), await basics.boundingBox()];
  assert(p.x + p.width <= b.x, `preview sits left of the fields: ${JSON.stringify({ p, b })}`);
  assert.equal(await dialog.getByRole('img', { name: '카드 이름 기본 카드 미리보기', exact: true }).count(), 1);
  const order = await dialog.evaluate(el => ['카드 기본 정보', '카드 태그 설정', '등록 카드 사용 규칙'].map(name => [...el.querySelectorAll('section[aria-label]')].findIndex(s => s.getAttribute('aria-label') === name)));
  assert(order.every((value, i) => value >= 0 && (i === 0 || value > order[i - 1])), `section order ${order}`);
  assert.equal(await dialog.locator('details.editor-advanced').evaluate(el => el.open), false);
  assert.equal(await dialog.getByRole('checkbox', { name: /에 넣기$/ }).isChecked(), true);
  await dialog.getByRole('button', { name: '취소', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await app.close();
  for (const zoom of [1, 1.25, 1.5]) {
    const { app, page } = await launch(userData, { width: 1280, height: 720, zoom });
    const dialog = await openRegistration(page);
    const box = await dialog.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    assert(box.sw <= box.cw + 1, `no horizontal overflow at ${zoom}: ${JSON.stringify(box)}`);
    const save = dialog.getByRole('button', { name: '카드 저장', exact: true }); await save.scrollIntoViewIfNeeded(); assert(await save.isVisible());
    await dialog.getByRole('button', { name: '취소', exact: true }).click(); await app.close();
  }
  check('Registration form: live preview beside the fields; basics → tags → use rule order; range/description folded; deck link on by default; no horizontal overflow and Save reachable at 100/125/150% (1280×720)');
}

// ---------------------------------------------------------------------------------------------
// 2. A card without an image: registered with a pact-slot cost, default face in hand and IN PLAY, enlargement, use + Undo.
let app, page, errors, hero;
({ app, page, errors } = await launch(userData));
{
  const data = await boot(page); hero = data.profiles.find(p => p.id === data.libraryState.activeCharacterId);
  const dialog = await openRegistration(page);
  await dialog.getByLabel('카드 이름', { exact: true }).fill('기본 카드 검수 주문');
  await dialog.getByLabel('카드 유형', { exact: true }).selectOption('spell');
  await dialog.getByLabel('주문 레벨 (선택)', { exact: true }).selectOption('1');
  await checks(dialog, '카드 역할', ['공격']); await checks(dialog, '카드 행동 경제', ['행동']);
  const live = dialog.getByRole('img', { name: '기본 카드 검수 주문 기본 카드 미리보기', exact: true });
  assert.match(await live.textContent(), /주문 · 1레벨/);
  await dialog.getByRole('radio', { name: '주문 슬롯', exact: true }).check();
  await dialog.getByLabel('등록 슬롯 계열', { exact: true }).selectOption('pact');
  await dialog.getByRole('button', { name: '카드 저장', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const after = await boot(page); const created = after.cards.find(card => card.name === '기본 카드 검수 주문');
  assert(created && !created.imageAssetId); assert(after.decks.find(deck => deck.id === hero.activeDeckId).cardIds.includes(created.id));
  assert.equal(readDb(userData, 'SELECT image_asset_id FROM card_definitions WHERE id=?', created.id)[0].image_asset_id, null);

  const button = await selectCard(page, '기본 카드 검수 주문');
  assert.equal(await button.locator('.card-face.default-face').count(), 1);
  assert.equal(await page.getByText(/등록된 이미지가 없습니다|이미지 없음/).count(), 0);
  const inPlay = page.getByRole('button', { name: '기본 카드 검수 주문 미리보기 확대', exact: true });
  assert(await inPlay.isEnabled()); assert.equal(await inPlay.locator('.default-face').count(), 1);
  await button.click();
  const lightbox = page.getByRole('dialog', { name: '기본 카드 검수 주문 원본 보기', exact: true }); await lightbox.waitFor();
  const large = lightbox.getByRole('img', { name: '기본 카드 검수 주문 기본 카드 확대 · 주문 · 1레벨', exact: true });
  await page.waitForFunction(() => !document.querySelector('.image-lightbox')?.getAnimations({ subtree: true }).length);
  const size = await large.boundingBox(); assert(size.height > 500 && Math.abs(size.height / size.width - 1.458) < .02, `large face keeps the card ratio: ${JSON.stringify(size)}`);
  await page.keyboard.press('Escape'); await lightbox.waitFor({ state: 'hidden' });
  await inPlay.click(); await lightbox.waitFor(); await page.mouse.click(8, 8); await lightbox.waitFor({ state: 'hidden' });

  const before = await resourcesOf(page, hero.id);
  const pact = before.resources.find(r => r.kind === 'slot_track' && Object.values(r.remainingByLevel ?? {}).some(n => n > 0) && /계약/.test(r.name));
  assert(pact, 'the hero has pact slots');
  const left = Object.values(pact.remainingByLevel).reduce((a, n) => a + n, 0);
  await page.waitForFunction(() => !document.querySelector('.use-button')?.disabled);
  await page.getByRole('button', { name: '사용 확정', exact: true }).click();
  const total = id => page.evaluate(async ({ hero, id }) => Object.values((await window.desktop.getResources(hero)).value.resources.find(r => r.id === id).remainingByLevel).reduce((a, n) => a + n, 0), { hero: hero.id, id });
  await page.waitForFunction(async ({ hero, id, want }) => Object.values((await window.desktop.getResources(hero)).value.resources.find(r => r.id === id).remainingByLevel).reduce((a, n) => a + n, 0) === want, { hero: hero.id, id: pact.id, want: left - 1 });
  assert.equal((await resourcesOf(page, hero.id)).events[0].type, 'card_used');
  await page.getByRole('complementary', { name: '자원 패널' }).getByRole('button', { name: '직전 자원 변경 실행 취소', exact: true }).click();
  await page.waitForFunction(async ({ hero, id, want }) => Object.values((await window.desktop.getResources(hero)).value.resources.find(r => r.id === id).remainingByLevel).reduce((a, n) => a + n, 0) === want, { hero: hero.id, id: pact.id, want: left });
  assert.equal(await total(pact.id), left);
  check('Card without an image: saved with no image and a pact-slot cost into the active deck; default face in hand and IN PLAY with no “image missing” text; re-click and IN PLAY open a large default face at the card ratio (ESC/outside click close); Use spends one pact slot and Undo restores it');
}

// ---------------------------------------------------------------------------------------------
// 3. One image: single name field, original copied byte for byte; cancel/remove discard the imported file.
{
  let dialog = await openRegistration(page);
  const before = readDb(userData, 'SELECT id, relative_path FROM assets ORDER BY id');
  await dialog.getByLabel('카드 이미지 파일').setInputFiles(images[0]);
  await dialog.getByRole('img', { name: /등록 미리보기$/ }).waitFor();
  assert.equal(await dialog.getByLabel('카드 이름 1', { exact: true }).count(), 0);
  let added = readDb(userData, 'SELECT id, relative_path FROM assets ORDER BY id').filter(row => !before.some(old => old.id === row.id));
  assert.equal(added.length, 1); const pickedPath = join(userData, added[0].relative_path); assert(await exists(pickedPath));
  await dialog.getByRole('button', { name: '이미지 빼기', exact: true }).click();
  await until(async () => !(await exists(pickedPath)), 'removed image file deleted'); assert.equal(readDb(userData, 'SELECT count(*) AS n FROM assets WHERE id=?', added[0].id)[0].n, 0);
  assert.equal(await dialog.getByRole('img', { name: /기본 카드 미리보기$/ }).count(), 1);
  await dialog.getByLabel('카드 이미지 파일').setInputFiles(images[1]); await dialog.getByRole('img', { name: /등록 미리보기$/ }).waitFor();
  added = readDb(userData, 'SELECT id, relative_path FROM assets ORDER BY id').filter(row => !before.some(old => old.id === row.id));
  const cancelledPath = join(userData, added[0].relative_path);
  await dialog.getByRole('button', { name: '취소', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await until(async () => !(await exists(cancelledPath)), 'cancelled image file deleted');
  assert.deepEqual(readDb(userData, 'SELECT id, relative_path FROM assets ORDER BY id'), before);
  check('Picking an image copies it into assets; “이미지 빼기” and cancelling delete exactly that copy (row and file); other images untouched');

  dialog = await openRegistration(page);
  await dialog.getByLabel('카드 이미지 파일').setInputFiles(images[0]);
  await dialog.getByRole('img', { name: /등록 미리보기$/ }).waitFor();
  await dialog.getByLabel('카드 이름', { exact: true }).fill('이미지 카드 검수');
  await dialog.getByRole('radio', { name: '무소모', exact: true }).check();
  await dialog.getByRole('button', { name: '카드 저장', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await page.waitForTimeout(400);
  const card = (await boot(page)).cards.find(c => c.name === '이미지 카드 검수');
  const row = readDb(userData, 'SELECT relative_path, sha256 FROM assets WHERE id=?', card.imageAssetId)[0];
  const source = await readFile(images[0]);
  assert.equal(sha(await readFile(join(userData, row.relative_path))), sha(source)); assert.equal(row.sha256, sha(source));
  const button = await selectCard(page, '이미지 카드 검수'); assert.equal(await button.locator('.card-face.image-face img').count(), 1);
  check('Card with one image: single 카드 이름 field, saved with its image (stored copy byte-identical to the source), image face in hand; the saved image survives the dialog cleanup');
}

// ---------------------------------------------------------------------------------------------
// 4. Deck link off: library only. Editing a card without an image can add an image later.
{
  const dialog = await openRegistration(page);
  await dialog.getByLabel('카드 이름', { exact: true }).fill('라이브러리 전용 카드');
  await dialog.getByRole('checkbox', { name: /에 넣기$/ }).uncheck();
  await dialog.getByRole('button', { name: '카드 저장', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const data = await boot(page); const card = data.cards.find(c => c.name === '라이브러리 전용 카드');
  assert(card); assert(!data.decks.some(deck => deck.cardIds.includes(card.id)));
  assert.equal(await page.getByRole('button', { name: '라이브러리 전용 카드 카드 선택', exact: true }).count(), 0);

  await selectCard(page, '기본 카드 검수 주문');
  await page.getByRole('button', { name: '관리', exact: true }).click();
  await page.getByRole('dialog', { name: '관리 메뉴', exact: true }).getByRole('button', { name: '정보 수정', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '카드 정보 수정', exact: true }); await edit.waitFor();
  assert.equal(await edit.getByRole('img', { name: '기본 카드 검수 주문 기본 카드 미리보기', exact: true }).count(), 1);
  await edit.getByLabel('교체 이미지 파일').setInputFiles(images[1]); await edit.getByAltText('교체 이미지 미리보기').waitFor();
  await edit.getByRole('button', { name: '수정 저장', exact: true }).click(); await edit.waitFor({ state: 'hidden' });
  const changed = (await boot(page)).cards.find(c => c.name === '기본 카드 검수 주문');
  assert(changed.imageAssetId);
  const button = await selectCard(page, '기본 카드 검수 주문'); await button.locator('.card-face.image-face img').waitFor();
  check('Deck link unchecked registers into the library only; a card without an image gets a real image later through 정보 수정 (default face → image face)');
}

// ---------------------------------------------------------------------------------------------
// 5. Every theme draws the default face in its own trim.
{
  const dialog = await openRegistration(page);
  await dialog.getByLabel('카드 이름', { exact: true }).fill('테마 확인 카드');
  await dialog.getByLabel('카드 유형', { exact: true }).selectOption('item');
  await dialog.getByRole('button', { name: '카드 저장', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const colours = {};
  for (const theme of ['oxblood', 'ebony', 'verdant', 'abyss']) {
    await setTheme(page, theme);
    await page.reload(); await page.waitForSelector('.board'); await page.waitForTimeout(500);
    const face = (await selectCard(page, '테마 확인 카드')).locator('.default-card');
    const style = await face.evaluate(el => { const frame = el.querySelector('.dc-frame'); const icon = el.querySelector('.dc-emblem svg'); const name = el.querySelector('.dc-name span'); return { frame: getComputedStyle(frame).borderTopColor, icon: getComputedStyle(icon).color, nameVisible: name.getBoundingClientRect().height > 4 && name.scrollWidth <= name.clientWidth + 1 }; });
    assert(style.nameVisible, `${theme}: name visible`); colours[theme] = style;
  }
  assert.equal(new Set(Object.values(colours).map(c => c.frame)).size, 4, JSON.stringify(colours));
  await setTheme(page, 'oxblood');
  check('All four themes draw the default face in their own trim colour (four distinct frame colours) with the name fitting', colours);
}
assert.deepEqual(errors, []);
await app.close();

// ---------------------------------------------------------------------------------------------
// 6. Restart: everything persisted, the earlier cards and images are unchanged, the database is sound.
{
  ({ app, page, errors } = await launch(userData));
  const data = await boot(page);
  for (const name of ['기본 카드 검수 주문', '이미지 카드 검수', '라이브러리 전용 카드', '테마 확인 카드']) assert(data.cards.some(card => card.name === name), name);
  const face = (await selectCard(page, '테마 확인 카드')).locator('.card-face.default-face'); assert.equal(await face.count(), 1);
  const now = readDb(userData, 'SELECT * FROM card_definitions ORDER BY id');
  for (const card of originalCards) assert.deepEqual(now.find(row => row.id === card.id), card, card.name);
  const hashes = await assetHashes(userData);
  for (const [name, hash] of Object.entries(originalAssets)) assert.equal(hashes[name], hash, name);
  assert.deepEqual(readDb(userData, 'PRAGMA foreign_key_check'), []);
  assert.equal(readDb(userData, 'PRAGMA quick_check')[0].quick_check, 'ok');
  assert.deepEqual(errors, []);
  await app.close();
  check('After restart: new cards persisted (default face still drawn); every pre-existing card row and image file unchanged; foreign keys and quick_check ok');
}

if (server) await server.close();
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, checks: report.checks.length, run }, null, 2));
