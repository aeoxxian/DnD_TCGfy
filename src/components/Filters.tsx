import type { LibraryState, Tag } from '../shared/contracts';
import { ROLE_NAMES, ACTION_NAMES, KIND_NAMES, RANGE_NAMES } from '../shared/library';

export function toggleValue<T>(values: T[], value: T): T[] { return values.includes(value) ? values.filter(v => v !== value) : [...values, value]; }
function Chips<T extends string>({ title, choices, selected, onChange }: { title: string; choices: Record<T, string>; selected: T[]; onChange: (next: T[]) => void }) {
  return <fieldset className="filter-group"><legend>{title}</legend><div className="chips">{(Object.entries(choices) as [T, string][]).map(([key, name]) => <button key={key} type="button" aria-pressed={selected.includes(key)} onClick={() => onChange(toggleValue(selected, key))}>{name}</button>)}</div></fieldset>;
}
export function Filters({ state, tags, onChange }: { state: LibraryState; tags: Tag[]; onChange: (patch: Partial<LibraryState>) => void }) {
  const extraCount = state.actions.length + state.kinds.length + state.ranges.length + state.tagIds.length;
  const activeCount = extraCount + state.roles.length + (state.query ? 1 : 0);
  return <section className="filters" aria-label="카드 검색 및 필터">
    <div className="search-row"><label className="search-field"><span className="sr-only">카드 이름 검색</span><input type="search" placeholder="카드 이름 검색" value={state.query} maxLength={200} onChange={event => onChange({ query: event.target.value })} /></label><button type="button" disabled={!activeCount} onClick={() => onChange({ query: '', roles: [], actions: [], kinds: [], ranges: [], tagIds: [] })}>필터 초기화</button></div>
    <div className="role-filter"><button type="button" aria-pressed={!state.roles.length} onClick={() => onChange({ roles: [] })}>전체</button><Chips title="역할 필터" choices={ROLE_NAMES} selected={state.roles} onChange={roles => onChange({ roles })} /></div>
    <details className="extra-filters"><summary>추가 필터{extraCount ? ` · ${extraCount}개 선택` : ''}</summary>
      <Chips title="행동 경제 필터" choices={ACTION_NAMES} selected={state.actions} onChange={actions => onChange({ actions })} />
      <Chips title="카드 유형 필터" choices={KIND_NAMES} selected={state.kinds} onChange={kinds => onChange({ kinds })} />
      <Chips title="사거리 필터" choices={RANGE_NAMES} selected={state.ranges} onChange={ranges => onChange({ ranges })} />
      <fieldset className="filter-group"><legend>태그 필터</legend><div className="chips">{tags.length ? tags.map(tag => <button key={tag.id} type="button" aria-pressed={state.tagIds.includes(tag.id)} onClick={() => onChange({ tagIds: toggleValue(state.tagIds, tag.id) })}>{tag.name}</button>) : <span className="muted">등록된 태그가 없습니다.</span>}</div></fieldset>
      <p className="filter-help">같은 분류는 OR · 서로 다른 분류는 AND로 찾습니다.</p>
    </details>
  </section>;
}
