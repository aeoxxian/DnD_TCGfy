import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { AppStore } from '../electron/store';
import { LibraryStore } from '../electron/library-store';
import { ResourceStore } from '../electron/resource-store';
import { RegistrationStore } from '../electron/registration-store';
import { AssetService } from '../electron/assets';
import { TrashStore } from '../electron/trash-store';
import type { CardDraft, RegistrationTemplate } from '../src/shared/contracts';

const root = resolve('artifacts/batch-unit'); mkdirSync(root, { recursive: true });
function fixture() {
  const path = mkdtempSync(join(root, 'case-')); const store = new AppStore(join(path, 'user-data'));
  const library = new LibraryStore(store), resources = new ResourceStore(store);
  library.createProfile({ name: 'A' }); const a = library.getLibrary().profiles[0];
  return { path, store, library, resources, a, registration: new RegistrationStore(store, library, resources), assets: new AssetService(store.userData, library) };
}
const draft = (name: string): CardDraft => ({ name, kind: 'other', roles: [], actions: ['action'], range: { kind: 'self' }, tags: [] });

describe('v1.3 Phase 2 · per-card registration in a batch', () => {
  it('one failing card leaves the others saved; a retry with the same request saves it once; re-sending a saved request adds nothing', () => {
    const f = fixture(); const target = { characterId: f.a.id, deckId: f.a.activeDeckId! };
    const request = (name: string, requestId = randomUUID()) => ({ cards: [draft(name)], registrationTarget: target, initialRules: { requestId, configured: true, scope: 'character' as const, characterId: f.a.id, expectedRevision: f.resources.snapshot(f.a.id).revision, castOptions: [{ id: randomUUID(), label: '일반 사용', costs: [] }], bindings: [] } });
    f.store.db.exec("CREATE TRIGGER batch_fail BEFORE INSERT ON card_definitions WHEN NEW.name = '둘째' BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    const first = request('첫째'); f.registration.save(first);
    const second = request('둘째'); expect(() => f.registration.save(second)).toThrow();
    // Each configured save moves the character's resource revision, so the next card reads it again.
    const third = request('셋째'); f.registration.save(third);
    let lib = f.library.getLibrary();
    expect(lib.cards.map(card => card.name).sort()).toEqual(['셋째', '첫째']);
    expect(lib.decks.find(deck => deck.id === target.deckId)!.cardIds).toHaveLength(2);
    f.store.db.exec('DROP TRIGGER batch_fail');
    f.registration.save({ ...second, initialRules: { ...second.initialRules, expectedRevision: f.resources.snapshot(f.a.id).revision } });
    f.registration.save({ ...first, initialRules: { ...first.initialRules, expectedRevision: f.resources.snapshot(f.a.id).revision } });
    lib = f.library.getLibrary();
    expect(lib.cards.map(card => card.name).sort()).toEqual(['둘째', '셋째', '첫째']);
    expect(lib.decks.find(deck => deck.id === target.deckId)!.cardIds).toHaveLength(3);
    expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.store.close();
  });

  it('saved registration templates live in their own settings key and survive a restart', () => {
    const f = fixture();
    const template: RegistrationTemplate = { id: 'tpl', name: '공격 주문', card: { kind: 'spell', spellLevel: 1, roles: ['damage'], actions: ['action'], range: { kind: 'ranged', feet: 60 }, tags: [] },
      rule: { kind: 'none', scope: 'character', family: 'standard', homebrew: false, belowBase: false, amount: 1, variable: false, min: 1, max: 5, step: 1 }, addToDeck: true };
    const before = f.store.db.prepare("SELECT value_json FROM settings WHERE key='preferences'").get();
    f.store.saveSettings({ ...f.store.getSettings(), registrationTemplates: [template] });
    expect(JSON.parse((f.store.db.prepare("SELECT value_json FROM settings WHERE key='registration_templates'").get() as { value_json: string }).value_json)).toEqual([template]);
    expect(JSON.parse((f.store.db.prepare("SELECT value_json FROM settings WHERE key='preferences'").get() as { value_json: string }).value_json)).not.toHaveProperty('registrationTemplates');
    if (before) expect(f.store.db.prepare("SELECT value_json FROM settings WHERE key='preferences'").get()).toEqual(before);
    f.store.close();
    const store = new AppStore(join(f.path, 'user-data'));
    expect(store.getSettings().registrationTemplates).toEqual([template]);
    expect(() => store.saveSettings({ ...store.getSettings(), registrationTemplates: [template, { ...template, id: 'tpl-2' }] })).toThrow();
    store.close();
  });

  it('an imported image says which existing cards (trash included) already use the same bytes', async () => {
    const f = fixture();
    const bytes = await sharp({ create: { width: 30, height: 44, channels: 3, background: '#335577' } }).png().toBuffer();
    const other = await sharp({ create: { width: 30, height: 44, channels: 3, background: '#775533' } }).png().toBuffer();
    const paths = ['a.png', 'b.png', 'c.png'].map(name => join(f.path, name));
    writeFileSync(paths[0], bytes); writeFileSync(paths[1], bytes); writeFileSync(paths[2], other);
    const firstImport = await f.assets.importPaths([paths[0]]);
    expect(firstImport.assets[0].duplicates).toBeUndefined(); expect(firstImport.assets[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    const saved = f.library.saveCards({ cards: [{ ...draft('원래 카드'), imageAssetId: firstImport.assets[0].id }] }).cards.find(card => card.name === '원래 카드')!;
    let again = await f.assets.importPaths([paths[1], paths[2]]);
    expect(again.assets[0].duplicates).toEqual([{ name: '원래 카드', trashed: false }]);
    expect(again.assets[0].sha256).toBe(firstImport.assets[0].sha256);
    expect(again.assets[1].duplicates).toBeUndefined();
    const trash = new TrashStore(f.store); const action = { type: 'move' as const, cardIds: [saved.id] };
    trash.change({ requestId: randomUUID(), action, quote: trash.preview(action).quote, confirmed: true });
    again = await f.assets.importPaths([paths[1]]);
    expect(again.assets[0].duplicates).toEqual([{ name: '원래 카드', trashed: true }]);
    f.store.close();
  });
});
