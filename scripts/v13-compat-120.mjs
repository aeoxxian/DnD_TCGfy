// v1.3 → 1.2.0 downgrade check. A database written by v1.3 must still open in the real 1.2.0 build, and v1.3 must find its
// own settings again after 1.2.0 has saved settings:
//  - Phase 1: an image-less card and a library-only registration
//  - Phase 2: cards saved one by one (batch style) and a template in `registration_templates`
//  - Phase 3: a cleared USED pile in `used_view`
// Build 1.2.0 first (git 042d533) into a folder with dist/ and dist-electron/, e.g.
//   git worktree add --detach C:/tmp/dnd-120 042d533  (link node_modules, then `npm run build` there)
// Usage: node scripts/v13-compat-120.mjs  (DND_TCG_OLD_APP = that folder, default C:/tmp/dnd-120; the new side is this
// repository's built bundle, or DND_TCG_EXECUTABLE). Runs on a COPY of repository-data.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const OLD = resolve(process.env.DND_TCG_OLD_APP ?? 'C:/tmp/dnd-120');
const binary = process.env.DND_TCG_EXECUTABLE;
await stat(join(OLD, 'dist-electron', 'main.cjs')).catch(() => assert.fail(`build 1.2.0 into ${OLD} first (see the header)`));
const run = await mkdtemp(join(resolve('artifacts'), 'v13-compat-120-'));
const userData = join(run, 'user-data');
await cp(resolve('repository-data/user-data'), userData, { recursive: true });
async function launch(which) {
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DND_TCG_DEV_URL; delete env.DND_TCG_EXECUTABLE;
  const options = which === 'old' ? { args: [OLD], cwd: OLD } : binary ? { executablePath: binary, args: [] } : { args: [resolve('.')], cwd: resolve('.') };
  const app = await electron.launch({ ...options, env, timeout: 45000 });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.waitForSelector('.board', { timeout: 30000 }); await page.waitForTimeout(600);
  return { app, page, errors };
}
const result = { newSide: binary ? 'packaged-exe' : 'built-bundle' };

// 1. v1.3 writes a template, an image-less library-only card, two cards saved one by one, and clears the USED pile.
let { app, page, errors } = await launch('new');
const written = await page.evaluate(async () => {
  const ok = r => { if (!r.ok) throw new Error(r.error); return r.value; };
  const boot = ok(await window.desktop.getBootstrap());
  const hero = boot.profiles.find(p => p.id === boot.libraryState.activeCharacterId);
  const target = { characterId: hero.id, deckId: hero.activeDeckId };
  const template = { id: crypto.randomUUID(), name: '호환 템플릿', card: { kind: 'spell', spellLevel: 1, roles: ['damage'], actions: ['action'], range: { kind: 'ranged', feet: 60 }, tags: [] },
    rule: { kind: 'none', scope: 'character', family: 'standard', homebrew: false, belowBase: false, amount: 1, variable: false, min: 1, max: 5, step: 1 }, addToDeck: true };
  // The mark 비우기 writes (history-view.ts historyMark): hide everything up to the newest play event.
  const newest = ok(await window.desktop.getResources(hero.id)).events[0];
  const usedViews = { [hero.id]: { clearedEventId: newest.id, clearedAt: new Date(newest.timestamp).toISOString() } };
  const card = name => ({ name, kind: 'spell', spellLevel: 1, roles: ['damage'], actions: ['action'], range: { kind: 'ranged' }, tags: [] });
  const rules = async () => ({ requestId: crypto.randomUUID(), configured: true, scope: 'character', characterId: hero.id, expectedRevision: ok(await window.desktop.getResources(hero.id)).revision, castOptions: [{ id: crypto.randomUUID(), label: '일반 사용', costs: [] }], bindings: [] });
  ok(await window.desktop.saveCards({ cards: [{ ...card('호환 기본 카드'), kind: 'item', spellLevel: undefined }], registrationTarget: target, addToDeck: false, initialRules: { ...(await rules()), configured: false } }));
  ok(await window.desktop.saveCards({ cards: [card('호환 일괄 1')], registrationTarget: target, initialRules: await rules() }));
  ok(await window.desktop.saveCards({ cards: [card('호환 일괄 2')], registrationTarget: target, initialRules: await rules() }));
  const settings = ok(await window.desktop.getBootstrap()).settings;
  const saved = await window.desktop.saveSettings({ ...settings, registrationTemplates: [template], usedViews });
  const after = ok(await window.desktop.getBootstrap());
  return { saved: saved.ok ? 'ok' : saved.error, names: after.cards.filter(c => c.name.startsWith('호환')).map(c => c.name).sort(), templates: after.settings.registrationTemplates?.length, usedViews: Object.keys(after.settings.usedViews ?? {}).length };
});
assert.equal(written.saved, 'ok', `v1.3 saves its settings: ${written.saved}`);
assert.deepEqual(written.names, ['호환 기본 카드', '호환 일괄 1', '호환 일괄 2']); assert.equal(written.templates, 1); assert.equal(written.usedViews, 1);
assert.deepEqual(errors, []); await app.close();
result.v13Wrote = written;

// 2. The real 1.2.0 opens the same database, shows the cards (the image-less one too) and saves its own settings.
({ app, page, errors } = await launch('old'));
const old = await page.evaluate(async () => {
  const ok = r => { if (!r.ok) throw new Error(r.error); return r.value; };
  const boot = ok(await window.desktop.getBootstrap());
  ok(await window.desktop.saveSettings({ ...boot.settings, viewMode: 'grid' }));
  return { version: boot.appVersion, names: boot.cards.filter(c => c.name.startsWith('호환')).map(c => c.name).sort(), hasTemplates: 'registrationTemplates' in boot.settings, hasUsedViews: 'usedViews' in boot.settings,
    imageless: boot.cards.find(c => c.name === '호환 기본 카드')?.imageAssetId ?? null, warnings: boot.warnings };
});
const banners = await page.locator('.error-banner').allTextContents();
assert.equal(old.version, '1.2.0'); assert.deepEqual(old.names, written.names); assert.equal(old.imageless, null);
assert.equal(old.hasTemplates, false); assert.equal(old.hasUsedViews, false); assert.deepEqual(old.warnings, []); assert.deepEqual(banners, []);
assert.deepEqual(errors, []); await app.close();
result.v120Read = old;

// 3. v1.3 again: its template and USED mark survived 1.2.0's settings save, 1.2.0's own change is kept, the database is sound.
({ app, page, errors } = await launch('new'));
const back = await page.evaluate(async () => { const boot = (await window.desktop.getBootstrap()).value; return { version: boot.appVersion, templates: boot.settings.registrationTemplates?.map(t => t.name), usedViews: Object.keys(boot.settings.usedViews ?? {}).length, viewMode: boot.settings.viewMode }; });
assert.deepEqual({ ...back, version: undefined }, { version: undefined, templates: ['호환 템플릿'], usedViews: 1, viewMode: 'grid' });
assert(/최근 0건/.test(await page.locator('.used-pile .pile-button').getAttribute('aria-label')), 'the USED pile is still cleared');
assert.deepEqual(errors, []); await app.close();
const db = new DatabaseSync(join(userData, 'data', 'app.sqlite3'), { readOnly: true });
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok'); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6); db.close();
result.v13Again = back;
await writeFile(join(run, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ outcome: 'PASS', ...result }, null, 2));
