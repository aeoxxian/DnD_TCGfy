import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openManagement, putInDeck, registerBatch, showWholeLibrary } from './navigation-helpers.mjs';

const root = resolve('artifacts');
await mkdir(root, { recursive: true });
const run = await mkdtemp(join(root, 'v14-p3-audit-'));
const userData = join(run, 'user-data');
const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DND_TCG_DEV_URL;
const checks = [];
const screenshots = [];
const errors = [];
const character = '검수 마법사';
const spell = '검수 · 5레벨 주문';
const ownedCard = '검수 · 별빛 부적';
const resource = '별빛 충전';
let app;
let page;
let characterId;
const pass = text => { checks.push(text); console.log(text); };
console.log(run);

async function launch() {
  app = await electron.launch({ args: ['.'], cwd: process.cwd(), env, timeout: 45000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.board');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), userData);
}
const boot = () => page.evaluate(async () => {
  const reply = await window.desktop.getBootstrap();
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
});
const snapshot = () => page.evaluate(async id => {
  const reply = await window.desktop.getResources(id);
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}, characterId);
const own = async () => (await snapshot()).resources.find(item => item.ownerCardName === ownedCard);
const ownedCardInfo = async () => (await boot()).cards.find(card => card.name === ownedCard);
const tile = name => page.getByRole('button', { name: `${name} 카드 선택`, exact: true });
const useButton = () => page.getByRole('button', { name: '사용 확정', exact: true });
const ledger = (name = resource) => page.getByRole('button', { name: `${name} · ${ownedCard} 상태·수정`, exact: true });
const dialog = name => page.getByRole('dialog', { name, exact: true });
const fields = (form, n = 1) => form.getByRole('group', { name: `고유 자원 ${n}`, exact: true });

async function shot(name, anchor) {
  if (anchor) {
    await anchor.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await anchor.waitFor({ state: 'visible' });
  }
  await page.screenshot({ path: join(run, name), animations: 'disabled' });
  screenshots.push(name);
}
async function openRegistration(name) {
  await page.getByRole('button', { name: '카드 등록', exact: true }).click();
  const form = dialog('카드 등록');
  if (name) await form.getByLabel('카드 이름', { exact: true }).fill(name);
  return form;
}
async function save(form, button = '카드 저장') {
  await form.getByRole('button', { name: button, exact: true }).click();
  await form.waitFor({ state: 'hidden' });
}
async function selectCharacter() {
  await page.getByLabel('활성 캐릭터', { exact: true }).selectOption(characterId);
}
async function configureWizard(level) {
  await openManagement(page, '캐릭터·덱');
  await dialog('캐릭터와 덱').getByRole('button', { name: '클래스·레벨 설정', exact: true }).click();
  const modal = dialog('클래스·레벨 설정');
  await modal.getByLabel('클래스', { exact: true }).selectOption('wizard');
  await modal.getByLabel('클래스 레벨', { exact: true }).fill(String(level));
  await modal.getByRole('button', { name: '변경 미리보기', exact: true }).click();
  await modal.getByRole('button', { name: '클래스 변경 확정', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
}
async function defineResource(form,name,type) {
  await form.getByRole('button',{name:'새 자원 정의',exact:true}).click();
  await form.getByLabel('정의 이름').fill(name);
  await form.getByLabel('정의 종류').selectOption(type);
  await form.getByRole('button',{name:'정의 등록',exact:true}).click();
  await form.getByRole('option',{name:new RegExp(name)}).waitFor({state:'attached'});
  return page.evaluate(async name=>(await window.desktop.getResourceDefinitions()).value.find(item=>item.name===name),name);
}
async function declareCounter(form,name) {
  await form.getByRole('radio', { name: '사용 횟수', exact: true }).check();
  await form.getByLabel('등록 규칙 적용 범위').selectOption('shared');
  await form.getByLabel('연결 방식',{exact:true}).selectOption('automatic');
  const def=await defineResource(form,name,'uses');
  assert.equal(await form.getByLabel('등록 사용할 자원',{exact:true}).count(),0);
  return def;
}
async function addCounter(name, configure) {
  await openManagement(page, '자원 관리');
  await dialog('자원 관리').getByRole('button', { name: `${name} 템플릿 장착`, exact: true }).click();
  const form = dialog(configure?'자원 설정 후 장착':'템플릿 장착');
  if(configure) await form.getByLabel('최대치').fill('5');
  await save(form, configure?'자원 저장':'장착 확정');
  await dialog('자원 관리').getByRole('button', { name: '자원 관리 닫기', exact: true }).click();
}
async function waitOwnedAmount(remaining) {
  await page.waitForFunction(async ({ id, card, remaining }) => {
    const reply = await window.desktop.getResources(id);
    return reply.ok && reply.value.resources.find(item => item.ownerCardName === card)?.remaining === remaining;
  }, { id: characterId, card: ownedCard, remaining });
}

try {
  await launch();
  await openManagement(page, '캐릭터·덱');
  const manager = dialog('캐릭터와 덱');
  await manager.getByLabel('새 캐릭터 이름').fill(character);
  await manager.getByRole('button', { name: '캐릭터 만들기', exact: true }).click();
  await manager.getByRole('heading', { name: `${character}의 덱` }).waitFor();
  characterId = (await boot()).libraryState.activeCharacterId;
  const firstDeck = (await boot()).profiles.find(item => item.id === characterId).activeDeckId;
  await manager.getByRole('button', { name: '캐릭터와 덱 닫기', exact: true }).click();

  await configureWizard(5);
  assert.deepEqual(Object.keys((await snapshot()).resources.find(item => item.template.slotKind === 'standard').capacityByLevel), ['1', '2', '3']);
  let form = await openRegistration(spell);
  await form.getByRole('radio', { name: '주문 슬롯', exact: true }).check();
  const tier = form.getByLabel('등록 기본 주문 레벨', { exact: true });
  assert.deepEqual(await tier.locator('option').evaluateAll(options => options.map(option => option.value)), ['', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  await tier.selectOption('5');
  await form.getByLabel('등록 허용 슬롯 범위').selectOption('fixed');
  await form.getByLabel('등록 규칙 적용 범위').selectOption('shared');
  await shot('01-missing-slot-registration.png', form.getByRole('region', { name: '등록 카드 사용 규칙' }));
  await save(form);
  await tile(spell).click();
  await page.getByText('요구한 레벨의 슬롯을 보유하지 않았습니다.', { exact: true }).waitFor();
  assert.equal(await useButton().isEnabled(), false);
  await configureWizard(9);
  await useButton().click();
  await page.getByRole('button', { name: '예외 사용 · 자원 미차감', exact: true }).waitFor();
  assert.equal((await snapshot()).resources.find(item => item.template.slotKind === 'standard').remainingByLevel['5'], 0);
  pass('RES-001 · III까지 보유한 캐릭터가 등록 화면에서 I~IX를 선택하고 V 카드 저장, V 획득 후 자동 사용, 소진 표시');

  form = await openRegistration('검수 · 사용자 정의 V');
  await declareCounter(form, '임시 횟수');
  await form.getByText('고급 사용 규칙', { exact: true }).click();
  await form.getByRole('button', { name: '등록 고급 규칙 편집', exact: true }).click();
  const advanced = dialog('등록 카드 고급 사용 규칙');
  const customTrack=await defineResource(advanced,'사용자 정의 트랙','generic');
  const trackLevel = advanced.getByLabel('트랙 레벨 1-1', { exact: true });
  assert.deepEqual(await trackLevel.locator('option').evaluateAll(options => options.map(option => option.value)), ['', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  await trackLevel.selectOption('5');
  await save(advanced, '등록 규칙에 적용');
  await form.getByRole('button', { name: '이미지 없는 카드 추가', exact: true }).click();
  await form.getByText('이 카드의 고급 자원 요구를 보존하려면 먼저 카드 한 장을 저장하세요.', { exact: true }).waitFor();
  await save(form);
  await tile('검수 · 사용자 정의 V').click();
  await page.getByText('필요한 자원을 보유하지 않았습니다.', { exact: true }).waitFor();
  const custom = (await boot()).cards.find(card => card.name === '검수 · 사용자 정의 V');
  assert.deepEqual(custom.castOptions[0].costs[0].requirement, { kind: 'track', key: customTrack.key, slotKind:'generic' });
  assert.equal(custom.castOptions[0].costs[0].slotLevel, 5);
  pass('RES-001 · 사용자 정의 V 트랙을 미보유 상태로 등록하고 일괄 화면 전환 시 입력 유실 방지');

  form = await openRegistration(ownedCard);
  await form.getByLabel('카드 유형', { exact: true }).selectOption('item');
  await form.getByText('카드 고유 자원', { exact: true }).click();
  await form.getByRole('button', { name: '+ 고유 자원 추가', exact: true }).click();
  const editor = fields(form);
  await editor.getByLabel('고유 자원 1 이름', { exact: true }).fill(resource);
  await editor.getByLabel('단위', { exact: true }).fill('회');
  await editor.getByLabel('최대량', { exact: true }).fill('7');
  await editor.getByLabel('사용할 때 차감', { exact: true }).fill('1');
  await editor.getByLabel('짧은 휴식 회복 방식', { exact: true }).selectOption('fixed');
  await editor.getByLabel('짧은 휴식 회복량', { exact: true }).fill('2');
  await editor.getByLabel('새벽 경과 회복 방식', { exact: true }).selectOption('full');
  await shot('02-owned-resource-settings.png', editor);
  await form.getByRole('checkbox', { name: /등록하면.*넣기/ }).uncheck();
  await save(form);
  const saved = await ownedCardInfo();
  assert.equal(saved.ownedResources.length, 1);
  assert.deepEqual(saved.ownedResources[0].recovery, [
    { triggers: ['short_rest'], amount: { type: 'fixed', value: 2 } },
    { triggers: ['dawn'], amount: { type: 'full' } },
  ]);
  assert.equal(await own(), undefined);
  pass('RES-003 · 등록 화면에서 이름, 단위, 최대량, 차감량, 정량 및 전량 회복 설정, 라이브러리만 저장하여 미생성');

  await putInDeck(page, ownedCard, `${character} · 기본 덱`);
  await selectCharacter();
  await tile(ownedCard).click();
  await ledger().waitFor({ state: 'visible' });
  const instance = await own();
  assert.deepEqual([instance.remaining, instance.capacity, instance.inactive], [7, 7, false]);
  assert.equal((await snapshot()).bindings.some(item => item.cardId === saved.id), false);
  await shot('03-automatically-added-ledger.png', ledger());
  for (let expected = 6; expected >= 2; expected--) {
    await useButton().click();
    await waitOwnedAmount(expected);
  }
  await openManagement(page, '현재 덱에서만 제거');
  await ledger().waitFor({ state: 'detached' });
  assert.deepEqual([(await own()).remaining, (await own()).inactive], [2, true]);
  await putInDeck(page, ownedCard, `${character} · 기본 덱`);
  await selectCharacter();
  await tile(ownedCard).click();
  await ledger().waitFor({ state: 'visible' });
  assert.deepEqual([(await own()).id, (await own()).remaining], [instance.id, 2]);
  await shot('04-removed-and-readded-ledger.png', ledger());
  await openManagement(page, '정보 수정');
  form = dialog('카드 정보 수정');
  await form.getByText('카드 고유 자원 (1개)', { exact: true }).click();
  assert.equal(await fields(form).getByLabel('고유 자원 1 이름', { exact: true }).inputValue(), resource);
  await fields(form).getByLabel('고유 자원 1 이름', { exact: true }).fill('별빛 충전 개정');
  await fields(form).getByLabel('최대량', { exact: true }).fill('1');
  await fields(form).getByLabel('새벽 경과 회복 방식', { exact: true }).selectOption('none');
  await save(form, '수정 저장');
  await ledger('별빛 충전 개정').waitFor({ state: 'visible' });
  assert.deepEqual([(await own()).id, (await own()).remaining, (await own()).capacity], [instance.id, 1, 1]);
  assert.equal((await ownedCardInfo()).ownedResources[0].id, saved.ownedResources[0].id);
  assert.equal((await snapshot()).events.filter(event => event.cardId === saved.id).length, 5);
  pass('RES-003/004 · 덱 추가만으로 장부 및 비용 연결, 5회 사용 후 제거·재추가 2/7, 수정 화면에서 감소한 최대량과 기존 기록 보존');

  await openManagement(page, '캐릭터·덱');
  await manager.getByLabel('새 덱 이름').fill('재검수 덱');
  await manager.getByRole('button', { name: '덱 만들기', exact: true }).click();
  await manager.getByRole('listitem').filter({ hasText: '재검수 덱' }).waitFor();
  await manager.getByRole('button', { name: '캐릭터와 덱 닫기', exact: true }).click();
  const otherDeck = (await boot()).profiles.find(item => item.id === characterId).activeDeckId;
  assert.notEqual(firstDeck, otherDeck);
  await ledger('별빛 충전 개정').waitFor({ state: 'detached' });
  await putInDeck(page, ownedCard, `${character} · 재검수 덱`);
  await selectCharacter();
  await ledger('별빛 충전 개정').waitFor({ state: 'visible' });
  await page.getByLabel('활성 덱', { exact: true }).selectOption(firstDeck);
  await ledger('별빛 충전 개정').waitFor({ state: 'visible' });
  assert.deepEqual((await snapshot()).resources.filter(item => item.ownerCardName === ownedCard).map(item => [item.id, item.remaining]), [[instance.id, 1]]);
  pass('RES-004 · 같은 캐릭터의 두 덱에서 인스턴스 하나와 잔여량 유지');

  const templateName = '검수 자원 템플릿';
  form = await openRegistration('검수 · 사용자 정의 요구');
  const pool=await declareCounter(form, '공유 집중 A');
  await form.getByText('카드 고유 자원', { exact: true }).click();
  await form.getByRole('button', { name: '+ 고유 자원 추가', exact: true }).click();
  await fields(form).getByLabel('고유 자원 1 이름').fill('템플릿 빛');
  await fields(form).getByLabel('최대량', { exact: true }).fill('4');
  await fields(form).getByLabel('사용할 때 차감', { exact: true }).fill('2');
  await fields(form).getByLabel('새벽 경과 회복 방식', { exact: true }).selectOption('full');
  await form.getByLabel('새 템플릿 이름').fill(templateName);
  await form.getByRole('button', { name: '지금 설정을 템플릿으로 저장', exact: true }).click();
  await form.getByText(`‘${templateName}’ 템플릿을 저장했습니다.`).waitFor();
  await save(form);
  await tile('검수 · 사용자 정의 요구').click();
  await page.getByText('필요한 자원을 보유하지 않았습니다.', { exact: true }).waitFor();
  await addCounter('공유 집중 A', true);
  await useButton().click();
  await page.waitForFunction(async id => {
    const result = await window.desktop.getResources(id);
    return result.ok && result.value.resources.find(item => item.name === '공유 집중 A')?.remaining === 4
      && result.value.resources.find(item => item.name === '템플릿 빛')?.remaining === 2;
  }, characterId);
  await page.getByRole('button', { name: '직전 자원 변경 실행 취소', exact: true }).click();
  await page.waitForFunction(async id => (await window.desktop.getResources(id)).value.resources.find(item => item.name === '공유 집중 A')?.remaining === 5, characterId);
  await addCounter('공유 집중 A', false);
  await page.getByText('같은 자원 후보가 여러 개입니다. 카드 사용 규칙에서 직접 연결해 주세요.', { exact: true }).waitFor();
  assert.equal(await useButton().isEnabled(), false);
  assert.deepEqual((await snapshot()).resources.filter(item => item.templateId === pool.id).map(item => item.remaining), [5, 5]);
  pass('RES-002/003 · 사용자 정의 키 획득 후 동시 차감·Undo, 후보 둘이면 확정 비활성화와 무차감');

  await app.close();
  await launch();
  await showWholeLibrary(page);
  form = await openRegistration();
  await form.getByLabel('등록 템플릿 선택').selectOption({ label: templateName });
  await form.getByRole('button', { name: '템플릿 적용', exact: true }).click();
  await form.getByRole('button', { name: '이미지 없는 카드 추가', exact: true }).click();
  await form.getByLabel('카드 이름 1', { exact: true }).fill('검수 · 템플릿 공통');
  await form.getByLabel('카드 이름 2', { exact: true }).fill('검수 · 템플릿 개별');
  await form.getByRole('button', { name: '검수 · 템플릿 개별 개별 설정', exact: true }).click();
  const row = form.getByRole('group', { name: '검수 · 템플릿 개별 개별 설정', exact: true });
  await row.getByRole('checkbox', { name: '이 카드의 속성을 따로 정하기', exact: true }).check();
  await row.getByText('카드 고유 자원 (1개)', { exact: true }).click();
  await fields(row).getByLabel('고유 자원 1 이름').fill('개별 빛');
  await fields(row).getByLabel('최대량', { exact: true }).fill('8');
  await registerBatch(form, 2);
  const after = await boot();
  const base = after.cards.find(card => card.name === '검수 · 템플릿 공통');
  const individual = after.cards.find(card => card.name === '검수 · 템플릿 개별');
  const original = after.cards.find(card => card.name === '검수 · 사용자 정의 요구');
  assert.deepEqual(base.ownedResources, original.ownedResources);
  assert.deepEqual(individual.ownedResources, [{ ...original.ownedResources[0], name: '개별 빛', maximum: 8 }]);
  for (const card of [base, individual]) {
    assert.deepEqual(card.castOptions[0].costs[0].requirement, { kind: 'counter', key: pool.key });
    assert.equal((await snapshot()).resources.some(item => item.ownerCardName === card.name), false);
  }
  assert.deepEqual(errors, []);
  pass('DATA-003 · 재시작 후 템플릿 적용, 신규 고유 정의와 사용자 정의 요구를 공통·개별 일괄 등록에 유지');
  await writeFile(join(run, 'report.json'), JSON.stringify({ outcome: 'PASS', checks, screenshots, errors, userData }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: join(run, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
}
