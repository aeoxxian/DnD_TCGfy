import { app, BrowserWindow, dialog, ipcMain, protocol, session } from 'electron';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join, resolve, extname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { AppStore } from './store';
import { SCHEMA_VERSION } from './migrations';
import { APP_URL, DEV_URL, PRODUCTION_CSP, isAllowedRequest, isTrustedPage, resolveBundleAsset } from './security';
import { IPC, settingsSchema, type Result } from '../src/shared/contracts';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const development = !app.isPackaged && process.env.DND_TCG_DEV_URL === DEV_URL;
// Explicit process environment only; never supplied through renderer/IPC.
const isolatedPath = process.env.DND_TCG_TEST_USER_DATA;
if (isolatedPath && !isAbsolute(isolatedPath)) throw new Error('테스트 데이터 경로는 절대 경로여야 합니다.');
const dataPath = isolatedPath ? resolve(isolatedPath) : join(app.getPath('appData'), app.isPackaged ? 'DnD TCG-fy' : 'DnD TCG-fy Development');
mkdirSync(dataPath, { recursive: true });
app.setPath('userData', dataPath);
app.setPath('sessionData', join(dataPath, 'chromium'));
const singleInstance = app.requestSingleInstanceLock();
let store: AppStore | undefined;
let mainWindow: BrowserWindow | undefined;
if (!singleInstance) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.focus(); });
  app.whenReady().then(async () => {
    store = new AppStore(app.getPath('userData'));
    // Read settings now: corrupted persisted settings stop startup without resetting data.
    store.getSettings();
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedRequest(details.url, development) }));
    const rendererRoot = join(__dirname, '..', 'dist');
    protocol.handle('app', async request => {
      const filePath = resolveBundleAsset(request.url, rendererRoot);
      if (!filePath) return new Response('Forbidden', { status: 403 });
      const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      try {
        return new Response(await readFile(filePath), { headers: { 'Content-Type': contentTypes[extname(filePath)], 'Content-Security-Policy': PRODUCTION_CSP, 'X-Content-Type-Options': 'nosniff' } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    const safeHandler = (channel: string, action: (input: unknown) => unknown) => {
      ipcMain.handle(channel, (event, input: unknown): Result<unknown> => {
        if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || !isTrustedPage(event.senderFrame.url, development)) return { ok: false, error: '허용되지 않은 요청입니다.' };
        try { return { ok: true, value: action(input) }; }
        catch (error) {
          console.error(`[${channel}]`, error);
          return { ok: false, error: '설정 처리에 실패했습니다. 입력과 저장 공간을 확인해 주세요. 기존 데이터를 초기화하지 않았습니다.' };
        }
      });
    };
    safeHandler(IPC.getBootstrap, input => {
      z.undefined().parse(input);
      return { settings: store!.getSettings(), cards: SAMPLE_CARDS, appVersion: app.getVersion(), schemaVersion: SCHEMA_VERSION };
    });
    safeHandler(IPC.saveSettings, input => store!.saveSettings(settingsSchema.parse(input)));
    mainWindow = new BrowserWindow({
      title: 'DnD TCG-fy', width: 1440, height: 900, minWidth: 960, minHeight: 600, backgroundColor: '#14161b',
      show: false, autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false, spellcheck: false },
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    await mainWindow.loadURL(development ? DEV_URL : APP_URL);
  }).catch(error => {
    console.error('Startup failed:', error);
    dialog.showErrorBox('DnD TCG-fy · 시작 오류', `${error instanceof Error ? error.message : '앱을 열 수 없습니다.'}\n기존 데이터는 초기화하지 않았습니다.`);
    app.quit();
  });
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => store?.close());
