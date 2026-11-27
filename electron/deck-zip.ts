import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { open as openZip, type Entry, type ZipFile as ZipReader } from 'yauzl';
import { ZipFile } from 'yazl';
import { z } from 'zod';
import { MAX_DECK_BYTES, type DeckDocument } from '../src/shared/deck-exchange';
import { detectImageFormat, MAX_IMAGE_BYTES } from './assets';
import { UserInputError } from './errors';

const limit = 512 * 1024 * 1024;
const imageName = /^images\/([0-9a-f]{64})\.(png|jpg|webp)$/;
const digest = (bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const manifestSchema=z.strictObject({
  format:z.literal('dnd-tcg-fy-deck-zip'),version:z.literal(1),deckSha256:z.string().regex(/^[a-f0-9]{64}$/),
});

export async function writeDeckZip(path:string,document:Buffer,images:Map<string,{path:string;mime:string;size:number}>) {
  if(document.length+[...images.values()].reduce((sum,image)=>sum+image.size,0)>limit)
    throw new UserInputError('이미지를 포함한 덱 ZIP은 512 MiB까지 저장할 수 있습니다.');
  const zip = new ZipFile();
  zip.on('error',error=>(zip.outputStream as Readable).destroy(error));
  const done = pipeline(zip.outputStream,createWriteStream(path,{flags:'wx'}));
  zip.addBuffer(Buffer.from(JSON.stringify({format:'dnd-tcg-fy-deck-zip',version:1,deckSha256:digest(document)})),'manifest.json');
  zip.addBuffer(document,'deck.json');
  for(const [sha,image] of images){
    zip.addFile(image.path,`images/${sha}.${image.mime==='image/jpeg'?'jpg':image.mime.slice(6)}`,{compress:false});
  }
  zip.end();
  await done;
}

function entriesOf(zip:ZipReader):Promise<Map<string,Entry>>{
  return new Promise((resolve,reject)=>{
    const entries=new Map<string,Entry>();
    let total=0;
    const fail=(message:string)=>{zip.close();reject(new UserInputError(message));};
    zip.on('error',()=>fail('덱 ZIP 파일 구조가 손상되었습니다.'));
    zip.on('end',()=>resolve(entries));
    zip.on('entry',(entry:Entry)=>{
      const name=entry.fileName;
      if(name==='data/app.sqlite3')return fail('전체 백업 ZIP입니다. 관리 → 백업·복원에서 열어 주세요.');
      if(name!=='manifest.json'&&name!=='deck.json'&&!imageName.test(name))return fail('덱 ZIP에 허용되지 않은 파일 경로가 있습니다.');
      const max=name==='manifest.json'?4096:name==='deck.json'?MAX_DECK_BYTES:MAX_IMAGE_BYTES;
      if(entries.has(name)||entry.isEncrypted()||(entry.externalFileAttributes>>>16&0xf000)===0xa000
        ||entry.uncompressedSize>max||entries.size>=5002||(total+=entry.uncompressedSize)>limit)
        return fail('덱 ZIP에 중복 항목 또는 크기 제한을 넘는 항목이 있습니다.');
      entries.set(name,entry);zip.readEntry();
    });
    zip.readEntry();
  });
}

async function readEntry(zip:ZipReader,entry:Entry):Promise<Buffer>{
  const stream=await new Promise<NodeJS.ReadableStream>((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>{
    if(error||!stream)reject(new UserInputError('덱 ZIP 항목을 읽을 수 없습니다.'));else resolve(stream);
  }));
  const chunks:Buffer[]=[];
  let size=0;
  for await (const data of stream){
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    size+=chunk.length;
    if(size>entry.uncompressedSize)throw new UserInputError('덱 ZIP 크기가 맞지 않습니다.');
    chunks.push(chunk);
  }
  if(size!==entry.uncompressedSize)throw new UserInputError('덱 ZIP 항목이 누락되거나 손상되었습니다.');
  return Buffer.concat(chunks,size);
}

export async function readDeckZip(path:string,parseDeck:(value:unknown)=>DeckDocument,
  onImage?:(sha:string,bytes:Buffer)=>Promise<void>):Promise<{deck:DeckDocument; images:Set<string>}>{
  const file=await stat(path).catch(()=>undefined);
  if(!file?.isFile()||file.size>limit+2*1024*1024)throw new UserInputError('512 MiB 이하의 덱 ZIP 파일을 선택해 주세요.');
  const zip=await new Promise<ZipReader>((resolve,reject)=>openZip(path,
    {lazyEntries:true,autoClose:false,strictFileNames:true,validateEntrySizes:true},
    (error,zip)=>error||!zip?reject(new UserInputError('덱 ZIP 파일을 열 수 없습니다.')):resolve(zip)));
  try{
    const entries=await entriesOf(zip);
    const manifest=entries.get('manifest.json');
    const document=entries.get('deck.json');
    if(!manifest||!document)throw new UserInputError('덱 교환 ZIP의 안내 파일 또는 덱 정보가 없습니다.');
    const decode=(bytes:Buffer)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const info=manifestSchema.safeParse(decode(await readEntry(zip,manifest)));
    if(!info.success)throw new UserInputError('지원하지 않는 덱 ZIP입니다. 전체 백업은 백업·복원에서 열어 주세요.');
    const documentBytes=await readEntry(zip,document);
    if(digest(documentBytes)!==info.data.deckSha256)throw new UserInputError('ZIP의 덱 정보가 손상되었습니다.');
    const deck=parseDeck(decode(documentBytes));
    const referenced=new Set(deck.cards.flatMap(card=>card.image?[card.image.sha256]:[]));
    const images=new Set<string>();
    for(const [name,entry] of entries){
      const match=imageName.exec(name);
      if(!match)continue;
      const [,sha,ext]=match;
      if(!referenced.has(sha)||images.has(sha))throw new UserInputError('덱에 없는 이미지 또는 중복된 이미지가 있습니다.');
      const bytes=await readEntry(zip,entry);
      if(digest(bytes)!==sha||detectImageFormat(bytes)!==(ext==='jpg'?'jpeg':ext))throw new UserInputError('덱 ZIP의 원본 이미지가 손상되었습니다.');
      images.add(sha);
      await onImage?.(sha,bytes);
    }
    return {deck,images};
  } catch(error){
    if(error instanceof UserInputError)throw error;
    throw new UserInputError('덱 ZIP 내용을 읽지 못했습니다. 손상된 파일인지 확인해 주세요.');
  } finally{zip.close();}
}
