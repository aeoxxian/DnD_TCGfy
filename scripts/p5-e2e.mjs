// P5 end-to-end checks on Windows: offline play, crash consistency, ZIP export,
// restore into a brand-new profile (SPEC acceptance #13) and copy-import.
// Uses COPIES of repository-data/user-data under artifacts/; never touches %APPDATA%.
// Run against the built bundle (`npm run build`) or a packaged app via DND_TCG_EXECUTABLE.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = resolve('artifacts'); await mkdir(root, { recursive: true });
const run = await mkdtemp(join(root, 'p5-e2e-'));
const sourceData = join(run, 'source-data'); const freshData = join(run, 'new-profile');
await cp(resolve('repository-data/user-data'), sourceData, { recursive: true });
await mkdir(freshData, { recursive: true });
const zipPath = join(run, 'backup.zip');
const binary = process.env.DND_TCG_EXECUTABLE;
const report = { target: binary ? 'packaged-exe' : 'built-bundle', steps: [], externalRequests: [], pageErrors: [] };
const step = (name, details = {}) => { report.steps.push({ name, ...details }); console.log(`✓ ${name}`); };

async function launch(userData, attempts = 1) {
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  // After a hard kill, orphaned Chromium children can hold the single-instance lock for a moment.
  for (let attempt = 1; !app; attempt++) {
    try { app = await electron.launch({ ...(binary ? { executablePath: binary, args: [] } : { args: ['.'] }), env, cwd: process.cwd(), timeout: 45000 }); await app.firstWindow(); }
    catch (error) { app = undefined; if (attempt >= attempts) throw error; await new Promise(done => setTimeout(done, 2000)); }
  }
  const page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  page.on('request', request => { const { protocol } = new URL(request.url()); if (!['app:', 'data:', 'blob:', 'devtools:'].includes(protocol)) report.externalRequests.push(request.url()); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1366, 768));
  await page.waitForSelector('.board');
  return { app, page };
}
const slotText = page => page.locator('.resource-status-row strong').first().textContent();
const historyCount = async page => Number((await page.locator('.resource-history > summary').textContent()).match(/(\d+)\s*$/)[1]);
async function waitSlotChange(page, before) { await page.waitForFunction(prev => document.querySelector('.resource-status-row strong')?.textContent !== prev, before, { timeout: 15000 }); }
async function useSelected(page) {
  await page.waitForFunction(() => document.querySelector('.use-button') && !document.querySelector('.use-button').disabled, null, { timeout: 15000 });
  const before = await slotText(page);
  await page.getByRole('button', { name: '사용 확정', exact: true }).click();
  await waitSlotChange(page, before);
}
async function openBackupDialog(page) {
  await page.getByRole('button', { name: '관리', exact: true }).click();
  await page.getByRole('button', { name: '백업·복원', exact: true }).click();
  return page.getByRole('dialog', { name: '데이터 백업·복원' });
}
const sha = data => createHash('sha256').update(data).digest('hex');
function snapshot(folder) {
  const db = new DatabaseSync(join(folder, 'data', 'app.sqlite3'), { readOnly: true });
  try {
    const rows = sql => db.prepare(sql).all();
    const assets = rows('SELECT id, relative_path, sha256 FROM assets ORDER BY id');
    return {
      cards: rows('SELECT id, name, image_asset_id, attributes_json, archived_at FROM card_definitions ORDER BY id'),
      characters: rows('SELECT * FROM character_profiles ORDER BY id'), decks: rows('SELECT * FROM deck_cards ORDER BY deck_id, position'),
      resources: rows('SELECT id, overrides_json FROM resource_instances ORDER BY id'), events: rows('SELECT id, event_type, payload_json FROM play_events ORDER BY id'),
      settings: rows("SELECT key, value_json FROM settings WHERE key IN ('preferences','appearance','resource_display','library_state') ORDER BY key"),
      assets, files: assets.map(asset => existsSync(join(folder, asset.relative_path)) ? sha(readFileSync(join(folder, asset.relative_path))) : 'missing'),
    };
  } finally { db.close(); }
}

// 1. Offline play, then a hard crash right after a confirmed use.
{
  const { app, page } = await launch(sourceData);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.locator('.card-button').first().click();
  await useSelected(page);
  await page.getByRole('button', { name: '짧은 휴식', exact: true }).click();
  const before = await slotText(page);
  await page.getByRole('button', { name: '회복 확정', exact: true }).click();
  await waitSlotChange(page, before);
  await useSelected(page);
  const images = await page.evaluate(() => [...document.querySelectorAll('.card-face img')].filter(img => img.complete).map(img => img.naturalWidth > 0));
  assert(images.length > 0 && images.every(Boolean), 'card images load from the local protocol while offline');
  const expected = { slot: await slotText(page), history: await historyCount(page) };
  step('offline: card use, short rest and second use worked with the network cut', expected);
  assert(existsSync(join(sourceData, 'backups', 'auto')) && readdirSync(join(sourceData, 'backups', 'auto')).some(name => /^app-\d{8}-\d{6}\.sqlite3$/.test(name)));
  step('auto backup: a daily database snapshot was created on start-up');
  const pid = app.process().pid;
  const closed = new Promise(done => app.process().once('exit', done));
  // Abrupt termination of the whole app (like "End process tree"): no shutdown handlers run.
  execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  await closed;
  const again = await launch(sourceData, 5);
  await again.page.waitForFunction(() => document.querySelector('.resource-status-row strong'));
  const after = { slot: await slotText(again.page), history: await historyCount(again.page) };
  assert.deepEqual(after, expected, 'the last confirmed use survives a hard kill');
  step('crash: process killed after the last confirmed use; state and history were intact after restart', after);

  // 2. ZIP export through the real dialog flow (the native save dialog is answered by the test).
  await again.app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, zipPath);
  const backupDialog = await openBackupDialog(again.page);
  await backupDialog.getByRole('button', { name: 'ZIP으로 내보내기…', exact: true }).click();
  await backupDialog.getByText('저장했습니다').waitFor({ timeout: 60000 });
  assert(existsSync(zipPath));
  step('export: ZIP written from the backup dialog', { bytes: (await readFile(zipPath)).length });
  await again.app.close();
}

// 3. Restore into a brand-new local profile and compare everything (SPEC #13).
{
  const { app, page } = await launch(freshData);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, zipPath);
  const backupDialog = await openBackupDialog(page);
  await backupDialog.getByRole('button', { name: '백업 파일 열기…', exact: true }).click();
  await backupDialog.getByLabel('복원 미리보기').waitFor({ timeout: 60000 });
  assert.equal(await backupDialog.getByRole('radio', { name: /현재 데이터를 백업으로 교체/ }).isChecked(), true, 'an empty profile defaults to replacement');
  await backupDialog.getByLabel('교체 확인 문구').fill('복원');
  const exited = new Promise(done => app.process().once('exit', done));
  await backupDialog.getByRole('button', { name: '교체하고 다시 시작', exact: true }).click();
  await exited;
  const reopened = await launch(freshData, 5);
  await reopened.page.waitForFunction(() => document.querySelectorAll('.card-face img').length > 0);
  const status = await reopened.page.getByRole('status').first().textContent();
  assert.match(status, /복원했습니다/);
  await reopened.app.close();
  const original = snapshot(sourceData); const restored = snapshot(freshData);
  assert.deepEqual(restored, original, 'restored profile equals the source library');
  assert(readdirSync(join(freshData, 'backups')).some(name => name.startsWith('replaced-')), 'the replaced (empty) profile data is preserved');
  step('restore (replace) into a new profile: cards, images (SHA-256), characters, decks, resources, history and settings are identical', { cards: restored.cards.length, assets: restored.assets.length, events: restored.events.length });
}

// 4. Copy-import into an existing library.
{
  const before = snapshot(sourceData).cards.filter(card => !card.archived_at).length;
  const { app, page } = await launch(sourceData);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, zipPath);
  const backupDialog = await openBackupDialog(page);
  await backupDialog.getByRole('button', { name: '백업 파일 열기…', exact: true }).click();
  await backupDialog.getByLabel('복원 미리보기').waitFor({ timeout: 60000 });
  assert.equal(await backupDialog.getByRole('radio', { name: /카드만 새로 복제해 추가/ }).isChecked(), true, 'a non-empty library defaults to copy mode');
  await backupDialog.getByRole('button', { name: '카드 추가', exact: true }).click();
  await backupDialog.getByText(/카드 \d+장을 새로 추가했습니다/).waitFor({ timeout: 60000 });
  await app.close();
  const after = snapshot(sourceData).cards.filter(card => !card.archived_at).length;
  assert.equal(after, before * 2);
  step('restore (copy): active cards added as new copies next to the existing library', { before, after });
}

assert.deepEqual(report.externalRequests, [], 'no request ever left the app protocol');
assert.deepEqual(report.pageErrors, []);
await writeFile(join(run, 'p5-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, artifacts: run }, null, 2));
