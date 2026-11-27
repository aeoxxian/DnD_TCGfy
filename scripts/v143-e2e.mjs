import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron } from 'playwright';
import sharp from 'sharp';
import { openManagement, putInDeck, showWholeLibrary } from './navigation-helpers.mjs';

const root = resolve('artifacts');
await mkdir(root, { recursive: true });
const run = await mkdtemp(join(root,'v143-windows-'));
const image = join(run,'original.png');
const json = join(run,'deck.json');
const zip = join(run,'deck.zip');
const full = join(run,'full.zip');
const filename = '공유 삽화 주문';
const original = await sharp({create:{width:333,height:511,channels:4,background:{r:22,g:80,b:140,alpha:0.47}}}).png().toBuffer();
await writeFile(image,original);
const checks = [];
const binary = process.env.DND_TCG_EXECUTABLE;
let app, page, profile;
const button = (area,name) => area.getByRole('button',{name, exact:true});
const dialog = name => page.getByRole('dialog',{name, exact:true});
const exchange = () => dialog('덱 JSON·ZIP 교환');
const preview = () => exchange().getByRole('region',{name:'덱 불러오기 미리보기'});
const close = name => button(dialog(name),`${name} 닫기`).click();
const shot = name => page.screenshot({path:join(run,`${name}.png`),animations:'disabled'});
const boot = () => page.evaluate(async ()=>{const response=await window.desktop.getBootstrap();if(!response.ok)throw new Error(response.error);return response.value;});
const snapshot = id => page.evaluate(async id=>{const response=await window.desktop.getResources(id);if(!response.ok)throw new Error(response.error);return response.value;},id);
const contains = (data,deck,card) => data.decks.find(item=>item.id===deck)?.cardIds.includes(card);

async function launch(name) {
  profile=join(run,name);
  app=await electron.launch({...(binary?{executablePath:binary,args:[]}:{args:['.']}),cwd:process.cwd(),
    env:{...process.env,DND_TCG_TEST_USER_DATA:profile,DND_TCG_TEST_NO_RELAUNCH:'1'},timeout:45000});
  page=await app.firstWindow();
  page.setDefaultTimeout(15000);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1424,890));
  await page.locator('.board').waitFor();
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
  assert.equal((await boot()).appVersion,'1.4.3');
}
async function selectFile(path) {
  await app.evaluate(({dialog},path)=>{
    dialog.showSaveDialog=async()=>({canceled:false,filePath:path});
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});
  },path);
}
async function create(name) {
  await openManagement(page,'캐릭터·덱');
  const form=dialog('캐릭터와 덱');
  await form.getByLabel('새 캐릭터 이름').fill(name);
  await button(form,'캐릭터 만들기').click();
  await form.getByRole('heading',{name:`${name}의 덱`}).waitFor();
  await close('캐릭터와 덱');
  return (await boot()).profiles.find(item=>item.name===name);
}
async function openImport(characterId,mode='append') {
  await openManagement(page,'덱 JSON·ZIP 교환');
  await exchange().getByLabel('가져오는 방식').selectOption(mode);
  await exchange().getByLabel('가져올 캐릭터').selectOption(characterId);
  await inspect();
}
async function inspect() {
  await button(exchange(),'덱 JSON 또는 ZIP 파일 선택').click();
  await preview().waitFor();
}
async function openCard() {
  const card = button(page,`${filename} 카드 선택`);
  if (await card.getAttribute('aria-pressed')!=='true') await card.click();
}
async function originalBytes(id) {
  const db=new DatabaseSync(join(profile,'data','app.sqlite3'),{readOnly:true});
  try { return await readFile(join(profile,db.prepare('SELECT relative_path FROM assets WHERE id=?').get(id).relative_path)); }
  finally { db.close(); }
}

try {
  await launch('source');
  const source=await create('보내는 캐릭터');
  const other=await create('공유 대상 캐릭터');
  await page.getByLabel('활성 캐릭터').selectOption(source.id);
  await button(page,'카드 등록').click();
  const editor=dialog('카드 등록');
  await editor.getByLabel('카드 이미지 파일').setInputFiles(image);
  await editor.getByLabel('이미지 표시 방식').selectOption('illustration');
  await editor.getByLabel('카드 이름',{exact:true}).fill(filename);
  await editor.getByRole('radio',{name:'무소모',exact:true}).check();
  await editor.getByLabel('등록 규칙 적용 범위').selectOption('shared');
  await editor.getByText('카드 고유 자원',{exact:true}).click();
  await button(editor,'+ 고유 자원 추가').click();
  const owned=editor.getByRole('group',{name:'고유 자원 1',exact:true});
  await owned.getByLabel('고유 자원 1 이름').fill('교환 충전');
  await owned.getByLabel('최대량',{exact:true}).fill('5');
  await owned.getByLabel('사용할 때 차감',{exact:true}).fill('2');
  await button(editor,'카드 저장').click();
  await editor.waitFor({state:'hidden'});
  const card=(await boot()).cards.find(item=>item.name===filename);
  assert(contains(await boot(),source.activeDeckId,card.id));
  await openCard();
  await button(page,'사용 확정').click();
  await page.getByText(/교환 충전/).first().waitFor();
  const spent=await snapshot(source.id);
  assert.equal(spent.resources.find(item=>item.ownedDefinitionId).remaining,3);
  await selectFile(json);
  await openManagement(page,'덱 JSON·ZIP 교환');
  await button(exchange(),'덱 JSON 내보내기').click();
  await exchange().getByText(/덱 JSON을 저장했습니다/).waitFor();
  await close('덱 JSON·ZIP 교환');
  await selectFile(zip);
  await openManagement(page,'덱 JSON·ZIP 교환');
  await button(exchange(),'이미지 포함 덱 ZIP 내보내기').click();
  await exchange().getByText(/덱 ZIP을 저장했습니다/).waitFor();
  await shot('zip-export');
  await close('덱 JSON·ZIP 교환');
  await selectFile(full);
  await openManagement(page,'백업·복원');
  await button(dialog('데이터 백업·복원'),'ZIP으로 내보내기…').click();
  await dialog('데이터 백업·복원').getByText('저장했습니다',{exact:false}).waitFor();
  await close('데이터 백업·복원');
  await openManagement(page,'덱 JSON·ZIP 교환');
  await button(exchange(),'덱 JSON 또는 ZIP 파일 선택').click();
  await exchange().getByRole('alert').filter({hasText:'전체 백업 ZIP'}).waitFor();
  await close('덱 JSON·ZIP 교환');

  await selectFile(json);
  await openImport(other.id);
  await preview().getByText(/기존 카드 연결/).waitFor();
  assert.equal(await preview().getByText(/같은 원본 이미지가 없습니다/).count(),0);
  await button(preview(),'기존 덱에 추가 확정').click();
  await exchange().getByText(/기존 연결 1장/).waitFor();
  await close('덱 JSON·ZIP 교환');
  await openCard();
  await openManagement(page,'현재 덱에서만 제거');
  assert.equal(contains(await boot(),source.activeDeckId,card.id),false);
  assert(contains(await boot(),other.activeDeckId,card.id));
  checks.push('JSON 재사용과 현재 덱에서만 제거 후 다른 캐릭터의 덱 보존');
  await showWholeLibrary(page);
  await putInDeck(page,filename,'보내는 캐릭터 · 기본 덱');
  await openCard();
  await openManagement(page,'라이브러리 원본을 휴지통으로 이동');
  const trash=dialog('휴지통 이동 확인');
  await trash.getByText(/영향을 받는 덱.*공유 대상 캐릭터/).waitFor();
  await shot('library-impact');
  await button(trash,'휴지통으로 이동 확정').click();
  await trash.waitFor({state:'hidden'});
  await openImport(source.id);
  const restore=preview().getByRole('checkbox',{name:`${filename} 복원 후 추가`});
  assert(await restore.isChecked());
  assert.equal((await boot()).cards.some(item=>item.id===card.id),false);
  await shot('restore-preview');
  await button(preview(),'미리보기 닫기').click();
  assert.equal((await boot()).cards.some(item=>item.id===card.id),false);
  await inspect();
  await button(preview(),'기존 덱에 추가 확정').click();
  await exchange().getByText(/휴지통 복원 1장/).waitFor();
  assert(contains(await boot(),source.activeDeckId,card.id));
  assert(contains(await boot(),other.activeDeckId,card.id));
  const resumed=await snapshot(source.id);
  assert.deepEqual(resumed.events,spent.events);
  assert.equal(resumed.resources.find(item=>item.ownedDefinitionId).remaining,3);
  await inspect();
  await button(preview(),'기존 덱 확인').click();
  await exchange().getByRole('status').filter({hasText:/중복 1장/}).waitFor();
  assert.deepEqual((await snapshot(source.id)).resources,resumed.resources);
  checks.push('휴지통 미리보기 취소와 화면 내 복원, 두 덱·잔여량·기록·반복 가져오기 검증');
  await app.close();
  app=undefined;

  await launch('clean');
  const clean=await create('새 프로필');
  await selectFile(json);
  await openImport(clean.id);
  await preview().getByText(/같은 원본 이미지가 없습니다/).waitFor();
  await button(preview(),'기존 덱에 추가 확정').click();
  await exchange().getByText(/신규 등록 1장/).waitFor();
  const imported=(await boot()).cards.find(item=>item.name===filename);
  assert(imported.imageReference);
  await selectFile(zip);
  await inspect();
  assert.equal(await preview().getByText(/같은 원본 이미지가 없습니다/).count(),0);
  await button(preview(),'기존 덱 확인').click();
  await exchange().getByRole('status').filter({hasText:/중복 1장/}).waitFor();
  const repaired=(await boot()).cards.find(item=>item.id===imported.id);
  assert.equal(repaired.imageReference,undefined);
  assert.deepEqual(Buffer.from(await originalBytes(repaired.imageAssetId)),original);
  await exchange().getByLabel('가져오는 방식').selectOption('new');
  await inspect();
  await button(preview(),'새 덱 불러오기 확정').click();
  await exchange().getByText(/덱을 추가했습니다/).waitFor();
  assert.equal(new Set((await boot()).cards.map(item=>item.imageAssetId)).size,1);
  const state=await snapshot(clean.id);
  assert.equal(state.events.length,0);
  assert(state.resources.every(item=>!item.ownedDefinitionId || item.remaining===5));
  checks.push('깨끗한 프로필에서 JSON 누락 안내, ZIP 직접 연결·새 덱, RGBA 원본 바이트와 자원 정의 보존');
  await close('덱 JSON·ZIP 교환');
  await app.close();
  app=undefined;
  await launch('clean');
  assert.deepEqual(Buffer.from(await originalBytes(repaired.imageAssetId)),original);
  checks.push('재시작 후 ZIP으로 연결한 원본 보존');
  await writeFile(join(run,'report.json'),JSON.stringify({ outcome:'PASS', checks },null,2));
  console.log(run);
} catch(error) {
  if(page) await shot('failure').catch(()=>undefined);
  await writeFile(join(run,'report.json'),JSON.stringify({ outcome:'FAIL', checks, error:String(error) },null,2));
  console.error(run);
  throw error;
} finally { if(app) await app.close(); }
