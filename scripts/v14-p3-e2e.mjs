import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openManagement, putInDeck } from './navigation-helpers.mjs';

const root = resolve('artifacts');
await mkdir(root, { recursive: true });
const run = await mkdtemp(join(root, 'v14-p3-'));
const userData = join(run, 'user-data');
const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DND_TCG_DEV_URL;
const checks = [];
const errors = [];
let app;
let page;
const pass = name => { checks.push(name); console.log(name); };

async function launch() {
  app = await electron.launch({ args: ['.'], cwd: process.cwd(), env, timeout: 45000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.board');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), userData);
}
const resources = id => page.evaluate(async characterId => {
  const result = await window.desktop.getResources(characterId);
  if (!result.ok) throw new Error(result.error);
  return result.value.resources;
}, id);
const waitRemaining = (id, value) => page.waitForFunction(async ({ id, value }) => {
  const result = await window.desktop.getResources(id);
  return result.ok && result.value.resources.find(resource => resource.ownedDefinitionId)?.remaining === value;
}, { id, value });
const ledger = () => page.getByRole('button', { name: '별빛 · P3 별빛 부적 상태·수정', exact: true });
const select = name => page.getByRole('button', { name: `${name} 카드 선택`, exact: true }).click();

try {
  await launch();
  const characterId = await page.evaluate(async () => {
    const result = await window.desktop.createProfile({ name: 'P3 검증 캐릭터' });
    if (!result.ok) throw new Error(result.error);
    return result.value.libraryState.activeCharacterId;
  });
  await page.reload();
  await page.waitForSelector('.board');
  await page.getByRole('button', { name: '카드 등록', exact: true }).click();
  const form = page.getByRole('dialog', { name: '카드 등록', exact: true });
  await form.getByRole('textbox', { name: '카드 이름', exact: true }).fill('P3 별빛 부적');
  await form.getByText('카드 고유 자원', { exact: true }).click();
  await form.getByRole('button', { name: '+ 고유 자원 추가', exact: true }).click();
  await form.getByRole('textbox', { name: '고유 자원 1 이름', exact: true }).fill('별빛');
  await form.getByRole('spinbutton', { name: '최대량', exact: true }).fill('7');
  await form.getByRole('combobox', { name: '짧은 휴식 회복 방식', exact: true }).selectOption('fixed');
  await form.getByRole('radio', { name: '사용 횟수', exact: true }).check();
  await form.getByLabel('등록 규칙 적용 범위').selectOption('shared');
  await form.getByLabel('연결 방식',{exact:true}).selectOption('automatic');
  await form.getByRole('button',{name:'새 자원 정의',exact:true}).click();
  await form.getByLabel('정의 이름').fill('집중 자원');
  await form.getByRole('button',{name:'정의 등록',exact:true}).click();
  await form.getByRole('option',{name:/집중 자원/}).waitFor({state:'attached'});
  await form.getByRole('button', { name: '카드 저장', exact: true }).click();
  await form.waitFor({ state: 'hidden' });
  await select('P3 별빛 부적');
  const confirm = page.getByRole('button', { name: '사용 확정', exact: true });
  await page.getByText('필요한 자원을 보유하지 않았습니다.', { exact: true }).waitFor();
  assert.equal(await confirm.isEnabled(), false);
  await waitRemaining(characterId, 7);
  pass('Registers a shared resource requirement in the card UI while the character does not own it');

  await openManagement(page, '자원 관리');
  await page.getByRole('button', { name: '집중 자원 템플릿 장착', exact: true }).click();
  const resourceForm = page.getByRole('dialog', { name: '자원 설정 후 장착', exact: true });
  await resourceForm.getByLabel('최대치').fill('5');
  await resourceForm.getByRole('button', { name: '자원 저장', exact: true }).click();
  await resourceForm.waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  for (let expected = 6; expected >= 2; expected--) {
    await confirm.click();
    await waitRemaining(characterId, expected);
  }
  assert.deepEqual((await resources(characterId)).map(item => [item.name, item.remaining]), [['별빛', 2], ['집중 자원', 0]]);
  await page.getByRole('button', { name: '예외 사용 · 자원 미차감', exact: true }).waitFor();
  assert.equal(await confirm.isEnabled(), false);
  pass('Acquiring the matching resource enables the existing card and both costs are charged together');
  await page.screenshot({ path: join(run, 'mixed-cost.png') });

  await openManagement(page, '현재 덱에서만 제거');
  await ledger().waitFor({ state: 'detached' });
  const before = (await resources(characterId)).find(item => item.ownedDefinitionId);
  assert.deepEqual([before.remaining, before.inactive], [2, true]);
  await putInDeck(page, 'P3 별빛 부적', 'P3 검증 캐릭터 · 기본 덱');
  await page.getByLabel('활성 캐릭터', { exact: true }).selectOption(characterId);
  await ledger().waitFor({ state: 'attached' });
  const after = (await resources(characterId)).find(item => item.ownedDefinitionId);
  assert.deepEqual([after.id, after.remaining, after.inactive], [before.id, 2, false]);
  await app.close();
  await launch();
  assert.deepEqual((await resources(characterId)).filter(item => item.ownedDefinitionId).map(item => [item.id, item.remaining]), [[before.id, 2]]);
  assert.deepEqual(errors, []);
  pass('The ledger hides the removed card resource, then shows the same instance at 2/7 after re-add and restart');
  await writeFile(join(run, 'report.json'), JSON.stringify({ checks, errors, userData }, null, 2));
  console.log(run);
} finally {
  if (app) await app.close();
}
