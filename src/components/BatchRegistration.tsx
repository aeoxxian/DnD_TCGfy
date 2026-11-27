import { OwnedResourcesEditor } from './OwnedResourcesEditor';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CardDraft, Library, RegistrationTarget, Tag } from '../shared/contracts';
import { ACTION_NAMES, KIND_NAMES, RANGE_NAMES, ROLE_NAMES } from '../shared/library';
import { BATCH_RULE_NAMES, attemptFor, cardFields, effectiveItem, itemProblem, itemRequest, itemRule, summarizeBatch, type BatchCommon, type BatchItem, type BatchRule, type BatchRuleKind, type CardFields } from '../shared/batch-registration';
import { describeUseRules } from '../shared/use-rules';
import { sameResourceName, type NewResourceDraft } from '../shared/resource-drafts';
import type { ResourceView } from '../shared/resources';
import type { ResourceController } from './ResourcePanel';
import { RegistrationRules, type RegistrationKind } from './RegistrationRules';
import { Checks } from './FormChecks';
import { DefaultCard, kindLine } from './CardFace';
import { CardTraits, ImageModeField } from './CardMetadataFields';
import type { BatchAsset } from '../shared/batch-registration';

type Phase = 'edit' | 'confirm' | 'running' | 'done';
type Items = Record<string, BatchItem>;
export type Duplicates = Map<string, { existing: string[]; trashed: boolean; repeatOf?: string }>;
const STATUS: Record<BatchItem['status'], string> = { ready: '대기', saving: '등록 중…', saved: '완료', failed: '실패', pending: '미처리' };
const STOP_AFTER = 3;

/**
 * v1.3 Phase 2: the list part of a multi-image registration. Each card follows the common settings unless it is set on
 * its own; “N장 등록” → final check → one registration transaction per card → result with retry.
 */
export function BatchRegistration({ assets, items, onItems, names, onName, onRemove, duplicates, common, tags, target, targetLabel, characterId, characterName, controller, resources, draft, draftView, pendingNote, busy, onLibrary, onClose, onRunning, onFocus, deckLink }: {
  assets: BatchAsset[]; items: Items; onItems: (update: (current: Items) => Items) => void;
  names: Record<string, string>; onName: (assetId: string, name: string) => void; onRemove: (assetId: string) => void; duplicates: Duplicates;
  common: BatchCommon; tags: Tag[]; target: RegistrationTarget | null; targetLabel?: string; characterId?: string; characterName?: string;
  controller?: ResourceController; resources: ResourceView[]; draft?: NewResourceDraft; draftView?: ResourceView; pendingNote?: string;
  busy: boolean; onLibrary: (library: Library) => void; onClose: () => void; onRunning: (running: boolean) => void; onFocus: (assetId?: string) => void; deckLink: ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>('edit');
  const [open, setOpen] = useState<string>();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const latest = useRef(items);
  useEffect(() => { latest.current = items; }, [items]);
  const stop = useRef(false);
  const created = useRef<string | undefined>(undefined);
  const ctx = { target, characterId, draft, duplicates };
  const nameOf = (asset: BatchAsset) => names[asset.id] ?? asset.name;
  const itemOf = (asset: BatchAsset): BatchItem => items[asset.id] ?? { assetId: asset.id, include: true, status: 'ready', ids: { optionId: `${asset.id}-o`, costKey: `${asset.id}-c` } };
  const summary = summarizeBatch(assets.map(itemOf), Object.fromEntries(assets.map(asset => [asset.id, nameOf(asset)])), common, ctx);
  const running = phase === 'running';
  const update = (assetId: string, patch: Partial<BatchItem>) => onItems(current => current[assetId] ? { ...current, [assetId]: { ...current[assetId], ...patch } } : current);
  const existingDuplicates = assets.filter(asset => { const item = itemOf(asset); return item.include && item.status !== 'saved' && duplicates.get(asset.id)?.existing.length; });

  function review() {
    setError(''); setNote('');
    if (!summary.included) { setError('등록할 카드가 없습니다. 목록에서 카드를 포함해 주세요.'); return; }
    if (summary.problems) {
      const first = assets.find(asset => { const item = itemOf(asset); return item.include && item.status !== 'saved' && itemProblem(effectiveItem(item, nameOf(asset), common), item.ids, ctx); });
      if (first) { setOpen(first.id); onFocus(first.id); }
      setError(`확인이 필요한 카드 ${summary.problems}장이 있습니다. 목록의 ‘확인 필요’를 고친 뒤 다시 등록해 주세요.`); return;
    }
    setPhase('confirm');
  }
  async function run(retry: boolean) {
    latest.current = items;
    stop.current = false; setError(''); setNote(''); setPhase('running'); setOpen(undefined); onRunning(true);
    const queue = assets.filter(asset => { const item = latest.current[asset.id]; return item?.include && item.status !== 'saved' && (!retry || item.status === 'failed' || item.status === 'pending'); });
    let failures = 0; let stopped = false;
    for (let index = 0; index < queue.length; index++) {
      const asset = queue[index];
      if (stop.current || failures >= STOP_AFTER) {
        stopped = true;
        for (const rest of queue.slice(index)) update(rest.id, { status: 'pending', error: undefined });
        break;
      }
      const item = latest.current[asset.id];
      update(asset.id, { status: 'saving', error: undefined });
      try {
        const effective = effectiveItem(item, nameOf(asset), common);
        const problem = itemProblem(effective, item.ids, ctx);
        if (problem) throw new Error(problem);
        let revision: number | undefined;
        if (characterId && itemRule(effective, item.ids).configured) {
          const snapshot = await window.desktop.getResources(characterId);
          if (!snapshot.ok) throw new Error(snapshot.error);
          revision = snapshot.value.revision;
        }
        const { createsDraft, ...request } = itemRequest(effective, item.ids, { target, characterId, revision, draft, createdDraftId: created.current });
        const attempt = attemptFor(item, { ...request, createsDraft });
        update(asset.id, { attempt });
        latest.current = { ...latest.current, [asset.id]: { ...item, attempt } };
        const result = await window.desktop.saveCards({ ...request, initialRules: { ...request.initialRules, requestId: attempt.requestId } });
        if (!result.ok) { failures++; update(asset.id, { status: 'failed', error: result.error }); continue; }
        failures = 0; onLibrary(result.value);
        update(asset.id, { status: 'saved', error: undefined, cardId: result.value.cards.find(card => card.imageAssetId === asset.id)?.id });
        if (createsDraft && draft && characterId) {
          const snapshot = await window.desktop.getResources(characterId);
          if (snapshot.ok) created.current = snapshot.value.resources.find(resource => sameResourceName(resource.name, draft.template.name))?.id;
        }
      } catch (caught) {
        failures++;
        update(asset.id, { status: 'failed', error: caught instanceof Error && caught.message ? caught.message : '카드를 저장하지 못했습니다. 다시 시도할 수 있습니다.' });
      }
    }
    if (stopped && !stop.current) setNote(`연속으로 ${STOP_AFTER}장이 실패해 나머지는 등록하지 않았습니다(미처리). 원인을 확인한 뒤 다시 등록해 주세요.`);
    else if (stopped) setNote('중단했습니다. 남은 카드는 미처리로 남겼습니다.');
    setPhase('done'); onRunning(false);
    void controller?.refresh();
  }

  const total = summary.saved + summary.failed + summary.pending;
  return <>
    <section className="batch-list" aria-label="카드별 확인">
      <div className="batch-head">
        <h3>카드별 확인 · {assets.length}장</h3>
        <p className="muted">카드마다 공통 설정을 따르면 ‘기본값’, 이 카드만 바꾸면 ‘개별’로 표시합니다. 이름·설명·비용·덱 연결을 카드마다 바꿀 수 있습니다.</p>
        <p className="batch-counts" aria-label="일괄 등록 현황">포함 {summary.included + summary.saved}장 · 제외 {summary.excluded}장{summary.problems ? ` · 확인 필요 ${summary.problems}장` : ''}{summary.saved ? ` · 완료 ${summary.saved}장` : ''}</p>
        {existingDuplicates.length > 0 && phase === 'edit' && <button type="button" disabled={busy} onClick={() => onItems(current => { const next = { ...current }; for (const asset of existingDuplicates) next[asset.id] = { ...next[asset.id], include: false }; return next; })}>이미 등록된 이미지 {existingDuplicates.length}장 제외</button>}
      </div>
      <ol className="batch-rows">{assets.map((asset, index) => {
        const item = itemOf(asset); const name = nameOf(asset);
        const effective = effectiveItem(item, name, common);
        const problem = item.include && item.status !== 'saved' ? itemProblem(effective, item.ids, ctx) : undefined;
        const duplicate = duplicates.get(asset.id);
        const locked = busy || running || item.status === 'saved';
        let ruleText: string = BATCH_RULE_NAMES[effective.rule.kind];
        if (effective.card.ownedResources?.length && ['unconfigured', 'none'].includes(effective.rule.kind)) ruleText = '고유 자원 사용';
        if (effective.rule.kind !== 'unconfigured' && !problem) {
          try { const rule = itemRule(effective, item.ids); ruleText = describeUseRules(rule.castOptions, rule.bindings, [...resources, ...(draftView ? [draftView] : [])])[0] ?? ruleText; } catch { /* shown as 확인 필요 */ }
        }
        return <li key={asset.id} className={`batch-row status-${item.status} ${item.include ? '' : 'is-excluded'} ${open === asset.id ? 'is-open' : ''}`} aria-label={`${index + 1}번 카드 ${name}`}>
          <label className="batch-include"><input type="checkbox" aria-label={`${name} 등록에 포함`} checked={item.include} disabled={locked} onChange={event => update(asset.id, { include: event.target.checked })}/></label>
          {effective.card.imageMode === 'none' ? <span className="batch-thumb" aria-label="이미지 없음">◇</span> : effective.card.imageMode === 'illustration' ? <div className="batch-thumb card-face default-face"><DefaultCard card={effective.card} artwork={<img src={asset.thumbnailUrl} alt="" draggable={false}/>}/></div> : <img className="batch-thumb" src={asset.thumbnailUrl} alt={`${asset.name} 등록 미리보기`} draggable={false}/>}
          <div className="batch-main">
            <label className="batch-name">카드 이름 {index + 1}<input value={name} required maxLength={200} disabled={locked} onChange={event => onName(asset.id, event.target.value)}/></label>
            <p className="batch-chips">
              <span className={effective.custom.card ? 'is-custom' : ''}><b>{effective.custom.card ? '개별' : '기본값'}</b>{kindLine(effective.card)} · {effective.card.roles.map(role => ROLE_NAMES[role]).join('·') || '역할 없음'} · {effective.card.actions.map(action => ACTION_NAMES[action]).join('·')}</span>
              <span className={effective.custom.rule ? 'is-custom' : ''}><b>{effective.custom.rule ? '개별' : '기본값'}</b>{ruleText}</span>
              {target && <span className={effective.custom.deck ? 'is-custom' : ''}><b>{effective.custom.deck ? '개별' : '기본값'}</b>{effective.addToDeck ? '덱에 넣기' : '라이브러리만'}</span>}
              {item.description?.trim() && <span className="is-custom"><b>개별</b>설명 있음</span>}
            </p>
            {duplicate && <p className="batch-warning">{duplicate.repeatOf ? `이 목록의 ‘${duplicate.repeatOf}’와 같은 이미지입니다. 기본으로 제외했습니다.` : `같은 이미지가 이미 ‘${duplicate.existing.join('’, ‘')}’ 카드에 있습니다${duplicate.trashed ? '(휴지통 포함)' : ''}.`}</p>}
            {problem && <p className="batch-problem">확인 필요 · {problem}</p>}
            {item.include && item.status !== 'ready' && <p className={`batch-status status-${item.status}`} role={item.status === 'failed' ? 'alert' : undefined}>{STATUS[item.status]}{item.status === 'failed' && item.error ? ` · ${item.error}` : ''}</p>}
          </div>
          <div className="batch-actions">
            <button type="button" aria-expanded={open === asset.id} aria-label={`${name} 개별 설정`} disabled={locked} onClick={() => { const next = open === asset.id ? undefined : asset.id; setOpen(next); onFocus(next); }}>개별 설정</button>
            <button type="button" aria-label={`${asset.name} 등록 목록에서 제외`} disabled={locked} onClick={() => { if (open === asset.id) { setOpen(undefined); onFocus(undefined); } onRemove(asset.id); }}>빼기</button>
          </div>
          {open === asset.id && !locked && <ItemEditor item={item} name={name} common={common} tags={tags} target={target} targetLabel={targetLabel} characterId={characterId} characterName={characterName} controller={controller} resources={resources} draftView={draftView} pendingNote={pendingNote} onChange={patch => update(asset.id, patch)}/>}
        </li>;
      })}</ol>
    </section>
    {phase === 'confirm' && <section className="batch-confirm" aria-label="등록 전 최종 확인">
      <h3>등록 전 최종 확인</h3>
      <ul>
        <li><strong>{summary.included}장</strong>을 새 카드로 등록합니다. 이미지 원본은 그대로 보관합니다.{summary.excluded ? ` 제외한 ${summary.excluded}장은 등록하지 않습니다.` : ''}</li>
        <li>{target ? `‘${targetLabel ?? '선택한 덱'}’에 넣기 ${summary.toDeck}장 · 라이브러리에만 ${summary.libraryOnly}장` : `활성 덱이 없어 ${summary.included}장 모두 라이브러리에만 등록합니다.`}</li>
        <li>비용: {(Object.entries(summary.rules) as [BatchRuleKind, number][]).filter(([, n]) => n).map(([kind, n]) => `${BATCH_RULE_NAMES[kind]} ${n}장`).join(' · ')}</li>
        {summary.custom > 0 && <li>개별 설정한 카드 {summary.custom}장</li>}
        {summary.createsResource && draft && <li>새 자원 ‘{draft.template.name}’을(를) 처음 등록되는 카드와 함께 만듭니다.</li>}
        {summary.duplicates > 0 && <li className="batch-warning">이미 있는 카드와 같은 이미지 {summary.duplicates}장이 포함되어 있습니다.</li>}
      </ul>
      <p className="muted">카드마다 따로 저장합니다. 중간에 실패한 카드가 있어도 저장된 카드는 그대로이며, 결과에서 다시 시도할 수 있습니다. 등록만으로 자원은 차감되지 않습니다.</p>
    </section>}
    {(phase === 'running' || phase === 'done') && <section className="batch-result" aria-label="등록 결과">
      <h3>{running ? `등록 중 · ${summary.saved}/${total}` : summary.failed || summary.pending ? '등록 결과' : `${summary.saved}장 등록 완료`}</h3>
      <p role="status">완료 {summary.saved}장 · 실패 {summary.failed}장 · 미처리 {summary.pending}장 · 제외 {summary.excluded}장</p>
      {note && <p className="batch-warning">{note}</p>}
      {!running && !summary.failed && !summary.pending && <p className="muted">모든 카드를 등록했습니다. 닫으면 손패로 돌아갑니다.</p>}
    </section>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    <div className="modal-actions editor-actions batch-actions-bar">
      {phase === 'edit' && deckLink}
      {phase === 'edit' && <><button type="button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary" disabled={busy || !summary.included} onClick={review}>{summary.included}장 등록</button></>}
      {phase === 'confirm' && <><button type="button" onClick={() => setPhase('edit')}>돌아가기</button><button type="button" className="primary" onClick={() => void run(false)}>등록 시작</button></>}
      {phase === 'running' && <button type="button" onClick={() => { stop.current = true; }}>중단</button>}
      {phase === 'done' && <>{(summary.failed > 0 || summary.pending > 0) && <button type="button" className="primary" onClick={() => void run(true)}>실패·미처리 다시 등록</button>}{summary.included > 0 && !summary.failed && !summary.pending && <button type="button" onClick={() => setPhase('edit')}>남은 카드 등록</button>}<button type="button" className={summary.failed || summary.pending ? '' : 'primary'} onClick={onClose}>닫기</button></>}
    </div>
  </>;
}

function ItemEditor({ item, name, common, tags, target, targetLabel, characterId, characterName, controller, resources, draftView, pendingNote, onChange }: {
  item: BatchItem; name: string; common: BatchCommon; tags: Tag[]; target: RegistrationTarget | null; targetLabel?: string; characterId?: string; characterName?: string;
  controller?: ResourceController; resources: ResourceView[]; draftView?: ResourceView; pendingNote?: string; onChange: (patch: Partial<BatchItem>) => void;
}) {
  const card = item.card;
  const setCard = (patch: Partial<CardFields>) => onChange({ card: { ...(card ?? cardFields(common.card)), ...patch } });
  const effective = effectiveItem(item, name, common);
  const rule: BatchRule = item.rule ?? common.rule;
  const setRule = (patch: Partial<BatchRule>) => onChange({ rule: { ...rule, ...patch } });
  let summary: string[] = [];
  try { const built = itemRule(effective, item.ids); summary = describeUseRules(built.castOptions, built.bindings, [...resources, ...(draftView ? [draftView] : [])]); } catch (error) { summary = [(error as Error).message]; }
  return <div className="batch-editor" role="group" aria-label={`${name} 개별 설정`}>
    <label className="checkbox-line"><input type="checkbox" checked={!!card} onChange={event => onChange({ card: event.target.checked ? cardFields(common.card) : undefined })}/>이 카드의 속성을 따로 정하기</label>
    {card ? <div className="batch-editor-card">
      <div className="form-columns">
        <label className="form-field">유형<select aria-label="개별 카드 유형" value={card.kind} onChange={event => setCard({ kind: event.target.value as CardDraft['kind'], spellLevel: event.target.value === 'spell' ? card.spellLevel : undefined })}>{Object.entries(KIND_NAMES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        {card.kind === 'spell' && <label className="form-field">주문 레벨<select aria-label="개별 주문 레벨" value={card.spellLevel ?? ''} onChange={event => setCard({ spellLevel: event.target.value === '' ? undefined : Number(event.target.value) })}><option value="">미지정</option>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{i === 0 ? '0 · 소마법' : i}</option>)}</select></label>}
        <label className="form-field">사거리<select aria-label="개별 사거리" value={card.range.kind} onChange={event => setCard({ range: { ...card.range, kind: event.target.value as CardDraft['range']['kind'] } })}>{Object.entries(RANGE_NAMES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      </div>
      <Checks title="개별 카드 역할" disabled={false} choices={ROLE_NAMES} values={card.roles} onChange={roles => setCard({ roles })}/>
      <Checks title="개별 카드 행동 경제" disabled={false} choices={ACTION_NAMES} values={card.actions} onChange={actions => setCard({ actions })}/>
      <ImageModeField mode={effective.card.imageMode ?? 'full_card'} onChange={imageMode => setCard({ imageMode })} individual noFile={item.imageless}/>
      <CardTraits value={card} onChange={setCard} individual/>
      <OwnedResourcesEditor definitions={card.ownedResources} onChange={ownedResources => setCard({ ownedResources })}/>
      {tags.length > 0 && <Checks title="개별 카드 태그" disabled={false} choices={Object.fromEntries(tags.map(tag => [tag.id, tag.name]))} values={card.tags} onChange={selected => setCard({ tags: selected })}/>}
    </div> : <p className="muted">공통 설정을 따릅니다: {kindLine(common.card)} · {common.card.roles.map(role => ROLE_NAMES[role]).join('·') || '역할 없음'}</p>}
    <label className="form-field">설명 (선택)<textarea aria-label="개별 카드 설명" maxLength={10000} rows={2} value={item.description ?? ''} onChange={event => onChange({ description: event.target.value })}/></label>
    <label className="form-field">비용<select aria-label="개별 비용 방식" value={item.rule ? 'own' : 'common'} onChange={event => onChange({ rule: event.target.value === 'own' ? { ...common.rule, draft: { ...common.rule.draft } } : undefined })}><option value="common">공통 규칙 따르기 ({BATCH_RULE_NAMES[common.rule.kind]})</option><option value="own">이 카드만 정하기</option></select></label>
    {item.rule && <RegistrationRules hasOwned={!!effective.card.ownedResources?.length} perCard advanced={false} kind={rule.kind as RegistrationKind} onKind={kind => setRule({ kind: (kind === 'advanced' ? 'unconfigured' : kind) as BatchRuleKind })} draft={{ ...rule.draft, spellLevel: effective.card.spellLevel }}
      onChange={patch => { if ('spellLevel' in patch) setCard({ kind: 'spell', spellLevel: patch.spellLevel }); const { spellLevel: _ignored, ...rest } = patch; void _ignored; if (Object.keys(rest).length) setRule({ draft: { ...rule.draft, ...rest } }); }}
      scope={rule.scope} onScope={scope => setRule({ scope })} characterId={characterId} snapshot={controller?.snapshot} busy={false} onAdvanced={() => undefined} summary={summary} pending={draftView} pendingNote={pendingNote} characterName={characterName}/>}
    {target && <label className="form-field">덱 연결<select aria-label="개별 덱 연결" value={item.addToDeck === undefined ? 'common' : item.addToDeck ? 'yes' : 'no'} onChange={event => onChange({ addToDeck: event.target.value === 'common' ? undefined : event.target.value === 'yes' })}><option value="common">공통 설정 따르기 ({common.addToDeck ? '넣기' : '넣지 않기'})</option><option value="yes">‘{targetLabel ?? '선택한 덱'}’에 넣기</option><option value="no">넣지 않기(라이브러리만)</option></select></label>}
    <button type="button" onClick={() => onChange({ card: undefined, rule: undefined, addToDeck: undefined, description: undefined })}>기본값으로 되돌리기</button>
  </div>;
}
