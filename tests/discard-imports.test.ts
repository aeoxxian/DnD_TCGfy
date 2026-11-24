import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { AppStore } from '../electron/store';
import { LibraryStore } from '../electron/library-store';
import { AssetService } from '../electron/assets';
import { AssetCleanup } from '../electron/asset-cleanup';
import { DEFAULT_APPEARANCE, discardImportsSchema } from '../src/shared/contracts';

const root = resolve('artifacts/discard-unit');
beforeAll(async () => { await mkdir(root, { recursive: true }); });
async function fixture(count: number) {
  const path = await mkdtemp(join(root, 'case-')); const store = new AppStore(join(path, 'user-data'));
  const library = new LibraryStore(store); const assets = new AssetService(store.userData, library);
  const files = await Promise.all(Array.from({ length: count }, async (_, i) => {
    const file = join(path, `그림-${i}.png`);
    await writeFile(file, await sharp({ create: { width: 60 + i, height: 90, channels: 4, background: { r: 40 * i, g: 90, b: 120, alpha: .5 } } }).png().toBuffer());
    return file;
  }));
  const imported = await assets.importPaths(files); expect(imported.errors).toEqual([]);
  return { path, store, library, assets, cleanup: new AssetCleanup(store, assets), ids: imported.assets.map(asset => asset.id) };
}
const exists = (path: string) => stat(path).then(() => true, () => false);

describe('v1.3 Phase 1 · images of a cancelled registration are discarded safely', () => {
  it('only images imported during this run can be claimed, and each only once', async () => {
    const f = await fixture(2);
    expect(f.assets.takeSessionImports(['someone-else', f.ids[0], f.ids[0]])).toEqual([f.ids[0]]);
    expect(f.assets.takeSessionImports([f.ids[0], f.ids[1]])).toEqual([f.ids[1]]);
    expect(f.assets.takeSessionImports(f.ids)).toEqual([]);
    // A fresh service (a restart) knows nothing about earlier imports: old images can never be discarded this way.
    expect(new AssetService(f.store.userData, f.library).takeSessionImports(f.ids)).toEqual([]);
    expect(discardImportsSchema.safeParse(Array.from({ length: 201 }, (_, i) => `id-${i}`)).success).toBe(false);
    f.store.close();
  });

  it('deletes unused images but keeps those used by a card, the card image history or a custom card back', async () => {
    const f = await fixture(5);
    const [unused, onCard, inHistory, asBack, alsoUnused] = f.ids;
    const saved = f.library.saveCards({ cards: [
      { name: '이미지 카드', kind: 'spell', roles: [], actions: ['action'], range: { kind: 'self' }, tags: [], imageAssetId: onCard },
      { name: '기록 카드', kind: 'item', roles: [], actions: ['action'], range: { kind: 'self' }, tags: [] },
    ] }).cards;
    f.store.db.prepare('INSERT INTO card_asset_history(card_id,asset_id) VALUES (?,?)').run(saved.find(card => card.name === '기록 카드')!.id, inHistory);
    f.store.saveSettings({ ...f.store.getSettings(), appearance: { ...DEFAULT_APPEARANCE, customBacks: [{ assetId: asBack, name: '파티 문장' }] } });
    const paths = Object.fromEntries(f.ids.map(id => [id, join(f.store.userData, f.library.getAsset(id)!.relative_path)]));
    const cardBytes = await readFile(paths[onCard]);

    const queued = f.library.queueUnusedImports(f.assets.takeSessionImports([...f.ids, 'not-imported']));
    expect(queued.sort()).toEqual([unused, alsoUnused].sort());
    const result = await f.cleanup.run();
    expect(result).toMatchObject({ removed: 2, pending: 0, errors: [] });
    for (const id of [unused, alsoUnused]) { expect(await exists(paths[id])).toBe(false); expect(f.library.getAsset(id)).toBeUndefined(); }
    for (const id of [onCard, inHistory, asBack]) { expect(await exists(paths[id])).toBe(true); expect(f.library.getAsset(id)).toBeDefined(); }
    expect(await readFile(paths[onCard])).toEqual(cardBytes);
    expect(f.library.getLibrary().cards.find(card => card.name === '이미지 카드')!.imageAssetId).toBe(onCard);
    expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.store.close();
  });

  it('keeps everything when the card-back settings cannot be read, and ignores ids that are not stored assets', async () => {
    const f = await fixture(1);
    f.store.db.prepare("INSERT OR REPLACE INTO settings(key,value_json) VALUES ('appearance','\"not an object\"')").run();
    expect(f.library.queueUnusedImports(f.ids)).toEqual([]);
    f.store.db.prepare("DELETE FROM settings WHERE key='appearance'").run();
    expect(f.library.queueUnusedImports(['missing-asset'])).toEqual([]);
    expect(f.library.queueUnusedImports(f.ids)).toEqual(f.ids);
    f.store.close();
  });
});
