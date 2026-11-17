import { memo } from 'react';
import type { LibraryState, Tag, CardDefinition } from '../shared/contracts';
import { ROLE_NAMES, ACTION_NAMES, KIND_NAMES, RANGE_NAMES } from '../shared/library';

export function toggleValue<T>(values: T[], value: T): T[] { return values.includes(value) ? values.filter(v => v !== value) : [...values, value]; }

/** Action-economy values offered next to the role chips. They edit the same `actions` state as the extra filters. */
export const QUICK_ACTIONS = ['action', 'bonus_action'] as const;
export const EXTRA_FILTERS_PANEL_ID = 'extra-filters-panel';

/** One-line description of every active condition, shown inside the popover and as the toggle's tooltip. */
export function filterSummary(state: LibraryState, tags: Tag[]): string {
  const parts: string[] = [];
  const group = (label: string, names: string[]) => { if (names.length) parts.push(`${label} ${names.join(' 또는 ')}`); };
  group('역할', state.roles.map(role => ROLE_NAMES[role]));
  group('행동 경제', state.actions.map(action => ACTION_NAMES[action]));
  group('유형', state.kinds.map(kind => KIND_NAMES[kind]));
  group('사거리', state.ranges.map(range => RANGE_NAMES[range]));
  group('태그', state.tagIds.map(id => tags.find(tag => tag.id === id)?.name ?? id));
  if (state.query) parts.push(`이름 “${state.query}”`);
  return parts.join(' · 그리고 · ');
}

function Chips<T extends string>({ title, choices, selected, onChange, counts }: { title: string; choices: Record<T, string>; selected: T[]; onChange: (next: T[]) => void; counts?: Partial<Record<T, number>> }) {
  return <fieldset className="filter-group" data-filter-group={title}><legend>{title}</legend><div className="chips">{(Object.entries(choices) as [T, string][]).map(([key, name]) => <button key={key} type="button" aria-label={name} data-filter-value={key} aria-pressed={selected.includes(key)} onClick={() => onChange(toggleValue(selected, key))}>{name}{counts && <span aria-hidden="true"> · {counts[key] ?? 0}</span>}</button>)}</div></fieldset>;
}

export const Filters = memo(function Filters({ state, tags, onChange, cards = [] }: { state: LibraryState; tags: Tag[]; onChange: (patch: Partial<LibraryState>) => void; cards?: CardDefinition[] }) {
  const extraCount = state.actions.length + state.kinds.length + state.ranges.length + state.tagIds.length;
  const activeCount = extraCount + state.roles.length + (state.query ? 1 : 0);
  const summary = filterSummary(state, tags);
  return <section className="filters" aria-label="카드 검색 및 필터">
    <div className="search-row"><label className="search-field"><span className="sr-only">카드 이름 검색</span><input id="card-name-search" aria-keyshortcuts="Control+f Meta+f" type="search" placeholder="카드 이름 검색" value={state.query} maxLength={200} onChange={event => onChange({ query: event.target.value })} /></label><button type="button" className="filter-reset" disabled={!activeCount} onClick={() => onChange({ query: '', roles: [], actions: [], kinds: [], ranges: [], tagIds: [] })}>필터 초기화</button></div>
    <div className="filter-strip">
      <div className="role-filter"><button type="button" aria-pressed={!state.roles.length} onClick={() => onChange({ roles: [] })}>전체</button><Chips title="역할 필터" choices={ROLE_NAMES} selected={state.roles} onChange={roles => onChange({ roles })} /></div>
      <div className="quick-actions" role="group" aria-label="행동 빠른 선택">{QUICK_ACTIONS.map(action => <button key={action} type="button" aria-pressed={state.actions.includes(action)} onClick={() => onChange({ actions: toggleValue(state.actions, action) })}>{ACTION_NAMES[action]}</button>)}</div>
    </div>
    <div className="extra-filters">
      <button type="button" className="extra-filters-toggle" popoverTarget={EXTRA_FILTERS_PANEL_ID} aria-haspopup="dialog" title={summary ? `적용 중: ${summary}` : '추가 필터'}>추가 필터{extraCount > 0 && <span className="filter-count" aria-label={`${extraCount}개 선택`}> · {extraCount}</span>}</button>
      <div id={EXTRA_FILTERS_PANEL_ID} popover="auto" className="extra-filters-panel" role="dialog" aria-label="추가 필터">
        <div className="extra-filters-head">
          <strong>추가 필터</strong>
          <button type="button" className="extra-filters-close" popoverTarget={EXTRA_FILTERS_PANEL_ID} popoverTargetAction="hide" aria-label="추가 필터 닫기">닫기</button>
          <p className="filter-summary" aria-live="polite">{summary ? `적용 중: ${summary}` : '적용 중인 조건이 없습니다.'}</p>
        </div>
        <Chips title="행동 경제 필터" choices={ACTION_NAMES} selected={state.actions} onChange={actions => onChange({ actions })} />
        <Chips title="카드 유형 필터" choices={KIND_NAMES} selected={state.kinds} onChange={kinds => onChange({ kinds })} counts={Object.fromEntries(Object.keys(KIND_NAMES).map(kind => [kind, cards.filter(card => card.kind === kind).length]))} />
        <p className="filter-help">유형별 수는 현재 라이브러리/덱 기준입니다. 역할 ‘공격’과 유형 ‘공격’은 별도로 지정합니다.</p>
        <Chips title="사거리 필터" choices={RANGE_NAMES} selected={state.ranges} onChange={ranges => onChange({ ranges })} />
        <fieldset className="filter-group"><legend>태그 필터</legend><div className="chips">{tags.length ? tags.map(tag => <button key={tag.id} type="button" aria-pressed={state.tagIds.includes(tag.id)} onClick={() => onChange({ tagIds: toggleValue(state.tagIds, tag.id) })}>{tag.name}</button>) : <span className="muted">등록된 태그가 없습니다.</span>}</div></fieldset>
        <p className="filter-help">같은 분류는 OR · 서로 다른 분류는 AND로 찾습니다. 위의 “행동·보너스 행동” 버튼은 행동 경제 필터와 같은 설정입니다.</p>
      </div>
    </div>
  </section>;
});
