import { open, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { importPathsSchema, type AssetPreview, type ImportBatch } from '../src/shared/contracts';
import { LibraryStore, type AssetRecord } from './library-store';
import { UserInputError } from './errors';

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
sharp.cache({ memory: 32, files: 0, items: 32 });
sharp.concurrency(2);

export function detectImageFormat(bytes: Buffer): 'png' | 'jpeg' | 'webp' | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
}
export function assetUrl(id: string, thumbnail = false): string { return `app://assets/${encodeURIComponent(id)}${thumbnail ? '/thumbnail' : ''}`; }
async function readBounded(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new UserInputError('일반 이미지 파일만 선택할 수 있습니다.');
    if (info.size > MAX_IMAGE_BYTES) throw new UserInputError('이미지는 한 장에 32 MiB 이하여야 합니다.');
    const chunks: Buffer[] = [];
    let length = 0;
    while (length <= MAX_IMAGE_BYTES) {
      const chunk = Buffer.alloc(Math.min(1024 * 1024, MAX_IMAGE_BYTES + 1 - length));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead)); length += bytesRead;
    }
    if (length > MAX_IMAGE_BYTES) throw new UserInputError('이미지는 한 장에 32 MiB 이하여야 합니다.');
    return Buffer.concat(chunks, length);
  } finally { await handle.close(); }
}

export class AssetService {
  private readonly activeReads = new Map<string,Set<Promise<unknown>>>();
  async waitForReads(id:string){await Promise.allSettled([...(this.activeReads.get(id)??[])]);}
  private readonly pendingThumbnails = new Map<string, Promise<Buffer>>();
  /** v1.3: images imported during this run that have not been claimed yet. Only these can be discarded on request. */
  private readonly sessionImports = new Set<string>();
  constructor(readonly userData: string, readonly library: LibraryStore) {}
  private cachePath(id: string): string { return join(this.userData, 'cache', 'thumbnails', `${createHash('sha256').update(id).digest('hex')}.webp`); }
  private async ensureCacheRoot(): Promise<string> {
    const path = join(this.userData, 'cache', 'thumbnails');
    await mkdir(path, { recursive: true });
    const canonical = await realpath(path);
    if (!canonical.startsWith(`${await realpath(this.userData)}${sep}`)) throw new UserInputError('캐시 폴더 경로가 올바르지 않습니다.');
    return canonical;
  }
  private async managedPath(relativePath: string): Promise<string> {
    if (!/^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/.test(relativePath)) throw new UserInputError('관리 이미지 경로가 올바르지 않습니다.');
    const root = await realpath(this.userData);
    const path = await realpath(resolve(this.userData, relativePath));
    if (!path.startsWith(`${root}${sep}`)) throw new UserInputError('허용되지 않은 이미지 경로입니다.');
    return path;
  }
  private async thumbnail(bytes: Buffer): Promise<Buffer> {
    return sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS, pages: 1 })
      .autoOrient().resize({ width: 420, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  }
  async importPaths(input: unknown): Promise<ImportBatch> {
    const paths = importPathsSchema.parse(input);
    const result: ImportBatch = { assets: [], errors: [] };
    for (const path of paths) {
      try { result.assets.push(await this.importOne(path)); }
      catch (error) { result.errors.push({ name: basename(path), message: error instanceof UserInputError ? error.message : '이미지를 읽거나 저장하지 못했습니다. 파일 손상과 저장 공간을 확인해 주세요.' }); }
    }
    return result;
  }
  private async importOne(path: string): Promise<AssetPreview> {
    if (!isAbsolute(path) || path.startsWith('\\\\')) throw new UserInputError('이 기기의 로컬 이미지 파일만 가져올 수 있습니다.');
    const sourcePath = await realpath(path);
    if (sourcePath.startsWith('\\\\')) throw new UserInputError('네트워크 경로는 지원하지 않습니다.');
    const expected = ({ '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' } as Record<string, string>)[extname(path).toLowerCase()];
    if (!expected) throw new UserInputError('PNG, JPEG, WebP 이미지만 지원합니다.');
    const bytes = await readBounded(sourcePath);
    const format = detectImageFormat(bytes);
    if (!format || format !== expected) throw new UserInputError('파일 확장자와 실제 이미지 형식이 일치하지 않습니다.');
    let width: number, height: number, thumbnail: Buffer;
    try {
      const metadata = await sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
      width = metadata.width; height = metadata.height;
      if (metadata.format !== format || !width || !height || width * height * (metadata.pages ?? 1) > MAX_IMAGE_PIXELS) throw new Error('pixels');
      thumbnail = await this.thumbnail(bytes); // Decode before accepting the original.
    } catch { throw new UserInputError('손상된 이미지이거나 최대 4천만 픽셀을 초과한 이미지입니다.'); }
    const id = randomUUID();
    const relativePath = `assets/${id}.${format === 'jpeg' ? 'jpg' : format}`;
    const assetsRoot = join(this.userData, 'assets');
    await mkdir(assetsRoot, { recursive: true });
    const root = await realpath(this.userData);
    if (!(await realpath(assetsRoot)).startsWith(`${root}${sep}`)) throw new UserInputError('이미지 보관 폴더 경로가 올바르지 않습니다.');
    const destination = join(this.userData, relativePath);
    const target = await open(destination, 'wx');
    try { await target.writeFile(bytes); await target.sync(); } finally { await target.close(); }
    await this.ensureCacheRoot();
    await writeFile(this.cachePath(id), thumbnail, { flag: 'wx' });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    this.library.addAsset({ id, relative_path: relativePath, sha256,
      mime_type: `image/${format}`, width, height, original_name: basename(path) });
    this.sessionImports.add(id);
    const duplicates = this.library.cardsWithImage(sha256);
    return { id, name: basename(path, extname(path)), url: assetUrl(id), thumbnailUrl: assetUrl(id, true), width, height, sha256, ...(duplicates.length ? { duplicates } : {}) };
  }
  /** v1.3: the requested ids that were imported during this run, forgotten so they can be claimed only once. The renderer
   *  can never point the cleanup at an image from an earlier run, a backup or another card. */
  takeSessionImports(ids: readonly string[]): string[] {
    return [...new Set(ids)].filter(id => this.sessionImports.delete(id));
  }
  async readAsset(url: string): Promise<{ bytes: Buffer; mime: string } | undefined> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'app:' || parsed.host !== 'assets' || parsed.search || parsed.hash) return;
    const parts = parsed.pathname.slice(1).split('/');
    if (parts.length > 2 || (parts.length === 2 && parts[1] !== 'thumbnail')) return;
    const id = decodeURIComponent(parts[0]);
    if (!id || id.length > 128 || /[/\\\0]/.test(id)) return;
    const asset = this.library.getAsset(id);
    if (!asset) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime_type)) return;
    const task=this.readManagedAsset(asset,parts.length===2);
    const reads=this.activeReads.get(id)??new Set<Promise<unknown>>();reads.add(task);this.activeReads.set(id,reads);
    try{return await task;}finally{reads.delete(task);if(!reads.size)this.activeReads.delete(id);}
  }
  private async readManagedAsset(asset:AssetRecord,thumbnail:boolean):Promise<{bytes:Buffer;mime:string}|undefined>{
    const path = await this.managedPath(asset.relative_path);
    if (!(await stat(path)).isFile()) return;
    if (thumbnail) return { bytes: await this.readThumbnail(asset, path), mime: 'image/webp' };
    const bytes = await readBounded(path);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) return;
    return { bytes, mime: asset.mime_type };
  }
  private async readThumbnail(asset: AssetRecord, path: string): Promise<Buffer> {
    const cached = this.cachePath(asset.id);
    const cacheRoot = await this.ensureCacheRoot();
    try {
      const canonical = await realpath(cached);
      if (!canonical.startsWith(`${cacheRoot}${sep}`)) throw new UserInputError('허용되지 않은 캐시 경로입니다.');
      return await readBounded(canonical);
    } catch (error) { if (error instanceof UserInputError) throw error; /* Cache miss. */ }
    let pending = this.pendingThumbnails.get(asset.id);
    if (!pending) {
      pending = (async () => {
        const bytes = await readBounded(path);
        if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new UserInputError('원본 파일 무결성이 일치하지 않습니다.');
        const thumbnail = await this.thumbnail(bytes);
        await this.ensureCacheRoot();
        // wx avoids following an unexpected file/link created during generation.
        try { await writeFile(cached, thumbnail, { flag: 'wx' }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        return thumbnail;
      })();
      this.pendingThumbnails.set(asset.id, pending);
    }
    try { return await pending; } finally { this.pendingThumbnails.delete(asset.id); }
  }
}
