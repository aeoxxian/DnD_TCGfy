import { RegistrationStore } from './registration-store';
import { TrashStore } from './trash-store';
import { AssetCleanup } from './asset-cleanup';
import { EditStore } from './edit-store';
import { app, BrowserWindow, dialog, ipcMain, protocol, session } from 'electron';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join, resolve, extname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { AppStore } from './store';
import { SCHEMA_VERSION } from './migrations';
import { APP_URL, DEV_URL, PRODUCTION_CSP, isAllowedRequest, isTrustedPage, resolveBundleAsset } from './security';
import { IPC, settingsSchema, type Result } from '../src/shared/contracts';
import { LibraryStore } from './library-store';
import { AssetService } from './assets';
import { UserInputError } from './errors';
import { ResourceStore } from './resource-store';

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
    const library = new LibraryStore(store);
    const assets = new AssetService(app.getPath('userData'), library);
    const resources = new ResourceStore(store);
    const registration = new RegistrationStore(store, library, resources);
    const edits = new EditStore(store);
    const trash = new TrashStore(store);
    const cleanup = new AssetCleanup(store,assets);
    await cleanup.run();
    // Read settings now: corrupted persisted settings stop startup without resetting data.
    store.getSettings();
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedRequest(details.url, development) }));
    const rendererRoot = join(__dirname, '..', 'dist');
    protocol.handle('app', async request => {
      if (new URL(request.url).host === 'assets') {
        try {
          const asset = await assets.readAsset(request.url);
          if (!asset) return new Response('Image unavailable', { status: 404 });
          return new Response(Uint8Array.from(asset.bytes), { headers: { 'Content-Type': asset.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' } });
        } catch { return new Response('Image unavailable', { status: 404 }); }
      }
      const filePath = resolveBundleAsset(request.url, rendererRoot);
      if (!filePath) return new Response('Forbidden', { status: 403 });
      const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      try {
        return new Response(await readFile(filePath), { headers: { 'Content-Type': contentTypes[extname(filePath)], 'Content-Security-Policy': PRODUCTION_CSP, 'X-Content-Type-Options': 'nosniff' } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    const safeHandler = (channel: string, action: (input: unknown) => unknown) => {
      ipcMain.handle(channel, async (event, input: unknown): Promise<Result<unknown>> => {
        if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || !isTrustedPage(event.senderFrame.url, development)) return { ok: false, error: '허용되지 않은 요청입니다.' };
        try { return { ok: true, value: await action(input) }; }
        catch (error) {
          console.error(`[${channel}]`, error);
          return { ok: false, error: error instanceof UserInputError ? error.message : error instanceof z.ZodError ? '입력값의 형식이나 길이가 올바르지 않습니다.' : '저장 처리에 실패했습니다. 저장 공간을 확인하고 다시 시도해 주세요. 기존 데이터를 초기화하지 않았습니다.' };
        }
      });
    };
    safeHandler(IPC.getBootstrap, input => {
      z.undefined().parse(input);
      return { settings: store!.getSettings(), ...library.getLibrary(), appVersion: app.getVersion(), schemaVersion: SCHEMA_VERSION };
    });
    safeHandler(IPC.saveSettings, input => store!.saveSettings(settingsSchema.parse(input)));
    safeHandler(IPC.saveLibraryState, input => library.saveState(input));
    safeHandler(IPC.importImages, input => assets.importPaths(input));
    safeHandler(IPC.saveCards, input => registration.save(input));
    safeHandler(IPC.archiveCard, input => library.archiveCard(input));
    safeHandler(IPC.saveTag, input => library.saveTag(input));
    safeHandler(IPC.deleteTag, input => library.deleteTag(input));
    safeHandler(IPC.createProfile, input => library.createProfile(input));
    safeHandler(IPC.createDeck, input => library.createDeck(input));
    safeHandler(IPC.selectDeck, input => library.selectDeck(input));
    safeHandler(IPC.setDeckCards, input => library.setDeckCards(input));
    safeHandler(IPC.getTrash, input => trash.state(input));
    safeHandler(IPC.previewTrash, input => trash.preview(input));
    safeHandler(IPC.changeTrash, async input => { const result=trash.change(input); return result.type==='purge'||result.type==='empty'?{...result,cleanup:await cleanup.run()}:result; });
    safeHandler(IPC.retryImageCleanup, input => {z.undefined().parse(input);return cleanup.run();});
    safeHandler(IPC.getUseHistory, input => resources.history(input));
    safeHandler(IPC.previewEdit, input => edits.preview(input));
    safeHandler(IPC.applyEdit, input => edits.apply(input));
    safeHandler(IPC.getEditHistory, input => edits.history(input));
    safeHandler(IPC.previewClass, input => resources.previewClass(input));
    safeHandler(IPC.getResources, input => resources.snapshot(input));
    safeHandler(IPC.previewResource, input => resources.preview(input));
    safeHandler(IPC.changeResource, input => resources.change(input));
    mainWindow = new BrowserWindow({
      title: 'DnD TCG-fy', width: 1440, height: 900, minWidth: 860, minHeight: 440, backgroundColor: '#14161b',
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
