import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppStore } from '../electron/store';
import { LibraryStore } from '../electron/library-store';
import { AssetService, assetUrl, MAX_IMAGE_BYTES } from '../electron/assets';

const root = resolve('artifacts/asset-unit');
beforeAll(async () => { await mkdir(root, { recursive: true }); });
async function fixture() {
  const path = await mkdtemp(join(root, 'case-')); const store = new AppStore(join(path, 'user-data'));
  const library = new LibraryStore(store); return { path, store, library, assets: new AssetService(store.userData, library) };
}
async function image(format: 'png' | 'jpeg' | 'webp') { return sharp({ create: { width: 180, height: 260, channels: 3, background: '#667788' } }).toFormat(format).toBuffer(); }
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('immutable original image handling', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('imports %s byte-for-byte and serves a separate lazy thumbnail', async format => {
    const { path, store, library, assets } = await fixture(); const bytes = await image(format);
    const input = join(path, `원본.${format}`); await writeFile(input, bytes);
    const result = await assets.importPaths([input]); expect(result.errors).toEqual([]); expect(result.assets).toHaveLength(1);
    const asset = library.getAsset(result.assets[0].id)!;
    expect(asset.sha256).toBe(sha(bytes)); expect(asset.relative_path).toMatch(/^assets\/[a-f0-9-]+\.(png|jpg|webp)$/);
    expect(await readFile(input)).toEqual(bytes); expect(await readFile(join(store.userData, asset.relative_path))).toEqual(bytes);
    expect((await assets.readAsset(result.assets[0].url))?.bytes).toEqual(bytes);
    const thumbnail = await assets.readAsset(result.assets[0].thumbnailUrl);
    expect(thumbnail?.mime).toBe('image/webp'); expect((await sharp(thumbnail!.bytes).metadata()).width).toBeLessThanOrEqual(420);
    store.close();
  });
  it('isolates same-name imports, refuses extension spoofing, SVG, corruption and folders, and retains valid files', async () => {
    const { path, store, library, assets } = await fixture();
    const good = join(path, 'valid.png'); await writeFile(good, await image('png'));
    const spoof = join(path, 'wrong.jpg'); await writeFile(spoof, await image('png'));
    const corrupt = join(path, 'corrupt.png'); await writeFile(corrupt, Buffer.from([137,80,78,71,13,10,26,10,0]));
    const svg = join(path, 'remote.png'); await writeFile(svg, '<svg><image href="https://example.invalid/test"/></svg>');
    const result = await assets.importPaths([good, spoof, corrupt, svg, path]);
    expect(result.assets).toHaveLength(1); expect(result.errors).toHaveLength(4);
    const again = await assets.importPaths([good]); expect(again.assets[0].id).not.toBe(result.assets[0].id);
    expect(library.getAsset(result.assets[0].id)).toBeDefined(); expect(library.getAsset(again.assets[0].id)).toBeDefined(); store.close();
  });
  it('rejects non-local paths, overlarge files, excess batch sizes and unsupported pixel dimensions', async () => {
    const { path, store, assets } = await fixture();
    const oversized = join(path, 'huge.png'); await writeFile(oversized, Buffer.alloc(MAX_IMAGE_BYTES + 1));
    const pixels = join(path, 'pixels.png');
    await writeFile(pixels, await sharp({ create: { width: 6500, height: 6500, channels: 3, background: '#000000' } }).png().toBuffer());
    const result = await assets.importPaths(['relative.png', '\\\\server\\remote.png', oversized, pixels]);
    expect(result.assets).toEqual([]); expect(result.errors).toHaveLength(4);
    await expect(assets.importPaths(Array.from({ length: 101 }, () => oversized))).rejects.toThrow(); store.close();
  });
  it('rejects asset URL traversal and DB path tampering without reading outside managed assets', async () => {
    const { path, store, library, assets } = await fixture();
    const input = join(path, 'image.png'); await writeFile(input, await image('png'));
    const imported = (await assets.importPaths([input])).assets[0];
    for (const url of ['app://assets/%2e%2e%2fsecret', 'app://assets/x/../../outside', 'app://assets/x/extra/thumbnail', 'app://assets/x?path=secret', 'file:///C:/secret']) expect(await assets.readAsset(url)).toBeUndefined();
    store.db.prepare("UPDATE assets SET relative_path='../outside.png' WHERE id=?").run(imported.id);
    await expect(assets.readAsset(imported.url)).rejects.toThrow('경로');
    expect(library.getAsset(imported.id)).toBeDefined(); store.close();
  });
  it('recovers missing thumbnails, rejects changed originals, and tolerates missing files without changing card data', async () => {
    const { path, store, library, assets } = await fixture(); const input = join(path, 'image.png'); await writeFile(input, await image('png'));
    const imported = (await assets.importPaths([input])).assets[0]; const record = library.getAsset(imported.id)!;
    const cacheRoot = join(store.userData, 'cache', 'thumbnails'); const cached = (await readdir(cacheRoot))[0];
    await rename(join(cacheRoot, cached), join(cacheRoot, `${cached}.old`));
    expect((await assets.readAsset(imported.thumbnailUrl))?.mime).toBe('image/webp');
    const original = join(store.userData, record.relative_path);
    await writeFile(original, Buffer.from('tampered')); expect(await assets.readAsset(imported.url)).toBeUndefined();
    await rename(original, `${original}.missing`); await expect(assets.readAsset(assetUrl(imported.id))).rejects.toThrow();
    expect(library.getAsset(imported.id)).toEqual(record); store.close();
  });
});
