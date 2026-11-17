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
