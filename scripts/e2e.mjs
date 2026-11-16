import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';

const outputRoot = resolve('artifacts');
await mkdir(outputRoot, { recursive: true });
const runPath = await mkdtemp(join(outputRoot, 'e2e-'));
const userData = join(runPath, 'user-data');
const binary = process.env.DND_TCG_EXECUTABLE;
const devMode = process.argv.includes('--dev');
assert(!(binary && devMode), 'Development mode uses the Electron project entry.');
const childEnv = { ...process.env, DND_TCG_TEST_USER_DATA: userData };
delete childEnv.ELECTRON_RUN_AS_NODE;
delete childEnv.DND_TCG_DEV_URL;
if (devMode) childEnv.DND_TCG_DEV_URL = 'http://127.0.0.1:5173';
let server;
if (devMode) {
  server = await createServer();
  await server.listen();
}
const checks = [];
const pageErrors = [];
const securityWarnings = [];
let app;
async function launch() {
  const instance = await electron.launch({
    ...(binary ? { executablePath: resolve(binary), args: [] } : { args: ['.'] }),
    cwd: process.cwd(), env: childEnv, timeout: 45_000,
  });
  const page = await instance.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => { if (msg.text().includes('Electron Security Warning')) securityWarnings.push(msg.text()); });
  await page.getByRole('button', { name: '상처 치료 카드 선택' }).waitFor();
  return { instance, page };
}
async function screenshot(_page, name) {
  // Capture Electron's native viewport; Playwright fullPage clips at non-1 zoom.
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(join(runPath, `${name}.png`), Buffer.from(png, 'base64'));
}
try {
  let launched = await launch();
  app = launched.instance;
  let page = launched.page;
  const runtime = await app.evaluate(({ app, BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { packaged: app.isPackaged, userData: app.getPath('userData'), electron: process.versions.electron, node: process.versions.node, sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation, webSecurity: prefs.webSecurity };
  });
  assert.equal(resolve(runtime.userData), resolve(userData));
  assert.equal(runtime.sandbox, true);
  assert.equal(runtime.contextIsolation, true);
  assert.equal(runtime.nodeIntegration, false);
  assert.equal(runtime.webSecurity, true);
  if (binary) assert.equal(runtime.packaged, true);
  checks.push('실제 Windows Electron 창과 보안 설정 확인');
  const bridge = await page.evaluate(() => ({ keys: Object.keys(window.desktop).sort(), requireType: typeof window.require, processType: typeof window.process }));
  assert.deepEqual(bridge.keys, ['getBootstrap', 'saveSettings']);
  assert.equal(bridge.requireType, 'undefined');
  assert.equal(bridge.processType, 'undefined');
  const stateBefore = await page.evaluate(() => window.desktop.getBootstrap());
  await page.getByRole('button', { name: '상처 치료 카드 선택' }).click();
  assert.equal(await page.getByRole('button', { name: '사용 · 준비 중' }).isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.desktop.getBootstrap()), stateBefore);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '카드 선택 닫기' }).count(), 0);
  checks.push('샘플 4장 렌더·선택·확대·ESC; 선택에 따른 영속 상태 변경 없음');
  const invalidResult = await page.evaluate(() => window.desktop.saveSettings({ viewMode: 'grid', reducedMotion: false, resourcePanelCollapsed: false, extra: '../../secret' }));
  assert.equal(invalidResult.ok, false);
  assert.deepEqual(await page.evaluate(() => window.desktop.getBootstrap()), stateBefore);
  checks.push('IPC 잘못된 입력 거부 및 기존 설정 보존');

  for (const [width, height, zoom, name] of [[1920, 1080, 1, '1920x1080'], [1280, 720, 1, '1280x720'], [1280, 720, 1.25, '1280x720-125pct'], [1280, 720, 1.5, '1280x720-150pct']]) {
    await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(width, height); win.webContents.setZoomFactor(zoom); }, { width, height, zoom });
    await page.getByRole('button', { name: '상처 치료 카드 선택' }).click();
    await page.getByRole('button', { name: '사용 · 준비 중' }).scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `horizontal overflow at ${name}`);
    await screenshot(page, name);
    await page.getByRole('button', { name: '카드 선택 닫기' }).click();
  }
  checks.push('1920×1080, 1280×720, Chromium 확대 125%·150% 레이아웃과 캡처');
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1280, 720); win.webContents.setZoomFactor(1); });
  await page.getByRole('button', { name: '격자', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '저장됨' }).waitFor();
  await page.getByRole('button', { name: '환경 설정', exact: true }).click();
  // Controlled input is committed after SQLite IPC, rather than optimistically.
  await page.getByRole('checkbox', { name: '모션 줄이기' }).click();
  await page.getByRole('status').filter({ hasText: '저장됨' }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: '모션 줄이기' }).isChecked(), true);
  await page.getByRole('button', { name: '자원 패널 접기' }).click();
  await page.getByRole('status').filter({ hasText: '저장됨' }).waitFor();
  const expectedSettings = { viewMode: 'grid', reducedMotion: true, resourcePanelCollapsed: true };
  assert.deepEqual((await page.evaluate(() => window.desktop.getBootstrap())).value.settings, expectedSettings);
  await screenshot(page, 'saved-preferences');
  await app.close();
  app = undefined;

  launched = await launch();
  app = launched.instance;
  page = launched.page;
  assert.deepEqual((await page.evaluate(() => window.desktop.getBootstrap())).value.settings, expectedSettings);
  assert.equal(await page.getByRole('button', { name: '격자', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: '자원 패널 펼치기' }).count(), 1);
  checks.push('앱 완전 종료·재시작 후 SQLite 설정 3종 유지');
  if (!devMode) {
    await app.context().setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: '상처 치료 카드 선택' }).waitFor();
    assert.deepEqual((await page.evaluate(() => window.desktop.getBootstrap())).value.settings, expectedSettings);
    const remoteAllowed = await page.evaluate(async () => { try { await fetch('https://example.invalid/probe'); return true; } catch { return false; } });
    assert.equal(remoteAllowed, false);
    await page.getByRole('button', { name: '손패', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '저장됨' }).waitFor();
    assert.deepEqual((await page.evaluate(() => window.desktop.getBootstrap())).value.settings, { ...expectedSettings, viewMode: 'hand' });
    await page.getByRole('button', { name: '검격 카드 선택' }).click();
    await screenshot(page, 'offline-restart');
    checks.push('Chromium offline 모드에서 재로딩·카드 선택·SQLite 설정 읽기/쓰기; 외부 fetch 거부');
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(securityWarnings, []);
  const result = { outcome: 'PASS', mode: binary ? 'packaged-windows-exe' : devMode ? 'vite-development' : 'production-bundle', runtime, checks, pageErrors, securityWarnings, artifacts: runPath };
  await writeFile(join(runPath, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(join(runPath, 'failure.txt'), String(error.stack ?? error));
  throw error;
} finally {
  if (app) await app.close();
  if (server) await server.close();
}
