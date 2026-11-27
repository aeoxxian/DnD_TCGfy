import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertLayout, measure } from './v13-board.mjs';

const artifacts = resolve('artifacts');
await mkdir(artifacts, { recursive: true });
const run = await mkdtemp(join(artifacts, 'p5-display-'));
const userData = join(run, 'user-data');
await cp(resolve('repository-data/user-data'), userData, { recursive: true });
const executablePath = process.env.DND_TCG_EXECUTABLE;
const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DND_TCG_DEV_URL;
const app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), cwd: process.cwd(), env });
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.board');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), userData);
  await app.evaluate(({ BrowserWindow, screen }) => {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    BrowserWindow.getAllWindows()[0].setContentSize(Math.min(width, 1366), Math.min(height - 45, 768));
  });
  const tile = page.getByRole('button', { name: /카드 선택$/ }).first();
  await tile.click();
  const selectedImage = page.locator('.in-play-slot img');
  await selectedImage.waitFor({ state: 'visible' });
  await selectedImage.evaluate(async image => {
    await image.decode();
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  // Wait for Playwright's stable element capture before asking Electron for the full frame.
  await selectedImage.screenshot({ animations: 'disabled' });
  const system = await app.evaluate(({ app, BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const display = screen.getDisplayMatching(window.getBounds());
    return { packaged: app.isPackaged, version: app.getVersion(), dpi: display.scaleFactor, display: display.size, content: window.getContentSize() };
  });
  const renderer = await page.evaluate(async () => ({
    size: [innerWidth, innerHeight], ratio: devicePixelRatio,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    schema: (await window.desktop.getBootstrap()).value.schemaVersion,
    columns: ['.board-left', '.board-center', '.board-right'].map(selector => document.querySelector(selector)?.getBoundingClientRect().width ?? null),
    theme: document.querySelector('.app')?.dataset.theme,
    imageDecoded: Boolean(document.querySelector('.in-play-slot img')?.naturalWidth),
  }));
  assert.equal(renderer.horizontalOverflow, false);
  assert.equal(renderer.imageDecoded, true);
  if (process.argv[2]) assert.equal(system.dpi, Number(process.argv[2]), 'Windows scale reported by Electron');
  assert.equal(renderer.ratio, system.dpi, 'renderer uses the OS scale without a Chromium override');
  const screenshot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(join(run, 'play-board.png'), Buffer.from(screenshot, 'base64'));
  const layout = await measure(page);
  if (renderer.schema === 9) assertLayout(layout, `Windows ${system.dpi * 100}%`);
  const matrix = [];
  if (process.env.DND_TCG_P5_MATRIX === '1') {
    for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720], [860, 440]]) {
      await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), [width, height]);
      await page.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, [width, height]);
      await selectedImage.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const layout = await measure(page);
      assertLayout(layout, `${width}x${height}`);
      const shot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await writeFile(join(run, `board-${width}x${height}.png`), Buffer.from(shot, 'base64'));
      matrix.push({ width, height, layout });
    }
  }
  await writeFile(join(run, 'report.json'), JSON.stringify({ outcome: 'PASS', system, renderer, layout, matrix, run }, null, 2));
  console.log(JSON.stringify({ system, renderer, run }, null, 2));
} finally { await app.close(); }
