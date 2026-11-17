// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXTRA_FILTERS_PANEL_ID, Filters, filterSummary } from '../src/components/Filters';
import { DEFAULT_LIBRARY_STATE, type LibraryState, type Tag } from '../src/shared/contracts';
import { filterCards } from '../src/shared/library';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';

afterEach(cleanup);
const tags: Tag[] = [{ id: 'tag-fire', name: '화염', usageCount: 2 }];
const state = (patch: Partial<LibraryState> = {}): LibraryState => ({ ...DEFAULT_LIBRARY_STATE, ...patch });
// jsdom does not run the native popover toggle; its contents are queried with hidden: true.
const inPanel = (group: string, name: string) => screen.getByRole('group', { name: group, hidden: true }).querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement;

describe('v1.1 Phase 1 filter bar', () => {
  it('offers action and bonus action next to the roles and shares one state with the extra action-economy filter', () => {
    const onChange = vi.fn();
    const view = render(<Filters state={state({ actions: ['action'] })} tags={tags} onChange={onChange}/>);
    const quick = screen.getByRole('group', { name: '행동 빠른 선택' });
    const quickAction = quick.querySelector('button:nth-child(1)') as HTMLButtonElement;
    const quickBonus = quick.querySelector('button:nth-child(2)') as HTMLButtonElement;
    expect([quickAction.textContent, quickBonus.textContent]).toEqual(['행동', '보너스 행동']);
    expect(quickAction.getAttribute('aria-pressed')).toBe('true');
    expect(inPanel('행동 경제 필터', '행동').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(quickBonus);
    expect(onChange).toHaveBeenLastCalledWith({ actions: ['action', 'bonus_action'] });
    fireEvent.click(inPanel('행동 경제 필터', '행동'));
    expect(onChange).toHaveBeenLastCalledWith({ actions: [] });
    view.rerender(<Filters state={state({ actions: ['bonus_action'] })} tags={tags} onChange={onChange}/>);
    expect(quickAction.getAttribute('aria-pressed')).toBe('false');
    expect(quickBonus.getAttribute('aria-pressed')).toBe('true');
    expect(inPanel('행동 경제 필터', '보너스 행동').getAttribute('aria-pressed')).toBe('true');
  });

  it('combines the quick action filter with roles as AND, exactly like the extra filter', () => {
    const viaQuick = filterCards(SAMPLE_CARDS, state({ roles: ['damage', 'heal'], actions: ['bonus_action'] }));
    expect(viaQuick.every(card => (card.roles.includes('damage') || card.roles.includes('heal')) && card.actions.includes('bonus_action'))).toBe(true);
    expect(viaQuick.length).toBeLessThanOrEqual(filterCards(SAMPLE_CARDS, state({ roles: ['damage', 'heal'] })).length);
  });

  it('keeps the bar to a single row: no summary line is added below it when filters are active', () => {
    const active = state({ roles: ['damage'], kinds: ['spell'], ranges: ['ranged'], tagIds: ['tag-fire'], query: '불' });
    const view = render(<Filters state={active} tags={tags} onChange={vi.fn()}/>);
    const section = view.container.querySelector('.filters')!;
    expect([...section.children].map(child => child.className)).toEqual(['search-row', 'filter-strip', 'extra-filters']);
    const toggle = view.container.querySelector('.extra-filters-toggle')!;
    expect(toggle.getAttribute('title')).toBe(`적용 중: ${filterSummary(active, tags)}`);
    expect(filterSummary(active, tags)).toBe('역할 공격 · 그리고 · 유형 주문 · 그리고 · 사거리 원거리 · 그리고 · 태그 화염 · 그리고 · 이름 “불”');
    expect(view.container.querySelector('.extra-filters-panel .filter-summary')!.textContent).toContain('역할 공격');
    expect(toggle.textContent).toBe('추가 필터 · 3');
  });

  it('is a native popover: the toggle targets it, it light-dismisses, and a close button hides it', () => {
    const view = render(<Filters state={state()} tags={tags} onChange={vi.fn()}/>);
    const panel = view.container.querySelector(`#${EXTRA_FILTERS_PANEL_ID}`)!;
    expect(panel.getAttribute('popover')).toBe('auto');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(screen.getByRole('button', { name: '추가 필터' }).getAttribute('popovertarget')).toBe(EXTRA_FILTERS_PANEL_ID);
    const close = view.container.querySelector('.extra-filters-close')!;
    expect(close.getAttribute('popovertarget')).toBe(EXTRA_FILTERS_PANEL_ID);
    expect(close.getAttribute('popovertargetaction')).toBe('hide');
  });

  it('marks every selected extra filter in every group, and reset clears all of them at once', () => {
    const onChange = vi.fn();
    const active = state({ actions: ['reaction'], kinds: ['item'], ranges: ['touch'], tagIds: ['tag-fire'] });
    const view = render(<Filters state={active} tags={tags} onChange={onChange}/>);
    const pressed = () => [...view.container.querySelectorAll('.extra-filters-panel button[aria-pressed="true"]')].map(button => button.textContent!.replace(/ · \d+$/, ''));
    expect(pressed()).toEqual(['반응 행동', '아이템', '접촉', '화염']);
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }));
    expect(onChange).toHaveBeenLastCalledWith({ query: '', roles: [], actions: [], kinds: [], ranges: [], tagIds: [] });
    view.rerender(<Filters state={state()} tags={tags} onChange={onChange}/>);
    expect(pressed()).toEqual([]);
  });
});
