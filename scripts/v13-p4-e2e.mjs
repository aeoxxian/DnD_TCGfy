// v1.3 Phase 4: one integrated session on ONE copy of repository-data, through the UI, across restarts.
//  1. Register one card with an image (standard spell slot, active deck), one card without an image (homebrew rule
//     that may cast below its level), and three images at once with a saved template (counter cost; one card kept
//     out of the deck).
//  2. Search and filters find them; the enlargement shows the original image file, byte-identical to the source.
//  3. Use: standard slot with upcasting, homebrew downcasting, a counter, a pact slot; USED and the full history;
//     Undo; a long rest.
//  4. Trash and restore through 관리, back into the same deck.
//  5. Restart: cards, decks, template, theme, cleared USED pile and resources are all as they were; the template still
//     fills the form; every theme shows the same board (screenshots for the visual review).
//  Original images and card rows stay byte-identical; integrity_check and foreign_key_check pass.
// Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE. Screenshots go to <run>/shots.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { createServer } from 'vite';
import { assertLayout, measure } from './v13-board.mjs';
import { openManagement, registerBatch, showWholeLibrary } from './navigation-helpers.mjs';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v13-p4-'));
const shots = join(run, 'shots'); await mkdir(shots);
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [] };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function readDb(path, sql, ...params) { const db = new DatabaseSync(join(path, 'data', 'app.sqlite3'), { readOnly: true }); try { return db.prepare(sql).all(...params); } finally { db.close(); } }
async function assetHashes(userData) { const dir = join(userData, 'assets'); const out = {}; for (const name of await readdir(dir)) out[name] = sha(await readFile(join(dir, name))); return out; }
async function launch(userData) {
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DND_TCG_DEV_URL;
  if (dev) env.DND_TCG_DEV_URL = 'http://127.0.0.1:5173';
  const app = await electron.launch({ ...(binary ? { executablePath: binary, args: [] } : { args: ['.'] }), env, cwd: process.cwd(), timeout: 45000 });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1366, 768));
  await page.waitForSelector('.board'); await page.waitForTimeout(600);
  return { app, page, errors };
}
async function capture(app, page, name) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(join(shots, `${name}.png`), Buffer.from(bytes, 'base64'));
}
// The fixture has no saved appearance yet, so start from the app's default card backs (as the other suites do).
const setTheme = (page, theme) => page.evaluate(async theme => { const s = (await window.desktop.getBootstrap()).value.settings; const r = await window.desktop.saveSettings({ ...s, appearance: { ...(s.appearance ?? { cardBack: { default: { type: 'builtin', id: 'dragon' }, decks: {} }, customBacks: [] }), theme } }); if (!r.ok) throw new Error(r.error); }, theme);
const boot = page => page.evaluate(async () => (await window.desktop.getBootstrap()).value);
const resourcesOf = (page, id) => page.evaluate(async id => (await window.desktop.getResources(id)).value, id);
async function character(page, name) {
  if (name === undefined) return showWholeLibrary(page);
  await page.getByLabel('활성 캐릭터', { exact: true }).selectOption({ label: name });
  await page.waitForFunction(name => [...document.querySelectorAll('#active-character option, select option')].some(o => o.selected && o.textContent === name), name).catch(() => {});
  await page.waitForTimeout(500);
}
async function openRegistration(page) {
  await page.locator('.top-actions').getByRole('button', { name: '카드 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '카드 등록', exact: true }); await dialog.waitFor(); return dialog;
}
async function checks(scope, group, names) { const set = scope.getByRole('group', { name: group, exact: true }); for (const box of await set.getByRole('checkbox').all()) { const label = await box.evaluate(el => el.closest('label').textContent.trim()); if (names.includes(label)) await box.check(); else await box.uncheck(); } }
async function selectCard(page, name) { const button = page.getByRole('button', { name: `${name} 카드 선택`, exact: true }); await button.scrollIntoViewIfNeeded(); if (await button.getAttribute('aria-pressed') !== 'true') await button.click(); await page.mouse.move(1, 1); await page.locator('.use-button').waitFor(); return button; }
async function confirmUse(page) { await page.waitForFunction(() => !document.querySelector('.use-button')?.disabled); await page.getByRole('button', { name: '사용 확정', exact: true }).click(); }
const undo = page => page.getByRole('button', { name: '직전 자원 변경 실행 취소', exact: true }).click();
const slotLeft = async (page, who, id, level) => (await resourcesOf(page, who)).resources.find(r => r.id === id).remainingByLevel[level];
const waitFor = async (page, fn, arg, what) => { try { await page.waitForFunction(fn, arg, { timeout: 15000 }); } catch { assert.fail(`timed out: ${what}`); } };
const waitSlot = (page, who, id, level, value) => waitFor(page, ({ who, id, level, value }) => window.desktop.getResources(who).then(r => r.value.resources.find(x => x.id === id).remainingByLevel[level] === value), { who, id, level, value }, `slot ${level} = ${value}`);
const waitCounter = (page, who, id, value) => waitFor(page, ({ who, id, value }) => window.desktop.getResources(who).then(r => r.value.resources.find(x => x.id === id).remaining === value), { who, id, value }, `counter = ${value}`);
const usedCount = async page => Number((await page.locator('.used-pile .pile-button').getAttribute('aria-label')).match(/최근 (\d+)건/)[1]);
async function makeImage(name, text, color, width = 600, height = 875) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/><rect x="18" y="18" width="${width - 36}" height="${height - 36}" fill="none" stroke="#e8d2a0" stroke-width="8"/><text x="50" y="120" font-family="sans-serif" font-size="52" fill="#fff">${text}</text><circle cx="${width / 2}" cy="${height / 2}" r="${width / 4}" fill="#ffffff" opacity=".18"/></svg>`;
  const path = join(run, name); await writeFile(path, await sharp(Buffer.from(svg)).png().toBuffer()); return path;
}

const userData = await mkdtemp(join(run, 'data-')); await cp(resolve('repository-data/user-data'), userData, { recursive: true });
const originalAssets = await assetHashes(userData);
const originalCards = readDb(userData, 'SELECT * FROM card_definitions ORDER BY id');
const images = { single: await makeImage('p4-single.png', 'P4 통합 주문', '#4a2a3a', 640, 933), b1: await makeImage('p4-b1.png', 'P4 일괄 1', '#2a3a4a'), b2: await makeImage('p4-b2.png', 'P4 일괄 2', '#2a4a3a'), b3: await makeImage('p4-b3.png', 'P4 일괄 3', '#4a3a2a') };

// ---------------------------------------------------------------------------------------------
// 1. Registration: a single card with an image, one without, and three at once with a template.
let { app, page, errors } = await launch(userData);
let data = await boot(page);
const hero = data.profiles.find(p => p.name === '리벨리오 반 빅토르'); const druid = data.profiles.find(p => p.name === '드루이드');
await character(page, '드루이드');
let druidRes = await resourcesOf(page, druid.id);
const slots = druidRes.resources.find(r => r.kind === 'slot_track' && r.template.slotKind === 'standard');
assert(slots && slots.remainingByLevel[5] > 0, 'the druid has standard slots up to 5th level');
let counter = druidRes.resources.find(r => r.kind === 'counter' && r.overrides?.scope !== 'card');
if (!counter) {
  // The fixture druid may have no counter of its own: make one the way 자원 관리 does.
  await page.evaluate(async ({ id }) => { const s = (await window.desktop.getResources(id)).value; const r = await window.desktop.changeResource({ requestId: crypto.randomUUID(), characterId: id, expectedRevision: s.revision, action: { type: 'create_resource', scope: 'character', template: { name: 'P4 통합 횟수', unit: '회', kind: 'counter', capacity: { type: 'fixed', value: 3 }, recovery: [{ triggers: ['long_rest'], amount: { type: 'full' } }] } } }); if (!r.ok) throw new Error(r.error); }, { id: druid.id });
  druidRes = await resourcesOf(page, druid.id); counter = druidRes.resources.find(r => r.name === 'P4 통합 횟수');
}
const deckBefore = data.decks.find(d => d.id === druid.activeDeckId).cardIds.length;
{
  let form = await openRegistration(page);
  await form.getByLabel('카드 이미지 파일').setInputFiles(images.single); await form.getByRole('img', { name: /등록 미리보기$/ }).waitFor();
  await form.getByLabel('카드 이름', { exact: true }).fill('P4 통합 주문');
  await form.getByLabel('카드 유형', { exact: true }).selectOption('spell');
  await form.getByLabel('주문 레벨 (선택)', { exact: true }).selectOption('2');
  await checks(form, '카드 역할', ['공격']); await checks(form, '카드 행동 경제', ['행동']);
  await form.getByRole('radio', { name: '주문 슬롯', exact: true }).check();
  await form.getByLabel('등록 슬롯 계열', { exact: true }).selectOption('standard');
  assert.equal(await form.getByRole('checkbox', { name: /에 넣기$/ }).isChecked(), true, 'deck link on by default');
  await capture(app, page, 'register-single');
  await form.getByRole('button', { name: '카드 저장', exact: true }).click(); await form.waitFor({ state: 'hidden' });

  form = await openRegistration(page);
  await form.getByLabel('카드 이름', { exact: true }).fill('P4 통합 기본 카드');
  await form.getByLabel('카드 유형', { exact: true }).selectOption('spell');
  await form.getByLabel('주문 레벨 (선택)', { exact: true }).selectOption('3');
  await checks(form, '카드 역할', ['보호']); await checks(form, '카드 행동 경제', ['반응 행동']);
  await form.getByRole('radio', { name: '주문 슬롯', exact: true }).check();
  await form.getByLabel('등록 슬롯 계열', { exact: true }).selectOption('standard');
  await form.getByText('홈브루 예외 허용', { exact: true }).click();
  await form.getByText('기본 주문 레벨 미만 시전 허용', { exact: true }).click();
  await form.getByLabel('등록 홈브루 최소 레벨', { exact: true }).fill('1'); await form.getByLabel('등록 홈브루 최대 레벨', { exact: true }).fill('5');
  await form.getByRole('button', { name: '카드 저장', exact: true }).click(); await form.waitFor({ state: 'hidden' });

  form = await openRegistration(page);
  await form.getByLabel('카드 이미지 파일').setInputFiles([images.b1, images.b2, images.b3]); await form.locator('.batch-row').nth(2).waitFor();
  await form.getByLabel('카드 유형', { exact: true }).selectOption('other');
  await checks(form, '카드 역할', ['유틸']);
  await form.getByRole('radio', { name: '사용 횟수', exact: true }).check();
  await form.getByLabel('등록 사용할 자원', { exact: true }).selectOption(counter.id);
  await form.getByLabel('새 템플릿 이름').fill('P4 통합 템플릿');
  await form.getByRole('button', { name: '지금 설정을 템플릿으로 저장' }).click();
  await form.getByText('‘P4 통합 템플릿’ 템플릿을 저장했습니다.').waitFor();
  const row = n => form.getByRole('listitem', { name: new RegExp(`^${n}번 카드 `) });
  for (let i = 1; i <= 3; i++) await row(i).getByLabel(`카드 이름 ${i}`, { exact: true }).fill(`P4 일괄 ${i}`);
  await row(3).getByRole('button', { name: /개별 설정$/ }).click();
  await form.getByRole('group', { name: /개별 설정$/ }).getByLabel('개별 덱 연결').selectOption('no');
  await row(3).getByRole('button', { name: /개별 설정$/ }).click();
  await capture(app, page, 'register-batch');
  await registerBatch(form, 3);

  data = await boot(page);
  const byName = name => data.cards.find(c => c.name === name);
  const deck = data.decks.find(d => d.id === druid.activeDeckId).cardIds;
  for (const name of ['P4 통합 주문', 'P4 통합 기본 카드', 'P4 일괄 1', 'P4 일괄 2']) assert(deck.includes(byName(name)?.id), `${name} is in the druid's deck`);
  assert(byName('P4 일괄 3') && !deck.includes(byName('P4 일괄 3').id), 'P4 일괄 3 is in the library only');
  assert.equal(deck.length, deckBefore + 4);
  assert.equal(byName('P4 통합 기본 카드').imageAssetId ?? null, null);
  // Each new image file is a byte-for-byte copy of the picked file.
  for (const [name, file] of [['P4 통합 주문', images.single], ['P4 일괄 1', images.b1], ['P4 일괄 2', images.b2], ['P4 일괄 3', images.b3]]) {
    const rel = readDb(userData, 'SELECT relative_path FROM assets WHERE id=?', byName(name).imageAssetId)[0].relative_path;
    assert.equal(sha(await readFile(join(userData, rel))), sha(await readFile(file)), `${name}: stored image equals the picked file`);
  }
  assert.equal(await page.getByRole('button', { name: 'P4 통합 기본 카드 카드 선택', exact: true }).locator('.card-face.default-face').count(), 1, 'image-less card draws the default face');
  check('Registration: one card with an image (standard slot), one without (homebrew below-base rule, default face), and three at once with a saved template (counter cost, one kept out of the deck); stored images are byte copies of the picked files', { deck: deck.length });
}

// ---------------------------------------------------------------------------------------------
// 2. Search, filters and the original image.
{
  const count = () => page.getByLabel('표시 카드 수', { exact: true }).textContent();
  const all = await count();
  await page.locator('#card-name-search').fill('P4 일괄');
  await page.waitForFunction(all => document.querySelector('[aria-label="표시 카드 수"]')?.textContent !== all, all);
  let names = await page.locator('.cards-area .card-button').evaluateAll(b => b.map(x => x.getAttribute('aria-label')));
  assert.deepEqual(names.sort(), ['P4 일괄 1 카드 선택', 'P4 일괄 2 카드 선택'], 'the deck view finds the two deck cards');
  await character(page, undefined); await page.waitForTimeout(400);
  names = await page.locator('.cards-area .card-button').evaluateAll(b => b.map(x => x.getAttribute('aria-label')));
  assert.equal(names.length, 3, 'the whole library also finds the library-only card');
  await page.locator('#card-name-search').fill(''); await character(page, '드루이드');
  await page.locator('.board-top').getByRole('button', { name: '반응 행동', exact: true }).click(); await page.waitForTimeout(300);
  names = await page.locator('.cards-area .card-button').evaluateAll(b => b.map(x => x.getAttribute('aria-label')));
  assert(names.includes('P4 통합 기본 카드 카드 선택') && !names.includes('P4 통합 주문 카드 선택'), `반응 행동 filter: ${names}`);
  await page.locator('.board-top').getByRole('button', { name: '반응 행동', exact: true }).click();
  await page.waitForFunction(all => document.querySelector('[aria-label="표시 카드 수"]')?.textContent === all, all);
  // Original: the enlargement loads the stored file at its full size (not the thumbnail).
  const card = data.cards.find(c => c.name === 'P4 통합 주문');
  const button = await selectCard(page, 'P4 통합 주문'); await button.click();
  const lightbox = page.locator('dialog.image-lightbox'); await lightbox.waitFor();
  const img = lightbox.locator('.lightbox-card > img');
  await page.waitForFunction(() => document.querySelector('.lightbox-card > img')?.complete);
  assert.equal(await img.getAttribute('src'), `app://assets/${encodeURIComponent(card.imageAssetId)}`);
  assert.deepEqual(await img.evaluate(el => [el.naturalWidth, el.naturalHeight]), [640, 933], 'the original size, not the thumbnail');
  await capture(app, page, 'original-view');
  await page.keyboard.press('Escape'); await lightbox.waitFor({ state: 'detached' });
  check('Search finds the new cards in the deck view and the whole library; 반응 행동 filters them; the enlargement shows the stored original at full size (640×933)');
}

// ---------------------------------------------------------------------------------------------
// 3. Use: upcasting, homebrew downcasting, a counter, a pact slot; USED, history, Undo, a long rest.
{
  const start = (await resourcesOf(page, druid.id)).resources;
  const s0 = start.find(r => r.id === slots.id).remainingByLevel; const c0 = start.find(r => r.id === counter.id).remaining;
  const used0 = await usedCount(page);
  // Standard slot, cast at 4th level instead of 2nd.
  await selectCard(page, 'P4 통합 주문');
  const pickSlot = page.getByLabel('시전 슬롯 1', { exact: true }); await pickSlot.waitFor();
  assert.deepEqual(await pickSlot.locator('option').evaluateAll(o => o.map(x => x.value).filter(Boolean)).then(v => v.map(Number).sort()), [2, 3, 4, 5], 'a 2nd-level spell offers 2nd–5th level slots');
  await pickSlot.selectOption('4'); await confirmUse(page); await waitSlot(page, druid.id, slots.id, 4, s0[4] - 1);
  await undo(page); await waitSlot(page, druid.id, slots.id, 4, s0[4]);
  // Homebrew: a 3rd-level spell cast with a 1st-level slot.
  await selectCard(page, 'P4 통합 기본 카드');
  const homebrew = page.getByLabel('시전 슬롯 1', { exact: true }); await homebrew.waitFor();
  assert((await homebrew.locator('option').evaluateAll(o => o.map(x => x.value))).includes('1'), 'below-base levels are offered');
  await homebrew.selectOption('1'); await confirmUse(page); await waitSlot(page, druid.id, slots.id, 1, s0[1] - 1);
  // Counter cost.
  await selectCard(page, 'P4 일괄 1'); await confirmUse(page); await waitCounter(page, druid.id, counter.id, c0 - 1);
  await page.waitForFunction(n => /최근 (\d+)건/.exec(document.querySelector('.used-pile .pile-button')?.getAttribute('aria-label') ?? '')?.[1] === String(n), used0 + 3);
  await page.locator('.used-pile .pile-button').click();
  const history = page.getByRole('dialog', { name: /카드 사용 기록/ }); await history.waitFor();
  // The list loads after the dialog opens (getUseHistory), so wait for it rather than reading it at once.
  await waitFor(page, names => { const d = [...document.querySelectorAll('dialog[open]')].find(x => /카드 사용 기록/.test(x.getAttribute('aria-label') ?? x.textContent)); return d && names.every(n => d.textContent.includes(n)); }, ['P4 통합 주문', 'P4 통합 기본 카드', 'P4 일괄 1'], 'the full history lists all three uses');
  await capture(app, page, 'history');
  await page.keyboard.press('Escape'); await history.waitFor({ state: 'hidden' });
  // Undo walks back: the counter first, the homebrew slot stays spent.
  await undo(page); await waitCounter(page, druid.id, counter.id, c0);
  assert.equal(await slotLeft(page, druid.id, slots.id, 1), s0[1] - 1);
  // A long rest restores the slot.
  await page.getByRole('button', { name: '긴 휴식', exact: true }).click();
  const rest = page.getByRole('dialog', { name: '긴 휴식 확인', exact: true }); await rest.getByRole('button', { name: '회복 확정', exact: true }).click(); await rest.waitFor({ state: 'hidden' });
  await waitSlot(page, druid.id, slots.id, 1, s0[1]);
  // Pact slot for the warlock; the druid's resources are untouched.
  const druidAfter = JSON.stringify((await resourcesOf(page, druid.id)).resources.map(r => [r.id, r.remaining, r.remainingByLevel]));
  await character(page, '리벨리오 반 빅토르');
  const pact = (await resourcesOf(page, hero.id)).resources.find(r => r.template.slotKind === 'pact'); const level = Number(Object.keys(pact.remainingByLevel)[0]);
  await selectCard(page, '차원참'); await confirmUse(page); await waitSlot(page, hero.id, pact.id, level, pact.remainingByLevel[level] - 1);
  await undo(page); await waitSlot(page, hero.id, pact.id, level, pact.remainingByLevel[level]);
  assert.equal(JSON.stringify((await resourcesOf(page, druid.id)).resources.map(r => [r.id, r.remaining, r.remainingByLevel])), druidAfter, 'one character never spends another’s resources');
  check('Use: a 2nd-level spell upcast to a 4th-level slot and Undo; a 3rd-level homebrew spell cast with a 1st-level slot; a counter cost; USED and the full history list all three; Undo takes back only the last; a long rest restores the slot; the warlock’s pact slot and Undo leave the druid untouched', { slotsBefore: s0, counterBefore: c0 });
}

// ---------------------------------------------------------------------------------------------
// 4. Trash and restore through 관리.
{
  await character(page, '드루이드');
  const id = (await boot(page)).cards.find(c => c.name === 'P4 일괄 2').id;
  await selectCard(page, 'P4 일괄 2');
  await openManagement(page, '휴지통으로 이동');
  const move = page.getByRole('dialog', { name: '휴지통 이동 확인', exact: true });
  await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] button')].some(b => b.textContent === '휴지통으로 이동 확정' && !b.disabled));
  await move.getByRole('button', { name: '휴지통으로 이동 확정', exact: true }).click(); await move.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'P4 일괄 2 카드 선택', exact: true }).waitFor({ state: 'detached' });
  assert(!(await boot(page)).decks.find(d => d.id === druid.activeDeckId).cardIds.includes(id), 'the trashed card leaves the deck');
  await openManagement(page, '라이브러리 관리'); await page.getByRole('button', { name: '휴지통', exact: true }).click();
  const trash = page.getByRole('dialog', { name: '카드 휴지통', exact: true }); await trash.waitFor();
  await capture(app, page, 'trash');
  await trash.getByRole('button', { name: 'P4 일괄 2 복원', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '카드 복원 확인', exact: true }); await confirm.getByRole('button', { name: '카드 복원 확정', exact: true }).click(); await confirm.waitFor({ state: 'hidden' });
  await trash.getByRole('button', { name: '카드 휴지통 닫기', exact: true }).click();
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('button', { name: 'P4 일괄 2 카드 선택', exact: true }).waitFor();
  const after = await boot(page);
  assert(after.cards.find(c => c.id === id), 'restored with the same ID'); assert(after.decks.find(d => d.id === druid.activeDeckId).cardIds.includes(id), 'back in the same deck');
  check('Trash: 관리 → 휴지통으로 이동 takes the card out of the hand and deck; 라이브러리 관리 → 휴지통 → 복원 brings it back with the same ID into the same deck');
}

// ---------------------------------------------------------------------------------------------
// 5. Settings, restart and every theme.
{
  await page.locator('.used-pile .pile-button').click({ button: 'right' });
  await page.getByRole('button', { name: '최근 사용 더미 비우기', exact: true }).click();
  await page.waitForFunction(() => /최근 0건/.test(document.querySelector('.used-pile .pile-button')?.getAttribute('aria-label') ?? ''));
  await setTheme(page, 'verdant');
  const before = await boot(page);
  const mine = b => b.cards.filter(c => c.name.startsWith('P4 ')).map(c => [c.id, c.name, c.imageAssetId ?? null]).sort();
  const snapshot = { cards: mine(before), deck: before.decks.find(d => d.id === druid.activeDeckId).cardIds, templates: before.settings.registrationTemplates.map(t => t.name), theme: before.settings.appearance.theme,
    resources: JSON.stringify((await resourcesOf(page, druid.id)).resources.map(r => [r.id, r.remaining, r.remainingByLevel])), events: (await resourcesOf(page, druid.id)).events.length };
  assert.deepEqual(errors, []); await app.close();

  ({ app, page, errors } = await launch(userData));
  const back = await boot(page);
  assert.deepEqual(mine(back), snapshot.cards); assert.deepEqual(back.decks.find(d => d.id === druid.activeDeckId).cardIds, snapshot.deck);
  assert.deepEqual(back.settings.registrationTemplates.map(t => t.name), snapshot.templates); assert.equal(back.settings.appearance.theme, 'verdant');
  assert.equal(await page.locator('.app').getAttribute('data-theme'), 'verdant');
  assert.equal(back.libraryState.activeCharacterId, druid.id, 'the selected character is kept');
  assert.equal(await usedCount(page), 0, 'the cleared USED pile stays cleared');
  assert.equal(JSON.stringify((await resourcesOf(page, druid.id)).resources.map(r => [r.id, r.remaining, r.remainingByLevel])), snapshot.resources);
  assert.equal((await resourcesOf(page, druid.id)).events.length, snapshot.events);
  // The template still fills the single form after the restart; cancelling registers nothing.
  const form = await openRegistration(page);
  await form.getByLabel('등록 템플릿 선택').selectOption({ label: 'P4 통합 템플릿' }); await form.getByRole('button', { name: '템플릿 적용' }).click();
  assert.equal(await form.getByLabel('카드 유형', { exact: true }).inputValue(), 'other');
  assert.equal(await form.getByRole('radio', { name: '사용 횟수', exact: true }).isChecked(), true);
  assert.equal(await form.getByLabel('등록 사용할 자원', { exact: true }).inputValue(), counter.id);
  await form.getByRole('button', { name: '취소', exact: true }).click(); await form.waitFor({ state: 'hidden' });
  assert.equal((await boot(page)).cards.length, back.cards.length);
  check('Restart: the new cards (same IDs), deck, template, theme, selected character, cleared USED pile, resources and history are kept; the template still fills the form and cancelling saves nothing');

  const themes = {};
  for (const theme of ['oxblood', 'ebony', 'verdant', 'abyss']) {
    await setTheme(page, theme);
    await page.reload(); await page.waitForSelector('.board'); await page.waitForTimeout(500);
    await selectCard(page, 'P4 통합 주문'); await page.waitForTimeout(400);
    assertLayout(await measure(page), `theme ${theme}`);
    await capture(app, page, `theme-${theme}`);
    themes[theme] = await page.locator('.use-button').evaluate(el => getComputedStyle(el).backgroundImage.slice(0, 40));
  }
  check('Every theme shows the same board with the new cards (layout contract holds); screenshots for the visual review', themes);
  assert.deepEqual(errors, []); await app.close();
}

// ---------------------------------------------------------------------------------------------
// 6. Data integrity.
{
  const assets = await assetHashes(userData);
  for (const [name, hash] of Object.entries(originalAssets)) assert.equal(assets[name], hash, `original image ${name} unchanged`);
  const now = new Map(readDb(userData, 'SELECT * FROM card_definitions').map(row => [row.id, JSON.stringify(row)]));
  for (const row of originalCards) assert.equal(now.get(row.id), JSON.stringify(row), `original card ${row.name} unchanged`);
  assert.equal(readDb(userData, 'PRAGMA integrity_check')[0].integrity_check, 'ok');
  assert.deepEqual(readDb(userData, 'PRAGMA foreign_key_check'), []);
  assert.equal(readDb(userData, 'PRAGMA user_version')[0].user_version, 8, 'schema v8 after resource migration');
  check('Data: every original image file and card row is byte-identical; integrity_check ok, no foreign key problems, schema v7 after migration', { originalImages: Object.keys(originalAssets).length, originalCards: originalCards.length });
}

if (server) await server.close();
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, outcome: 'PASS', checks: report.checks.length, run }, null, 2));
