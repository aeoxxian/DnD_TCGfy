export async function openAdvancedRules(page){
  const dialog=page.getByRole('dialog',{name:'카드 사용 규칙',exact:true});
  if(await dialog.locator('.basic-use-rules').count()){
    const details=dialog.locator('.use-rule-advanced');
    if(!await details.evaluate(element=>element.open))await details.locator('summary').click();
    await dialog.getByRole('button',{name:'복수 자원·사용 방식 편집',exact:true}).click();
  }
  await dialog.getByLabel('비용 편집 범위',{exact:true}).waitFor();
  return dialog;
}
