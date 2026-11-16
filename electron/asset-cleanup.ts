import { lstat, realpath, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import type { AppStore } from './store';
import type { AssetService } from './assets';
import type { CleanupResult } from '../src/shared/trash';
import { transaction } from './migrations';

export class AssetCleanup {
  private running?:Promise<CleanupResult>;
  constructor(private store:AppStore,private assets:AssetService,private remove:(path:string)=>Promise<void>=unlink){}
  run():Promise<CleanupResult>{if(this.running)return this.running;this.running=this.execute().finally(()=>{this.running=undefined;});return this.running;}
  private async removeManaged(relativePath:string) {
    const root=await realpath(this.store.userData);const target=resolve(this.store.userData,relativePath);
    if(!target.startsWith(`${root}${sep}`))throw new Error('관리 폴더 밖의 파일은 삭제하지 않습니다.');
    try{
      const parent=await realpath(dirname(target));
      if(!parent.startsWith(`${root}${sep}`)||parent.toLowerCase()!==dirname(target).toLowerCase())throw new Error('관리 경로가 변경되었습니다.');
      const info=await lstat(target);if(info.isSymbolicLink()||!info.isFile())throw new Error('일반 관리 파일이 아닙니다.');
      const canonical=await realpath(target);if(!canonical.startsWith(`${root}${sep}`))throw new Error('허용되지 않은 파일 경로입니다.');
      await this.remove(canonical);
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  private async execute():Promise<CleanupResult>{
    const db=this.store.db;const result:CleanupResult={removed:0,pending:0,errors:[]};
    const jobs=db.prepare('SELECT a.id,a.relative_path FROM asset_cleanup j JOIN assets a ON a.id=j.asset_id ORDER BY j.queued_at,a.id').all() as {id:string;relative_path:string}[];
    for(const job of jobs)try{
      if(!/^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/.test(job.relative_path))throw new Error('잘못된 관리 이미지 경로입니다.');
      await this.assets.waitForReads(job.id);
      if(db.prepare('SELECT 1 FROM card_definitions WHERE image_asset_id=? UNION SELECT 1 FROM card_asset_history WHERE asset_id=?').get(job.id,job.id))throw new Error('다른 카드가 참조하여 정리를 보류했습니다.');
      await this.removeManaged(job.relative_path);
      await this.removeManaged(join('cache','thumbnails',`${createHash('sha256').update(job.id).digest('hex')}.webp`));
      transaction(db,()=>{db.prepare('DELETE FROM assets WHERE id=?').run(job.id);});
      result.removed++;
    }catch(error){
      const message=error instanceof Error?error.message:'파일 정리 실패';result.errors.push(`이미지 ${job.id}: ${message}`);
      try{db.prepare('UPDATE asset_cleanup SET attempts=attempts+1,last_error=? WHERE asset_id=?').run(message.slice(0,1000),job.id);}catch{/* The durable job remains if the database is temporarily unwritable. */}
    }
    result.pending=Number(db.prepare('SELECT count(*) AS n FROM asset_cleanup').get()!.n);return result;
  }
}
