import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import sharp from 'sharp';
import { openManagement, expandResource, openExtraFilters, closeExtraFilters } from './navigation-helpers.mjs';

const baseline=process.argv.includes('--baseline'),dev=process.argv.includes('--dev');
const binary=process.env.DND_TCG_EXECUTABLE;assert(!(dev&&binary));
await mkdir('artifacts',{recursive:true});
const run=await mkdtemp(resolve('artifacts/p4-b-')),userData=join(run,'user-data');
const env={...process.env,DND_TCG_TEST_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;delete env.DND_TCG_DEV_URL;
let server,app,page;const errors=[],benchmarks=[],matrix=[],checks=[];
if(dev){server=await createServer();await server.listen();env.DND_TCG_DEV_URL='http://127.0.0.1:5173';}
const sourceRoot=resolve(process.env.DND_TCG_CARD_FIXTURES??'artifacts/p4-b-input');
const sources=JSON.parse(await readFile(join(sourceRoot,'registered.json'),'utf8'));
assert(sources.length>0,'Provide registered.json and read-only copies of registered images');
const inputs=[];const actualHashes=[];
for(let i=1;i<=200;i++){
  const source=sources[i-1],prefix=`${i%2?'홀수':'짝수'} ${String(i).padStart(3,'0')}`;
  const file=join(run,`${prefix}${source?' '+source.name.replace(/[<>:"/\\|?*]/g,'_'):''}${source?extname(source.file):'.png'}`);
  if(source){const bytes=await readFile(join(sourceRoot,source.file));assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256);await copyFile(join(sourceRoot,source.file),file);actualHashes.push(source.sha256);}
  else await writeFile(file,await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1166"><rect width="800" height="1166" fill="#263242"/><rect x="16" y="16" width="768" height="1134" fill="none" stroke="#dec18b" stroke-width="4"/><text x="60" y="120" font-size="44" fill="white">PERFORMANCE TEST ${i}</text><text x="60" y="1060" font-size="28" fill="white">Temporary fixture / not user artwork</text></svg>`)).png().toBuffer());
  inputs.push(file);
}
async function launch(scale=1){const start=Date.now();app=await electron.launch({...(binary?{executablePath:resolve(binary),args:[`--force-device-scale-factor=${scale}`]}:{args:['.',`--force-device-scale-factor=${scale}`]}),cwd:process.cwd(),env,timeout:45000});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'관리',exact:true}).waitFor();return Date.now()-start;}
async function size(width,height,scale=1){await app.evaluate(({BrowserWindow},{width,height,scale})=>BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width/scale),Math.round(height/scale)),{width,height,scale});}
async function frame(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function capture(name){await frame();const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));await writeFile(join(run,`${name}.png`),Buffer.from(png,'base64'));}
async function cards(){const result=await page.evaluate(()=>window.desktop.getBootstrap());assert(result.ok,result.error);return result.value;}
async function resourceState(id){const result=await page.evaluate(id=>window.desktop.getResources(id),id);assert(result.ok,result.error);return result.value;}
async function seed(from,to){
  for(let i=from;i<to;i+=20){await openManagement(page,'카드 등록');const form=page.getByRole('dialog',{name:'카드 등록',exact:true});await form.getByLabel('카드 이미지 파일').setInputFiles(inputs.slice(i,Math.min(i+20,to)));await form.getByRole('button',{name:'카드 저장',exact:true}).click();await form.waitFor({state:'hidden'});}
  await page.evaluate(async()=>{const r=await window.desktop.getBootstrap();if(!r.ok)throw Error(r.error);for(let i=0;i<r.value.cards.length;i+=100){const cards=r.value.cards.slice(i,i+100).map(c=>({id:c.id,name:c.name,imageAssetId:c.imageAssetId,kind:c.kind,spellLevel:c.spellLevel,roles:c.name.startsWith('짝수')?['damage']:['utility'],actions:c.actions,range:c.range,tags:c.tags,description:c.description}));const saved=await window.desktop.saveCards({cards});if(!saved.ok)throw Error(saved.error);}});
}
async function measureFilter(query,expected){return page.evaluate(async({query,expected})=>{
  const input=document.querySelector('input[type=search]');const start=performance.now();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,query);input.dispatchEvent(new Event('input',{bubbles:true}));
  for(let i=0;i<180;i++){await new Promise(requestAnimationFrame);const buttons=[...document.querySelectorAll('.card-button')];if(buttons.length===expected&&(!query||buttons.every(b=>b.textContent.includes(query)))){await new Promise(requestAnimationFrame);return performance.now()-start;}}
  throw Error('Filter did not settle');
},{query,expected});}
try{
  await launch();await size(1920,1080);
  await seed(0,20);
  const fixture=await page.evaluate(async()=>{
    const ok=r=>{if(!r.ok)throw Error(r.error);return r.value;};const lib=ok(await window.desktop.createProfile({name:'P4-B 가독성 검수'})),profile=lib.profiles[0];
    let state=ok(await window.desktop.getResources(profile.id));const configuration={classId:'wizard',level:11};const preview=ok(await window.desktop.previewClass({characterId:profile.id,configuration}));
    state=ok(await window.desktop.changeResource({requestId:crypto.randomUUID(),characterId:profile.id,expectedRevision:state.revision,action:{type:'configure_class',configuration,quote:preview.quote}})).snapshot;
    const first=lib.cards[0];ok(await window.desktop.saveCards({cards:[{id:first.id,name:first.name,imageAssetId:first.imageAssetId,roles:first.roles,actions:first.actions,range:first.range,tags:first.tags,kind:'spell',spellLevel:4,description:'가독성 검수용 설명.\n'.repeat(80)}]}));
    state=ok(await window.desktop.getResources(profile.id));ok(await window.desktop.changeResource({requestId:crypto.randomUUID(),characterId:profile.id,expectedRevision:state.revision,action:{type:'save_costs',scope:'shared',confirmShared:true,cardId:first.id,castOptions:[{id:'use',label:'시전',costs:[{type:'slot',costKey:'slot',slotSelection:'standard',autoBind:true}]}],bindings:[]}}));
    const latest=ok(await window.desktop.getBootstrap());ok(await window.desktop.saveLibraryState({...latest.libraryState,activeCharacterId:profile.id,viewScope:'library',query:''}));return{profile:profile.id,card:first.id,name:first.name};
  });await page.reload();await page.getByRole('button',{name:`${fixture.name} 카드 선택`,exact:true}).waitFor();
  const initial=await resourceState(fixture.profile);const runtime=await app.evaluate(({app,screen})=>({appVersion:app.getVersion(),packaged:app.isPackaged,electron:process.versions.electron,node:process.versions.node,hostDisplays:screen.getAllDisplays().map(d=>({bounds:d.bounds,scaleFactor:d.scaleFactor}))}));if(binary)assert.equal(runtime.packaged,true);
  for(const count of [20,50,200]){
    if(count===50)await seed(20,50);if(count===200)await seed(50,200);
    await app.close();app=undefined;const coldLaunchMs=await launch();await size(1920,1080);await page.locator('.card-button').first().waitFor();
    assert.equal(await page.locator('.card-button').count(),count);const imageStart=Date.now();await page.waitForFunction(()=>[...document.querySelectorAll('.card-button img')].slice(0,4).every(img=>img.complete&&img.naturalWidth>0));const firstImagesMs=Date.now()-imageStart;
    const filterMs=[];for(let i=0;i<7;i++){filterMs.push(await measureFilter(i%2?'홀수':'짝수',count/2));}await measureFilter('',count);
    const roleFilterMs=[];for(let i=0;i<6;i++)roleFilterMs.push(await page.evaluate(async expected=>{const start=performance.now();document.querySelector('.role-filter [data-filter-value=damage]').click();const active=document.querySelector('.role-filter [data-filter-value=damage]').getAttribute('aria-pressed')!=='true';for(let frame=0;frame<180;frame++){await new Promise(requestAnimationFrame);if(document.querySelectorAll('.card-button').length===(active?expected/2:expected)){await new Promise(requestAnimationFrame);return performance.now()-start;}}throw Error('Role filter timeout');},count));
    const wheelMs=[];for(let i=0;i<10;i++)wheelMs.push(await page.locator('.cards-area').evaluate(async el=>{const start=performance.now(),before=el.scrollLeft;el.dispatchEvent(new WheelEvent('wheel',{deltaY:150,bubbles:true,cancelable:true}));await new Promise(requestAnimationFrame);return{ms:performance.now()-start,moved:el.scrollLeft>before};}));assert(wheelMs.every(v=>v.moved));
    const area=page.locator('.cards-area');await area.evaluate(el=>el.scrollLeft=0);const beforeDrag=(await cards()).cards;const box=await area.boundingBox();
    await page.evaluate(()=>{window.__p4Frames=[];window.__p4Last=performance.now();window.__p4Recording=true;const tick=now=>{window.__p4Frames.push(now-window.__p4Last);window.__p4Last=now;if(window.__p4Recording)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
    const start=Date.now();await page.mouse.move(box.x+box.width*.8,box.y+Math.min(120,box.height/2));await page.mouse.down();await page.mouse.move(box.x+40,box.y+Math.min(120,box.height/2),{steps:12});await page.mouse.up();const dragGestureMs=Date.now()-start;
    assert((await area.evaluate(el=>el.scrollLeft))>50);assert.equal(await page.locator('.card-button[aria-pressed=true]').count(),0);assert.deepEqual((await cards()).cards,beforeDrag);
    const frames=await page.evaluate(()=>{window.__p4Recording=false;return window.__p4Frames;});const workingSet=await app.evaluate(({app})=>app.getAppMetrics().map(p=>({type:p.type,workingSetKiB:p.memory.workingSetSize})));
    const values=filterMs.slice().sort((a,b)=>a-b),frameValues=frames.filter(v=>v>0).sort((a,b)=>a-b);
    benchmarks.push({count,coldLaunchMs,roleFilterMs,firstVisibleImagesWaitMs:firstImagesMs,filterMs,filterMedianMs:values[3],filterMaxMs:values.at(-1),wheelMs:wheelMs.map(v=>v.ms),dragGestureMs,dragFrameMedianMs:frameValues[Math.floor(frameValues.length/2)],dragFrameMaxMs:frameValues.at(-1),workingSet,rendererHeapBytes:await page.evaluate(()=>performance.memory?.usedJSHeapSize??null)});
    await area.evaluate(el=>el.scrollLeft=0);if(count===20)await capture(baseline?'before-hand-20':'after-hand-20');console.log(`Measured ${count} cards`);
  }
  const current=await cards();const first=current.cards.find(c=>c.id===fixture.card);await (async b=>{if(await b.getAttribute('aria-pressed')!=='true')await b.click();})(page.getByRole('button',{name:`${first.name} 카드 선택`,exact:true}));await page.waitForFunction(()=>!document.querySelector('.use-button')?.disabled);
  if(!baseline){
    const area=page.locator('.cards-area');await area.evaluate(el=>el.scrollLeft=0);
    const geometry=await page.locator('.card-item').evaluateAll(items=>{const a=items[0].getBoundingClientRect(),b=items[1].getBoundingClientRect();return{width:a.width,overlap:a.right-b.left};});assert(geometry.overlap>0&&geometry.overlap/geometry.width<=.081);
    await page.locator('.card-button').nth(2).hover();await page.waitForTimeout(180);assert(await page.locator('.card-button').nth(2).evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m42<0));await capture('hover-selected');
    await page.getByRole('button',{name:'격자',exact:true}).click();await page.locator('.cards-area.grid').waitFor();await capture('grid-200');await page.getByRole('button',{name:'손패',exact:true}).click();await page.locator('.cards-area.hand').waitFor();
    await page.getByRole('button',{name:'환경 설정',exact:true}).click();await page.getByRole('checkbox',{name:'모션 줄이기'}).check();await page.waitForFunction(()=>document.querySelector('.app').classList.contains('reduced-motion'));await page.getByRole('button',{name:'환경 설정 닫기',exact:true}).click();await page.locator('.card-button').nth(2).hover();assert.equal(await page.locator('.card-button').nth(2).evaluate(el=>getComputedStyle(el).transform),'none');
    await page.getByRole('button',{name:'환경 설정',exact:true}).click();await page.getByRole('checkbox',{name:'모션 줄이기'}).uncheck();await page.waitForFunction(()=>!document.querySelector('.app').classList.contains('reduced-motion'));await page.getByRole('button',{name:'환경 설정 닫기',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.card-button').nth(2).evaluate(el=>getComputedStyle(el).transform),'none');await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('.card-button').first().focus();
    checks.push('Weak overlap <=8.1%, hover lift and selected stacking, grid preserved, user/OS reduced motion disable lift');
    const selected=await page.locator('.card-button[aria-pressed=true]').getAttribute('aria-label');const state=await resourceState(fixture.profile);await page.keyboard.press('ArrowRight');assert.equal(await page.locator('.card-button[aria-pressed=true]').getAttribute('aria-label'),selected);await page.keyboard.press('End');assert.equal(await page.locator('.card-button').last().evaluate(el=>document.activeElement===el),true);await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('Space');assert.equal(await page.locator('.card-button').nth(1).getAttribute('aria-pressed'),'true');await page.keyboard.press('Enter');if(await page.locator('.card-button').nth(1).locator('.image-face').count()){const zoom=page.locator('dialog.image-lightbox');await zoom.waitFor();await page.keyboard.press('Escape');await zoom.waitFor({state:'detached'});}assert.equal(await page.locator('.card-button[aria-pressed=true]').count(),1);assert.equal(await page.locator('.card-button').nth(1).evaluate(el=>document.activeElement===el),true);await page.keyboard.press('Tab');assert(!await page.locator('.card-button').nth(2).evaluate(el=>document.activeElement===el));assert.deepEqual(await resourceState(fixture.profile),state);
    await page.locator('.card-button').first().focus();await page.keyboard.press('Control+f');assert.equal(await page.getByRole('searchbox').evaluate(el=>document.activeElement===el),true);await page.getByRole('searchbox').fill('홀수');await page.keyboard.press('ArrowLeft');assert.equal(await page.getByRole('searchbox').evaluate(el=>document.activeElement===el),true);await page.getByRole('searchbox').fill('');await measureFilter('',200);
    await (async b=>{if(await b.getAttribute('aria-pressed')!=='true')await b.click();})(page.getByRole('button',{name:`${first.name} 카드 선택`,exact:true}));await page.getByRole('button',{name:`${first.name} 미리보기 확대`,exact:true}).click();await page.getByRole('img',{name:`${first.name} 원본 확대`}).waitFor();await capture('original-reading');await page.keyboard.press('Escape');await page.locator('dialog.image-lightbox').waitFor({state:'detached'});assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('.card-button[aria-pressed=true]').count(),1);
    await expandResource(page,'주문 슬롯',4);await page.getByRole('button',{name:'우선 표시',exact:true}).click();await page.waitForFunction(async()=>Object.values((await window.desktop.getBootstrap()).value.settings.resourceViews??{}).some(v=>v.priorityIds.length));const group=page.locator('.resource-group').filter({hasText:'일반 주문 슬롯'}).first();await group.locator('summary').click();await page.waitForFunction(async()=>Object.values((await window.desktop.getBootstrap()).value.settings.resourceViews??{}).some(v=>v.collapsedGroups.includes('standard')));
    const preferences=(await cards()).settings.resourceViews;await app.close();app=undefined;await launch();assert.deepEqual((await cards()).settings.resourceViews,preferences);assert.equal(await page.locator('.resource-group').filter({hasText:'일반 주문 슬롯'}).first().evaluate(el=>el.open),false);await page.locator('.resource-group').filter({hasText:'일반 주문 슬롯'}).first().locator('summary').click();await page.waitForFunction(async()=>Object.values((await window.desktop.getBootstrap()).value.settings.resourceViews??{}).every(v=>!v.collapsedGroups.includes('standard')));
    checks.push('Roving Tab / arrows / Home / End / Space; selected card unchanged on focus navigation, no resource consumption; Ctrl+F and text input isolation; original enlargement and Escape; priority/group state restart');
  }
  for(const scale of [1,1.25,1.5]){
    await app.close();app=undefined;await launch(scale);
    for(const [width,height]of [[1920,1080],[1366,768]]){
      await size(width,height,scale);if(await page.locator('.card-button').first().getAttribute('aria-pressed')!=='true')await page.locator('.card-button').first().click();await page.waitForFunction(()=>!document.querySelector('.use-button')?.disabled);await frame();
      const m=await page.evaluate(()=>{const use=document.querySelector('.use-button').getBoundingClientRect(),image=document.querySelector('.detail-card img').getBoundingClientRect();return{viewport:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,scroll:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},use:{top:use.top,bottom:use.bottom},preview:{width:image.width,height:image.height},imageFit:getComputedStyle(document.querySelector('.detail-card img')).objectFit};});
      if(!baseline){assert(m.use.bottom<=m.viewport.height+1);assert(m.scroll.width<=m.viewport.width+1&&m.scroll.height<=m.viewport.height+1);assert.equal(m.imageFit,'contain');}
      matrix.push({width,height,scale,...m});await capture(`${baseline?'before':'after'}-${width}x${height}-${scale}`);
      if(!baseline){await openExtraFilters(page);const overlap=await page.locator('.card-item').evaluateAll(items=>{const a=items[0].getBoundingClientRect(),b=items[1].getBoundingClientRect();return(a.right-b.left)/a.width;});assert(overlap>=0&&overlap<=.081);await closeExtraFilters(page);}

    }
  }
  assert.deepEqual(await resourceState(fixture.profile),initial);assert.deepEqual(errors,[]);await app.close();app=undefined;
  const db=new DatabaseSync(join(userData,'data/app.sqlite3'),{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,6);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);const assets=db.prepare('SELECT relative_path,sha256 FROM assets').all();for(const asset of assets)assert.equal(createHash('sha256').update(await readFile(join(userData,asset.relative_path))).digest('hex'),asset.sha256);db.close();
  const result={outcome:'PASS',runtime,baseline,mode:dev?'development':binary?'packaged-windows-exe':'production-electron',actualRegisteredImages:sources.length,temporaryImages:200-sources.length,actualHashes,benchmarks,matrix,checks,errors,artifacts:run};await writeFile(join(run,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({outcome:'PASS',artifacts:run,benchmarks:benchmarks.map(({count,filterMedianMs,filterMaxMs,coldLaunchMs})=>({count,filterMedianMs,filterMaxMs,coldLaunchMs}))}));
}catch(error){await writeFile(join(run,'failure.txt'),error.stack??String(error));if(app&&page)await capture('failure').catch(()=>{});throw error;}finally{if(app)await app.close().catch(()=>{});if(server)await server.close();}
