// v1.1 Phase 2 checks: main-screen registration, selection bar (trash inside the bulk area, end-selection)
// and display-only clearing of recent actions. Runs on COPIES of repository-data.
// Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { createServer } from 'vite';
import { openBulkActions, openManagement } from './navigation-helpers.mjs';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v11-p2-'));
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [] };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }
const imagePath = join(run, 'p2-card.png');
await sharp({ create: { width: 500, height: 700, channels: 3, background: '#5a2a24' } }).png().toFile(imagePath);

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
const library = data => ({ cards: data.cards, decks: data.decks });
const rect = (page, selector) => page.locator(selector).first().evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }; });
const historyCount = async page => Number((await page.locator('.resource-history > summary').textContent()).match(/(\d+)\s*$/)[1]);
async function openHistory(page) { const details = page.locator('.resource-history'); if (!await details.evaluate(el => el.open)) await details.locator(':scope > summary').click(); return details; }

// 1. Header button and selection-mode cards fit at 100/125/150% scaling.
const layout = [];
for (const scale of [1, 1.25, 1.5]) {
  const { app, page } = await launch(await freshData(), scale);
  const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const register = page.locator('.top-actions').getByRole('button', { name: '카드 등록', exact: true });
  assert(await register.isVisible());
  const actions = await page.locator('.top-actions > *').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
  const plate = await rect(page, '.nameplate');
  assert(actions.every(r => r.left >= 0 && r.right <= viewport.w + 0.5 && r.bottom <= 90), `header buttons on screen ${JSON.stringify({ actions, viewport })}`);
  assert(actions[0].left >= plate.right - 0.5, `header buttons clear of the nameplate ${JSON.stringify({ first: actions[0], plate })}`);
  // Share of the first card face that is inside the hand area (1 = fully visible).
  const visible = async () => { const area = await rect(page, '.cards-area'); const face = await rect(page, '.cards-area .card-item .card-face'); return { ratio: Math.max(0, Math.min(face.bottom, area.bottom) - Math.max(face.top, area.top)) / (face.bottom - face.top), face, area }; };
  const normal = await visible();
  await openManagement(page, '선택 관리');
  const folded = await visible();
  const box = await rect(page, '.cards-area .card-batch-check');
  assert(box.left >= folded.face.left - 1 && box.right <= folded.face.right + 1 && box.top >= folded.face.top - 1, `check sits on the card ${JSON.stringify({ box, face: folded.face })}`);
  await openBulkActions(page);
  const opened = await visible();
  const round = value => Math.round(value * 100) / 100;
  layout.push({ scale, viewport, normal: round(normal.ratio), selection: round(folded.ratio), bulkOpen: round(opened.ratio) });
  // Selection mode never shows less of a card than normal play; where normal play shows whole cards, so does selection mode.
  for (const state of [folded, opened]) assert(state.ratio >= Math.min(1, normal.ratio) - 0.01, `card visibility in selection mode at ${scale} ${JSON.stringify({ normal: normal.ratio, state })}`);
  await app.close();
}
check('header 카드 등록 stays on screen beside the nameplate; in selection mode (folded and opened) cards are as visible as in normal play, with the check on their corner (100/125/150%)', { layout });

// 2. Main-screen registration: cancel changes nothing; save links image, info, tag and cost to the active deck.
const userData = await freshData();
let { app, page } = await launch(userData);
const initial = await boot(page);
const profile = initial.profiles.find(p => p.id === initial.libraryState.activeCharacterId);
const deck = initial.decks.find(d => d.id === profile.activeDeckId);
assert(profile && deck, 'repository data has an active character and deck');
const register = page.locator('.top-actions').getByRole('button', { name: '카드 등록', exact: true });
assert.equal(await register.getAttribute('title'), `${profile.name} · ${deck.name}에 등록`);
await register.click();
let form = page.getByRole('dialog', { name: '카드 등록', exact: true });
await form.getByLabel('카드 이름', { exact: true }).fill('취소될 카드');
await form.getByRole('button', { name: '취소', exact: true }).click(); await form.waitFor({ state: 'hidden' });
assert.deepEqual(library(await boot(page)), library(initial));
check('main-screen 카드 등록 opens the existing registration form; cancelling leaves cards and decks unchanged');

const NEW = 'P2 메인 등록 검수';
await register.click(); form = page.getByRole('dialog', { name: '카드 등록', exact: true });
await form.getByLabel('카드 이미지 파일').setInputFiles(imagePath);
await form.getByLabel('카드 이름', { exact: true }).fill(NEW);
const advanced = form.locator('details.editor-advanced');
if (!await advanced.evaluate(el => el.open)) await advanced.locator(':scope > summary').click();
const tagBox = form.getByRole('group', { name: '카드 태그', exact: true }).getByRole('checkbox').first();
const tagName = (await tagBox.count()) ? (await tagBox.evaluate(el => el.closest('label').textContent.trim())) : undefined;
if (tagName) await tagBox.check();
await form.getByRole('radio', { name: '사용 횟수', exact: true }).check();
const resourceSelect = form.getByLabel('등록 사용할 자원');
const options = await resourceSelect.locator('option').evaluateAll(list => list.map(o => ({ value: o.value, text: o.textContent })).filter(o => o.value));
assert(options.length, 'a counter resource is available for the cost');
await resourceSelect.selectOption(options[0].value);
await form.getByLabel('등록 사용할 양').fill('1');
await form.getByRole('button', { name: '카드 저장', exact: true }).click(); await form.waitFor({ state: 'hidden' });
let data = await boot(page);
const created = data.cards.find(card => card.name === NEW);
assert(created, 'card registered');
assert(created.imageAssetId, 'image kept');
assert(tagName, 'repository data has a tag to attach');
assert(created.tags.includes(initial.tags.find(t => t.name === tagName).id), 'tag kept');
assert(data.decks.find(d => d.id === deck.id).cardIds.includes(created.id), 'linked to the active deck');
let snapshot = await resourcesOf(page, profile.id);
const costs = [...created.castOptions, ...(snapshot.costOverrides?.find(o => o.cardId === created.id)?.castOptions ?? [])].flatMap(o => o.costs);
assert(costs.length > 0, 'cost rule saved');
assert.equal(data.cards.length, initial.cards.length + 1);
for (const card of initial.cards) assert.deepEqual(data.cards.find(c => c.id === card.id), card, 'other cards untouched');
check('registering from the main screen saves image, info, tag and a cost rule and links the card to the active deck', { card: NEW, tag: tagName, cost: options[0].text.trim(), deck: deck.name });

// 3. Selection bar: end-selection in the first row, trash move only inside the expanded bulk area.
await openManagement(page, '선택 관리');
const bar = page.getByRole('region', { name: '카드 선택 관리', exact: true });
assert.deepEqual(await bar.locator(':scope > .batch-actions button').allTextContents(), ['표시 카드 전체 선택', '카드 선택 해제', '선택 관리 종료']);
const trashButton = bar.getByRole('button', { name: '선택한 라이브러리 원본을 휴지통으로 이동', exact: true });
assert.equal(await trashButton.isVisible(), false, 'hidden while the bulk area is folded');
assert.equal(await page.locator('.toolbar-switches').getByRole('button', { name: '선택 관리 종료' }).count(), 0, 'end-selection moved out of the hand toolbar');
const targets = data.cards.filter(card => deck.cardIds.includes(card.id) && card.name !== NEW).slice(0, 2);
for (const card of targets) await page.getByLabel(`${card.name} 일괄 선택`, { exact: true }).check();
await openBulkActions(page);
assert(await trashButton.isVisible());
const scopeText = await bar.locator('.batch-trash-scope').textContent();
assert(scopeText.startsWith('대상 2장 · 범위: ') && scopeText.includes('현재 필터 결과'), scopeText);
await trashButton.click();
let dialog = page.getByRole('dialog', { name: '휴지통 이동 확인', exact: true });
await dialog.getByText('2장 휴지통 이동', { exact: true }).waitFor();
await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
assert.deepEqual(library(await boot(page)), library(data), 'cancelling the confirmation changes nothing');
await trashButton.click(); dialog = page.getByRole('dialog', { name: '휴지통 이동 확인', exact: true });
await dialog.getByRole('button', { name: '휴지통으로 이동 확정', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
let moved = await boot(page);
assert(targets.every(t => !moved.cards.some(c => c.id === t.id) && moved.decks.every(d => !d.cardIds.includes(t.id))), 'moved to the trash and hidden from decks');
await page.getByRole('button', { name: '휴지통 이동 실행 취소 · 2장', exact: true }).click();
await page.waitForFunction(async ids => { const v = (await window.desktop.getBootstrap()).value; return ids.every(id => v.cards.some(c => c.id === id)); }, targets.map(t => t.id));
moved = await boot(page);
assert(targets.every(t => moved.decks.find(d => d.id === deck.id).cardIds.includes(t.id)), 'undo restores deck membership with the same IDs');
check('selection bar: trash move shows only inside the expanded bulk area with its count and scope; confirmation cancel, move and one-click undo work as before', { scope: scopeText });

await page.getByLabel(`${targets[0].name} 일괄 선택`, { exact: true }).check();
await openBulkActions(page); await trashButton.click();
dialog = page.getByRole('dialog', { name: '휴지통 이동 확인', exact: true });
await dialog.getByRole('button', { name: '휴지통으로 이동 확정', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
await openManagement(page, '라이브러리 관리'); await page.getByRole('button', { name: '휴지통', exact: true }).click();
const manager = page.getByRole('dialog', { name: '카드 휴지통', exact: true });
await manager.getByRole('button', { name: `${targets[0].name} 복원`, exact: true }).click();
dialog = page.getByRole('dialog', { name: '카드 복원 확인', exact: true });
await dialog.getByRole('button', { name: '카드 복원 확정', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
await manager.getByRole('button', { name: '카드 휴지통 닫기', exact: true }).click();
assert((await boot(page)).cards.some(c => c.id === targets[0].id));
check('a card moved from the bulk area can be restored from the trash manager with its ID');

const beforeExit = await boot(page);
await page.getByLabel(`${targets[1].name} 일괄 선택`, { exact: true }).check();
await bar.getByRole('button', { name: '선택 관리 종료', exact: true }).click();
await bar.waitFor({ state: 'detached' });
assert.equal(await page.getByRole('checkbox', { name: /일괄 선택$/ }).count(), 0);
await page.waitForFunction(() => document.activeElement?.classList.contains('card-button'));
assert.deepEqual(library(await boot(page)), library(beforeExit), 'ending selection changes no card or deck');
await openManagement(page, '선택 관리');
assert.equal(await page.getByLabel(`${targets[1].name} 일괄 선택`, { exact: true }).isChecked(), false, 'checks cleared on exit');
await bar.getByRole('button', { name: '선택 관리 종료', exact: true }).click();
check('선택 관리 종료 hides the checks and selection bar, clears the selection, returns focus to the hand and changes no data');

// 4. Recent actions: display-only clearing that survives a restart; resources, use records and Undo intact.
const deckBox = page.getByRole('button', { name: `${NEW} 카드 선택`, exact: true });
await deckBox.click();
const counter = snapshot.resources.find(r => r.id === options[0].value);
await page.getByRole('button', { name: '사용 확정', exact: true }).click();
await page.waitForFunction(async ({ id, rid, before }) => (await window.desktop.getResources(id)).value.resources.find(r => r.id === rid).remaining === before - 1, { id: profile.id, rid: counter.id, before: counter.remaining });
await page.getByRole('button', { name: '카드 선택 닫기', exact: true }).click();
const history = await openHistory(page);
const shownBefore = await historyCount(page);
const beforeClear = await resourcesOf(page, profile.id);
await history.getByRole('button', { name: '기록 비우기', exact: true }).click();
dialog = page.getByRole('dialog', { name: '최근 작업 기록 비우기', exact: true });
const notice = await dialog.textContent();
for (const text of [`${shownBefore}건의 표시만`, '자원 현재량은 바뀌지 않습니다', '카드 사용 기록은 지우지 않습니다', '실행 취소', '다시 시작해도']) assert(notice.includes(text), text);
await dialog.getByRole('button', { name: '취소', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
assert.equal(await historyCount(page), shownBefore);
await history.getByRole('button', { name: '기록 비우기', exact: true }).click();
await dialog.getByRole('button', { name: '표시 기록 비우기', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
await page.waitForFunction(() => /· 0$/.test(document.querySelector('.resource-history > summary')?.textContent ?? ''));
const afterClear = await resourcesOf(page, profile.id);
assert.deepEqual({ resources: afterClear.resources, events: afterClear.events, undo: afterClear.undoTargetId, revision: afterClear.revision }, { resources: beforeClear.resources, events: beforeClear.events, undo: beforeClear.undoTargetId, revision: beforeClear.revision });
check('기록 비우기 asks first with the scope, then hides the list without changing resources, play events, revision or the Undo target', { hidden: shownBefore });

const undo = page.getByRole('button', { name: '직전 자원 변경 실행 취소', exact: true });
assert.equal(await undo.isEnabled(), true);
await undo.click();
await page.waitForFunction(async ({ id, rid, before }) => (await window.desktop.getResources(id)).value.resources.find(r => r.id === rid).remaining === before, { id: profile.id, rid: counter.id, before: counter.remaining });
await page.waitForFunction(() => /· 1$/.test(document.querySelector('.resource-history > summary')?.textContent ?? ''));
check('Undo still reverts the hidden card use; the new Undo entry appears in the cleared list');

await app.close(); ({ app, page } = await launch(userData));
await openHistory(page);
assert.equal(await historyCount(page), 1, 'cleared state kept after restart');
await page.locator('.resource-history').getByRole('button', { name: '전체 카드 사용 기록', exact: true }).click();
const useHistory = page.getByRole('dialog', { name: '카드 사용 기록', exact: true });
await useHistory.getByText(NEW).first().waitFor();
await useHistory.getByRole('button', { name: '카드 사용 기록 닫기', exact: true }).click();
await page.locator('.resource-history').getByRole('button', { name: '숨긴 기록 다시 표시', exact: true }).click();
await page.waitForFunction(n => new RegExp(`· ${n}$`).test(document.querySelector('.resource-history > summary')?.textContent ?? ''), shownBefore + 1);
const final = await boot(page);
assert.deepEqual(final.cards.map(c => c.id).sort(), data.cards.map(c => c.id).sort(), 'no card lost');
check('after a restart the list stays cleared, the full use history still shows the card use, and 숨긴 기록 다시 표시 brings every entry back', { restored: shownBefore + 1 });
await app.close();
if (server) await server.close();
await writeFile(join(run, 'v11-p2-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outcome: 'PASS', mode: report.mode, checks: report.checks.length, artifacts: run }));
