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
