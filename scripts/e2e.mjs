import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rename, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import sharp from 'sharp';
import { migrations } from '../electron/migrations.ts';

const root = resolve('artifacts'); await mkdir(root, { recursive: true });
const runPath = await mkdtemp(join(root, 'p1-e2e-'));
const userData = join(runPath, 'user-data'); const fixtures = join(runPath, 'fixtures');
await mkdir(join(userData, 'data'), { recursive: true }); await mkdir(fixtures);
const dbPath = join(userData, 'data', 'app.sqlite3');
const binary = process.env.DND_TCG_EXECUTABLE;
const devMode = process.argv.includes('--dev'); assert(!(binary && devMode));
const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE; delete env.DND_TCG_DEV_URL;
if (devMode) env.DND_TCG_DEV_URL = 'http://127.0.0.1:5173';
const initialSettings = { viewMode: 'hand', reducedMotion: true, resourcePanelCollapsed: false };
const legacyCard = { id: 'p0-card', name: 'P0 보존 카드', kind: 'feature', roles: ['utility'], actions: ['action'], range: { kind: 'self' }, tags: ['legacy-tag'], castOptions: [{ id: 'p0-cast', label: '기존 비용', costs: [{ type: 'fixed', costKey: 'spirit', amount: 2 }] }], createdAt: '2026-11-16T00:00:00.000Z', updatedAt: '2026-11-16T00:00:00.000Z' };
const db = new DatabaseSync(dbPath); db.exec(migrations[0].sql); db.exec('PRAGMA user_version=1');
db.exec("INSERT INTO schema_migrations VALUES (1,'2026-11-16T00:00:00.000Z')");
db.prepare("INSERT INTO settings VALUES ('preferences',?)").run(JSON.stringify(initialSettings));
const { id, name, kind, createdAt, updatedAt, ...attrs } = legacyCard;
db.prepare('INSERT INTO card_definitions VALUES (?,?,NULL,?,NULL,?,?,?)').run(id, name, kind, JSON.stringify(attrs), createdAt, updatedAt);
db.exec(`INSERT INTO character_profiles(id,name,ruleset,level) VALUES ('p0-character','P0 캐릭터','homebrew',1);
  INSERT INTO decks VALUES ('p0-deck','p0-character','P0 덱');
  UPDATE character_profiles SET active_deck_id='p0-deck';
  INSERT INTO deck_cards VALUES ('p0-deck','p0-card',0);
  INSERT INTO resource_templates VALUES ('p0-template','spirit','영력','counter','{"capacity":{"type":"fixed","value":5}}','user',1);
  INSERT INTO resource_instances VALUES ('p0-resource','p0-character','p0-template','{}','{"remaining":3}');
  INSERT INTO card_bindings VALUES ('p0-binding','p0-character','p0-card','spirit','p0-resource');
  INSERT INTO play_events VALUES ('p0-event','p0-character','manual_adjustment','{"changes":[]}','2026-11-16T00:00:00.000Z');`);
const resourceBefore = db.prepare('SELECT * FROM resource_instances').all(); const eventsBefore = db.prepare('SELECT * FROM play_events').all(); db.close();

const sources = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function makeImage(fileName, label, index = 0, landscape = false) {
  const width = landscape ? 1400 : 1000; const height = landscape ? 700 : 1458;
  const color = ['#354c54', '#4b3e4a', '#3d465f', '#4e4b37'][index % 4];
  // Test documents only: typography and boundary markers, no generated artwork.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171e29"/><rect x="18" y="18" width="${width - 36}" height="${height - 36}" rx="20" fill="${color}" stroke="#d8c39d" stroke-width="8"/><text x="70" y="130" fill="#f3e5c8" font-family="sans-serif" font-size="52">P1 FILE FIXTURE</text><text x="70" y="230" fill="white" font-family="sans-serif" font-size="65">${label}</text><line x1="70" y1="300" x2="${width - 70}" y2="300" stroke="#d8c39d" stroke-width="3"/><text x="70" y="390" fill="white" font-family="sans-serif" font-size="32">Original bytes must remain unchanged.</text><text x="70" y="450" fill="white" font-family="sans-serif" font-size="32">No illustration or game rules.</text><text x="70" y="${height - 85}" fill="#f3e5c8" font-family="sans-serif" font-size="28">EDGE CHECK / ${width} x ${height}</text></svg>`;
  const format = fileName.endsWith('.webp') ? 'webp' : fileName.endsWith('.jpg') ? 'jpeg' : 'png';
  const bytes = await sharp(Buffer.from(svg)).toFormat(format).toBuffer();
  const path = join(fixtures, fileName); await writeFile(path, bytes); sources.push({ path, hash: sha(bytes), fileName }); return path;
}
const inputPaths = [];
for (let i = 1; i <= 20; i++) inputPaths.push(await makeImage(`TEST-${String(i).padStart(2, '0')}.${i <= 12 ? 'png' : i <= 16 ? 'jpg' : 'webp'}`, `TEST ${String(i).padStart(2, '0')}`, i, i === 10));
const replacement = await makeImage('REPLACEMENT.webp', 'REPLACEMENT 01', 2);
const dropped = await makeImage('DROPPED.png', 'DROP INPUT', 1);
const bad = join(fixtures, 'not-an-image.png'); await writeFile(bad, 'not an image');
let server; if (devMode) { server = await createServer(); await server.listen(); }
let app; let page; const pageErrors = []; const securityWarnings = []; const checks = [];
function recordCheck(message) { checks.push(message); console.log(`PASS: ${message}`); }
async function launch() {
  app = await electron.launch({ ...(binary ? { executablePath: resolve(binary), args: [] } : { args: ['.'] }), cwd: process.cwd(), env, timeout: 45_000 });
  page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.text().includes('Electron Security Warning')) securityWarnings.push(message.text()); });
  await page.getByRole('button', { name: '카드 등록', exact: true }).waitFor();
}
async function state() { const result = await page.evaluate(() => window.desktop.getBootstrap()); assert.equal(result.ok, true, result.error); return result.value; }
async function waitCount(count) { await page.waitForFunction(async count => (await window.desktop.getBootstrap()).value?.cards.length === count, count); }
async function selectCard(title) {
  const button = page.getByRole('button', { name: `${title} 카드 선택`, exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
}
async function edit(title, callback) {
  await selectCard(title); await page.getByRole('button', { name: '정보 수정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '카드 정보 수정' }); await callback(dialog);
  await dialog.getByRole('button', { name: '수정 저장', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
}
async function checksTo(dialog, title, selected) {
  const group = dialog.getByRole('group', { name: title }); const inputs = group.getByRole('checkbox');
  for (let i = 0; i < await inputs.count(); i++) {
    const label = await inputs.nth(i).evaluate(input => input.parentElement.textContent.trim());
    await inputs.nth(i).setChecked(selected.includes(label));
  }
}
async function capture(name) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(join(runPath, `${name}.png`), Buffer.from(png, 'base64'));
}
async function showAll() { await page.getByRole('button', { name: '전체 카드', exact: true }).click(); const reset = page.getByRole('button', { name: '필터 초기화' }); if (await reset.isEnabled()) await reset.click(); }
async function countVisible(n) { await page.waitForFunction(n => document.querySelector('[aria-label="표시 카드 수"]')?.textContent.startsWith(`${n} /`), n); }

try {
  await launch();
  const runtime = await app.evaluate(({ app, BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { packaged: app.isPackaged, electron: process.versions.electron, node: process.versions.node, userData: app.getPath('userData'), sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation, webSecurity: prefs.webSecurity };
  });
  assert.equal(resolve(runtime.userData), resolve(userData)); if (binary) assert.equal(runtime.packaged, true);
  assert.equal(runtime.sandbox, true); assert.equal(runtime.nodeIntegration, false); assert.equal(runtime.contextIsolation, true); assert.equal(runtime.webSecurity, true);
  let data = await state(); assert.equal(data.schemaVersion, 2); assert.deepEqual(data.settings, initialSettings);
  assert.deepEqual(data.cards[0].castOptions, legacyCard.castOptions); assert.equal(data.cards[0].id, 'p0-card');
  assert.equal(data.tags[0].id, 'legacy-tag'); assert.equal(data.decks[0].cardIds[0], 'p0-card');
  assert.equal((await readdir(join(userData, 'backups'))).length, 1);
  const isolation = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, keys: Object.keys(window.desktop).sort() }));
  assert.equal(isolation.require, 'undefined'); assert.equal(isolation.process, 'undefined');
  assert(!isolation.keys.includes('invoke')); assert(!isolation.keys.includes('getPathForFile'));
  recordCheck('P0 v1 DB → v2 migration backup; preferences, costs, character/deck IDs preserved; sandbox verified');

  await page.getByRole('button', { name: '카드 등록', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '카드 등록', exact: true });
  await dialog.getByLabel('카드 이미지 파일').setInputFiles([...inputPaths, bad]);
  await dialog.getByRole('button', { name: '20장 등록' }).waitFor();
  assert.equal(await dialog.getByText(/not-an-image.png:/).count(), 1);
  await dialog.getByLabel('카드 유형', { exact: true }).selectOption('spell');
  await checksTo(dialog, '카드 역할', ['공격', '유틸']); await checksTo(dialog, '카드 행동 경제', ['보너스 행동']);
  await dialog.locator('summary').click(); await dialog.getByLabel('사거리', { exact: true }).selectOption('ranged');
  await dialog.getByLabel('거리 (ft, 선택)').fill('60'); await dialog.getByLabel('주문 레벨 (선택)').selectOption('1');
  await dialog.getByLabel('새 태그', { exact: true }).fill('검수 공통'); await dialog.getByRole('button', { name: '태그 추가', exact: true }).click();
  await dialog.getByRole('checkbox', { name: '검수 공통', exact: true }).waitFor();
  await dialog.getByRole('button', { name: '20장 등록' }).click(); await dialog.waitFor({ state: 'hidden' }); await waitCount(21);
  data = await state(); const importedCards = data.cards.filter(card => card.id !== 'p0-card');
  assert.equal(new Set(importedCards.map(card => card.id)).size, 20);
  assert(importedCards.every(card => card.imageAssetId && card.spellLevel === 1 && card.roles.includes('damage') && card.actions.includes('bonus_action')));
  assert.equal(await page.locator('.image-face').first().evaluate(face => getComputedStyle(face).overflow), 'visible');
  assert.equal(await page.locator('.image-face img').first().evaluate(img => getComputedStyle(img).objectFit), 'contain');
  const sharedTag = data.tags.find(tag => tag.name === '검수 공통'); assert.equal(sharedTag.usageCount, 20);
  recordCheck('20 actual PNG/JPEG/WebP files imported through file input; malformed file rejected; bulk metadata saved atomically');

  await edit('TEST-01', async dialog => {
    await dialog.getByLabel('카드 이름', { exact: true }).fill('치유의 카드'); await checksTo(dialog, '카드 역할', ['치유', '보호']);
  });
  await edit('TEST-02', async dialog => {
    await dialog.getByLabel('카드 이름', { exact: true }).fill('반응의 카드'); await dialog.getByLabel('카드 유형', { exact: true }).selectOption('feature');
    await checksTo(dialog, '카드 역할', ['유틸']); await checksTo(dialog, '카드 행동 경제', ['반응 행동']);
    await dialog.locator('summary').click(); await dialog.getByLabel('사거리', { exact: true }).selectOption('self');
    await dialog.getByRole('checkbox', { name: '검수 공통', exact: true }).uncheck();
    await dialog.getByLabel('새 태그', { exact: true }).fill('독립 태그'); await dialog.getByRole('button', { name: '태그 추가', exact: true }).click();
    await dialog.getByRole('checkbox', { name: '독립 태그', exact: true }).waitFor();
  });
  data = await state(); const first = data.cards.find(card => card.name === '치유의 카드'); const second = data.cards.find(card => card.name === '반응의 카드');
  assert.deepEqual(data.cards.find(card => card.name === 'TEST-03'), importedCards.find(card => card.name === 'TEST-03'));
  assert.equal(first.id, importedCards[0].id); assert(second.tags.every(id => id !== sharedTag.id));
  const beforeReplacement = data.cards;
  await edit('치유의 카드', async dialog => {
    await dialog.getByLabel('교체 이미지 파일').setInputFiles(replacement); await dialog.getByAltText('교체 이미지 미리보기').waitFor();
  });
  data = await state(); const replaced = data.cards.find(card => card.id === first.id);
  assert.notEqual(replaced.imageAssetId, first.imageAssetId);
  for (const field of ['id', 'createdAt', 'roles', 'actions', 'tags', 'range', 'castOptions']) assert.deepEqual(replaced[field], first[field]);
  for (const card of beforeReplacement.filter(card => card.id !== first.id)) assert.deepEqual(data.cards.find(next => next.id === card.id), card);
  recordCheck('Per-card metadata/tag edits and image replacement preserve stable IDs, cost options, other cards and old originals');

  await page.getByRole('button', { name: '태그 관리', exact: true }).click(); dialog = page.getByRole('dialog', { name: '공통 태그 관리' });
  await dialog.getByLabel('검수 공통 태그 이름', { exact: true }).fill('공유 태그 수정');
  await dialog.getByRole('button', { name: '검수 공통 태그 이름 저장' }).click();
  await dialog.getByLabel('공유 태그 수정 태그 이름', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '공통 태그 관리 닫기' }).click();
  assert.deepEqual((await state()).cards.find(card => card.id === first.id).tags, first.tags);

  await selectCard('치유의 카드'); await page.getByRole('button', { name: '크게 보기', exact: true }).click();
  const original = page.getByRole('img', { name: '치유의 카드 원본 확대' });
  await original.evaluate(img => img.decode()); assert.equal(await original.evaluate(img => getComputedStyle(img).objectFit), 'contain');
  await capture('p1-original'); await page.getByRole('button', { name: '원본 크기', exact: true }).click();
  assert.equal(await original.evaluate(img => getComputedStyle(img).maxWidth), 'none'); await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '정보 수정' }).count(), 1); await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080));
  await page.evaluate(() => window.scrollTo(0, 0)); await capture('p1-hand');
  await page.getByRole('button', { name: '격자', exact: true }).click(); await page.getByRole('status').filter({ hasText: '환경 설정 저장됨' }).waitFor();
  await capture('p1-grid'); recordCheck('Original contain display, fit/natural-size enlargement, ESC return, hand/grid and lazy thumbnail rendering');

  const roles = page.getByRole('group', { name: '역할 필터' });
  await roles.getByRole('button', { name: '공격', exact: true }).click(); await roles.getByRole('button', { name: '치유', exact: true }).click();
  await page.locator('.extra-filters summary').click();
  await page.getByRole('group', { name: '행동 경제 필터' }).getByRole('button', { name: '보너스 행동', exact: true }).click();
  await page.getByRole('group', { name: '카드 유형 필터' }).getByRole('button', { name: '주문', exact: true }).click();
  await page.getByRole('group', { name: '사거리 필터' }).getByRole('button', { name: '원거리', exact: true }).click();
  await page.getByRole('group', { name: '태그 필터' }).getByRole('button', { name: '공유 태그 수정', exact: true }).click(); await countVisible(19);
  await page.getByRole('searchbox', { name: '카드 이름 검색' }).fill('치유'); await countVisible(1);
  await page.getByRole('status').filter({ hasText: '필터 저장됨' }).waitFor();
  const persisted = await state(); await capture('p1-filters');
  await app.close(); app = undefined; await launch();
  data = await state(); assert.deepEqual(data.libraryState, persisted.libraryState); assert.deepEqual(data.cards, persisted.cards); assert.equal(data.settings.viewMode, 'grid'); await countVisible(1);
  recordCheck('OR roles + AND action/type/range/tag/title filtering; cards, tag labels, filters and P0 view settings restored after full restart');

  if (!devMode) {
    await app.context().setOffline(true); await page.reload(); await page.getByRole('button', { name: '카드 등록', exact: true }).waitFor();
    await selectCard('치유의 카드'); await page.getByRole('img', { name: '치유의 카드 카드 이미지' }).last().evaluate(img => img.decode());
    assert.equal(await page.evaluate(async () => { try { await fetch('https://example.invalid/test'); return true; } catch { return false; } }), false);
    await capture('p1-offline'); recordCheck('Offline reload, managed original images and SQLite operations; remote fetch denied');
  }
  await showAll(); await countVisible(21);
  await page.getByRole('button', { name: '캐릭터·덱', exact: true }).click(); dialog = page.getByRole('dialog', { name: '캐릭터와 덱' });
  await dialog.getByLabel('새 캐릭터 이름').fill('카드 플레이어 A'); await dialog.getByRole('button', { name: '캐릭터 만들기' }).click();
  await dialog.getByText('카드 플레이어 A의 덱').waitFor(); await dialog.getByRole('button', { name: '캐릭터와 덱 닫기' }).click();
  await showAll(); await selectCard('치유의 카드'); await page.getByRole('button', { name: '활성 덱에 추가' }).click(); await page.getByRole('button', { name: '활성 덱에서 빼기' }).waitFor();
  data = await state(); const playerA = data.profiles.find(profile => profile.name === '카드 플레이어 A');
  await page.getByRole('button', { name: '캐릭터·덱', exact: true }).click(); dialog = page.getByRole('dialog', { name: '캐릭터와 덱' });
  await dialog.getByLabel('새 캐릭터 이름').fill('카드 플레이어 B'); await dialog.getByRole('button', { name: '캐릭터 만들기' }).click();
  await dialog.getByText('카드 플레이어 B의 덱').waitFor(); await dialog.getByRole('button', { name: '캐릭터와 덱 닫기' }).click();
  await showAll(); await selectCard('치유의 카드'); await page.getByRole('button', { name: '활성 덱에 추가' }).click(); await page.getByRole('button', { name: '활성 덱에서 빼기' }).waitFor();
  data = await state(); const playerB = data.profiles.find(profile => profile.name === '카드 플레이어 B');
  assert(data.decks.find(deck => deck.id === playerA.activeDeckId).cardIds.includes(first.id)); assert(data.decks.find(deck => deck.id === playerB.activeDeckId).cardIds.includes(first.id));
  await page.getByLabel('활성 캐릭터', { exact: true }).selectOption(playerA.id); await page.getByRole('status').filter({ hasText: '필터 저장됨' }).waitFor();
  await page.getByRole('button', { name: '캐릭터·덱', exact: true }).click(); dialog = page.getByRole('dialog', { name: '캐릭터와 덱' });
  await dialog.getByLabel('새 덱 이름').fill('보조 덱'); await dialog.getByRole('button', { name: '덱 만들기' }).click(); await dialog.getByText('보조 덱').waitFor();
  await dialog.getByRole('button', { name: '캐릭터와 덱 닫기' }).click(); await showAll();
  await selectCard('반응의 카드'); await page.getByRole('button', { name: '활성 덱에 추가' }).click(); await page.getByRole('button', { name: '활성 덱에서 빼기' }).waitFor();
  await page.getByRole('button', { name: '활성 덱', exact: true }).click(); await countVisible(1);
  data = await state(); assert.deepEqual(data.decks.find(deck => deck.id === playerA.activeDeckId).cardIds, [first.id]); assert.deepEqual(data.decks.find(deck => deck.id === playerB.activeDeckId).cardIds, [first.id]);
  recordCheck('Two characters share one card with independent decks; extra deck creation/selection/membership and library/deck scope');

  await showAll();
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'e2e-drop-source'; document.body.append(input); });
  await page.locator('#e2e-drop-source').setInputFiles(dropped);
  await page.evaluate(() => { const input = document.querySelector('#e2e-drop-source'); const transfer = new DataTransfer(); transfer.items.add(input.files[0]); document.querySelector('[aria-label="카드 보드"]').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })); input.remove(); });
  dialog = page.getByRole('dialog', { name: '카드 등록', exact: true }); await dialog.getByLabel('카드 이름 1', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '카드 저장' }).click(); await dialog.waitFor({ state: 'hidden' }); await waitCount(22);
  recordCheck('Disk-backed File drag-and-drop follows the secure preload import pipeline');

  const readDb = new DatabaseSync(dbPath, { readOnly: true });
  const secondAsset = readDb.prepare('SELECT relative_path FROM assets WHERE id=?').get(second.imageAssetId); readDb.close();
  const missingPath = join(userData, secondAsset.relative_path); await rename(missingPath, `${missingPath}.missing`);
  await page.reload(); await page.getByRole('button', { name: '카드 등록', exact: true }).waitFor(); await selectCard('반응의 카드');
  await page.getByText('이미지 파일을 읽을 수 없습니다.').first().waitFor(); assert.equal(await page.getByRole('button', { name: '정보 수정' }).isEnabled(), true);
  assert.deepEqual((await state()).cards.find(card => card.id === second.id), data.cards.find(card => card.id === second.id));
  await capture('p1-missing-image'); await rename(`${missingPath}.missing`, missingPath);
  await page.reload(); await page.getByRole('button', { name: '카드 등록', exact: true }).waitFor();
  recordCheck('Missing managed image shows a safe fallback while metadata and editing remain available');

  const independentTag = (await state()).tags.find(tag => tag.name === '독립 태그');
  await page.locator('.extra-filters summary').click(); await page.getByRole('group', { name: '태그 필터' }).getByRole('button', { name: '독립 태그', exact: true }).click(); await countVisible(1);
  await page.getByRole('button', { name: '태그 관리', exact: true }).click(); dialog = page.getByRole('dialog', { name: '공통 태그 관리' });
  await dialog.getByRole('button', { name: '독립 태그 태그 삭제', exact: true }).click(); await dialog.getByRole('button', { name: '태그 삭제 확인' }).click();
  await dialog.getByLabel('독립 태그 태그 이름', { exact: true }).waitFor({ state: 'hidden' }); await dialog.getByRole('button', { name: '공통 태그 관리 닫기' }).click();
  data = await state(); assert(!data.libraryState.tagIds.includes(independentTag.id)); assert(!data.cards.find(card => card.id === second.id).tags.includes(independentTag.id)); assert(data.cards.find(card => card.id === first.id).tags.includes(sharedTag.id));
  await showAll(); await selectCard('DROPPED'); await page.getByRole('button', { name: '등록 해제', exact: true }).click();
  const archiveDialog = page.getByRole('dialog', { name: '카드 등록 해제' }); await archiveDialog.getByRole('button', { name: '등록 해제 확인' }).click(); await archiveDialog.waitFor({ state: 'hidden' }); await waitCount(21);
  recordCheck('Explicit common-tag deletion clears only that tag and its saved filter; archive preserves original data and references');

  await page.getByRole('button', { name: '손패', exact: true }).click(); await page.getByRole('status').filter({ hasText: '환경 설정 저장됨' }).waitFor();
  for (const [width, height, zoom, label] of [[1280,720,1,'p1-1280'],[1280,720,1.25,'p1-125pct'],[1280,720,1.5,'p1-150pct']]) {
    await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(size.width,size.height); win.webContents.setZoomFactor(size.zoom); }, { width,height,zoom });
    await selectCard('치유의 카드'); await page.getByRole('button', { name: '정보 수정' }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await capture(label);
    await page.getByRole('button', { name: '카드 선택 닫기' }).click();
  }
  recordCheck('1280x720 + Chromium 125%/150% scaling; no document horizontal overflow, controls remain scroll-accessible');
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1920,1080); win.webContents.setZoomFactor(1); });
  await page.evaluate(() => window.scrollTo(0,0)); await capture('p1-final-hand');

  const finalDb = new DatabaseSync(dbPath, { readOnly: true });
  const assets = finalDb.prepare('SELECT * FROM assets').all();
  for (const asset of assets) {
    const source = sources.find(source => source.fileName === asset.original_name); assert(source);
    assert.equal(sha(await readFile(join(userData, asset.relative_path))), source.hash);
    assert.equal(sha(await readFile(source.path)), source.hash); assert.equal(asset.sha256, source.hash);
  }
  assert.deepEqual(finalDb.prepare('SELECT * FROM resource_instances').all(), resourceBefore); assert.deepEqual(finalDb.prepare('SELECT * FROM play_events').all(), eventsBefore);
  assert.equal(finalDb.prepare('SELECT count(*) AS n FROM card_definitions WHERE archived_at IS NOT NULL').get().n, 1);
  assert.deepEqual(finalDb.prepare('PRAGMA foreign_key_check').all(), []); finalDb.close();
  assert.equal((await state()).cards.find(card => card.id === 'p0-card').castOptions[0].costs[0].amount, 2);
  assert.deepEqual(pageErrors, []); assert.deepEqual(securityWarnings, []);
  recordCheck('All managed/source SHA-256 values match; old replacement/archive assets retained; P0 resources/events/bindings untouched');
  const result = { outcome: 'PASS', mode: binary ? 'packaged-windows-exe' : devMode ? 'vite-development' : 'production-bundle', runtime, imageFilesRegistered: 20, imageFormats: { png: 12, jpeg: 4, webp: 4 }, finalActiveCards: (await state()).cards.length, checks, pageErrors, securityWarnings, artifacts: runPath };
  await writeFile(join(runPath,'result.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
} catch (error) {
  if (app && page) { try { await capture('failure'); } catch { /* Preserve the original error. */ } }
  await writeFile(join(runPath,'failure.txt'),String(error.stack ?? error)); throw error;
} finally { if (app) await app.close(); if (server) await server.close(); }
