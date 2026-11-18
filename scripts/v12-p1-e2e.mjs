// v1.2 Phase 1 checks: the 전체 카드/활성 덱 buttons are gone (scope follows the top selectors, deck
// building from the whole library) and a resource can be created while registering a card.
// Runs on COPIES of repository-data. Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import { openManagement } from './navigation-helpers.mjs';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v12-p1-'));
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [] };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

async function freshData() { const dir = await mkdtemp(join(run, 'data-')); await cp(resolve('repository-data/user-data'), dir, { recursive: true }); return dir; }
async function launch(userData, { scale = 1, width = 1366, height = 768, zoom = 1 } = {}) {
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DND_TCG_DEV_URL;
  if (dev) env.DND_TCG_DEV_URL = 'http://127.0.0.1:5173';
  const args = [`--force-device-scale-factor=${scale}`];
  const app = await electron.launch({ ...(binary ? { executablePath: binary, args } : { args: ['.', ...args] }), env, cwd: process.cwd(), timeout: 45000 });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(size.width, size.height); win.webContents.setZoomFactor(size.zoom); }, { width, height, zoom });
  await page.waitForSelector('.board'); await page.waitForTimeout(600);
  return { app, page, errors };
}
const boot = page => page.evaluate(async () => (await window.desktop.getBootstrap()).value);
const resourcesOf = (page, id) => page.evaluate(async id => (await window.desktop.getResources(id)).value, id);
const count = page => page.getByLabel('표시 카드 수', { exact: true }).textContent();
const waitCount = (page, text) => page.waitForFunction(text => document.querySelector('[aria-label="표시 카드 수"]')?.textContent === text, text);
const saved = page => page.getByRole('status').filter({ hasText: '필터 저장됨' }).waitFor();
async function selectCharacter(page, id) { await page.getByLabel('활성 캐릭터', { exact: true }).selectOption(id); await saved(page); }
async function selectCard(page, name) { const button = page.getByRole('button', { name: `${name} 카드 선택`, exact: true }); if (await button.getAttribute('aria-pressed') !== 'true') await button.click(); }
function readDb(path, sql, ...params) { const db = new DatabaseSync(join(path, 'data', 'app.sqlite3'), { readOnly: true }); try { return db.prepare(sql).all(...params); } finally { db.close(); } }
async function assetHashes(userData) { const dir = join(userData, 'assets'); const out = {}; for (const name of await readdir(dir)) out[name] = createHash('sha256').update(await readFile(join(dir, name))).digest('hex'); return out; }
const userTemplates = path => readDb(path, "SELECT name FROM resource_templates WHERE source='user' ORDER BY rowid").map(row => row.name);

async function openRegistration(page, name) {
  await page.locator('.top-actions').getByRole('button', { name: '카드 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '카드 등록', exact: true }); await dialog.waitFor();
  await dialog.getByLabel('카드 이름', { exact: true }).fill(name);
  await dialog.getByRole('radio', { name: '사용 횟수', exact: true }).check();
  return dialog;
}
async function draftResource(page, dialog, name, { max = 7, dawn = 3 } = {}) {
  await dialog.getByRole('button', { name: '+ 새 자원 만들기', exact: true }).click();
  const form = page.getByRole('dialog', { name: '새 자원 만들기', exact: true }); await form.waitFor();
  await form.getByLabel('자원 이름', { exact: true }).fill(name);
  await form.getByLabel('최대치', { exact: true }).fill(String(max));
  await form.getByLabel('새벽 경과 회복 방식', { exact: true }).selectOption('fixed');
  await form.getByLabel('새벽 경과 회복량', { exact: true }).fill(String(dawn));
  return form;
}

// ---------------------------------------------------------------------------------------------
// 1. Scope buttons removed: the selectors decide the scope; restart and old saved states.
{
  const userData = await freshData();
  let { app, page, errors } = await launch(userData);
  const start = await boot(page);
  const hero = start.profiles.find(profile => profile.id === start.libraryState.activeCharacterId);
  const heroDeck = start.decks.find(deck => deck.id === hero.activeDeckId);
  const total = start.cards.length;
  assert.equal(await page.getByRole('group', { name: '카드 범위', exact: true }).count(), 0);
  for (const name of ['전체 카드', '활성 덱']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, name);
  assert.equal(await count(page), `${heroDeck.cardIds.length} / ${total}장`);
  assert.equal(await page.locator('.deck-label strong').textContent(), heroDeck.name);
  await selectCharacter(page, '');
  await waitCount(page, `${total} / ${total}장`);
  assert.equal(await page.locator('.deck-label strong').textContent(), '전체 라이브러리');
  let state = (await boot(page)).libraryState; assert.equal(state.activeCharacterId, undefined); assert.equal(state.viewScope, 'library');
  await page.getByRole('searchbox', { name: '카드 이름 검색' }).fill(start.cards[0].name.slice(0, 2)); await saved(page);
  const searched = await count(page); assert(Number(searched.split(' ')[0]) >= 1 && Number(searched.split(' ')[0]) <= total);
  await page.getByRole('button', { name: '필터 초기화' }).click(); await waitCount(page, `${total} / ${total}장`);
  await selectCharacter(page, hero.id);
  await waitCount(page, `${heroDeck.cardIds.length} / ${total}장`);
  state = (await boot(page)).libraryState; assert.equal(state.activeCharacterId, hero.id); assert.equal(state.viewScope, 'deck');
  await app.close(); ({ app, page, errors } = await launch(userData));
  assert.equal(await count(page), `${heroDeck.cardIds.length} / ${total}장`);
  // An older saved "character + whole library" state (1.1.0 could store it) opens as the deck view, unchanged on disk.
  await page.evaluate(async id => { const lib = (await window.desktop.getBootstrap()).value; await window.desktop.saveLibraryState({ ...lib.libraryState, activeCharacterId: id, viewScope: 'library' }); }, hero.id);
  await app.close(); ({ app, page, errors } = await launch(userData));
  assert.equal(await count(page), `${heroDeck.cardIds.length} / ${total}장`);
  assert.equal((await boot(page)).libraryState.viewScope, 'library');
  assert.deepEqual(errors, []);
  check('Scope buttons removed; character = its active deck, 전체 라이브러리 = every card, search/reset work; persisted across restart; an older “character + library” state opens as the deck view without rewriting it', { deck: heroDeck.cardIds.length, total });

  // 2. Deck building from the whole library through the management menu.
  const empty = start.decks.find(deck => deck.cardIds.length === 0);
  const owner = start.profiles.find(profile => profile.id === empty.characterId);
  const card = start.cards.find(item => !empty.cardIds.includes(item.id));
  const cardsBefore = (await boot(page)).cards;
  await selectCharacter(page, '');
  await selectCard(page, card.name);
  await page.getByRole('button', { name: '관리', exact: true }).click();
  let menu = page.getByRole('dialog', { name: '관리 메뉴', exact: true });
  const group = menu.getByRole('group', { name: '덱에 넣기·빼기', exact: true });
  assert.equal(await group.getByRole('listitem').count(), start.decks.length);
  assert.equal(await menu.getByRole('button', { name: '활성 덱에 추가', exact: true }).count(), 0);
  await group.getByRole('button', { name: `${owner.name} · ${empty.name}에 넣기`, exact: true }).click();
  await group.getByRole('button', { name: `${owner.name} · ${empty.name}에서 빼기`, exact: true }).waitFor();
  let data = await boot(page);
  assert.deepEqual(data.decks.find(deck => deck.id === empty.id).cardIds, [card.id]);
  assert.deepEqual(data.cards, cardsBefore);
  for (const deck of start.decks.filter(deck => deck.id !== empty.id)) assert.deepEqual(data.decks.find(item => item.id === deck.id).cardIds, deck.cardIds);
  await page.keyboard.press('Escape');
  await selectCharacter(page, owner.id); await waitCount(page, `1 / ${total}장`);
  assert.equal(await page.getByRole('button', { name: `${card.name} 카드 선택`, exact: true }).count(), 1);
  await selectCharacter(page, '');
  await selectCard(page, card.name); await openManagement(page, `${owner.name} · ${empty.name}에서 빼기`);
  await page.waitForFunction(id => window.desktop.getBootstrap().then(r => r.value.decks.find(d => d.id === id).cardIds.length === 0), empty.id);
  await page.keyboard.press('Escape');
  await selectCharacter(page, owner.id); await page.getByText('이 덱에 아직 카드가 없어요').waitFor();
  data = await boot(page); assert.deepEqual(data.cards, cardsBefore);
  // Selection management and the bulk "추가할 덱" list still work from the whole library.
  await selectCharacter(page, '');
  await openManagement(page, '선택 관리');
  await page.getByRole('button', { name: '표시 카드 전체 선택', exact: true }).click();
  assert.match(await page.getByRole('region', { name: '카드 선택 관리' }).getByRole('status').textContent(), new RegExp(`${total}장 중 ${total}장 선택`));
  await page.locator('.batch-tools > details > summary').click();
  assert.equal(await page.getByLabel('일괄 추가할 덱', { exact: true }).locator('option').count(), start.decks.length + 1);
  await page.getByRole('button', { name: '선택 관리 종료', exact: true }).click();
  assert.deepEqual(errors, []);
  check('Whole-library deck building: 관리 → “<캐릭터> · <덱>에 넣기/빼기” changes only that deck; selected character shows it; empty-deck hint; selection management and bulk deck list intact', { deck: `${owner.name} · ${empty.name}`, card: card.name });
  await app.close();
}

// ---------------------------------------------------------------------------------------------
// 3. Registration creates a resource in the same save; cancel, duplicates and failures leave nothing.
{
  const userData = await freshData();
  const hashes = await assetHashes(userData);
  let { app, page, errors } = await launch(userData);
  const start = await boot(page);
  const hero = start.profiles.find(profile => profile.id === start.libraryState.activeCharacterId);
  const before = await resourcesOf(page, hero.id);
  const templatesBefore = userTemplates(userData);
  const eventsBefore = readDb(userData, 'SELECT COUNT(*) AS n FROM play_events')[0].n;

  // 3a. Cancel inside the resource form, then cancel the registration with a drafted resource.
  let dialog = await openRegistration(page, '취소될 카드');
  let form = await draftResource(page, dialog, '취소 자원');
  await form.getByRole('button', { name: '취소', exact: true }).click(); await form.waitFor({ state: 'hidden' });
  assert.equal(await dialog.getByLabel('등록 사용할 자원', { exact: true }).inputValue(), '');
  form = await draftResource(page, dialog, '취소 자원');
  await form.getByRole('button', { name: '자원 만들고 선택', exact: true }).click(); await form.waitFor({ state: 'hidden' });
  assert.equal(await dialog.getByLabel('카드 이름', { exact: true }).inputValue(), '취소될 카드');
  assert.match(await dialog.getByLabel('새 자원 초안', { exact: true }).textContent(), /카드를 저장할 때 함께 만들어집니다/);
  assert.deepEqual((await resourcesOf(page, hero.id)).resources, before.resources);
  await dialog.getByRole('button', { name: '취소', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual((await resourcesOf(page, hero.id)), before); assert.deepEqual(userTemplates(userData), templatesBefore);
  assert.equal((await boot(page)).cards.length, start.cards.length);
  check('Cancelling the resource form or the registration creates nothing (resources, templates, cards, revision unchanged)');

  // 3b. Save failure: the resource set changes while the form is open → the whole save is refused.
  dialog = await openRegistration(page, '천둥 지팡이');
  form = await draftResource(page, dialog, '지팡이 충전');
  await form.getByRole('button', { name: '자원 만들고 선택', exact: true }).click(); await form.waitFor({ state: 'hidden' });
  const other = before.resources.find(resource => resource.kind === 'counter' && !resource.unlimited && resource.remaining > 0);
  await page.evaluate(async ({ characterId, revision, resourceId }) => window.desktop.changeResource({ requestId: crypto.randomUUID(), characterId, expectedRevision: revision, action: { type: 'adjust', resourceId, delta: -1 } }), { characterId: hero.id, revision: before.revision, resourceId: other.id });
  await dialog.getByRole('button', { name: '카드 저장', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '자원 구성이 바뀌었습니다' }).waitFor();
  assert.equal((await boot(page)).cards.length, start.cards.length);
  assert.equal((await resourcesOf(page, hero.id)).resources.some(resource => resource.name === '지팡이 충전'), false);
  assert.deepEqual(userTemplates(userData), templatesBefore);
  assert.equal(await dialog.getByLabel('카드 이름', { exact: true }).inputValue(), '천둥 지팡이');
  check('A refused save (stale resources) leaves no card, resource, template or binding and keeps the form inputs');

  // 3c. Reload resources and save: card + resource + binding + deck link in one save.
  await dialog.getByRole('button', { name: '연결 자원 다시 불러오기', exact: true }).click();
  await page.waitForTimeout(300);
  await dialog.getByRole('button', { name: '카드 저장', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const after = await resourcesOf(page, hero.id);
  const created = after.resources.find(resource => resource.name === '지팡이 충전');
  assert(created); assert.equal(created.capacity, 7); assert.equal(created.remaining, 7); assert.equal(created.overrides.scope, 'character');
  assert.deepEqual(created.template.recovery, [{ triggers: ['dawn'], amount: { type: 'fixed', value: 3 } }]);
  let data = await boot(page);
  const wand = data.cards.find(card => card.name === '천둥 지팡이');
  assert(data.decks.find(deck => deck.id === hero.activeDeckId).cardIds.includes(wand.id));
  assert.deepEqual(after.bindings.filter(binding => binding.cardId === wand.id).map(binding => binding.resourceInstanceId), [created.id]);
  assert.equal(after.events[0].label, '지팡이 충전 자원 생성');
  assert.deepEqual(userTemplates(userData), [...templatesBefore, '지팡이 충전']);
  for (const resource of before.resources) { const now = after.resources.find(item => item.id === resource.id); assert(now, resource.name); if (resource.id !== other.id) assert.deepEqual({ ...now, template: undefined }, { ...resource, template: undefined }); }
  // The new card spends from the new resource; Undo restores it.
  await selectCard(page, '천둥 지팡이');
  await page.getByRole('button', { name: '사용 확정', exact: true }).click();
  await page.waitForFunction(({ id, name }) => window.desktop.getResources(id).then(r => r.value.resources.find(x => x.name === name)?.remaining === 6), { id: hero.id, name: '지팡이 충전' });
  await page.getByRole('complementary', { name: '자원 패널' }).getByRole('button', { name: '직전 자원 변경 실행 취소', exact: true }).click();
  await page.waitForFunction(({ id, name }) => window.desktop.getResources(id).then(r => r.value.resources.find(x => x.name === name)?.remaining === 7), { id: hero.id, name: '지팡이 충전' });
  check('Registration creates the resource with the card in one save: auto-selected cost, character-shared 7/7 with dawn +3, card in the active deck, “자원 생성” record; the card spends 7→6 and Undo restores', { resource: created.id });

  // 3d. Duplicate names are refused in the form (existing resource offered instead) and by the store.
  dialog = await openRegistration(page, '두 번째 지팡이');
  form = await draftResource(page, dialog, ' 지팡이 충전 ');
  await form.getByRole('alert').filter({ hasText: '이미 ‘지팡이 충전’ 자원이 있습니다' }).waitFor();
  assert.equal(await form.getByRole('button', { name: '자원 만들고 선택', exact: true }).isDisabled(), true);
  await form.getByRole('button', { name: '기존 ‘지팡이 충전’ 선택', exact: true }).click(); await form.waitFor({ state: 'hidden' });
  assert.equal(await dialog.getByLabel('등록 사용할 자원', { exact: true }).inputValue(), created.id);
  // Another window (here: the bridge) creates a same-named resource after the draft was made → refused.
  form = await draftResource(page, dialog, '보호막 점수');
  await form.getByRole('button', { name: '자원 만들고 선택', exact: true }).click(); await form.waitFor({ state: 'hidden' });
  const current = await resourcesOf(page, hero.id);
  await page.evaluate(async ({ characterId, revision }) => window.desktop.changeResource({ requestId: crypto.randomUUID(), characterId, expectedRevision: revision, action: { type: 'create_resource', scope: 'character', template: { name: '보호막 점수', unit: '점', kind: 'counter', capacity: { type: 'fixed', value: 3 }, recovery: [] } } }), { characterId: hero.id, revision: current.revision });
  await dialog.getByRole('button', { name: '연결 자원 다시 불러오기', exact: true }).click(); await page.waitForTimeout(300);
  await dialog.getByRole('button', { name: '카드 저장', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '같은 이름의 자원' }).waitFor();
  assert.equal((await resourcesOf(page, hero.id)).resources.filter(resource => resource.name === '보호막 점수').length, 1);
  assert.equal((await boot(page)).cards.some(card => card.name === '두 번째 지팡이'), false);
  await dialog.getByRole('button', { name: '취소', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  check('Duplicate names: the form blocks them and offers the existing resource; a same-named resource made meanwhile makes the whole save fail with nothing created');

  // 3e. Free and spell-slot registrations and 자원 관리 → 새 자원 만들기 keep working.
  dialog = await openRegistration(page, '무소모 검수');
  await dialog.getByRole('radio', { name: '무소모', exact: true }).check();
  await dialog.getByRole('button', { name: '카드 저장', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  dialog = await openRegistration(page, '계약 슬롯 검수');
  await dialog.getByRole('radio', { name: '주문 슬롯', exact: true }).check();
  await dialog.getByLabel('등록 기본 주문 레벨', { exact: true }).selectOption('3');
  await dialog.getByLabel('등록 슬롯 계열', { exact: true }).selectOption('pact');
  await dialog.getByRole('button', { name: '카드 저장', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  data = await boot(page);
  // With a character selected the registration rule defaults to “현재 캐릭터만” (a character cost override).
  const overrides = (await resourcesOf(page, hero.id)).costOverrides;
  const ruleOf = name => overrides.find(item => item.cardId === data.cards.find(card => card.name === name).id).castOptions[0];
  assert.deepEqual(ruleOf('무소모 검수').costs, []);
  assert.equal(ruleOf('계약 슬롯 검수').costs[0].slotSelection, 'pact'); assert.equal(ruleOf('계약 슬롯 검수').casting.allowUpcast, true);
  await openManagement(page, '자원 관리');
  const manager = page.getByRole('dialog', { name: '자원 관리', exact: true });
  await manager.getByRole('button', { name: '새 자원 만들기', exact: true }).click();
  const legacy = page.getByRole('dialog', { name: '새 자원', exact: true });
  await legacy.getByLabel('자원 이름', { exact: true }).fill('관리 화면 자원'); await legacy.getByLabel('최대치', { exact: true }).fill('4');
  await legacy.getByLabel('짧은 휴식 회복 방식', { exact: true }).selectOption('fixed'); await legacy.getByLabel('짧은 휴식 회복량', { exact: true }).fill('2');
  await legacy.getByLabel('긴 휴식 회복 방식', { exact: true }).selectOption('full');
  await legacy.getByRole('button', { name: '자원 저장', exact: true }).click(); await legacy.waitFor({ state: 'hidden' });
  await page.getByRole('dialog', { name: '자원 관리', exact: true }).getByRole('button', { name: '자원 관리 닫기', exact: true }).click();
  const managed = (await resourcesOf(page, hero.id)).resources.find(resource => resource.name === '관리 화면 자원');
  assert.deepEqual(managed.template.recovery, [{ triggers: ['short_rest'], amount: { type: 'fixed', value: 2 } }, { triggers: ['long_rest'], amount: { type: 'full' } }]);
  check('무소모 and spell-slot (pact, upcast) registration unchanged; 자원 관리 → 새 자원 만들기 (shared recovery fields) still saves the same template');

  // 3f. Restart: everything persisted, images and other data intact.
  await app.close(); ({ app, page, errors } = await launch(userData));
  const final = await resourcesOf(page, hero.id); data = await boot(page);
  assert(final.resources.some(resource => resource.name === '지팡이 충전' && resource.remaining === 7));
  assert(data.cards.some(card => card.name === '천둥 지팡이'));
  assert.deepEqual(await assetHashes(userData), hashes);
  for (const card of start.cards) assert.deepEqual(data.cards.find(item => item.id === card.id), card);
  assert(readDb(userData, 'SELECT COUNT(*) AS n FROM play_events')[0].n > eventsBefore);
  assert.deepEqual(readDb(userData, 'PRAGMA foreign_key_check'), []);
  assert.equal(readDb(userData, 'PRAGMA quick_check')[0].quick_check, 'ok');
  assert.deepEqual(errors, []);
  check('After restart: new card/resource persisted; existing cards and image files byte-identical; play events only appended; SQLite foreign keys and quick_check ok');
  await app.close();
}

// ---------------------------------------------------------------------------------------------
// 4. The new-resource form fits at 100/125/150% scaling.
for (const zoom of [1, 1.25, 1.5]) {
  const { app, page } = await launch(await freshData(), { width: 1280, height: 720, zoom });
  const dialog = await openRegistration(page, '배율 검수');
  const form = await draftResource(page, dialog, '배율 자원');
  const box = await form.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  assert(box.sw <= box.cw + 1, `no horizontal overflow at ${zoom}: ${JSON.stringify(box)}`);
  assert(await form.getByRole('button', { name: '자원 만들고 선택', exact: true }).isVisible() || await form.getByRole('button', { name: '자원 만들고 선택', exact: true }).evaluate(el => { el.scrollIntoView(); return true; }));
  await app.close();
}
check('New-resource form has no horizontal overflow at 100/125/150% (1280×720)');

if (server) await server.close();
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, checks: report.checks.length, run }, null, 2));
