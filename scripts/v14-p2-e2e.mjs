import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { closeExtraFilters, openExtraFilters, openManagement, registerBatch } from './navigation-helpers.mjs';

const root = resolve('artifacts');
await mkdir(root, { recursive: true });
const run = await mkdtemp(join(root, 'v14-p2-'));
const userData = join(run, 'user-data');
await cp(resolve('repository-data/user-data'), userData, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function query(path, sql, ...args) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(sql).all(...args); } finally { db.close(); }
}
const dbPath = join(userData, 'data', 'app.sqlite3');
const baselineVersion = query(dbPath, 'PRAGMA user_version')[0].user_version;
assert.equal(baselineVersion, 6, 'test starts from a v1.3 database');
const originalCards = query(dbPath, 'SELECT * FROM card_definitions ORDER BY id');
const originalEvents = query(dbPath, 'SELECT * FROM play_events ORDER BY id');
const originalTrash = query(dbPath, 'SELECT * FROM card_trash ORDER BY card_id');
const fixture = join(run, 'artwork.png');
await sharp({ create: { width: 410, height: 210, channels: 3, background: '#4878a6' } }).png().toFile(fixture);
const fixtureHash = hash(await readFile(fixture));
const binary = process.env.DND_TCG_EXECUTABLE;
const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DND_TCG_DEV_URL;
const checks = [];
function pass(name) { checks.push(name); console.log(name); }
let app;
let page;
const pageErrors = [];
async function launch() {
  app = await electron.launch({ ...(binary ? { executablePath: binary, args: [] } : { args: ['.'] }), env, cwd: process.cwd(), timeout: 45000 });
  page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForSelector('.board');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), userData);
}
const bootstrap = () => page.evaluate(async () => {
  const result = await window.desktop.getBootstrap();
  if (!result.ok) throw new Error(result.error);
  return result.value;
});
const search = name => page.getByRole('searchbox', { name: '카드 이름 검색' }).fill(name);
const tile = name => page.getByRole('button', { name: `${name} 카드 선택`, exact: true });
const select = async name => { await search(name); await tile(name).click(); };

try {
  await launch();
  assert.equal((await bootstrap()).schemaVersion, 11);
  assert.deepEqual(query(dbPath, 'SELECT * FROM card_definitions ORDER BY id'), originalCards);
  assert.deepEqual(query(dbPath, 'SELECT * FROM play_events ORDER BY id'), originalEvents);
  assert.deepEqual(query(dbPath, 'SELECT * FROM card_trash ORDER BY card_id'), originalTrash);
  const backups = join(userData, 'backups');
  const before = (await readdir(backups)).filter(name => name.startsWith('before-v6-to-v11-'));
  assert.equal(before.length, 1);
  assert.equal(query(join(backups, before[0]), 'PRAGMA user_version')[0].user_version, 6);
  pass('v1.3 database migrates once while preserving original card, event and trash rows and saving a v6 backup');

  const characterId = await page.evaluate(async () => {
    const ok = result => { if (!result.ok) throw new Error(result.error); return result.value; };
    const library = ok(await window.desktop.createProfile({ name: 'P2 검증 마법사' }));
    const characterId = library.profiles.find(item => item.name === 'P2 검증 마법사').id;
    const configuration = { classId: 'wizard', level: 3 };
    const preview = ok(await window.desktop.previewClass({ characterId, configuration }));
    const change = async action => {
      const snapshot = ok(await window.desktop.getResources(characterId));
      return ok(await window.desktop.changeResource({ characterId, requestId: crypto.randomUUID(), expectedRevision: snapshot.revision, action }));
    };
    await change({ type: 'configure_class', configuration, quote: preview.quote });
    await change({ type: 'create_resource', scope: 'character', template: {
      name: '의식 재료', kind: 'counter', unit: '회', capacity: { type: 'fixed', value: 3 }, recovery: [],
    } });
    return characterId;
  });
  await page.reload(); await page.waitForSelector('.board');
  await page.getByRole('button', { name: '카드 등록', exact: true }).click();
  let form = page.getByRole('dialog', { name: '카드 등록', exact: true });
  await form.getByLabel('카드 이미지 파일').setInputFiles(fixture);
  await form.getByLabel('이미지 표시 방식').selectOption('illustration');
  await form.getByLabel('카드 이름', { exact: true }).fill('P2 삽화 주문');
  await form.getByRole('radio', { name: '주문 슬롯', exact: true }).check();
  await form.getByLabel('등록 기본 주문 레벨').selectOption('1');
  const traits = form.getByRole('group', { name: '주문 속성' });
  await traits.getByRole('checkbox', { name: '집중', exact: true }).check();
  await traits.getByRole('checkbox', { name: '의식', exact: true }).check();
  assert(!await form.getByRole('checkbox', { name: '상위 슬롯 효과 강화', exact: true }).isChecked());
  await form.getByRole('button', { name: '카드 저장', exact: true }).click();
  await form.waitFor({ state: 'hidden' });
  await select('P2 삽화 주문');
  assert.equal(await tile('P2 삽화 주문').locator('.dc-artwork img').evaluate(el => getComputedStyle(el).objectFit), 'contain');
  await page.getByRole('button', { name: 'P2 삽화 주문 미리보기 확대' }).click();
  await page.locator('.image-lightbox .dc-artwork img').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.image-lightbox').waitFor({state:'hidden'});
  const tier = page.getByRole('combobox', { name: '시전 슬롯 1' });
  await tier.selectOption('2');
  await page.getByRole('button', { name: '사용 확정', exact: true }).click();
  await page.waitForFunction(async id => (await window.desktop.getResources(id)).value.events[0].selectedSlotLevels &&
    Object.values((await window.desktop.getResources(id)).value.events[0].selectedSlotLevels).includes(2), characterId);
  pass('Illustration registration and enlargement keep contain fit, both traits save, and a higher slot works with enhancement left off');

  await page.evaluate(async id => {
    const ok = result => { if (!result.ok) throw new Error(result.error); return result.value; };
    let snapshot = ok(await window.desktop.getResources(id));
    const material = snapshot.resources.find(item => item.name === '의식 재료');
    const slots = snapshot.resources.find(item => item.template.slotKind === 'standard');
    for (const [level, remaining] of Object.entries(slots.remainingByLevel)) {
      if (!remaining) continue;
      snapshot = ok(await window.desktop.changeResource({ characterId: id, requestId: crypto.randomUUID(), expectedRevision: snapshot.revision,
        action: {type:'adjust', resourceId:slots.id, slotLevel:Number(level), delta:-remaining} })).snapshot;
    }
    const target = ok(await window.desktop.getBootstrap()).profiles.find(item => item.id === id);
    const rule = { id:'general', label:'일반 사용', costs:[{type:'slot',costKey:'slot',slotSelection:'standard',autoBind:true},{type:'fixed',costKey:'material',amount:1}] };
    ok(await window.desktop.saveCards({ cards:[{name:'P2 의식 재료 주문', kind:'spell', spellLevel:1, ritual:true, roles:[], actions:['action'], tags:[], range:{kind:'self'}}],
      registrationTarget:{characterId:id,deckId:target.activeDeckId}, initialRules:{requestId:crypto.randomUUID(),characterId:id,expectedRevision:snapshot.revision,
        configured:true,scope:'character',castOptions:[rule],bindings:[{costKey:'material',resourceInstanceId:material.id}]} }));
  }, characterId);
  await page.reload(); await page.waitForSelector('.board');
  await select('P2 의식 재료 주문');
  assert.equal(await tile('P2 의식 재료 주문').locator('..').getAttribute('data-usability'), 'usable');
  const use = page.getByRole('button', { name: '사용 확정', exact: true });
  assert(await use.isDisabled());
  await page.getByRole('combobox', { name: '시전 방법' }).selectOption('ritual');
  await page.getByText('시전 시간 +10분 · 주문 슬롯 미소모').waitFor();
  await use.click();
  await page.waitForFunction(async id => (await window.desktop.getResources(id)).value.events[0].costSnapshot?.option.ritual, characterId);
  let snapshot = await page.evaluate(async id => (await window.desktop.getResources(id)).value, characterId);
  assert.equal(snapshot.resources.find(item => item.name === '의식 재료').remaining, 2);
  assert(Object.values(snapshot.resources.find(item => item.template.slotKind === 'standard').remainingByLevel).every(value => value === 0));
  await page.getByRole('button', { name: '직전 자원 변경 실행 취소' }).click();
  await page.waitForFunction(async id => (await window.desktop.getResources(id)).value.resources.find(item => item.name === '의식 재료').remaining === 3, characterId);
  pass('Exhausted regular slots do not block a ritual; confirmation spends the explicit counter only and Undo restores it');

  await page.evaluate(async () => {
    const base = { kind: 'spell', spellLevel: 1, roles: [], range: { kind: 'self' }, tags: [], imageMode: 'none' };
    const result = await window.desktop.saveCards({ cards: [
      { ...base, name: 'P2 집중만', concentration: true, ritual: false, actions: ['reaction'] },
      { ...base, name: 'P2 속성 없음', concentration: false, ritual: false, actions: ['bonus_action'] },
    ] });
    if (!result.ok) throw new Error(result.error);
  });
  await page.reload(); await page.waitForSelector('.board');
  await search('P2 ');
  const filters = await openExtraFilters(page);
  const traitsFilter = filters.getByRole('group', { name: '주문 속성 필터' });
  const concentration = traitsFilter.getByRole('button', { name: /집중/ });
  const ritual = traitsFilter.getByRole('button', { name: /의식/ });
  await concentration.click();
  await tile('P2 집중만').waitFor();
  await tile('P2 의식 재료 주문').waitFor({ state: 'hidden' });
  await tile('P2 속성 없음').waitFor({ state: 'hidden' });
  await ritual.click();
  await tile('P2 삽화 주문').waitFor();
  await tile('P2 집중만').waitFor({ state: 'hidden' });
  await openExtraFilters(page);
  await concentration.click();
  await tile('P2 의식 재료 주문').waitFor();
  await tile('P2 집중만').waitFor({ state: 'hidden' });
  await openExtraFilters(page);
  await ritual.click();
  await tile('P2 속성 없음').waitFor();
  await closeExtraFilters(page);
  await page.getByRole('button', { name: '필터 초기화' }).click();
  await select('P2 삽화 주문');
  await openManagement(page, '정보 수정');
  form = page.getByRole('dialog', {name:'카드 정보 수정'});
  await form.getByLabel('이미지 표시 방식').selectOption('full_card');
  await form.getByRole('checkbox',{name:'상위 슬롯 효과 강화',exact:true}).check();
  await form.getByRole('button',{name:'수정 저장',exact:true}).click();
  await form.waitFor({state:'hidden'});
  await tile('P2 삽화 주문').locator('.image-face').waitFor();
  await openManagement(page, '정보 수정');
  form = page.getByRole('dialog', {name:'카드 정보 수정'});
  await form.getByLabel('이미지 표시 방식').selectOption('none');
  await form.getByRole('button',{name:'수정 저장',exact:true}).click();
  await form.waitFor({state:'hidden'});
  await tile('P2 삽화 주문').locator('.default-face').waitFor();
  const asset = query(dbPath, 'SELECT relative_path FROM assets WHERE sha256=?', fixtureHash)[0];
  assert.equal(hash(await readFile(join(userData, asset.relative_path))), fixtureHash);
  pass('Independent trait filters, edit switching illustration to full and no-image, and the original image hash all pass');

  await search('');
  await page.getByRole('button',{name:'카드 등록',exact:true}).click();
  form = page.getByRole('dialog',{name:'카드 등록',exact:true});
  await form.getByLabel('카드 이미지 파일').setInputFiles(fixture);
  await form.getByRole('button',{name:'이미지 없는 카드 추가',exact:true}).click();
  await form.getByLabel('카드 이름 1',{exact:true}).fill('P2 일괄 그림');
  await form.getByLabel('카드 이름 2',{exact:true}).fill('P2 일괄 기본');
  await form.getByLabel('이미지 표시 방식').selectOption('illustration');
  await registerBatch(form, 2);
  await app.close(); app = undefined;
  await launch();
  const cards = (await bootstrap()).cards;
  assert.equal(cards.find(item => item.name === 'P2 일괄 그림').imageMode, 'illustration');
  assert.equal(cards.find(item => item.name === 'P2 일괄 기본').imageMode, 'none');
  assert.equal(cards.find(item => item.name === 'P2 삽화 주문').upcastEffect, true);
  const single = cards.find(item => item.name === 'P2 집중만');
  const neither = cards.find(item => item.name === 'P2 속성 없음');
  assert.deepEqual([single.concentration, single.ritual, single.actions], [true, false, ['reaction']]);
  assert.deepEqual([neither.concentration, neither.ritual, neither.actions], [false, false, ['bonus_action']]);
  assert.equal((await readdir(backups)).filter(name => name.startsWith('before-v6-to-v11-')).length, 1);
  assert.deepEqual(query(dbPath,'PRAGMA foreign_key_check'),[]);
  assert.deepEqual(pageErrors,[]);
  await search('P2 일괄');
  await page.screenshot({path:join(run,'image-modes.png')});
  pass('Mixed batch image modes survive restart; migration backup is not recreated and DB foreign keys are intact');
  await writeFile(join(run,'report.json'), JSON.stringify({outcome:'PASS',checks,run},null,2));
  console.log(run);
} finally {
  await app?.close();
}
