import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { AppStore } from '../electron/store';
import { LibraryStore } from '../electron/library-store';
import { AssetService } from '../electron/assets';
import { assetAlphaSchema } from '../src/shared/contracts';

const root = resolve('artifacts/alpha-unit');
beforeAll(async () => { await mkdir(root, { recursive: true }); });

describe('v1.3 (memo 1) · which card images have see-through pixels', () => {
  it('finds transparent PNG/WebP images, treats opaque and JPEG images as opaque, and leaves the files untouched', async () => {
    const path = await mkdtemp(join(root, 'case-')); const store = new AppStore(join(path, 'user-data'));
    const library = new LibraryStore(store); const assets = new AssetService(store.userData, library);
    const rounded = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="290"><rect x="10" y="10" width="180" height="270" rx="30" fill="#345"/></svg>');
    const files = {
      'clear.png': await sharp(rounded).png().toBuffer(),
      'clear.webp': await sharp(rounded).webp().toBuffer(),
      'solid.png': await sharp({ create: { width: 200, height: 290, channels: 4, background: { r: 40, g: 60, b: 80, alpha: 1 } } }).png().toBuffer(),
      'photo.jpg': await sharp({ create: { width: 200, height: 290, channels: 3, background: '#456' } }).jpeg().toBuffer(),
    };
    for (const [name, bytes] of Object.entries(files)) await writeFile(join(path, name), bytes);
    const imported = await assets.importPaths(Object.keys(files).map(name => join(path, name)));
    expect(imported.errors).toEqual([]);
    const ids = Object.fromEntries(imported.assets.map((asset, i) => [Object.keys(files)[i], asset.id]));
    const result = await assets.alphaOf([...Object.values(ids), 'unknown-image']);
    expect(result).toEqual({ [ids['clear.png']]: true, [ids['clear.webp']]: true, [ids['solid.png']]: false, [ids['photo.jpg']]: false, 'unknown-image': false });
    expect(await assets.alphaOf([ids['clear.png']])).toEqual({ [ids['clear.png']]: true }); // remembered
    for (const [name, id] of Object.entries(ids)) expect(await readFile(join(store.userData, library.getAsset(id)!.relative_path))).toEqual(files[name as keyof typeof files]);
    expect(assetAlphaSchema.safeParse([]).success).toBe(false);
    store.close();
  });
});
