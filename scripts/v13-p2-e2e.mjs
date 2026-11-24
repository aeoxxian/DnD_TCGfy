// v1.3 Phase 2 checks: registering several images at once (common settings, per-card settings, duplicate images, final
// check, per-card saves with an injected failure, stop after repeated failures, retry, 50 cards) and registration
// templates (save, restart, apply with a resource found by name). Runs on COPIES of repository-data.
// Modes: built bundle (default), `--dev` (Vite), or DND_TCG_EXECUTABLE. Needs artifacts/p4-b-input.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { createServer } from 'vite';
import { registerBatch } from './navigation-helpers.mjs';

const dev = process.argv.includes('--dev');
const binary = process.env.DND_TCG_EXECUTABLE;
assert(!(dev && binary));
const run = await mkdtemp(join(resolve('artifacts'), 'v13-p2-'));
const report = { mode: binary ? 'packaged-exe' : dev ? 'vite-development' : 'built-bundle', checks: [] };
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`✓ ${name}`); };
let server; if (dev) { server = await createServer(); await server.listen(); }

const fixtureDir = resolve('artifacts/p4-b-input');
const realImages = (await readdir(fixtureDir)).filter(name => /\.(png|jpe?g|webp)$/i.test(name)).sort().map(name => join(fixtureDir, name));
assert(realImages.length >= 6, 'run scripts/prepare-p4-b-fixtures.mjs first');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const synthetic = join(run, 'synthetic'); await mkdir(synthetic);
async function makeImage(name, text, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="612"><rect width="100%" height="100%" fill="${color}"/><rect x="12" y="12" width="396" height="588" fill="none" stroke="#e2c98f" stroke-width="5"/><text x="34" y="90" font-size="34" fill="#fff">${text}</text></svg>`;
  const path = join(synthetic, name); await writeFile(path, await sharp(Buffer.from(svg)).png().toBuffer()); return path;
}

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
const dbPath = userData => join(userData, 'data', 'app.sqlite3');
function readDb(userData, sql, ...params) { const db = new DatabaseSync(dbPath(userData), { readOnly: true }); try { return db.prepare(sql).all(...params); } finally { db.close(); } }
function execDb(userData, sql) { const db = new DatabaseSync(dbPath(userData)); try { db.exec(sql); } finally { db.close(); } }
async function assetHashes(userData) { const dir = join(userData, 'assets'); const out = {}; for (const name of await readdir(dir)) out[name] = sha(await readFile(join(dir, name))); return out; }
const exists = path => stat(path).then(() => true, () => false);
async function until(test, what, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return; await new Promise(r => setTimeout(r, 100)); } assert.fail(`timed out: ${what}`); }
async function openRegistration(page) {
  await page.locator('.top-actions').getByRole('button', { name: '카드 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '카드 등록', exact: true }); await dialog.waitFor(); return dialog;
}
async function pick(form, files) { await form.getByLabel('카드 이미지 파일').setInputFiles(files); await form.locator('.batch-row').nth(files.length - 1).waitFor(); }
const row = (form, n) => form.getByRole('listitem', { name: new RegExp(`^${n}번 카드 `) });
async function checks(scope, group, names) { const set = scope.getByRole('group', { name: group, exact: true }); for (const box of await set.getByRole('checkbox').all()) { const label = await box.evaluate(el => el.closest('label').textContent.trim()); if (names.includes(label)) await box.check(); else await box.uncheck(); } }

const userData = await freshData();
const originalAssets = await assetHashes(userData);
const originalCards = readDb(userData, 'SELECT * FROM card_definitions ORDER BY id');
let { app, page, errors } = await launch(userData);
const start = await boot(page);
const hero = start.profiles.find(p => p.id === start.libraryState.activeCharacterId);
const counter = (await page.evaluate(async id => (await window.desktop.getResources(id)).value, hero.id)).resources.find(r => r.kind === 'counter' && r.overrides.scope !== 'card');
assert(counter, 'the hero has a counter resource for the template check');

// ---------------------------------------------------------------------------------------------
// 1. Six images: common settings, a template, per-card settings, duplicate warnings, a failure, retry, cleanup.
{
  const picks = [realImages[0], realImages[1], realImages[2], realImages[3], realImages[4], realImages[0]];
  const form = await openRegistration(page);
  const before = readDb(userData, 'SELECT id, relative_path FROM assets');
  await pick(form, picks);
  assert.equal(await form.locator('.batch-row').count(), 6);
  assert.equal(await row(form, 6).getByRole('checkbox', { name: /등록에 포함$/ }).isChecked(), false, 'the repeated image starts excluded');
  assert.match(await row(form, 6).textContent(), /이 목록의 ‘.+’와 같은 이미지입니다/);
  assert.match(await row(form, 1).textContent(), /같은 이미지가 이미 ‘.+’ 카드에 있습니다/);
  await form.getByRole('button', { name: /^이미 등록된 이미지 \d+장 제외$/ }).waitFor();
  // Common settings + a template that keeps them.
  await form.getByLabel('카드 유형', { exact: true }).selectOption('spell');
  await form.getByLabel('주문 레벨 (선택)', { exact: true }).selectOption('1');
  await checks(form, '카드 역할', ['공격']);
  await form.getByRole('radio', { name: '사용 횟수', exact: true }).check();
  await form.getByLabel('등록 사용할 자원', { exact: true }).selectOption(counter.id);
  await form.getByLabel('새 템플릿 이름').fill('E2E 주문 템플릿');
  await form.getByRole('button', { name: '지금 설정을 템플릿으로 저장' }).click();
  await form.getByText('‘E2E 주문 템플릿’ 템플릿을 저장했습니다.').waitFor();
  await form.getByRole('radio', { name: '무소모', exact: true }).check();
  // Card 2: its own kind, description and “나중에 설정”. Card 3: library only. Card 4 will fail once.
  const names = ['P2 하나', 'P2 둘', 'P2 셋', 'P2 실패', 'P2 다섯'];
  for (let i = 0; i < 5; i++) await row(form, i + 1).getByLabel(`카드 이름 ${i + 1}`, { exact: true }).fill(names[i]);
  await row(form, 2).getByRole('button', { name: /개별 설정$/ }).click();
  let editor = form.getByRole('group', { name: /개별 설정$/ });
  await editor.getByRole('checkbox', { name: '이 카드의 속성을 따로 정하기' }).check();
  await editor.getByLabel('개별 카드 유형').selectOption('attack');
  await editor.getByLabel('개별 카드 설명').fill('둘째 카드만의 설명');
  await editor.getByLabel('개별 비용 방식').selectOption('own');
  await editor.getByRole('radio', { name: '개별 나중에 설정' }).check();
  await row(form, 2).getByRole('button', { name: /개별 설정$/ }).click();
  await row(form, 3).getByRole('button', { name: /개별 설정$/ }).click();
  editor = form.getByRole('group', { name: /개별 설정$/ });
  await editor.getByLabel('개별 덱 연결').selectOption('no');
  await row(form, 3).getByRole('button', { name: /개별 설정$/ }).click();
  assert.match(await row(form, 2).textContent(), /개별/); assert.match(await row(form, 1).textContent(), /기본값/);
  const imported = readDb(userData, 'SELECT id, relative_path, sha256 FROM assets').filter(a => !before.some(b => b.id === a.id));
  execDb(userData, "CREATE TRIGGER e2e_fail BEFORE INSERT ON card_definitions WHEN NEW.name = 'P2 실패' BEGIN SELECT RAISE(ABORT, 'injected'); END;");
  await form.getByRole('button', { name: '5장 등록', exact: true }).click();
  const final = form.getByRole('region', { name: '등록 전 최종 확인', exact: true });
  const finalText = await final.textContent();
  assert.match(finalText, /5장을 새 카드로 등록합니다/); assert.match(finalText, /제외한 1장/); assert.match(finalText, /넣기 4장 · 라이브러리에만 1장/);
  assert.match(finalText, /나중에 설정 1장 · 무소모 4장/); assert.match(finalText, /개별 설정한 카드 2장/);
  await form.getByRole('button', { name: '등록 시작', exact: true }).click();
  const result = form.getByRole('region', { name: '등록 결과', exact: true });
  await form.getByRole('button', { name: '실패·미처리 다시 등록' }).waitFor();
  assert.match(await result.textContent(), /완료 4장 · 실패 1장 · 미처리 0장 · 제외 1장/);
  assert.match(await row(form, 4).getByRole('alert').textContent(), /^실패 · /);
  let lib = await boot(page);
  const deck = lib.decks.find(d => d.id === hero.activeDeckId);
  for (const [i, name] of names.entries()) {
    const card = lib.cards.find(c => c.name === name);
    if (name === 'P2 실패') { assert(!card); continue; }
    assert(card, name);
    const source = await readFile(picks[i]); const stored = readDb(userData, 'SELECT relative_path FROM assets WHERE id=?', card.imageAssetId)[0];
    assert.equal(sha(await readFile(join(userData, stored.relative_path))), sha(source), `${name} keeps the original bytes`);
    assert.equal(deck.cardIds.includes(card.id), name !== 'P2 셋', `${name} deck link`);
    // The rule is character-scoped (a character is selected), so it lives in the character's cost override.
    const overrides = readDb(userData, 'SELECT count(*) AS n FROM character_cost_overrides WHERE card_id=? AND character_id=?', card.id, hero.id)[0].n;
    if (name === 'P2 둘') assert.deepEqual([card.kind, card.description, overrides], ['attack', '둘째 카드만의 설명', 0]);
    else assert.deepEqual([card.kind, card.spellLevel, card.roles, overrides], ['spell', 1, ['damage'], 1]);
  }
  check('Six images: repeated image excluded, existing-card duplicates warned; common spell/level/role/무소모 applied; per-card kind/description/나중에 설정 and library-only kept apart; final check counts; one injected failure leaves four cards saved with byte-identical originals and the right deck links');
  execDb(userData, 'DROP TRIGGER e2e_fail');
  await form.getByRole('button', { name: '실패·미처리 다시 등록' }).click();
  await result.getByRole('heading', { name: '5장 등록 완료' }).waitFor();
  lib = await boot(page);
  for (const name of names) assert.equal(lib.cards.filter(c => c.name === name).length, 1, `${name} exists once`);
  await form.getByRole('button', { name: '닫기', exact: true }).last().click(); await form.waitFor({ state: 'hidden' });
  const repeat = imported.find(a => !lib.cards.some(c => c.imageAssetId === a.id));
  assert(repeat, 'the excluded repeat was imported');
  // The cleanup removes the file first and the database row right after it: wait for both.
  await until(async () => !(await exists(join(userData, repeat.relative_path))) && readDb(userData, 'SELECT count(*) AS n FROM assets WHERE id=?', repeat.id)[0].n === 0, 'excluded image file and row deleted on close');
  for (const a of imported.filter(a => a.id !== repeat.id)) assert(await exists(join(userData, a.relative_path)), 'saved images kept');
  assert.equal(readDb(userData, 'SELECT count(*) AS n FROM assets WHERE id=?', repeat.id)[0].n, 0);
  check('Retry registers the failed card once (no duplicates); closing deletes only the excluded image, every saved image stays');
}

// ---------------------------------------------------------------------------------------------
// 2. Three failures in a row stop the run; the rest stay unprocessed and finish on retry.
{
  const files = []; for (let i = 1; i <= 5; i++) files.push(await makeImage(`stop-${i}.png`, `STOP ${i}`, ['#203040', '#302040', '#403020', '#204030', '#402030'][i - 1]));
  const form = await openRegistration(page);
  await pick(form, files);
  execDb(userData, "CREATE TRIGGER e2e_fail_all BEFORE INSERT ON card_definitions BEGIN SELECT RAISE(ABORT, 'injected'); END;");
  await form.getByRole('button', { name: '5장 등록', exact: true }).click();
  await form.getByRole('button', { name: '등록 시작', exact: true }).click();
  const result = form.getByRole('region', { name: '등록 결과', exact: true });
  await form.getByRole('button', { name: '실패·미처리 다시 등록' }).waitFor();
  assert.match(await result.textContent(), /완료 0장 · 실패 3장 · 미처리 2장/); assert.match(await result.textContent(), /연속으로 3장이 실패해/);
  assert.equal(await row(form, 5).getByText('미처리', { exact: true }).count(), 1);
  execDb(userData, 'DROP TRIGGER e2e_fail_all');
  await form.getByRole('button', { name: '실패·미처리 다시 등록' }).click();
  await result.getByRole('heading', { name: '5장 등록 완료' }).waitFor();
  await form.getByRole('button', { name: '닫기', exact: true }).last().click(); await form.waitFor({ state: 'hidden' });
  const lib = await boot(page);
  for (let i = 1; i <= 5; i++) assert.equal(lib.cards.filter(c => c.name === `stop-${i}`).length, 1);
  check('Three failures in a row stop the run (3 실패 · 2 미처리, nothing saved); retry finishes all five exactly once');
}

// ---------------------------------------------------------------------------------------------
// 3. Fifty images at once with a template.
{
  const files = []; for (let i = 1; i <= 50; i++) files.push(await makeImage(`bulk-${String(i).padStart(2, '0')}.png`, `BULK ${i}`, `hsl(${i * 7}, 35%, 28%)`));
  const form = await openRegistration(page);
  await pick(form, files);
  await form.getByLabel('등록 템플릿 선택').selectOption({ label: 'E2E 주문 템플릿' });
  await form.getByRole('button', { name: '템플릿 적용' }).click();
  assert.equal(await form.getByLabel('카드 유형', { exact: true }).inputValue(), 'spell');
  assert.equal(await form.getByLabel('등록 사용할 자원', { exact: true }).inputValue(), counter.id);
  await form.getByRole('radio', { name: '무소모', exact: true }).check();
  const startedAt = Date.now();
  await registerBatch(form, 50);
  const seconds = (Date.now() - startedAt) / 1000;
  const lib = await boot(page); const deck = lib.decks.find(d => d.id === hero.activeDeckId);
  const bulk = lib.cards.filter(c => /^bulk-\d\d$/.test(c.name));
  assert.equal(bulk.length, 50); assert(bulk.every(c => c.kind === 'spell' && c.spellLevel === 1 && deck.cardIds.includes(c.id)));
  assert.equal(readDb(userData, `SELECT count(*) AS n FROM character_cost_overrides WHERE character_id=? AND card_id IN (${bulk.map(() => '?').join(',')})`, hero.id, ...bulk.map(c => c.id))[0].n, 50);
  check('Fifty images: template applied (kind, level, resource found by name), all 50 saved into the active deck', { seconds });
}
assert.deepEqual(errors, []);
await app.close();

// ---------------------------------------------------------------------------------------------
// 4. Restart: the template survives and fills the single-card form; old data untouched; database sound.
{
  ({ app, page, errors } = await launch(userData));
  const form = await openRegistration(page);
  await form.getByLabel('등록 템플릿 선택').selectOption({ label: 'E2E 주문 템플릿' });
  await form.getByRole('button', { name: '템플릿 적용' }).click();
  assert.equal(await form.getByLabel('카드 유형', { exact: true }).inputValue(), 'spell');
  assert.equal(await form.getByLabel('주문 레벨 (선택)', { exact: true }).inputValue(), '1');
  assert.equal(await form.getByRole('radio', { name: '사용 횟수', exact: true }).isChecked(), true);
  assert.equal(await form.getByLabel('등록 사용할 자원', { exact: true }).inputValue(), counter.id);
  await form.getByLabel('카드 이름', { exact: true }).fill('템플릿 한 장');
  await form.getByRole('button', { name: '카드 저장', exact: true }).click(); await form.waitFor({ state: 'hidden' });
  const lib = await boot(page); const card = lib.cards.find(c => c.name === '템플릿 한 장');
  assert(card && card.kind === 'spell' && card.spellLevel === 1);
  const snapshot = await page.evaluate(async id => (await window.desktop.getResources(id)).value, hero.id);
  assert(snapshot.bindings.some(b => b.cardId === card.id && b.resourceInstanceId === counter.id));
  const now = readDb(userData, 'SELECT * FROM card_definitions ORDER BY id');
  for (const old of originalCards) assert.deepEqual(now.find(row => row.id === old.id), old, old.name);
  const hashes = await assetHashes(userData); for (const [name, hash] of Object.entries(originalAssets)) assert.equal(hashes[name], hash, name);
  assert.deepEqual(readDb(userData, 'PRAGMA foreign_key_check'), []); assert.equal(readDb(userData, 'PRAGMA quick_check')[0].quick_check, 'ok');
  assert.equal(readDb(userData, "SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'e2e_%'")[0].n, 0);
  assert.deepEqual(errors, []);
  await app.close();
  check('After restart: the template persists and fills the single-card form (spell 1레벨, 사용 횟수 bound to the same resource); pre-existing cards and images unchanged; foreign keys and quick_check ok');
}

// ---------------------------------------------------------------------------------------------
// 5. The batch form fits at 100/125/150% (1280×720).
for (const zoom of [1, 1.25, 1.5]) {
  const data = await freshData();
  ({ app, page } = await launch(data, { width: 1280, height: 720, zoom }));
  const form = await openRegistration(page);
  await pick(form, realImages.slice(0, 3));
  const box = await form.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  assert(box.sw <= box.cw + 1, `no horizontal overflow at ${zoom}: ${JSON.stringify(box)}`);
  await row(form, 1).getByRole('button', { name: /개별 설정$/ }).click();
  const editor = form.getByRole('group', { name: /개별 설정$/ }); await editor.getByLabel('개별 비용 방식').selectOption('own');
  const wide = await form.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  assert(wide.sw <= wide.cw + 1, `per-card editor fits at ${zoom}: ${JSON.stringify(wide)}`);
  const action = form.getByRole('button', { name: '3장 등록', exact: true }); assert(await action.isVisible(), `3장 등록 visible at ${zoom}`);
  await form.getByRole('button', { name: '취소', exact: true }).click(); await form.waitFor({ state: 'hidden' });
  await app.close();
}
check('Batch form with an open per-card editor has no horizontal overflow and keeps “N장 등록” visible at 100/125/150% (1280×720)');

if (server) await server.close();
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, checks: report.checks.length, run }, null, 2));
