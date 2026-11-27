import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { openManagement, putInDeck, openExtraFilters, closeExtraFilters } from './navigation-helpers.mjs';

const root = resolve('artifacts');
await mkdir(root, { recursive: true });
const run = await mkdtemp(join(root, 'v14-p4-'));
const binary = process.env.DND_TCG_EXECUTABLE;
const fromPath = join(run, 'source-profile');
const toPath = join(run, 'target-profile');
const jsonPath = join(run, 'deck.json');
const imagePath = join(run, 'fixture.png');
const fullImagePath = join(run, 'full-card.png');
const checks = [];
const errors = [];
let app, page;
console.log(run);
const pass = text => { checks.push(text); console.log(text); };
async function launch(userData) {
  const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, DND_TCG_TEST_NO_RELAUNCH: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DND_TCG_DEV_URL;
  app = await electron.launch({ ...(binary ? { executablePath: binary, args: [] } : { args: ['.'] }), cwd: process.cwd(), env, timeout: 45000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.board');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), userData);
  if (binary) assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
}
async function useDialog(kind, path) {
  await app.evaluate(({ dialog }, { kind, path }) => {
    if (kind === 'save') dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    else dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, { kind, path });
}
const snap = characterId => page.evaluate(async characterId => {
  const result = await window.desktop.getResources(characterId);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}, characterId);
const boot = () => page.evaluate(async () => {
  const result = await window.desktop.getBootstrap();
  if (!result.ok) throw new Error(result.error);
  return result.value;
});
const manager = () => page.getByRole('dialog', { name: '덱 JSON 교환', exact: true });
const getPreview = () => manager().getByRole('region', { name: '덱 불러오기 미리보기', exact: true });
const screenshot = name => page.screenshot({ path: join(run, name), animations: 'disabled' });
const cardName = '교환 검증 · 별빛 주문';

try {
  await sharp({ create: { width: 440, height: 260, channels: 3, background: '#456a85' } }).png().toFile(imagePath);
  await sharp({ create: { width: 420, height: 612, channels: 4, background: { r: 32, g: 63, b: 78, alpha: 0.7 } } }).png().toFile(fullImagePath);
  await launch(fromPath);
  await openManagement(page, '캐릭터·덱');
  const profiles = page.getByRole('dialog', { name: '캐릭터와 덱', exact: true });
  await profiles.getByLabel('새 캐릭터 이름').fill('보내는 마법사');
  await profiles.getByRole('button', { name: '캐릭터 만들기', exact: true }).click();
  await profiles.getByRole('heading', { name: '보내는 마법사의 덱' }).waitFor();
  const source = (await boot()).profiles[0];
  await profiles.getByLabel('새 덱 이름').fill('검증 보조 덱');
  await profiles.getByRole('button', { name: '덱 만들기', exact: true }).click();
  await profiles.getByRole('listitem').filter({ hasText: '검증 보조 덱' }).waitFor();
  await profiles.getByRole('button', { name: '캐릭터와 덱 닫기', exact: true }).click();
  await page.getByLabel('활성 덱', { exact: true }).selectOption(source.activeDeckId);
  await page.getByRole('button', { name: '카드 등록', exact: true }).click();
  const registration = page.getByRole('dialog', { name: '카드 등록', exact: true });
  await registration.getByLabel('카드 이미지 파일').setInputFiles(imagePath);
  await registration.getByLabel('이미지 표시 방식').selectOption('illustration');
  await registration.getByLabel('카드 이름', { exact: true }).fill(cardName);
  await registration.getByRole('radio', { name: '주문 슬롯', exact: true }).check();
  await registration.getByLabel('등록 기본 주문 레벨').selectOption('2');
  await registration.getByLabel('등록 허용 슬롯 범위').selectOption('fixed');
  await registration.getByLabel('등록 규칙 적용 범위').selectOption('shared');
  await registration.getByRole('checkbox', { name: '집중', exact: true }).check();
  await registration.getByRole('checkbox', { name: '의식', exact: true }).check();
  await registration.getByRole('checkbox', { name: '상위 슬롯 효과 강화', exact: true }).check();
  await registration.getByRole('region', { name: '등록 카드 사용 규칙' }).evaluate(element => element.scrollIntoView({ block: 'center' }));
  await screenshot('card-registration.png');
  await registration.getByText('카드 고유 자원', { exact: true }).click();
  await registration.getByRole('button', { name: '+ 고유 자원 추가', exact: true }).click();
  const ownedFields = registration.getByRole('group', { name: '고유 자원 1', exact: true });
  await ownedFields.getByLabel('고유 자원 1 이름').fill('별빛 충전');
  await ownedFields.getByLabel('최대량', { exact: true }).fill('7');
  await ownedFields.getByLabel('사용할 때 차감', { exact: true }).fill('2');
  await ownedFields.getByLabel('짧은 휴식 회복 방식').selectOption('fixed');
  await ownedFields.getByLabel('새벽 경과 회복 방식').selectOption('full');
  await ownedFields.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await screenshot('owned-registration.png');
  await registration.getByRole('button', { name: '카드 저장', exact: true }).click();
  await registration.waitFor({ state: 'hidden' });
  const addBasic = async (name, path) => {
    await page.getByRole('button', { name: '카드 등록', exact: true }).click();
    if (path) {
      await registration.getByLabel('카드 이미지 파일').setInputFiles(path);
      await registration.getByLabel('이미지 표시 방식').selectOption('full_card');
    }
    await registration.getByLabel('카드 이름', { exact: true }).fill(name);
    await registration.getByRole('radio', { name: '무소모', exact: true }).check();
    await registration.getByRole('button', { name: '카드 저장', exact: true }).click();
    await registration.waitFor({ state: 'hidden' });
  };
  await addBasic('교환 검증 · 완성 카드', fullImagePath);
  await addBasic('교환 검증 · 이미지 없음');
  pass('한 프로필에서 캐릭터와 덱을 만들고 완성 카드·삽화·이미지 없음, 주문 속성·슬롯 제한·고유 자원을 실제 폼으로 저장');
  await page.evaluate(async ({ name, characterId, deckId }) => {
    const ok = result => { if (!result.ok) throw new Error(result.error); return result.value; };
    const original = ok(await window.desktop.getBootstrap()).cards.find(card => card.name === name);
    const tag = ok(await window.desktop.saveTag({ name: '별빛 태그' })).tags[0];
    const definition = original.ownedResources[0];
    if (!definition || definition.maximum !== 7 || definition.amount !== 2) throw new Error('카드 폼에서 저장한 고유 자원 확인 실패');
    ok(await window.desktop.saveCards({ cards: [{
      id: original.id, name, imageAssetId: original.imageAssetId, imageMode: 'illustration', kind: 'spell', spellLevel: 2,
      concentration: true, ritual: true, upcastEffect: true, range: { kind: 'ranged', feet: 60 }, roles: ['buff'], actions: ['bonus_action'],
      tags: [tag.id], description: '카드 설명과 고급 비용을 보존합니다.', ownedResources: [definition],
    }] }));
    const change = async action => {
      const snapshot = ok(await window.desktop.getResources(characterId));
      return ok(await window.desktop.changeResource({ characterId, requestId: crypto.randomUUID(), expectedRevision: snapshot.revision, action }));
    };
    await change({ type: 'create_resource', scope: 'character', template: { name: '교환 집중', matchKey: 'exchange:focus', kind: 'counter', unit: '점', capacity: { type: 'fixed', value: 5 }, recovery: [] } });
    const { snapshot } = await change({ type: 'create_resource', scope: 'character', template: { name: '현지 재료', kind: 'counter', unit: '회', capacity: { type: 'fixed', value: 3 }, recovery: [] } });
    await change({ type: 'save_costs', scope: 'shared', cardId: original.id, bindings: [], castOptions: [
      { id: 'source-normal', label: '슬롯 + 가변 비용', casting: { mode: 'standard', allowUpcast: true, allowBelowBase: false, minSlotLevel: 2, maxSlotLevel: 6 },
        costs: [{ type: 'slot', costKey: 'source-slot', slotSelection: 'standard', autoBind: true },
          { type: 'variable', costKey: 'source-demand', min: 1, max: 5, step: 2, requirement: { kind: 'counter', key: 'exchange:unowned' } }] },
      { id: 'source-ritual', label: '의식', ritual: true, costs: [] },
    ] });
    await change({ type: 'save_costs', scope: 'character', cardId: original.id, castOptions: [
      { id: 'source-owned', label: '고유 충전 사용', costs: [] },
      { id: 'source-portable', label: '집중 비용', costs: [{ type: 'fixed', costKey: 'source-focus', amount: 1 }] },
      { id: 'source-private', label: '현지 재료 사용', costs: [{ type: 'fixed', costKey: 'source-local', amount: 1 }] },
    ], bindings: [
      { costKey: 'source-focus', resourceInstanceId: snapshot.resources.find(item => item.name === '교환 집중').id },
      { costKey: 'source-local', resourceInstanceId: snapshot.resources.find(item => item.name === '현지 재료').id },
    ] });
    const action = { type: 'use', cardId: original.id, optionId: 'source-owned', choices: {} };
    await change({ ...action, quote: ok(await window.desktop.previewResource({ characterId, action })).quote });
    const cards = ok(await window.desktop.getBootstrap()).decks.find(deck => deck.id === deckId).cardIds;
    ok(await window.desktop.setDeckCards({ deckId, cardIds: cards.reverse() }));
  }, { name: cardName, characterId: source.id, deckId: source.activeDeckId });
  await page.reload(); await page.waitForSelector('.board');
  const search = page.getByRole('searchbox', { name: '카드 이름 검색', exact: true });
  await search.fill('별빛 주문');
  const filters = await openExtraFilters(page);
  assert(await filters.isVisible());
  await closeExtraFilters(page);
  await page.getByRole('button', { name: `${cardName} 카드 선택`, exact: true }).click();
  await page.getByRole('button', { name: '짧은 휴식', exact: true }).click();
  await page.getByRole('button', { name: '회복 확정', exact: true }).click();
  const waitResource = remaining => page.waitForFunction(async ({ id, remaining }) =>
    (await window.desktop.getResources(id)).value.resources.find(item => item.name === '별빛 충전')?.remaining === remaining, { id: source.id, remaining });
  await waitResource(6);
  await page.getByRole('button', { name: '직전 자원 변경 실행 취소', exact: true }).click();
  await waitResource(5);
  await openManagement(page, '활성 덱에서 빼기');
  await page.getByRole('button', { name: `별빛 충전 · ${cardName} 상태·수정`, exact: true }).waitFor({ state: 'detached' });
  await putInDeck(page, cardName, '보내는 마법사 · 기본 덱');
  await page.getByLabel('활성 캐릭터', { exact: true }).selectOption(source.id);
  await search.fill('');
  await waitResource(5);
  const sourceSnapshot = await snap(source.id);
  assert.equal(sourceSnapshot.resources.find(item => item.name === '별빛 충전').inactive, false);
  pass('같은 프로필에서 검색·필터, 사용과 회복·실행 취소, 덱 제외와 재추가 후 잔여량 유지');
  await useDialog('save', jsonPath);
  await openManagement(page, '덱 JSON 교환');
  await manager().getByRole('button', { name: '덱 JSON 내보내기', exact: true }).click();
  await manager().getByText('카드 3장의 덱 JSON을 저장했습니다.', { exact: true }).waitFor();
  await screenshot('01-export.png');
  const document = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(document.format, 'dnd-tcg-fy-deck');
  assert.deepEqual(document.cards.map(card => card.name), ['교환 검증 · 이미지 없음', '교환 검증 · 완성 카드', cardName]);
  assert.equal(document.cards[2].castOptions[0].casting.maxSlotLevel, 6);
  assert.equal(document.cards[2].castOptions[0].costs[1].requirement.key, 'exchange:unowned');
  assert.equal(document.cards[2].characterRules[1].costs[0].requirement.key, 'exchange:focus');
  assert.equal(document.cards[2].characterRules[2].costs[0].reconnect, 'counter');
  assert.doesNotMatch(JSON.stringify(document), /"remaining"|"events"|"resourceInstanceId"|source-private/);
  assert.deepEqual(await snap(source.id), sourceSnapshot);
  pass('Windows 관리 메뉴에서 덱 저장, 카드 순서와 고급 규칙, 캐릭터별 비용 보존 및 플레이 상태 제외');
  await app.close(); app = undefined;

  await launch(toPath);
  const target = await page.evaluate(async () => {
    const result = await window.desktop.createProfile({ name: '받는 캐릭터' });
    if (!result.ok) throw new Error(result.error);
    return result.value.profiles[0];
  });
  await page.reload(); await page.waitForSelector('.board');
  const invalid = join(run, 'unsupported-deck.json');
  await writeFile(invalid, JSON.stringify({ ...document, schemaVersion: 99 }));
  await openManagement(page, '덱 JSON 교환');
  await useDialog('open', invalid);
  await manager().getByRole('button', { name: '덱 JSON 파일 선택', exact: true }).click();
  await manager().getByRole('alert').filter({ hasText: '지원하지 않는 덱 JSON 버전입니다.' }).waitFor();
  assert.equal((await boot()).cards.length, 0);
  await useDialog('open', jsonPath);
  await manager().getByRole('button', { name: '덱 JSON 파일 선택', exact: true }).click();
  let preview = getPreview();
  await preview.getByRole('heading', { name: '받는 캐릭터 · 기본 덱 (2)' }).waitFor();
  assert.equal(await preview.getByText(/같은 원본 이미지가 없습니다/).count(), 2);
  await preview.getByText(/직접 연결해야 하는 비용이 있습니다/).waitFor();
  await preview.getByText('카드 순서 보기', { exact: true }).click();
  assert.equal((await boot()).cards.length, 0);
  await screenshot('02-import-preview.png');
  await preview.getByRole('button', { name: '새 덱 불러오기 확정', exact: true }).click();
  await manager().getByRole('status').filter({ hasText: /기본 덱 \(2\).*덱을 추가했습니다/ }).waitFor();
  await manager().getByRole('button', { name: '덱 JSON 교환 닫기', exact: true }).click();
  const received = await boot();
  assert.equal(received.schemaVersion, 9);
  const deck = received.decks.find(item => item.name === '기본 덱 (2)');
  const card = received.cards.find(item => item.name === cardName);
  assert.equal(received.decks.find(item => item.id === target.activeDeckId).cardIds.length, 0);
  assert.equal(card.imageMode, 'illustration');
  assert.equal(card.imageAssetId, undefined);
  for (const field of ['concentration', 'ritual', 'upcastEffect']) assert.equal(card[field], true);
  const firstSnapshot = await snap(target.id);
  assert.deepEqual(firstSnapshot.events, []);
  assert.equal(firstSnapshot.resources[0].remaining, 7);
  pass('새 DB에서 알 수 없는 버전 거부, 충돌 이름 안내, 이미지 및 수동 재연결 안내 후 새 덱 저장');

  await page.getByLabel('활성 덱', { exact: true }).selectOption(deck.id);
  await page.getByRole('button', { name: `${cardName} 카드 선택`, exact: true }).click();
  const ledger = page.getByRole('button', { name: `별빛 충전 · ${cardName} 상태·수정`, exact: true });
  await ledger.waitFor({ state: 'visible' });
  await ledger.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await page.getByRole('button', { name: '사용 확정', exact: true }).click();
  await page.waitForFunction(async id => (await window.desktop.getResources(id)).value.resources[0].remaining === 5, target.id);
  await page.getByLabel('사용 방법', { exact: true }).selectOption({ label: '현지 재료 사용' });
  const reconnect = page.getByText('가져온 비용을 카드 사용 규칙에서 자원에 직접 연결해 주세요.', { exact: true });
  await reconnect.waitFor();
  await reconnect.evaluate(el => el.scrollIntoView({ block: 'nearest' }));
  assert.equal(await page.getByRole('button', { name: '사용 확정', exact: true }).isEnabled(), false);
  await screenshot('03-imported-deck.png');
  const spent = await snap(target.id);
  await app.close(); app = undefined;

  await launch(toPath);
  await useDialog('open', jsonPath);
  await openManagement(page, '덱 JSON 교환');
  await manager().getByRole('button', { name: '덱 JSON 파일 선택', exact: true }).click();
  preview = getPreview();
  await preview.getByText(/이미 가져온 파일입니다/).waitFor();
  await screenshot('04-repeat-import.png');
  await preview.getByRole('button', { name: '기존 덱 확인', exact: true }).click();
  await manager().getByRole('status').filter({ hasText: /덱을 이미 가져왔습니다/ }).waitFor();
  assert.deepEqual(await snap(target.id), spent);
  assert.equal((await boot()).decks.length, 2);
  const returnedPath = join(run, 'round-trip.json');
  await useDialog('save', returnedPath);
  await manager().getByRole('button', { name: '덱 JSON 내보내기', exact: true }).click();
  await manager().getByText('카드 3장의 덱 JSON을 저장했습니다.', { exact: true }).waitFor();
  const roundTrip = JSON.parse(await readFile(returnedPath, 'utf8'));
  assert.deepEqual(roundTrip, { ...document, name: '기본 덱 (2)' });
  assert.deepEqual(errors, []);
  pass('새 덱에서 고유 자원 7→5 차감, 수동 연결 전 사용 차단, 재시작과 같은 파일 재등록 시 5/7 유지, 내보내기 왕복 일치');
  await manager().getByRole('button', { name: '덱 JSON 교환 닫기', exact: true }).click();
  const zipPath = join(run, 'full-backup.zip');
  await useDialog('save', zipPath);
  await openManagement(page, '백업·복원');
  const backup = () => page.getByRole('dialog', { name: '데이터 백업·복원', exact: true });
  await backup().getByRole('button', { name: 'ZIP으로 내보내기…', exact: true }).click();
  await backup().getByText('저장했습니다').waitFor();
  await app.close(); app = undefined;
  const restorePath = join(run, 'restored-profile');
  await launch(restorePath);
  await useDialog('open', zipPath);
  await openManagement(page, '백업·복원');
  await backup().getByRole('button', { name: '백업 파일 열기…', exact: true }).click();
  await backup().getByLabel('복원 미리보기').waitFor();
  await backup().getByLabel('교체 확인 문구').fill('복원');
  const exited = new Promise(done => app.process().once('exit', done));
  await backup().getByRole('button', { name: '교체하고 다시 시작', exact: true }).click();
  await exited;
  app = undefined;
  await launch(restorePath);
  assert.deepEqual(await snap(target.id), spent);
  assert.equal((await boot()).decks.find(item => item.id === deck.id).name, '기본 덱 (2)');
  await useDialog('open', jsonPath);
  await openManagement(page, '덱 JSON 교환');
  await manager().getByRole('button', { name: '덱 JSON 파일 선택', exact: true }).click();
  await getPreview().getByText(/이미 가져온 파일입니다/).waitFor();
  assert.deepEqual(errors, []);
  pass('기존 전체 ZIP 백업을 별도 프로필로 복원했을 때 가져온 덱, 5/7 잔여량, 사용 기록과 중복 가져오기 기록 유지');
  await writeFile(join(run, 'report.json'), JSON.stringify({ outcome: 'PASS', target: binary ? 'packaged-exe' : 'built-bundle', checks, errors, fromPath, toPath }, null, 2));
} catch (error) {
  if (page) await screenshot('failure.png').catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
}
