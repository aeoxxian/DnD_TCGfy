// P5 installer check: silent per-user install of an older build, upgrade to the new
// installer, run the installed app on isolated data, then uninstall.
// Usage: node scripts/p5-installer-check.mjs <older-setup.exe> <new-setup.exe>
// Refuses to run if DnD TCG-fy is already installed, so a real installation is never touched.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const [olderSetup, newSetup] = process.argv.slice(2).map(path => resolve(path));
assert(olderSetup && newSetup && existsSync(olderSetup) && existsSync(newSetup), 'usage: p5-installer-check.mjs <older-setup.exe> <new-setup.exe>');
// Versions come from the electron-builder file names (…-Setup-<version>-x64.exe), e.g. 0.6.0 → 1.1.0.
const versionOf = path => path.match(/Setup-(\d+\.\d+\.\d+)-x64\.exe$/i)?.[1];
const [olderVersion, newVersion] = [versionOf(olderSetup), versionOf(newSetup)];
assert(olderVersion && newVersion && olderVersion !== newVersion, `setup names must carry two different versions: ${olderVersion} / ${newVersion}`);
const run = await mkdtemp(join(resolve('artifacts'), 'p5-install-'));
const installDir = join(run, 'app'); const data = join(run, 'user-data');
await cp(resolve('repository-data/user-data'), data, { recursive: true });
const realData = join(process.env.APPDATA, 'DnD TCG-fy');
const realDataBefore = existsSync(realData) ? statSync(realData).mtimeMs : null;
const desktopLink = join(homedir(), 'Desktop', 'DnD TCG-fy.lnk');
const startLink = join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'DnD TCG-fy.lnk');
const report = { installDir, steps: [] };
const step = (name, details = {}) => { report.steps.push({ name, ...details }); console.log(`✓ ${name}`); };

function installs() {
  const script = "$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'; @(Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*TCG-fy*' } | Select-Object DisplayName,DisplayVersion,InstallLocation) | ConvertTo-Json -Compress";
  const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
  return out ? [JSON.parse(out)].flat() : [];
}
async function waitFor(check, label, ms = 120000) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > ms) throw new Error(`timed out: ${label}`); await new Promise(done => setTimeout(done, 500)); }
}
function install(setup) {
  // NSIS: /S silent, /D must be the last argument and unquoted.
  const result = spawnSync(setup, ['/S', `/D=${installDir}`], { stdio: 'ignore', windowsHide: true });
  assert.equal(result.status, 0, `installer exit code ${result.status}`);
}
async function openInstalled() {
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: data, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: join(installDir, 'DnD TCG-fy.exe'), args: [], env, timeout: 45000 });
  const page = await app.firstWindow();
  await page.waitForSelector('.board');
  return { app, page };
}
const footerVersion = page => page.locator('.board-status span').last().textContent();
const slot = page => page.locator('.resource-status-row strong').first().textContent();

assert.deepEqual(installs(), [], 'DnD TCG-fy is already installed on this PC; refusing to run the installer check');
assert(!existsSync(desktopLink) && !existsSync(startLink), 'existing DnD TCG-fy shortcuts found; refusing to run');

install(olderSetup);
await waitFor(() => existsSync(join(installDir, 'DnD TCG-fy.exe')), 'older install');
let entries = installs();
assert.equal(entries.length, 1); assert.equal(entries[0].DisplayVersion, olderVersion);
assert(existsSync(desktopLink) && existsSync(startLink), 'installer creates desktop and Start menu shortcuts');
step('older build installed silently per user (no admin), shortcuts created', { version: entries[0].DisplayVersion });

let session = await openInstalled();
assert.equal(await footerVersion(session.page), `v${olderVersion}`);
await session.page.locator('.card-button').first().click();
await session.page.waitForFunction(() => !document.querySelector('.use-button')?.disabled, null, { timeout: 15000 });
const before = await slot(session.page);
await session.page.getByRole('button', { name: '사용 확정', exact: true }).click();
await session.page.waitForFunction(prev => document.querySelector('.resource-status-row strong')?.textContent !== prev, before);
const afterUse = await slot(session.page);
await session.app.close();
step('installed older app ran on isolated data and recorded a card use', { slot: `${before} → ${afterUse}` });

install(newSetup);
await waitFor(() => installs()[0]?.DisplayVersion === newVersion, 'upgrade');
entries = installs();
assert.equal(entries.length, 1, 'upgrade keeps a single installation entry');
session = await openInstalled();
assert.equal(await footerVersion(session.page), `v${newVersion}`);
assert.equal(await slot(session.page), afterUse, 'data written by the older version is intact after the upgrade');
await session.page.locator('.card-button').first().click();
await session.page.waitForSelector('.use-button');
await session.app.close();
step(`upgraded in place to ${newVersion}; the app opens the same data with the earlier card use intact`, { version: entries[0].DisplayVersion });

const uninstaller = join(installDir, 'Uninstall DnD TCG-fy.exe');
assert(existsSync(uninstaller));
spawnSync(uninstaller, ['/S'], { stdio: 'ignore', windowsHide: true });
await waitFor(() => !existsSync(join(installDir, 'DnD TCG-fy.exe')) && installs().length === 0, 'uninstall');
await waitFor(() => !existsSync(desktopLink) && !existsSync(startLink), 'shortcut removal', 30000);
assert(existsSync(join(data, 'data', 'app.sqlite3')), 'uninstall keeps app data');
assert.equal(existsSync(realData) ? statSync(realData).mtimeMs : null, realDataBefore, 'the real %APPDATA% data folder was not touched');
step('uninstalled silently: program, shortcuts and registry entry removed; app data kept');

await writeFile(join(run, 'installer-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, artifacts: run }, null, 2));
