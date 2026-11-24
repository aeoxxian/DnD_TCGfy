import { RegistrationRules, type RegistrationKind } from './RegistrationRules';
import { AdvancedCardCostEditor } from './CardCostEditor';
import type { ResourceController } from './ResourcePanel';
import { buildBasicRule, describeUseRules, emptyBasicRule, type BasicRuleDraft } from '../shared/use-rules';
import { useState, useRef, type FormEvent, type DragEvent } from 'react';
import { cardDraftSchema, type CardDefinition, type CardDraft, type Tag, type AssetPreview, type Library, type RegistrationTarget, type CastOption } from '../shared/contracts';
import { ACTION_NAMES, KIND_NAMES, RANGE_NAMES, ROLE_NAMES, normalizeText } from '../shared/library';
import { Modal } from './Modal';
import { toggleValue } from './Filters';
import { NewResourceDialog } from './NewResourceDialog';
import { CardFace, DefaultCard } from './CardFace';
import { describeDraft, draftResourceView, type NewResourceDraft } from '../shared/resource-drafts';

function Checks<T extends string>({ title, choices, values, onChange, disabled }: { title: string; choices: Record<T, string>; values: T[]; onChange: (values: T[]) => void; disabled: boolean }) {
  return <fieldset className="editor-checks" disabled={disabled}><legend>{title}</legend><div>{(Object.entries(choices) as [T, string][]).map(([id, name]) => <label key={id}><input type="checkbox" checked={values.includes(id)} onChange={() => onChange(toggleValue(values, id))} />{name}</label>)}</div></fieldset>;
}
/** v1.3: forget images this dialog imported but did not save. The main process deletes only images imported during this
 *  run that no card, card image history or card back uses, so saved cards are never touched. Best effort. */
function discardImports(ids: string[]) {
  if (!ids.length) return;
  try { void Promise.resolve(window.desktop.discardImports(ids)).catch(() => undefined); } catch { /* bridge unavailable */ }
}
function draftFromCard(card?: CardDefinition): CardDraft {
  return card ? { id: card.id, name: card.name, kind: card.kind, imageAssetId: card.imageAssetId, roles: card.roles, actions: card.actions, range: card.range, tags: card.tags, description: card.description, spellLevel: card.spellLevel } : { name: '', kind: 'other', roles: [], actions: ['action'], range: { kind: 'special' }, tags: [] };
}

export function CardEditor({ card, initialAssets = [], tags, onLibrary, onClose, registrationTarget = null, targetLabel, controller, characterId, characterName }: { card?: CardDefinition; initialAssets?: AssetPreview[]; tags: Tag[]; onLibrary: (library: Library) => void; onClose: () => void; registrationTarget?: RegistrationTarget | null; targetLabel?: string; controller?: ResourceController; characterId?: string; characterName?: string }) {
  const [target] = useState(registrationTarget);
  const [destinationLabel] = useState(targetLabel);
  const [draft, setDraft] = useState<CardDraft>(() => ({ ...draftFromCard(card), ...(!card && initialAssets.length === 1 ? { name: initialAssets[0].name } : {}) }));
  const [assets, setAssets] = useState(initialAssets);
  // v1.3: every image imported while this dialog is open; the ones not saved are discarded when it closes.
  const imported = useRef(new Set(initialAssets.map(asset => asset.id)));
  const [linkDeck, setLinkDeck] = useState(true);
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(initialAssets.map(asset => [asset.id, asset.name])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [ruleKind,setRuleKind]=useState<RegistrationKind>('unconfigured');
  const [ruleScope,setRuleScope]=useState<'shared'|'character'>(characterId?'character':'shared');
  const [ruleDraft,setRuleDraft]=useState<BasicRuleDraft>(()=>emptyBasicRule({spellLevel:card?.spellLevel} as CardDefinition));
  const [ruleIds]=useState(()=>({optionId:crypto.randomUUID(),costKey:crypto.randomUUID()}));
  const [ruleTime]=useState(()=>new Date().toISOString());
  const [advancedOpen,setAdvancedOpen]=useState(false);
  const [advancedRules,setAdvancedRules]=useState<{castOptions:CastOption[];bindings:{costKey:string;resourceInstanceId:string}[]}>();
  // v1.2: a counter drafted from the use-rule resource picker. Created only when the card is saved.
  const [newResource,setNewResource]=useState<NewResourceDraft>();
  const [resourceFormOpen,setResourceFormOpen]=useState(false);
  const draftView=newResource&&characterId?draftResourceView(newResource,characterId):undefined;
  const ruleResources=[...(controller?.snapshot?.resources??[]),...(draftView?[draftView]:[])];
  const registrationAttempt=useRef<{signature:string;requestId:string}|undefined>(undefined);
  const saving=useRef(false);
  const ruleCard:CardDefinition={...draft,id:'registration-draft',name:draft.name||'등록할 카드',castOptions:advancedRules?.castOptions??[{id:ruleIds.optionId,label:'일반 사용',costs:[]}],createdAt:ruleTime,updatedAt:ruleTime};
  let proposal:ReturnType<typeof buildBasicRule>|undefined;let ruleError='';
  try{if(ruleKind==='advanced')proposal=advancedRules;else if(ruleKind!=='unconfigured')proposal=buildBasicRule(ruleCard,{...ruleDraft,kind:ruleKind,spellLevel:draft.spellLevel},ruleIds);}catch(error){ruleError=(error as Error).message;}
  function updateRule(patch:Partial<BasicRuleDraft>){setRuleDraft(current=>({...current,...patch}));if('spellLevel' in patch)setDraft(current=>({...current,spellLevel:patch.spellLevel}));setError('');}
  function chooseRule(kind:RegistrationKind){setRuleKind(kind);if(kind==='slots')setDraft(current=>({...current,kind:'spell'}));setError('');}

  async function importFiles(files: File[]) {
    if (!files.length || busy) return;
    if (card && files.length > 1) { setError('교체할 이미지는 한 장만 선택해 주세요.'); return; }
    if (!card && assets.length + files.length > 100) { setError('한 번에 최대 100장까지 등록할 수 있습니다.'); return; }
    setBusy(true); setError('');
    try {
      const result = await window.desktop.importImages(files);
      if (!result.ok) { setError(result.error); return; }
      const added = result.value.assets;
      for (const asset of added) imported.current.add(asset.id);
      if (card && added.length) discardImports(assets.map(asset => asset.id)); // a newer replacement supersedes the pending one
      setAssets(current => card ? added.length ? added : current : [...current, ...added]);
      if (!card && !assets.length && added.length === 1) {
        // A single image: its file name fills the name only if the user has not typed one (even while it was importing).
        setDraft(current => current.name.trim() ? current : { ...current, name: added[0].name });
      } else if (!card) {
        // Several images: one name each; the image that was alone keeps the name typed for it.
        const keep = assets.length === 1 ? { [assets[0].id]: draft.name.trim() || assets[0].name } : {};
        setNames(current => ({ ...current, ...keep, ...Object.fromEntries(added.map(asset => [asset.id, asset.name])) }));
      }
      setImportErrors(result.value.errors.map(item => `${item.name}: ${item.message}`));
    } catch { setError('이미지 가져오기에 실패했습니다. 다시 선택해 주세요.'); }
    finally { setBusy(false); }
  }
  /** Leave the dialog: images picked here and not saved are discarded (saved ones are skipped by the main process). */
  function finish() { discardImports([...imported.current]); imported.current.clear(); onClose(); }
  function removeAsset(id: string) {
    const remaining = assets.filter(item => item.id !== id);
    setAssets(remaining);
    // Back to a single image: its per-image name becomes the card name. Removing the only image keeps the typed name.
    if (!card && assets.length > 1 && remaining.length === 1) setDraft(current => ({ ...current, name: names[remaining[0].id] ?? remaining[0].name }));
    imported.current.delete(id); discardImports([id]);
  }
  function drop(event: DragEvent) { event.preventDefault(); if (event.dataTransfer.files.length) void importFiles(Array.from(event.dataTransfer.files)); }
  async function addTag() {
    if (!newTag.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const result = await window.desktop.saveTag({ name: newTag });
      if (!result.ok) { setError(result.error); return; }
      const tag = result.value.tags.find(tag => normalizeText(tag.name) === normalizeText(newTag));
      onLibrary(result.value);
      if (tag) setDraft(current => ({ ...current, tags: [...new Set([...current.tags, tag.id])] }));
      setNewTag('');
    } catch { setError('태그를 저장하지 못했습니다.'); } finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || saving.current) return;
    const candidates = card ? [{ ...draft, imageAssetId: assets.at(-1)?.id ?? draft.imageAssetId }]
      : assets.length > 1 ? assets.map(asset => ({ ...draft, name: names[asset.id] ?? asset.name, imageAssetId: asset.id }))
      : assets.length ? [{ ...draft, imageAssetId: assets[0].id }] : [draft];
    const parsed = candidates.map(value => cardDraftSchema.safeParse(value));
    const invalid = parsed.find(result => !result.success);
    if (invalid && !invalid.success) { setError(invalid.error.issues[0].message); return; }
    if(!card&&ruleError){setError(ruleError);return;}
    const boundDraft=newResource&&proposal?.bindings.some(binding=>binding.resourceInstanceId===newResource.draftId)?newResource:undefined;
    const initial = card?undefined:{configured:ruleKind!=='unconfigured',scope:ruleScope,characterId,expectedRevision:controller?.snapshot?.revision,castOptions:proposal?.castOptions??[{id:ruleIds.optionId,label:'비용 미설정',costs:[]}],bindings:proposal?.bindings??[],newResources:boundDraft?[boundDraft]:undefined};
    // The form's deck is always sent (the store rejects it if the active deck changed meanwhile); unchecking only skips the link.
    const destination=card?undefined:target;const addToDeck=!card&&target&&!linkDeck?false:undefined;
    const signature=JSON.stringify({cards:candidates,registrationTarget:destination,addToDeck,initial:initial?{...initial,expectedRevision:undefined}:undefined});
    if(!registrationAttempt.current||registrationAttempt.current.signature!==signature)registrationAttempt.current={signature,requestId:crypto.randomUUID()};
    saving.current=true;setBusy(true); setError('');
    try {
      const result = await window.desktop.saveCards({ cards: candidates, registrationTarget: destination,addToDeck,initialRules:initial?{...initial,requestId:registrationAttempt.current.requestId}:undefined });
      if (!result.ok) { setError(result.error); return; }
      onLibrary(result.value); finish();
    } catch { setError('카드를 저장하지 못했습니다. 기존 카드는 유지됩니다.'); } finally { saving.current=false;setBusy(false); }
  }
  if(advancedOpen){
    const snapshot={...(controller?.snapshot??{characterId:characterId??'registration',revision:0,resources:[],templates:[],bindings:[],events:[],warnings:[]}),resources:ruleResources,bindings:(proposal?.bindings??[]).map(binding=>({...binding,id:binding.costKey,cardId:ruleCard.id,characterId:characterId??'registration'}))};
    const draftController:ResourceController={...(controller??{busy:false,error:'',perform:async()=>false,refresh:async()=>{}}),snapshot};
    return <AdvancedCardCostEditor card={{...ruleCard,castOptions:proposal?.castOptions??ruleCard.castOptions}} controller={draftController} initialScope={ruleScope} onSaved={async()=>{}} onClose={()=>setAdvancedOpen(false)} onBasic={()=>setAdvancedOpen(false)} onDraft={value=>{setAdvancedRules(value);setRuleScope(value.scope);setRuleKind('advanced');setAdvancedOpen(false);}}/>;
  }
  const single = !card && assets.length === 1 ? assets[0] : undefined;
  const nameValue = draft.name;
  const setName = (value: string) => setDraft(current => ({ ...current, name: value }));
  const replacement = card ? assets.at(-1) : undefined;
  const previewImage = replacement ?? single;
  const previewInfo = { ...draft, name: nameValue.trim() || '카드 이름' };
  const multiple = !card && assets.length > 1;
  const pickLabel = card ? card.imageAssetId || replacement ? '교체 이미지 선택' : '이미지 선택' : assets.length ? '이미지 더 선택' : '이미지 선택';
  const pickNote = card
    ? replacement ? '저장하면 이 카드의 이미지만 바뀝니다. 분류·태그·덱 구성은 그대로입니다.' : 'PNG · JPEG · WebP, 원본 파일은 그대로 보관합니다.'
    : assets.length ? 'PNG · JPEG · WebP, 원본 파일은 그대로 보관합니다.' : '이미지 없이 등록하면 기본 카드 디자인으로 표시됩니다. 나중에 정보 수정에서 이미지를 넣을 수 있습니다.';
  return <Modal title={card ? '카드 정보 수정' : '카드 등록'} onClose={() => { if (!busy) finish(); }} wide>
    <form className="card-editor v13-editor" onSubmit={event => void submit(event)} aria-busy={busy}>
      <div className="editor-layout">
        <aside className="editor-preview-column" aria-label="카드 미리보기">
          <div className="editor-preview" onDragOver={event => event.preventDefault()} onDrop={drop}>
            {previewImage ? <img src={previewImage.thumbnailUrl} alt={replacement ? '교체 이미지 미리보기' : `${nameValue || previewImage.name} 등록 미리보기`} draggable={false}/>
              : multiple ? <div className="editor-preview-stack" role="img" aria-label={`이미지 ${assets.length}장`}>{assets.slice(0, 3).map(asset => <img key={asset.id} src={asset.thumbnailUrl} alt="" draggable={false}/>)}</div>
              : card?.imageAssetId ? <CardFace card={card} original/>
              : <div className="card-face default-face" role="img" aria-label={`${previewInfo.name} 기본 카드 미리보기`}><DefaultCard card={previewInfo} placeholder={!nameValue.trim()}/></div>}
          </div>
          <div className="drop-zone" onDragOver={event => event.preventDefault()} onDrop={drop}>
            <label className="file-button">{pickLabel}<input type="file" aria-label={card ? '교체 이미지 파일' : '카드 이미지 파일'} accept=".png,.jpg,.jpeg,.webp" multiple={!card} disabled={busy} onChange={event => { void importFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} /></label>
            {single && <button type="button" disabled={busy} onClick={() => removeAsset(single.id)}>이미지 빼기</button>}
            {replacement && <button type="button" disabled={busy} onClick={() => removeAsset(replacement.id)}>교체 취소</button>}
            <p>{pickNote}</p>
          </div>
        </aside>
        <div className="editor-fields">
          {busy && <p className="muted">이미지 또는 정보를 저장하는 중…</p>}
          {!!importErrors.length && <ul className="import-errors">{importErrors.map((message, i) => <li key={i}>{message}</li>)}</ul>}
          {multiple && <><div className="import-list">{assets.map((asset, i) => <div className="import-row" key={asset.id}><img src={asset.thumbnailUrl} alt={`${asset.name} 등록 미리보기`} /><label>카드 이름 {i + 1}<input value={names[asset.id] ?? asset.name} required maxLength={200} disabled={busy} onChange={event => setNames(current => ({ ...current, [asset.id]: event.target.value }))} /></label><button type="button" disabled={busy} aria-label={`${asset.name} 등록 목록에서 제외`} onClick={() => removeAsset(asset.id)}>제외</button></div>)}</div>
            <p className="muted">아래 속성과 새 사용 규칙을 {assets.length}장에 공통 적용합니다. 저장 후 각 카드에서 개별 수정할 수 있습니다.</p></>}
          <section className="editor-section" aria-label="카드 기본 정보">
            {!multiple && <label className="form-field">카드 이름<input autoFocus value={nameValue} required maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} /></label>}
            <div className="form-columns">
              <label className="form-field">카드 유형<select aria-label="카드 유형" value={draft.kind} disabled={busy} onChange={event => setDraft({ ...draft, kind: event.target.value as CardDraft['kind'], spellLevel: event.target.value === 'spell' ? draft.spellLevel : undefined })}>{Object.entries(KIND_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              {draft.kind === 'spell' && <label className="form-field">주문 레벨 (선택)<select aria-label="주문 레벨 (선택)" value={draft.spellLevel ?? ''} disabled={busy} onChange={event => setDraft({ ...draft, spellLevel: event.target.value === '' ? undefined : Number(event.target.value) })}><option value="">미지정</option>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{i === 0 ? '0 · 소마법' : i}</option>)}</select></label>}
            </div>
            <Checks title="카드 역할" disabled={busy} choices={ROLE_NAMES} values={draft.roles} onChange={roles => setDraft({ ...draft, roles })} />
            <Checks title="카드 행동 경제" disabled={busy} choices={ACTION_NAMES} values={draft.actions} onChange={actions => setDraft({ ...draft, actions })} />
            <p className="muted editor-hint">유형은 카드의 종류, 역할은 효과입니다. 예: 공격 주문 = 유형 ‘주문’ · 역할 ‘공격’.</p>
          </section>
          <section className="editor-section editor-tags" aria-label="카드 태그 설정">
            <Checks title="카드 태그" disabled={busy} choices={Object.fromEntries(tags.map(tag => [tag.id, tag.name]))} values={draft.tags} onChange={selected => setDraft({ ...draft, tags: selected })} />
            <div className="inline-form"><label>새 태그<input maxLength={60} value={newTag} disabled={busy} onChange={event => setNewTag(event.target.value)} /></label><button type="button" disabled={busy || !newTag.trim()} onClick={() => void addTag()}>태그 추가</button></div>
          </section>
          {!card&&<fieldset disabled={busy} className="registration-rules-shell"><RegistrationRules kind={ruleKind} onKind={chooseRule} draft={{...ruleDraft,spellLevel:draft.spellLevel}} onChange={updateRule} scope={ruleScope} onScope={setRuleScope} characterId={characterId} snapshot={controller?.snapshot} busy={busy} onAdvanced={()=>setAdvancedOpen(true)} summary={proposal?describeUseRules(proposal.castOptions,proposal.bindings,ruleResources):ruleError?[ruleError]:[]} pending={draftView} pendingNote={newResource?describeDraft(newResource):undefined} characterName={characterName} onNewResource={characterId&&controller?.snapshot?()=>setResourceFormOpen(true):undefined} onDiscardPending={()=>{if(newResource&&ruleDraft.resourceId===newResource.draftId)updateRule({resourceId:''});setNewResource(undefined);}}/>{controller?.error&&<p role="alert">{controller.error}</p>}<button type="button" disabled={busy||!controller} onClick={()=>void controller?.refresh()}>연결 자원 다시 불러오기</button></fieldset>}
          <details className="editor-advanced"><summary>세부 설정 · 사거리 / 설명</summary>
            <div className="form-columns"><label className="form-field">사거리<select aria-label="사거리" value={draft.range.kind} disabled={busy} onChange={event => setDraft({ ...draft, range: { ...draft.range, kind: event.target.value as CardDraft['range']['kind'] } })}>{Object.entries(RANGE_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="form-field">거리 (ft, 선택)<input type="number" min={0} max={100000} step={1} value={draft.range.feet ?? ''} disabled={busy} onChange={event => setDraft({ ...draft, range: { ...draft.range, feet: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label></div>
            <label className="form-field">설명 (선택)<textarea maxLength={10000} value={draft.description ?? ''} disabled={busy} rows={3} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
            <p className="muted">설명은 카드 페이지의 ‘설명·추가 정보’에 나옵니다. 주문 레벨은 시전 슬롯 검증에 씁니다.</p>
          </details>
        </div>
      </div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="modal-actions editor-actions">
        {!card && (target
          ? <label className="checkbox-line deck-link"><input type="checkbox" checked={linkDeck} disabled={busy} onChange={event => setLinkDeck(event.target.checked)}/>등록하면 ‘{destinationLabel ?? '선택한 덱'}’에 넣기</label>
          : <p className="deck-link muted">활성 덱이 없어 라이브러리에만 등록합니다. 상단에서 캐릭터를 고르면 그 덱에 바로 넣을 수 있습니다.</p>)}
        <button type="button" disabled={busy} onClick={finish}>취소</button><button className="primary" type="submit" disabled={busy}>{card ? '수정 저장' : assets.length > 1 ? `${assets.length}장 등록` : '카드 저장'}</button>
      </div>
    </form>
    {resourceFormOpen&&<NewResourceDialog initial={newResource} ruleKind={ruleKind==='points'?'points':'uses'} resources={controller?.snapshot?.resources??[]} characterName={characterName} onCancel={()=>setResourceFormOpen(false)} onPickExisting={id=>{updateRule({resourceId:id});setResourceFormOpen(false);}} onCreate={(created,kind)=>{setNewResource(created);chooseRule(kind);updateRule({resourceId:created.draftId});setResourceFormOpen(false);}}/>}
  </Modal>;
}
