export async function openManagement(page,name){
  await page.getByRole('button',{name:'관리',exact:true}).click();
  await page.getByRole('dialog',{name:'관리 메뉴',exact:true}).getByRole('button',{name,exact:true}).click();
}
export async function expandResource(page,name,level){
  const row=page.getByRole('button',{name:`${name}${level!==undefined?` ${level}레벨`:''} 상태·수정`,exact:true});
  const group=row.locator('xpath=ancestor::details[contains(@class,"resource-group")]');
  if(!await group.evaluate(el=>el.open))await group.locator(':scope > summary').click();
  if(await row.getAttribute('aria-expanded')!=='true')await row.click();
}
// v1.1: the extra filters are a native popover (top layer, light dismiss).
export async function openExtraFilters(page){
  const panel=page.locator('#extra-filters-panel');
  if(!await panel.evaluate(el=>el.matches(':popover-open')))await page.locator('.extra-filters-toggle').click();
  await panel.waitFor({state:'visible'});
  return panel;
}
export async function closeExtraFilters(page){
  const panel=page.locator('#extra-filters-panel');
  // The close button, not Escape: Escape in a focused search field clears the field instead.
  if(await panel.evaluate(el=>el.matches(':popover-open'))){await panel.locator('.extra-filters-close').click();await panel.waitFor({state:'hidden'});}
}
// v1.1 P2: card edits and the move to the trash sit inside the "선택 카드 일괄 작업" disclosure of the selection bar.
export async function openBulkActions(page){
  const details=page.locator('.batch-tools > details');
  if(!await details.evaluate(el=>el.open))await details.locator(':scope > summary').click();
  return details;
}
// v1.2: decks are built from the whole library (전체 라이브러리 → select the card → 관리 → "<캐릭터> · <덱>에 넣기").
export async function showWholeLibrary(page){
  const character=page.getByLabel('활성 캐릭터',{exact:true});
  if(await character.inputValue()){await character.selectOption('');await page.locator('.deck-label strong',{hasText:'전체 라이브러리'}).waitFor();}
}
export async function putInDeck(page,title,deckLabel){
  await showWholeLibrary(page);
  const card=page.getByRole('button',{name:`${title} 카드 선택`,exact:true});if(await card.getAttribute('aria-pressed')!=='true')await card.click();
  await page.getByRole('button',{name:'관리',exact:true}).click();const menu=page.getByRole('dialog',{name:'관리 메뉴',exact:true});
  await menu.getByRole('button',{name:`${deckLabel}에 넣기`,exact:true}).click();await menu.getByRole('button',{name:`${deckLabel}에서 빼기`,exact:true}).waitFor();await page.keyboard.press('Escape');
}
/** v1.3 Phase 2: register the cards of a multi-image form — “N장 등록” → final check → 등록 시작 → result → 닫기. */
export async function registerBatch(form,count){
  const start=form.getByRole('button',count?{name:`${count}장 등록`,exact:true}:{name:/^\d+장 등록$/});await start.click();
  await form.getByRole('region',{name:'등록 전 최종 확인',exact:true}).waitFor();await form.getByRole('button',{name:'등록 시작',exact:true}).click();
  await form.getByRole('region',{name:'등록 결과',exact:true}).getByRole('heading',{name:/장 등록 완료$/}).waitFor({timeout:120000});
  await form.getByRole('button',{name:'닫기',exact:true}).last().click();await form.waitFor({state:'hidden'});
}
