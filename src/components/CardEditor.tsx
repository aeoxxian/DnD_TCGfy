import { OwnedResourcesEditor } from './OwnedResourcesEditor';
import { RegistrationRules, type RegistrationKind } from './RegistrationRules';
import { AdvancedCardCostEditor } from './CardCostEditor';
import type { ResourceController } from './ResourcePanel';
import { buildBasicRule, describeUseRules, emptyBasicRule, type BasicRuleDraft } from '../shared/use-rules';
import { useState, useRef, type FormEvent, type DragEvent } from 'react';
import { cardDraftSchema, type CardDefinition, type CardDraft, type Tag, type AssetPreview, type Library, type RegistrationTarget, type CastOption, type RegistrationTemplate } from '../shared/contracts';
import { ACTION_NAMES, KIND_NAMES, RANGE_NAMES, ROLE_NAMES, normalizeText } from '../shared/library';
import { Modal } from './Modal';
import { NewResourceDialog } from './NewResourceDialog';
import { CardFace, DefaultCard } from './CardFace';
import { CardTraits, ImageModeField } from './CardMetadataFields';
import { Checks } from './FormChecks';
import { BatchRegistration } from './BatchRegistration';
import { TemplateBar } from './RegistrationTemplates';
import { describeDraft, draftResourceView, type NewResourceDraft } from '../shared/resource-drafts';
import { applyTemplate, batchDuplicates, cardFields, effectiveItem, itemRule, newBatchItem, templateFrom, type BatchAsset, type BatchCommon, type BatchItem } from '../shared/batch-registration';
import { effectiveCard } from '../shared/casting';

/** v1.3: forget images this dialog imported but did not save. The main process deletes only images imported during this
 *  run that no card, card image history or card back uses, so saved cards are never touched. Best effort. */
function discardImports(ids: string[]) {
  if (!ids.length) return;
  try { void Promise.resolve(window.desktop.discardImports(ids)).catch(() => undefined); } catch { /* bridge unavailable */ }
}
function draftFromCard(card?: CardDefinition): CardDraft {
  return card ? { id: card.id, name: card.name, kind: card.kind, imageAssetId: card.imageAssetId, roles: card.roles, actions: card.actions, range: card.range, tags: card.tags, description: card.description, spellLevel: card.spellLevel, imageMode: card.imageMode, concentration: card.concentration, ritual: card.ritual, upcastEffect: card.upcastEffect, ownedResources: card.ownedResources } : { name: '', kind: 'other', roles: [], actions: ['action'], range: { kind: 'special' }, tags: [] };
}
/** v1.3 Phase 2: one batch item per image; a second copy of an image already in the list starts excluded. */
function batchItemsFor(added: BatchAsset[], before: BatchAsset[]): Record<string, BatchItem> {
  const seen = new Set(before.map(asset => asset.sha256).filter(Boolean));
  const items: Record<string, BatchItem> = {};
  for (const asset of added) { items[asset.id] = newBatchItem(asset, !(asset.sha256 && seen.has(asset.sha256))); if (asset.sha256) seen.add(asset.sha256); }
  return items;
}

export function CardEditor({ card, initialAssets = [], tags, onLibrary, onClose, registrationTarget = null, targetLabel, controller, characterId, characterName, templates = [], onTemplates }: { card?: CardDefinition; initialAssets?: AssetPreview[]; tags: Tag[]; onLibrary: (library: Library) => void; onClose: () => void; registrationTarget?: RegistrationTarget | null; targetLabel?: string; controller?: ResourceController; characterId?: string; characterName?: string; templates?: RegistrationTemplate[]; onTemplates?: (templates: RegistrationTemplate[]) => Promise<boolean> }) {
  const [target] = useState(registrationTarget);
  const [destinationLabel] = useState(targetLabel);
  const [draft, setDraft] = useState<CardDraft>(() => ({ ...draftFromCard(card), ...(!card && initialAssets.length === 1 ? { name: initialAssets[0].name } : {}) }));
  const [assets, setAssets] = useState<BatchAsset[]>(initialAssets);
  // v1.3: every image imported while this dialog is open; the ones not saved are discarded when it closes.
  const imported = useRef(new Set(initialAssets.map(asset => asset.id)));
  const [linkDeck, setLinkDeck] = useState(true);
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(initialAssets.map(asset => [asset.id, asset.name])));
  // v1.3 Phase 2: per-image state of a multi-image registration (overrides, status, request IDs).
  const [batch, setBatch] = useState<Record<string, BatchItem>>(() => batchItemsFor(initialAssets, []));
  const [batchRunning, setBatchRunning] = useState(false);
  const [focus, setFocus] = useState<string>();
  const [templateNotes, setTemplateNotes] = useState<string[]>([]);
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
  const multiple = !card && assets.length > 1;
  /** The defaults of a batch (and what a template saves): the card fields, the basic use rule and the deck link. */
  const common: BatchCommon = { card: cardFields(draft), rule: { kind: ruleKind === 'advanced' ? 'unconfigured' : ruleKind, draft: ruleDraft, scope: ruleScope }, addToDeck: linkDeck };

  const keepsSingleRegistration = ruleKind === 'advanced' && advancedRules?.castOptions.some(option => option.costs.some(cost => cost.requirement));
  const singleRegistrationMessage = '이 카드의 고급 자원 요구를 보존하려면 먼저 카드 한 장을 저장하세요.';

  async function importFiles(files: File[]) {
    if (!files.length || busy || batchRunning) return;
    if (card && files.length > 1) { setError('교체할 이미지는 한 장만 선택해 주세요.'); return; }
    if (!card && keepsSingleRegistration && assets.length + files.length > 1) { setError(singleRegistrationMessage); return; }
    if (!card && assets.length + files.length > 100) { setError('한 번에 최대 100장까지 등록할 수 있습니다.'); return; }
    setBusy(true); setError('');
    try {
      const result = await window.desktop.importImages(files);
      if (!result.ok) { setError(result.error); return; }
      const added = result.value.assets;
      for (const asset of added) imported.current.add(asset.id);
      if (card && added.length) discardImports(assets.map(asset => asset.id)); // a newer replacement supersedes the pending one
      setAssets(current => card ? added.length ? added : current : [...current, ...added]);
      if (!card) setBatch(current => ({ ...current, ...batchItemsFor(added, assets) }));
      if (!card && !assets.length && added.length === 1) {
        // A single image: its file name fills the name only if the user has not typed one (even while it was importing).
        setDraft(current => current.name.trim() ? current : { ...current, name: added[0].name });
      } else if (!card) {
        // Several images: one name each; the image that was alone keeps the name typed for it.
        const keep = assets.length === 1 ? { [assets[0].id]: draft.name.trim() || assets[0].name } : {};
        setNames(current => ({ ...current, ...keep, ...Object.fromEntries(added.map(asset => [asset.id, asset.name])) }));
        if (ruleKind === 'advanced' && assets.length + added.length > 1) { setRuleKind('unconfigured'); setAdvancedRules(undefined); setTemplateNotes(['여러 장 등록에서는 고급 사용 규칙을 쓸 수 없어 ‘나중에 설정’으로 바꿨습니다. 등록 뒤 카드 사용 규칙에서 정해 주세요.']); }
      }
      setImportErrors(result.value.errors.map(item => `${item.name}: ${item.message}`));
    } catch { setError('이미지 가져오기에 실패했습니다. 다시 선택해 주세요.'); }
    finally { setBusy(false); }
  }
  /** Leave the dialog: images picked here and not saved are discarded (saved ones are skipped by the main process). */
  function finish() { discardImports([...imported.current]); imported.current.clear(); onClose(); }
  function addImageless() {
    if (keepsSingleRegistration) { setError(singleRegistrationMessage); return; }
    if (assets.length >= 100) { setError('한 번에 최대 100장까지 등록할 수 있습니다.'); return; }
    if (ruleKind === 'advanced') {
      setRuleKind('unconfigured'); setAdvancedRules(undefined);
      setTemplateNotes(['여러 장 등록에서는 고급 사용 규칙을 쓸 수 없어 ‘나중에 설정’으로 바꿨습니다.']);
    }
    const item = { id: crypto.randomUUID(), name: '이미지 없는 카드' };
    if (!assets.length) {
      const first = { id: crypto.randomUUID(), name: draft.name.trim() || '첫 번째 카드' };
      const rows = [first, item];
      const items = batchItemsFor(rows, []);
      items[first.id].description = draft.description;
      setAssets(rows); setBatch(items);
      setNames(Object.fromEntries(rows.map(row => [row.id, row.name])));
      return;
    }
    setAssets([...assets, item]); setBatch(current => ({ ...current, [item.id]: newBatchItem(item) }));
    setNames(current => ({ ...current, ...(assets.length === 1 && draft.name.trim() ? { [assets[0].id]: draft.name.trim() } : {}), [item.id]: item.name }));
  }
  function removeAsset(id: string) {
    const remaining = assets.filter(item => item.id !== id);
    setAssets(remaining);
    setBatch(current => { const next = { ...current }; delete next[id]; return next; });
    if (focus === id) setFocus(undefined);
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
  function applyChosenTemplate(template: RegistrationTemplate) {
    const applied = applyTemplate(template, { tags, resources: controller?.snapshot?.resources ?? [], characterId, base: ruleDraft });
    setDraft(current => ({ ...current, ...applied.common.card }));
    setRuleKind(applied.common.rule.kind); setRuleScope(applied.common.rule.scope); setRuleDraft(applied.common.rule.draft); setAdvancedRules(undefined);
    setLinkDeck(applied.common.addToDeck); setTemplateNotes(applied.notes); setError('');
  }
  function captureTemplate(id: string, name: string): RegistrationTemplate | string {
    if (!name.trim()) return '템플릿 이름을 입력해 주세요.';
    if (ruleKind === 'advanced') return '고급 사용 규칙은 템플릿에 넣을 수 없습니다. 기본 유형을 고르거나 ‘나중에 설정’으로 둔 뒤 저장해 주세요.';
    return templateFrom(id, name, common, ruleResources);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || saving.current || multiple) return;
    const picked = assets.at(-1);
    const imageAssetId = draft.imageMode === 'none' ? undefined : picked?.thumbnailUrl ? picked.id : draft.imageAssetId;
    if (draft.imageMode && draft.imageMode !== 'none' && !imageAssetId && !card?.imageReference) { setError('선택한 표시 방식에 사용할 이미지 파일을 골라 주세요.'); return; }
    const candidate = { ...draft, imageAssetId };
    if (!imageAssetId) delete candidate.imageAssetId;
    const candidates = [candidate];
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
  const locked = busy || batchRunning;
  const single = !card && assets.length === 1 ? assets[0] : undefined;
  const nameValue = draft.name;
  const setName = (value: string) => setDraft(current => ({ ...current, name: value }));
  const replacement = card ? assets.at(-1) : undefined;
  const focused = multiple ? assets.find(asset => asset.id === focus) : undefined;
  const previewImage = replacement ?? single ?? focused;
  const pickedImages = assets.filter(asset => asset.thumbnailUrl);
  const imageMode = draft.imageMode ?? (pickedImages.length || draft.imageAssetId || card?.imageReference ? 'full_card' : 'none');
  const focusedItem = focused ? batch[focused.id] : undefined;
  const focusedCard = focusedItem && focused ? effectiveItem(focusedItem, names[focused.id] ?? focused.name, common) : undefined;
  let previewOptions = proposal?.castOptions ?? (card ? effectiveCard(card, controller?.snapshot).castOptions : undefined);
  if (focusedCard && focusedItem) {
    try { previewOptions = itemRule(focusedCard, focusedItem.ids).castOptions; } catch { previewOptions = undefined; }
  }
  const previewInfo = { ...(focusedCard?.card ?? draft), name: (focusedCard?.card.name ?? nameValue).trim() || '카드 이름', castOptions: previewOptions };
  const previewMode = focusedCard ? focusedCard.card.imageMode ?? 'full_card' : imageMode;
  const duplicates = batchDuplicates(assets);
  const singleDuplicate = single ? duplicates.get(single.id) : undefined;
  const pickLabel = card ? card.imageAssetId || replacement ? '교체 이미지 선택' : '이미지 선택' : assets.length ? '이미지 더 선택' : '이미지 선택';
  const pickNote = card
    ? replacement ? '저장하면 이 카드의 이미지만 바뀝니다. 분류·태그·덱 구성은 그대로입니다.' : 'PNG · JPEG · WebP, 원본 파일은 그대로 보관합니다.'
    : multiple ? '여러 장을 고르면 카드마다 따로 등록합니다. 아래 공통 설정이 모든 카드의 기본값입니다. 최대 100장.'
    : assets.length ? 'PNG · JPEG · WebP, 원본 파일은 그대로 보관합니다. 여러 장을 고르면 한 번에 등록할 수 있습니다.' : '이미지 없이 등록하면 기본 카드 디자인으로 표시됩니다. 나중에 정보 수정에서 이미지를 넣을 수 있습니다.';
  const deckLink = !card && (target
    ? <label className="checkbox-line deck-link"><input type="checkbox" checked={linkDeck} disabled={locked} onChange={event => setLinkDeck(event.target.checked)}/>등록하면 ‘{destinationLabel ?? '선택한 덱'}’에 넣기</label>
    : <p className="deck-link muted">활성 덱이 없어 라이브러리에만 등록합니다. 상단에서 캐릭터를 고르면 그 덱에 바로 넣을 수 있습니다.</p>);
  return <Modal title={card ? '카드 정보 수정' : '카드 등록'} onClose={() => { if (!busy && !batchRunning) finish(); }} wide>
    <form className={`card-editor v13-editor ${multiple ? 'is-batch' : ''}`} onSubmit={event => void submit(event)} aria-busy={locked}>
      <div className="editor-layout">
        <aside className="editor-preview-column" aria-label="카드 미리보기">
          <div className="editor-preview" onDragOver={event => event.preventDefault()} onDrop={drop}>
            {previewMode === 'illustration' && (previewImage?.thumbnailUrl || draft.imageAssetId) ? <CardFace card={{ ...ruleCard, ...previewInfo, castOptions: previewInfo.castOptions ?? ruleCard.castOptions, imageMode: 'illustration', imageAssetId: previewImage?.thumbnailUrl ? previewImage.id : draft.imageAssetId }} original={!!card && !previewImage}/>
              : previewMode !== 'none' && previewImage?.thumbnailUrl ? <img src={previewImage.thumbnailUrl} alt={replacement ? '교체 이미지 미리보기' : focused ? `${names[focused.id] ?? focused.name} 등록 미리보기` : `${nameValue || previewImage.name} 등록 미리보기`} draggable={false}/>
              : multiple && !focused && pickedImages.length > 0 && previewMode !== 'none' ? <div className="editor-preview-stack" role="img" aria-label={`이미지 ${pickedImages.length}장`}>{pickedImages.slice(0, 3).map(asset => <img key={asset.id} src={asset.thumbnailUrl} alt="" draggable={false}/>)}</div>
              : previewMode !== 'none' && card?.imageAssetId ? <CardFace card={{...card,...draft, castOptions:card.castOptions}} original/>
              : <div className="card-face default-face" role="img" aria-label={`${previewInfo.name} 기본 카드 미리보기`}><DefaultCard card={previewInfo} placeholder={!nameValue.trim()}/></div>}
          </div>
          {singleDuplicate && <p className="batch-warning">같은 이미지가 이미 ‘{singleDuplicate.existing.join('’, ‘')}’ 카드에 있습니다{singleDuplicate.trashed ? '(휴지통 포함)' : ''}. 그대로 등록할 수도 있습니다.</p>}
          <div className="drop-zone" onDragOver={event => event.preventDefault()} onDrop={drop}>
            <label className="file-button">{pickLabel}<input type="file" aria-label={card ? '교체 이미지 파일' : '카드 이미지 파일'} accept=".png,.jpg,.jpeg,.webp" multiple={!card} disabled={locked} onChange={event => { void importFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} /></label>
            {card?.imageReference && !replacement?.thumbnailUrl && imageMode !== 'none' && <p className="muted">원본 이미지를 연결하려면 이미지 선택을 누르세요.</p>}
            <ImageModeField mode={imageMode} disabled={locked} onChange={imageMode => setDraft(current => ({ ...current, imageMode }))}/>
            {!card && <button type="button" disabled={locked || assets.length >= 100} onClick={addImageless}>이미지 없는 카드 추가</button>}
            {single && <button type="button" disabled={locked} onClick={() => removeAsset(single.id)}>이미지 빼기</button>}
            {replacement && <button type="button" disabled={locked} onClick={() => removeAsset(replacement.id)}>교체 취소</button>}
            <p>{pickNote}</p>
          </div>
        </aside>
        <div className="editor-fields">
          {busy && <p className="muted">이미지 또는 정보를 저장하는 중…</p>}
          {!!importErrors.length && <ul className="import-errors">{importErrors.map((message, i) => <li key={i}>{message}</li>)}</ul>}
          {!card && onTemplates && <TemplateBar templates={templates} busy={locked} onApply={applyChosenTemplate} onSave={onTemplates} capture={captureTemplate} notes={templateNotes}/>}
          {!card && !onTemplates && templateNotes.length > 0 && <div className="template-notes" role="status">{templateNotes.map((note, i) => <p key={i}>{note}</p>)}</div>}
          {multiple && <h3 className="batch-common-title">공통 설정 · 모든 카드의 기본값</h3>}
          <fieldset className="editor-plain" disabled={batchRunning}>
          <section className="editor-section" aria-label="카드 기본 정보">
            {!multiple && <label className="form-field">카드 이름<input autoFocus value={nameValue} required maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} /></label>}
            <div className="form-columns">
              <label className="form-field">카드 유형<select aria-label="카드 유형" value={draft.kind} disabled={busy} onChange={event => setDraft({ ...draft, kind: event.target.value as CardDraft['kind'], spellLevel: event.target.value === 'spell' ? draft.spellLevel : undefined })}>{Object.entries(KIND_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              {draft.kind === 'spell' && <label className="form-field">주문 레벨 (선택)<select aria-label="주문 레벨 (선택)" value={draft.spellLevel ?? ''} disabled={busy} onChange={event => setDraft({ ...draft, spellLevel: event.target.value === '' ? undefined : Number(event.target.value) })}><option value="">미지정</option>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{i === 0 ? '0 · 소마법' : i}</option>)}</select></label>}
            </div>
            <Checks title="카드 역할" disabled={busy} choices={ROLE_NAMES} values={draft.roles} onChange={roles => setDraft({ ...draft, roles })} />
            <Checks title="카드 행동 경제" disabled={busy} choices={ACTION_NAMES} values={draft.actions} onChange={actions => setDraft({ ...draft, actions })} />
            <CardTraits value={draft} disabled={busy} onChange={patch => setDraft(current => ({ ...current, ...patch }))}/>
            <OwnedResourcesEditor definitions={draft.ownedResources} disabled={locked} onChange={ownedResources => setDraft(current => ({ ...current, ownedResources }))}/>
            <p className="muted editor-hint">유형은 카드의 종류, 역할은 효과입니다. 예: 공격 주문 = 유형 ‘주문’ · 역할 ‘공격’.</p>
          </section>
          <section className="editor-section editor-tags" aria-label="카드 태그 설정">
            <Checks title="카드 태그" disabled={busy} choices={Object.fromEntries(tags.map(tag => [tag.id, tag.name]))} values={draft.tags} onChange={selected => setDraft({ ...draft, tags: selected })} />
            <div className="inline-form"><label>새 태그<input maxLength={60} value={newTag} disabled={busy} onChange={event => setNewTag(event.target.value)} /></label><button type="button" disabled={busy || !newTag.trim()} onClick={() => void addTag()}>태그 추가</button></div>
          </section>
          {!card&&<fieldset disabled={busy} className="registration-rules-shell"><RegistrationRules hasOwned={!!draft.ownedResources?.length} advanced={!multiple} kind={multiple&&ruleKind==='advanced'?'unconfigured':ruleKind} onKind={chooseRule} draft={{...ruleDraft,spellLevel:draft.spellLevel}} onChange={updateRule} scope={ruleScope} onScope={setRuleScope} characterId={characterId} snapshot={controller?.snapshot} busy={busy} onAdvanced={()=>setAdvancedOpen(true)} summary={proposal?describeUseRules(proposal.castOptions,proposal.bindings,ruleResources):ruleError?[ruleError]:[]} pending={draftView} pendingNote={newResource?describeDraft(newResource):undefined} characterName={characterName} onNewResource={characterId&&controller?.snapshot?()=>setResourceFormOpen(true):undefined} onDiscardPending={()=>{if(newResource&&ruleDraft.resourceId===newResource.draftId)updateRule({resourceId:''});setNewResource(undefined);}}/>{controller?.error&&<p role="alert">{controller.error}</p>}<button type="button" disabled={busy||!controller} onClick={()=>void controller?.refresh()}>연결 자원 다시 불러오기</button></fieldset>}
          <details className="editor-advanced"><summary>{multiple ? '세부 설정 · 사거리' : '세부 설정 · 사거리 / 설명'}</summary>
            <div className="form-columns"><label className="form-field">사거리<select aria-label="사거리" value={draft.range.kind} disabled={busy} onChange={event => setDraft({ ...draft, range: { ...draft.range, kind: event.target.value as CardDraft['range']['kind'] } })}>{Object.entries(RANGE_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="form-field">거리 (ft, 선택)<input type="number" min={0} max={100000} step={1} value={draft.range.feet ?? ''} disabled={busy} onChange={event => setDraft({ ...draft, range: { ...draft.range, feet: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label></div>
            {!multiple && <label className="form-field">설명 (선택)<textarea maxLength={10000} value={draft.description ?? ''} disabled={busy} rows={3} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>}
            <p className="muted">{multiple ? '설명은 카드마다 다르므로 아래 카드별 ‘개별 설정’에서 적습니다.' : '설명은 카드 페이지의 ‘설명·추가 정보’에 나옵니다. 주문 레벨은 시전 슬롯 검증에 씁니다.'}</p>
          </details>
          </fieldset>
          {multiple && <BatchRegistration assets={assets} items={batch} onItems={setBatch} names={names} onName={(id, value) => setNames(current => ({ ...current, [id]: value }))} onRemove={removeAsset} duplicates={duplicates}
            common={common} tags={tags} target={target} targetLabel={destinationLabel} characterId={characterId} characterName={characterName} controller={controller} resources={controller?.snapshot?.resources ?? []}
            draft={newResource} draftView={draftView} pendingNote={newResource ? describeDraft(newResource) : undefined} busy={busy} onLibrary={onLibrary} onClose={finish} onRunning={setBatchRunning} onFocus={setFocus} deckLink={deckLink}/>}
        </div>
      </div>
      {!multiple && <>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <div className="modal-actions editor-actions">
          {deckLink}
          <button type="button" disabled={busy} onClick={finish}>취소</button><button className="primary" type="submit" disabled={busy}>{card ? '수정 저장' : '카드 저장'}</button>
        </div>
      </>}
      {multiple && error && <p className="error-banner" role="alert">{error}</p>}
    </form>
    {resourceFormOpen&&<NewResourceDialog initial={newResource} ruleKind={ruleKind==='points'?'points':'uses'} resources={controller?.snapshot?.resources??[]} characterName={characterName} onCancel={()=>setResourceFormOpen(false)} onPickExisting={id=>{updateRule({resourceId:id});setResourceFormOpen(false);}} onCreate={(created,kind)=>{setNewResource(created);chooseRule(kind);updateRule({resourceId:created.draftId});setResourceFormOpen(false);}}/>}
  </Modal>;
}
