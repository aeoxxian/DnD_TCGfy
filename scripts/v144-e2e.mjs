import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron } from 'playwright';
import sharp from 'sharp';
import { openManagement } from './navigation-helpers.mjs';

const root=resolve('artifacts');
await mkdir(root,{recursive:true});
const run=await mkdtemp(join(root,'v144-windows-'));
const profile=join(run,'profile');
const image=join(run,'shared.png');
const json=join(run,'deck.json');
const zip=join(run,'deck.zip');
const png=await sharp({create:{width:44,height:62,channels:4,background:{r:32,g:71,b:108,alpha:0.5}}}).png().toBuffer();
await writeFile(image,png);
const checks=[];
const binary=process.env.DND_TCG_EXECUTABLE;
const app=await electron.launch({...(binary?{executablePath:binary,args:[]}:{args:['.']}),cwd:process.cwd(),
  env:{...process.env,DND_TCG_TEST_USER_DATA:profile},timeout:45000});
const page=await app.firstWindow();
page.setDefaultTimeout(18000);
const dialog=name=>page.getByRole('dialog',{name,exact:true});
const button=(area,name)=>area.getByRole('button',{name,exact:true});
const manager=dialog('캐릭터와 덱');
const exchange=dialog('덱 JSON·ZIP 교환');
const importPreview=()=>exchange.getByRole('region',{name:'덱 불러오기 미리보기'});
const close=name=>button(dialog(name),`${name} 닫기`).click();
const shot=name=>page.screenshot({path:join(run,`${name}.png`),animations:'disabled'});
const boot=()=>page.evaluate(async()=>{const response=await window.desktop.getBootstrap();if(!response.ok)throw new Error(response.error);return response.value;});
const state=id=>page.evaluate(async id=>{const response=await window.desktop.getResources(id);if(!response.ok)throw new Error(response.error);return response.value;},id);

async function chooseFile(path) {
  await app.evaluate(({dialog},path)=>{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});
    dialog.showSaveDialog=async()=>({canceled:false,filePath:path});
  },path);
}
async function createProfile(name) {
  await openManagement(page,'캐릭터·덱');
  await manager.getByLabel('새 캐릭터 이름').fill(name);
  await button(manager,'캐릭터 만들기').click();
  await manager.getByRole('heading',{name:`${name}의 덱`}).waitFor();
  await close('캐릭터와 덱');
  return (await boot()).profiles.find(item=>item.name===name);
}
async function openProfile(id) {
  await openManagement(page,'캐릭터·덱');
  await manager.getByLabel('관리할 캐릭터').selectOption(id);
}
async function archive(kind, id, owner) {
  const data=await boot();
  const item=(kind==='deck'?data.decks:data.profiles).find(item=>item.id===id);
  assert(item);
  await openProfile(owner);
  await button(manager,kind==='deck'?`${item.name} 삭제`:'캐릭터 삭제').click();
  const review=dialog(kind==='deck'?'덱 삭제 확인':'캐릭터 삭제 확인');
  await button(review,'휴지통으로 이동').click();
  await review.waitFor({state:'hidden'});
  await close('캐릭터와 덱');
  assert((await boot()).profileTrash.some(item=>item.id===id));
  return item;
}
async function openTrash() {
  await openManagement(page,'캐릭터·덱');
  const section=manager.getByText(/^캐릭터·덱 휴지통 \(/);
  if (!await section.evaluate(element=>element.parentElement.open)) await section.click();
}
async function purge(label, evidence, screenshot) {
  const review=dialog('캐릭터·덱 영구 삭제 확인');
  await button(manager,label).click();
  await review.getByText(evidence).first().waitFor();
  assert(await button(review,'영구 삭제 확정').isDisabled());
  await button(review,'취소').click();
  await button(manager,label).click();
  await review.getByLabel('영구 삭제 확인 문구').fill('영구 삭제');
  if (screenshot) await shot(screenshot);
  await button(review,'영구 삭제 확정').click();
  await review.waitFor({state:'hidden'});
  await close('캐릭터와 덱');
}
async function inspect(path,id) {
  await chooseFile(path);
  await openManagement(page,'덱 JSON·ZIP 교환');
  await exchange.getByLabel('가져오는 방식').selectOption('new');
  await exchange.getByLabel('가져올 캐릭터').selectOption(id);
  await button(exchange,'덱 JSON 또는 ZIP 파일 선택').click();
  await importPreview().waitFor();
}
async function createFromPreview() {
  const before=new Set((await boot()).decks.map(deck=>deck.id));
  await button(importPreview(),'새 덱 불러오기 확정').click();
  await exchange.getByRole('status').filter({hasText:'덱을 추가했습니다'}).waitFor();
  await close('덱 JSON·ZIP 교환');
  const added=(await boot()).decks.filter(deck=>!before.has(deck.id));
  assert.equal(added.length,1);
  return added[0];
}

try {
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
  await page.locator('.board').waitFor();
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
  assert.equal((await boot()).appVersion,'1.4.4');
  assert.equal((await boot()).schemaVersion,12);
  const source=await createProfile('덱 복원 검수');
  await button(page,'카드 등록').click();
  const editor=dialog('카드 등록');
  await editor.getByLabel('카드 이미지 파일').setInputFiles(image);
  await editor.getByLabel('이미지 표시 방식').selectOption('illustration');
  await editor.getByLabel('카드 이름',{exact:true}).fill('공유 원본');
  await editor.getByRole('radio',{name:'무소모',exact:true}).check();
  await editor.getByLabel('등록 규칙 적용 범위').selectOption('shared');
  await editor.getByText('카드 고유 자원',{exact:true}).click();
  await button(editor,'+ 고유 자원 추가').click();
  await editor.getByLabel('고유 자원 1 이름').fill('복원 충전');
  await editor.getByLabel('최대량',{exact:true}).fill('5');
  await editor.getByLabel('사용할 때 차감',{exact:true}).fill('2');
  await button(editor,'카드 저장').click();
  await editor.waitFor({state:'hidden'});
  const card=(await boot()).cards.find(item=>item.name==='공유 원본');
  await button(page,'공유 원본 카드 선택').click();
  await button(page,'사용 확정').click();
  await page.waitForFunction(async id=>(await window.desktop.getResources(id)).value.resources.some(item=>item.remaining===3),source.id);
  const spent=await state(source.id);
  for (const [path,label] of [[json,'덱 JSON 내보내기'],[zip,'이미지 포함 덱 ZIP 내보내기']]) {
    await chooseFile(path);
    await openManagement(page,'덱 JSON·ZIP 교환');
    await button(exchange,label).click();
    await exchange.getByRole('status').filter({hasText:'저장했습니다'}).waitFor();
    await close('덱 JSON·ZIP 교환');
  }
  await inspect(json,source.id);
  const first=await createFromPreview();
  assert.deepEqual(first.cardIds,[card.id]);
  await archive('deck',first.id,source.id);
  await archive('deck',source.activeDeckId,source.id);
  assert.equal((await boot()).profiles.find(item=>item.id===source.id).activeDeckId,undefined);
  await inspect(zip,source.id);
  const choice=()=>importPreview().getByLabel('새 덱 생성 또는 기존 덱 복원');
  await choice().getByRole('option',{name:new RegExp(first.name.replace(/[()]/g,'\\$&')+' 복원')}).waitFor({state:'attached'});
  assert.equal(await choice().inputValue(),'');
  const second=await createFromPreview();
  assert.deepEqual(second.cardIds,[card.id]);
  assert.equal((await boot()).profiles.find(item=>item.id===source.id).activeDeckId,second.id);
  assert((await boot()).profileTrash.some(item=>item.id===first.id));
  await archive('deck',second.id,source.id);
  await inspect(json,source.id);
  assert.equal(await choice().locator('option').count(),3);
  await choice().selectOption(first.id);
  await shot('restore-choice');
  await button(importPreview(),'기존 덱 복원 확정').click();
  await exchange.getByRole('status').filter({hasText:'덱을 휴지통에서 복원했습니다'}).waitFor();
  await close('덱 JSON·ZIP 교환');
  assert.deepEqual((await boot()).decks.find(deck=>deck.id===first.id),first);
  assert.equal((await state(source.id)).resources[0].remaining,3);
  assert.deepEqual((await state(source.id)).events,spent.events);
  checks.push('JSON 신규 → 덱 삭제 → ZIP으로 신규 생성 → 동일 JSON에서 복수 후보 중 원본 덱 직접 복원');

  await openTrash();
  await purge(`${source.name} · ${second.name} 영구 삭제`,/연결된 카드 원본 1장/,'purge-deck');
  assert(!(await boot()).profileTrash.some(item=>item.id===second.id));
  await inspect(zip,source.id);
  assert.equal(await choice().count(),0);
  await button(importPreview(),'같은 파일로 새 덱 만들기').click();
  const again=await createFromPreview();
  assert.notEqual(again.id,second.id);
  assert.deepEqual(again.cardIds,[card.id]);
  const other=await createProfile('영구 삭제 검수');
  const invoke=()=>page.evaluate(async({owner,cardId})=>{
    const result=await window.desktop.setDeckCards({deckId:owner.activeDeckId,cardIds:[cardId],operation:'add'});
    if(!result.ok)throw new Error(result.error);
  },{owner:other,cardId:card.id});
  await invoke();
  await archive('profile',other.id,other.id);
  await openTrash();
  await purge(`${other.name} 영구 삭제`,/자원 1개/,'purge-profile');
  const batch=await createProfile('휴지통 비우기 검수');
  await archive('profile',batch.id,batch.id);
  await archive('deck',again.id,source.id);
  await openTrash();
  await purge('캐릭터·덱 휴지통 비우기',/휴지통 비우기 검수/,'purge-all');
  const final=await boot();
  assert.deepEqual(final.profiles.map(item=>item.id),[source.id]);
  assert.equal(final.profileTrash.length,0);
  assert.deepEqual(final.cards.map(item=>[item.id,item.imageAssetId]),[[card.id,card.imageAssetId]]);
  assert.deepEqual(final.decks.find(deck=>deck.id===first.id),first);
  assert.deepEqual((await state(source.id)).events,spent.events);
  assert.equal((await state(source.id)).resources[0].remaining,3);
  const db=new DatabaseSync(join(profile,'data','app.sqlite3'),{readOnly:true});
  try {
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deck_exchange_imports WHERE deck_id=?').get(second.id).n,0);
    const original=db.prepare('SELECT relative_path FROM assets WHERE id=?').get(card.imageAssetId);
    assert.deepEqual(await readFile(join(profile,original.relative_path)),png);
  } finally {db.close();}
  checks.push('개별 덱·캐릭터 영구 삭제, 취소, 휴지통 비우기, 영구 삭제 후 재가져오기와 공유 카드·원본·잔여량·기록 검증');
  await writeFile(join(run,'report.json'),JSON.stringify({outcome:'PASS',checks},null,2));
  console.log(run);
} catch(error) {
  await shot('failure').catch(()=>undefined);
  await writeFile(join(run,'report.json'),JSON.stringify({outcome:'FAIL',checks,error:String(error)},null,2));
  console.error(run);
  throw error;
} finally {await app.close();}
