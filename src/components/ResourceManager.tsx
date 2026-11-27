import { BatchReview } from './BatchEdits';
import type { EditAction } from '../shared/bulk';
import { useState, type FormEvent } from 'react';
import type { CardDefinition, SlotColorSet } from '../shared/contracts';
import { SlotColorEditor } from './SlotColorEditor';
import { templateDraftSchema, type ResourceOverrides, type ResourceTemplate, type ResourceView, type TemplateDraft } from '../shared/resources';
import { PRESET_UNITS, recoveryChoices, recoveryRules, type RecoveryChoices } from '../shared/resource-drafts';
import { RecoveryFieldset } from './ResourceFields';
import type { ResourceController } from './ResourcePanel';
import { Modal } from './Modal';

type Mode = 'new'|'clone'|'edit_template'|'attach'|'instance';
interface FormSelection { mode: Mode; template?: ResourceTemplate; resource?: ResourceView }

function ResourceForm({ selection, cards, controller, onClose }: { selection: FormSelection; cards: CardDefinition[]; controller: ResourceController; onClose: () => void }) {
  const { mode, resource } = selection; const initial = selection.template ?? resource?.template;
  const [revision] = useState(controller.snapshot!.revision);
  const [name,setName] = useState(resource?.name ?? (initial ? `${initial.name}${mode === 'clone' ? ' 복제' : ''}` : ''));
  const [matchKey,setMatchKey] = useState(mode === 'clone' ? '' : initial?.matchKey ?? '');
  const [unit,setUnit] = useState(initial?.unit ?? '점'); const [customUnit,setCustomUnit] = useState(initial?.unit ?? '');
  const [kind,setKind] = useState<'counter'|'slot_track'>(initial?.kind ?? 'counter');
  const [slotKind,setSlotKind]=useState(initial?.slotKind??'generic');const [unlimited,setUnlimited]=useState(resource?.unlimited??initial?.unlimited??false);
  const canFollow=!!resource&&(!!resource.presetKey||resource.template.capacity?.type!=='fixed');const [follow,setFollow]=useState(canFollow&&resource?.overrides.capacityOverride===undefined&&resource?.overrides.slotCapacityOverride===undefined);
  const [capacity,setCapacity] = useState(resource?.capacity ?? (initial?.capacity?.type === 'fixed' ? initial.capacity.value : 5));
  const [slots,setSlots] = useState<Record<string,number>>(() => resource?.capacityByLevel ?? Object.fromEntries(Array.from({length:9},(_,i) => [String(i+1),initial?.slotCapacity?.[String(i+1)]?.type === 'fixed' ? (initial.slotCapacity[String(i+1)] as {value:number}).value : i === 0 ? 2 : 0])));
  const [preserveRule,setPreserveRule] = useState(!resource && !!initial && (initial.kind === 'counter' ? initial.capacity?.type !== 'fixed' : !!initial.slotCapacityByClassLevel || Object.values(initial.slotCapacity ?? {}).some(rule => rule.type !== 'fixed')));
  const [recovery,setRecovery] = useState<RecoveryChoices>(() => recoveryChoices(initial?.recovery));
  const [scope,setScope] = useState<ResourceOverrides['scope']>(resource?.overrides.scope ?? 'character');
  const [owner,setOwner] = useState(resource?.overrides.ownerCardId ?? ''); const [templateOnly,setTemplateOnly] = useState(false); const [error,setError] = useState('');
  const locked = mode === 'attach' || mode === 'instance'; const busy = controller.busy;
  const allowedOwners = cards.filter(card => scope !== 'item' || card.kind === 'item');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    const actualUnit = PRESET_UNITS.includes(unit) ? unit : customUnit;
    const scopeInfo = { scope, ownerCardId: scope === 'character' ? undefined : owner || undefined };
    if (mode === 'attach') { if (await controller.perform({ type:'attach',templateId:initial!.id,...scopeInfo },revision)) onClose(); return; }
    if (mode === 'instance') {
      const overrides: ResourceOverrides = { ...scopeInfo,nameOverride:name,unlimitedOverride:unlimited===initial?.unlimited?undefined:unlimited,capacityOverride:kind === 'counter'&&!follow ? capacity : undefined,slotCapacityOverride:kind === 'slot_track'&&!follow ? Object.fromEntries(Object.entries(slots).filter(([,n])=>n>0)) : undefined };
      if (await controller.perform({ type:'edit_resource',resourceId:resource!.id,overrides },revision)) onClose(); return;
    }
    const draft: TemplateDraft = {
      id: mode === 'edit_template' ? initial?.id : undefined,name,unit:actualUnit,kind,matchKey:matchKey.trim()||undefined,unlimited:kind==='counter'?unlimited:undefined,slotKind:kind==='slot_track'?slotKind:undefined,
      capacity: kind === 'counter' ? preserveRule ? initial?.capacity : {type:'fixed',value:capacity} : undefined,
      slotCapacity: kind === 'slot_track' && !(preserveRule && initial?.slotCapacityByClassLevel) ? preserveRule ? initial?.slotCapacity : Object.fromEntries(Object.entries(slots).filter(([,n])=>n>0).map(([level,value])=>[level,{type:'fixed' as const,value}])) : undefined,
      slotCapacityByClassLevel: kind === 'slot_track' && preserveRule ? initial?.slotCapacityByClassLevel : undefined,
      recovery:recoveryRules(recovery,kind),
    };
    const parsed=templateDraftSchema.safeParse(draft); if(!parsed.success){setError(parsed.error.issues[0].message);return;}
    const action = mode === 'edit_template' || templateOnly ? {type:'save_template' as const,template:draft} : {type:'create_resource' as const,template:draft,...scopeInfo};
    if(await controller.perform(action,revision)) onClose();
  }
  const title = mode === 'instance' ? '장착 자원 설정' : mode === 'attach' ? '템플릿 장착' : mode === 'edit_template' ? '템플릿 편집' : mode === 'clone' ? '자원 템플릿 복제' : '새 자원';
  return <Modal title={title} onClose={()=>{if(!busy)onClose();}}><form onSubmit={event=>void submit(event)}>
    <label className="form-field">자원 이름<input required maxLength={100} value={name} disabled={busy || mode === 'attach'} onChange={event=>setName(event.target.value)} /></label>
    <div className="form-columns"><label className="form-field">자원 종류<select aria-label="자원 종류" value={kind} disabled={busy || locked || mode === 'edit_template'} onChange={event=>{setKind(event.target.value as typeof kind);setPreserveRule(false);if(event.target.value==='slot_track')setRecovery(current=>Object.fromEntries(Object.entries(current).map(([key,rule])=>[key,rule.type==='fixed'?{...rule,type:'none' as const}:rule])) as RecoveryChoices);}}><option value="counter">횟수 / 포인트</option><option value="slot_track">레벨별 슬롯 트랙</option></select></label><label className="form-field">단위<select aria-label="단위" value={['점','회','개','슬롯'].includes(unit)?unit:'custom'} disabled={busy || locked} onChange={event=>setUnit(event.target.value)}>{['점','회','개','슬롯'].map(unit=><option key={unit}>{unit}</option>)}<option value="custom">사용자 정의</option></select></label></div>
    {!['점','회','개','슬롯'].includes(unit) && <label className="form-field">사용자 정의 단위<input required maxLength={30} value={customUnit} disabled={busy||locked} onChange={event=>setCustomUnit(event.target.value)} /></label>}
    {kind==='slot_track'&&<label className="form-field">슬롯 종류<select aria-label="슬롯 종류" value={slotKind} disabled={busy||locked} onChange={event=>setSlotKind(event.target.value as typeof slotKind)}><option value="generic">일반 자원 트랙 · 시전 아님</option><option value="standard">일반 주문 슬롯</option><option value="pact">계약 마법 · 단일 단계</option></select></label>}
    {kind==='counter'&&<label className="checkbox-line"><input type="checkbox" checked={unlimited} disabled={busy||mode==='attach'} onChange={event=>setUnlimited(event.target.checked)}/>무제한 · 현재량을 차감하지 않음</label>}
    {mode==='instance'&&canFollow&&<label className="checkbox-line"><input type="checkbox" checked={follow} disabled={busy} onChange={event=>setFollow(event.target.checked)}/>프리셋 / 레벨 표의 최대치 따르기</label>}
    {preserveRule ? <div><p className="muted">레벨/능력치에 따른 최대치 규칙을 그대로 유지합니다.</p>{!locked&&<button type="button" onClick={()=>setPreserveRule(false)}>고정 최대치로 변경</button>}</div> : kind === 'counter' ? <label className="form-field">최대치<input type="number" required min={0} max={1000000} step={1} value={capacity} disabled={busy || mode === 'attach'||follow} onChange={event=>setCapacity(Number(event.target.value))} /></label> : <fieldset className="editor-checks"><legend>레벨별 최대치 · 0은 사용 안 함</legend><div className="slot-editor">{Array.from({length:9},(_,i)=>String(i+1)).map(level=><label key={level}>{level}레벨<input type="number" aria-label={`${level}레벨 최대치`} min={0} max={1000000} step={1} value={slots[level]??0} disabled={busy||mode==='attach'||follow} onChange={event=>setSlots({...slots,[level]:Number(event.target.value)})}/></label>)}</div></fieldset>}
    {mode === 'instance' && <p className="registration-note">현재 소비량을 보존해 적용합니다.{kind==='counter' ? ` ${resource!.remaining}/${resource!.capacity} → ${Math.max(0,capacity-(resource!.capacity!-resource!.remaining!))}/${capacity}` : ' 새 레벨별 최대치에 맞게 현재량을 제한합니다.'} 설정 변경 이전의 사용 기록은 실행 취소 경계가 됩니다.</p>}
    {!locked && <label className="form-field">자동 연결 식별 키 (선택)<input aria-label="자동 연결 식별 키" maxLength={128} value={matchKey} disabled={busy} onChange={event=>setMatchKey(event.target.value)}/></label>}
    {!locked && <RecoveryFieldset kind={kind} value={recovery} onChange={setRecovery} disabled={busy}/>}
    {mode !== 'edit_template' && !templateOnly && <div className="form-columns"><label className="form-field">소유 범위<select aria-label="소유 범위" value={scope} disabled={busy} onChange={event=>{setScope(event.target.value as typeof scope);setOwner('');}}><option value="character">캐릭터 공유</option><option value="card">카드 전용</option><option value="item">아이템 소유</option></select></label>{scope!=='character'&&<label className="form-field">소유 카드/아이템<select aria-label="소유 카드/아이템" required value={owner} disabled={busy} onChange={event=>setOwner(event.target.value)}><option value="">선택하세요</option>{allowedOwners.map(card=><option key={card.id} value={card.id}>{card.name}</option>)}</select></label>}</div>}
    {!locked&&mode!=='edit_template'&&<label className="checkbox-line"><input type="checkbox" checked={templateOnly} onChange={event=>setTemplateOnly(event.target.checked)}/>템플릿만 저장 · 지금 장착하지 않음</label>}
    {mode==='attach'&&<p className="muted">선택한 캐릭터에 최대량으로 새 자원을 장착합니다. 기존 캐릭터의 현재량은 바뀌지 않습니다.</p>}
    {(error||controller.error)&&<p className="error-banner" role="alert">{error||controller.error}</p>}
    <div className="modal-actions"><button type="button" disabled={busy} onClick={onClose}>취소</button><button type="submit" disabled={busy}>{mode==='attach'?'장착 확정':mode==='instance'?'설정 변경 확정':'자원 저장'}</button></div>
  </form></Modal>;
}

export function ResourceManager({ cards, controller, onClose, characterName, slotColors, slotColorsBusy = false, onSlotColors }: { cards: CardDefinition[]; controller: ResourceController; onClose: () => void; characterName?: string; slotColors?: SlotColorSet; slotColorsBusy?: boolean; onSlotColors?: (next?: SlotColorSet) => void }) {
  const [selection,setSelection] = useState<FormSelection>();
  const [deletion,setDeletion] = useState<{id:string;name:string;template:boolean}>();
  const [manage,setManage]=useState(false);const [resourceIds,setResourceIds]=useState<string[]>([]);const [templateIds,setTemplateIds]=useState<string[]>([]);const [batch,setBatch]=useState<EditAction>();
  const snapshot=controller.snapshot;
  if(selection&&snapshot)return <ResourceForm key={`${selection.mode}-${selection.template?.id??selection.resource?.id??'new'}`} selection={selection} cards={cards} controller={controller} onClose={()=>{setSelection(undefined);setResourceIds([]);setTemplateIds([]);}}/>;
  return <Modal title="자원 관리" wide onClose={onClose}>{!snapshot?<p>상단에서 캐릭터를 선택해 주세요.</p>:<>
    {onSlotColors&&<SlotColorEditor snapshot={snapshot} characterName={characterName} value={slotColors} busy={slotColorsBusy} onChange={onSlotColors}/>}
    <p className="manager-help">장착 자원의 현재량과 템플릿은 별도입니다. 사용 중인 템플릿은 복제해서 편집합니다. 아래 설정 변경은 이전 자원 변경 기록의 실행 취소 경계가 됩니다.</p>
    <button className="primary" disabled={controller.busy} onClick={()=>setSelection({mode:'new'})}>새 자원 만들기</button>
    <button disabled={controller.busy} aria-pressed={manage} onClick={()=>{setManage(!manage);setResourceIds([]);setTemplateIds([]);}}>{manage?'자원 선택 관리 종료':'자원 선택 관리'}</button>
    {manage&&<section className="batch-tools" aria-label="자원 선택 관리"><p>현재 캐릭터 자원 {resourceIds.length}/{snapshot.resources.filter(r=>!r.ownedDefinitionId).length}개 · 템플릿 {templateIds.length}/{snapshot.templates.length}개 선택</p><div className="batch-actions"><button onClick={()=>setResourceIds(snapshot.resources.filter(r=>!r.ownedDefinitionId).map(r=>r.id))}>장착 자원 전체 선택</button><button onClick={()=>setTemplateIds(snapshot.templates.map(t=>t.id))}>템플릿 전체 선택</button><button onClick={()=>{setResourceIds([]);setTemplateIds([]);}}>자원·템플릿 선택 해제</button><button disabled={!resourceIds.length} onClick={()=>setBatch({type:'disconnect_resources',characterId:snapshot.characterId,resourceIds})}>선택 자원 연결 해제</button><button disabled={!templateIds.length} onClick={()=>setBatch({type:'archive_templates',templateIds})}>선택 템플릿 삭제</button></div><p>연결 해제: 현재 캐릭터에서만 사용 중지. 템플릿 삭제: 새 장착 목록에서 숨기며 다른 캐릭터의 기존 자원은 유지합니다. 모두 일괄 편집 복원에서 복구할 수 있습니다.</p></section>}
    <h3 className="manager-subtitle">이 캐릭터에 장착한 자원</h3><div className="module-list">{snapshot.resources.filter(resource=>!resource.retired).map(resource=><section className="module-row" key={resource.id}>{manage&&!resource.ownedDefinitionId&&<label className="batch-select"><input type="checkbox" aria-label={`${resource.name} 자원 선택`} checked={resourceIds.includes(resource.id)} onChange={e=>setResourceIds(e.target.checked?[...resourceIds,resource.id]:resourceIds.filter(id=>id!==resource.id))}/>자원 선택</label>}<div><strong>{resource.name}</strong><p className="muted">{resource.kind==='counter'?`${resource.remaining} / ${resource.capacity} ${resource.unit}`:'레벨별 슬롯 트랙'} · {resource.ownedDefinitionId ? `고유 · ${resource.ownerCardName??'보관된 카드'}${resource.inactive?' · 비활성':''}` : resource.overrides.scope==='character'?'공유':resource.overrides.scope==='card'?'카드 전용':'아이템'}</p>{!resource.ownedDefinitionId&&<p className="muted">식별 키 {resource.template.matchKey??resource.template.key}</p>}</div>{resource.ownedDefinitionId?<div className="resource-adjust"><button disabled={controller.busy||!resource.remaining} aria-label={`${resource.name} 1 감소`} onClick={()=>void controller.perform({type:'adjust',resourceId:resource.id,delta:-1})}>−</button><button disabled={controller.busy||resource.remaining===resource.capacity} aria-label={`${resource.name} 1 증가`} onClick={()=>void controller.perform({type:'adjust',resourceId:resource.id,delta:1})}>+</button></div>:<div><button disabled={controller.busy} aria-label={`${resource.name} 자원 설정`} onClick={()=>setSelection({mode:'instance',resource})}>설정</button><button disabled={controller.busy} aria-label={`${resource.name} 자원 연결 해제`} onClick={()=>setDeletion({id:resource.id,name:resource.name,template:false})}>연결 해제</button></div>}</section>)}</div>
    <h3 className="manager-subtitle">자원 템플릿 라이브러리</h3><div className="module-list">{snapshot.templates.map(template=><section className="module-row" key={template.id}>{manage&&<label className="batch-select"><input type="checkbox" aria-label={`${template.name} 템플릿 선택`} checked={templateIds.includes(template.id)} onChange={e=>setTemplateIds(e.target.checked?[...templateIds,template.id]:templateIds.filter(id=>id!==template.id))}/>템플릿 선택</label>}<div><strong>{template.name}</strong><p className="muted">{template.unit} · v{template.version} · 식별 키 {template.matchKey??template.key}</p></div><div><button disabled={controller.busy} aria-label={`${template.name} 템플릿 장착`} onClick={()=>setSelection({mode:'attach',template})}>장착</button><button disabled={controller.busy} aria-label={`${template.name} 템플릿 복제`} onClick={()=>setSelection({mode:'clone',template})}>복제</button><button disabled={controller.busy} aria-label={`${template.name} 템플릿 편집`} onClick={()=>setSelection({mode:'edit_template',template})}>편집</button><button disabled={controller.busy} aria-label={`${template.name} 템플릿 보관 해제`} onClick={()=>setDeletion({id:template.id,name:template.name,template:true})}>보관 해제</button></div></section>)}</div>
    {deletion&&<div className="inline-confirm"><p>{deletion.template?`“${deletion.name}” 템플릿을 라이브러리에서 숨깁니다. 이미 장착된 자원은 유지됩니다.`:`“${deletion.name}” 자원을 연결 해제합니다. 연결된 카드 비용은 사용 불가 상태가 되며 다른 자원으로 자동 연결하지 않습니다.`}</p><button disabled={controller.busy} onClick={async()=>{if(await controller.perform(deletion.template?{type:'archive_template',templateId:deletion.id}:{type:'delete_resource',resourceId:deletion.id})){setDeletion(undefined);setResourceIds([]);setTemplateIds([]);}}}>자원 삭제 확인</button><button onClick={()=>setDeletion(undefined)}>취소</button></div>}
    {controller.error&&<p className="error-banner" role="alert">{controller.error}</p>}
    {batch&&<BatchReview action={batch} onClose={()=>setBatch(undefined)} onSaved={async()=>{setResourceIds([]);setTemplateIds([]);await controller.refresh();}}/>}
  </>}</Modal>;
}
