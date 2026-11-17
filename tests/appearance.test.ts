import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppStore } from '../electron/store';
import { DEFAULT_APPEARANCE, DEFAULT_SETTINGS, appearanceSchema, type Appearance } from '../src/shared/contracts';
import { addCustomBack, cardBackFor, removeCustomBack, setCardBack } from '../src/shared/appearance';

const root = resolve('artifacts/unit-data');
mkdirSync(root, { recursive: true });
function addAsset(store: AppStore, id: string) {
  store.db.prepare('INSERT INTO assets(id,relative_path,sha256,mime_type,width,height) VALUES (?,?,?,?,?,?)').run(id, `assets/${id}.png`, 'a'.repeat(64), 'image/png', 600, 875);
}

describe('card backs and themes (pure rules)', () => {
  it('uses the deck choice first and the default otherwise', () => {
    const withDeck = setCardBack(DEFAULT_APPEARANCE, { type: 'builtin', id: 'stars' }, 'deck', 'deck-a');
    expect(cardBackFor(withDeck, 'deck-a')).toEqual({ type: 'builtin', id: 'stars' });
    expect(cardBackFor(withDeck, 'deck-b')).toEqual({ type: 'builtin', id: 'dragon' });
    const newDefault = setCardBack(withDeck, { type: 'builtin', id: 'crest' }, 'default');
    expect(cardBackFor(newDefault, 'deck-b')).toEqual({ type: 'builtin', id: 'crest' });
    expect(cardBackFor(newDefault, 'deck-a')).toEqual({ type: 'builtin', id: 'stars' });
  });
  it('lists user images once with a trimmed name and falls back to the dragon back when one is removed', () => {
    let value = addCustomBack(DEFAULT_APPEARANCE, 'img-1', 'party-crest.png');
    value = addCustomBack(value, 'img-1', 'again.png');
    expect(value.customBacks).toEqual([{ assetId: 'img-1', name: 'party-crest' }]);
    value = setCardBack(value, { type: 'custom', assetId: 'img-1' }, 'deck', 'deck-a');
    value = setCardBack(value, { type: 'custom', assetId: 'img-1' }, 'default');
    expect(appearanceSchema.safeParse(value).success).toBe(true);
    const removed = removeCustomBack(value, 'img-1');
    expect(removed.customBacks).toEqual([]);
    expect(removed.cardBack.decks).toEqual({});
    expect(cardBackFor(removed, 'deck-a')).toEqual({ type: 'builtin', id: 'dragon' });
    expect(appearanceSchema.safeParse(removed).success).toBe(true);
  });
  it('rejects a card back that points at an image outside the list, unknown themes and duplicates', () => {
    const dangling: Appearance = { ...DEFAULT_APPEARANCE, cardBack: { default: { type: 'custom', assetId: 'missing' }, decks: {} } };
    expect(appearanceSchema.safeParse(dangling).success).toBe(false);
    expect(appearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, theme: 'neon' }).success).toBe(false);
    expect(appearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, customBacks: [{ assetId: 'a', name: 'x' }, { assetId: 'a', name: 'y' }] }).success).toBe(false);
  });
});

describe('appearance persistence', () => {
  it('stores appearance under its own key, keeps preferences readable by older versions, and survives restarts', () => {
    const path = mkdtempSync(join(root, 'appearance-'));
    const first = new AppStore(path);
    addAsset(first, 'back-1');
    const appearance: Appearance = { theme: 'ebony', customBacks: [{ assetId: 'back-1', name: '파티 문장' }], cardBack: { default: { type: 'builtin', id: 'crest' }, decks: { 'deck-a': { type: 'custom', assetId: 'back-1' } } } };
    first.saveSettings({ ...DEFAULT_SETTINGS, viewMode: 'grid', appearance });
    const preferences = JSON.parse((first.db.prepare("SELECT value_json FROM settings WHERE key='preferences'").get() as { value_json: string }).value_json);
    expect(preferences).toEqual({ ...DEFAULT_SETTINGS, viewMode: 'grid' });
    first.close();
    const second = new AppStore(path);
    expect(second.getSettings()).toEqual({ ...DEFAULT_SETTINGS, viewMode: 'grid', appearance });
    // Saving other preferences without appearance never erases the stored appearance.
    second.saveSettings({ ...DEFAULT_SETTINGS, reducedMotion: true });
    expect(second.getSettings().appearance).toEqual(appearance);
    second.close();
  });
  it('refuses a user card back whose image is not a stored asset and keeps the previous settings', () => {
    const path = mkdtempSync(join(root, 'appearance-'));
    const store = new AppStore(path);
    const appearance: Appearance = { ...DEFAULT_APPEARANCE, customBacks: [{ assetId: 'ghost', name: '없는 이미지' }] };
    expect(() => store.saveSettings({ ...DEFAULT_SETTINGS, appearance })).toThrow('카드 뒷면 이미지를 찾을 수 없습니다');
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    store.close();
  });
});
