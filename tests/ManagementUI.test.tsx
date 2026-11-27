// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardBatchTools } from '../src/components/CardBatchTools';
import { ResourcePanel, type ResourceController } from '../src/components/ResourcePanel';
import { historyMark, visibleHistory } from '../src/shared/history-view';
import type { DesktopBridge } from '../src/shared/contracts';
import type { ResourceEvent } from '../src/shared/resources';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.desktop = {
    previewTrash: vi.fn().mockResolvedValue({ ok: true, value: { count: 2, names: ['가', '나'], characters: [], decks: [], notes: [], quote: 'q', requiresPhrase: false } }),
    changeTrash: vi.fn(), getUseHistory: vi.fn(), changeResource: vi.fn(), previewResource: vi.fn(),
  } as unknown as DesktopBridge;
});
afterEach(cleanup);

const event = (id: string, minute: number, label = '카드 사용'): ResourceEvent =>
  ({ id, characterId: 'a', type: 'card_used', label, changes: [], reversible: true, barrier: false, timestamp: `2026-11-18T10:${String(minute).padStart(2, '0')}:00.000Z` });
const events = [event('e3', 3, '화염구'), event('e2', 2, '짧은 휴식'), event('e1', 1, '마법 화살')];
const controller = (list: ResourceEvent[], undoTargetId?: string): ResourceController => ({
  snapshot: { characterId: 'a', revision: 4, templates: [], resources: [], bindings: [], events: list, warnings: [], undoTargetId },
  busy: false, error: '', perform: vi.fn(), refresh: vi.fn(),
} as unknown as ResourceController);

describe('v1.1 Phase 2 selection management bar', () => {
  const props = { visibleCount: 9, scopeLabel: '활성 덱 ‘기본 덱’', tags: [], decks: [], onAll: vi.fn(), onClear: vi.fn(), onSaved: vi.fn(), onTrashed: vi.fn() };

  it('puts end-selection where the trash move was and moves the trash move into the bulk area with its count and scope', async () => {
    const onExit = vi.fn();
    const view = render(<CardBatchTools {...props} ids={['x', 'y']} onExit={onExit}/>);
    const firstRow = view.container.querySelector('.batch-tools > .batch-actions')!;
    expect([...firstRow.querySelectorAll('button')].map(button => button.textContent)).toEqual(['표시 카드 전체 선택', '카드 선택 해제', '선택 관리 종료']);
    const details = view.container.querySelector('.batch-tools > details')!;
    expect(details.querySelector('summary')!.textContent).toBe('선택 카드 일괄 작업');
    expect(details.hasAttribute('open')).toBe(false);
    const trash = details.querySelector<HTMLButtonElement>('.batch-trash button')!;
    expect(trash.textContent).toBe('선택한 라이브러리 원본을 휴지통으로 이동');
    expect(view.container.querySelectorAll('.trash-move')).toHaveLength(1);
    expect(details.querySelector('.batch-trash-scope')!.textContent).toBe('대상 2장 · 범위: 활성 덱 ‘기본 덱’의 현재 필터 결과 9장 중 선택한 카드');
    fireEvent.click(trash);
    expect(await screen.findByRole('heading', { name: '휴지통 이동 확인' })).toBeDefined();
    expect(window.desktop.previewTrash).toHaveBeenCalledWith({ type: 'move', cardIds: ['x', 'y'] });
    expect(window.desktop.changeTrash).not.toHaveBeenCalled();
    fireEvent.click(within(firstRow as HTMLElement).getByRole('button', { name: '선택 관리 종료' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('keeps the trash move disabled while nothing is selected', () => {
    const view = render(<CardBatchTools {...props} ids={[]} onExit={vi.fn()}/>);
    expect(view.container.querySelector<HTMLButtonElement>('.batch-trash button')!.disabled).toBe(true);
    expect(view.container.querySelector('.batch-trash-scope')!.textContent).toContain('대상 0장');
  });
});

describe('v1.1 Phase 2 recent actions display', () => {
  it('hides what was shown when cleared, shows newer actions, and falls back to time when the mark is out of range', () => {
    expect(visibleHistory(events)).toEqual(events);
    const mark = historyMark(events)!;
    expect(mark).toEqual({ clearedEventId: 'e3', clearedAt: '2026-11-18T10:03:00.000Z' });
    expect(visibleHistory(events, mark)).toEqual([]);
    expect(visibleHistory([event('e4', 4), ...events], mark).map(item => item.id)).toEqual(['e4']);
    expect(visibleHistory([event('e5', 5), event('e4', 4)], { clearedEventId: 'gone', clearedAt: '2026-11-18T10:04:00.000Z' }).map(item => item.id)).toEqual(['e5']);
    expect(historyMark([])).toBeUndefined();
  });

  it('asks first, explains that resources, use records and Undo are kept, and stores only a display mark', () => {
    const onHistoryChange = vi.fn(); const control = controller(events, 'e3');
    const view = render(<ResourcePanel controller={control} onHistoryChange={onHistoryChange}/>);
    const history = view.container.querySelector('.resource-history') as HTMLElement;
    expect(history.querySelector('summary')!.textContent).toBe('최근 작업 · 3');
    fireEvent.click(within(history).getByRole('button', { name: '기록 비우기' }));
    let dialog = screen.getByRole('dialog', { name: '최근 작업 기록 비우기' });
    for (const text of ['3건의 표시만 정리합니다', '자원 현재량은 바뀌지 않습니다', '카드 사용 기록은 지우지 않습니다', '직전 자원 변경 실행 취소', '다시 시작해도']) expect(dialog.textContent).toContain(text);
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(onHistoryChange).not.toHaveBeenCalled();
    fireEvent.click(within(history).getByRole('button', { name: '기록 비우기' }));
    dialog = screen.getByRole('dialog', { name: '최근 작업 기록 비우기' });
    fireEvent.click(within(dialog).getByRole('button', { name: '표시 기록 비우기' }));
    expect(onHistoryChange).toHaveBeenCalledWith({ clearedEventId: 'e3', clearedAt: '2026-11-18T10:03:00.000Z' });
    expect(control.perform).not.toHaveBeenCalled();
    expect(window.desktop.changeResource).not.toHaveBeenCalled();
  });

  it('after clearing shows only newer actions, keeps Undo available and can show the hidden actions again', () => {
    const onHistoryChange = vi.fn();
    const view = render(<ResourcePanel controller={controller([event('e4', 4, '신규 작업'), ...events], 'e4')} history={historyMark(events)} onHistoryChange={onHistoryChange}/>);
    const history = view.container.querySelector('.resource-history') as HTMLElement;
    expect(history.querySelector('summary')!.textContent).toBe('최근 작업 · 1');
    expect([...history.querySelectorAll('li strong')].map(item => item.textContent)).toEqual(['신규 작업']);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '직전 자원 변경 실행 취소' }).disabled).toBe(false);
    fireEvent.click(within(history).getByRole('button', { name: '숨긴 기록 다시 표시' }));
    expect(onHistoryChange).toHaveBeenCalledWith(undefined);
    view.rerender(<ResourcePanel controller={controller(events, 'e3')} history={historyMark(events)} onHistoryChange={onHistoryChange}/>);
    expect(history.querySelector('.history-empty')!.textContent).toBe('기록을 비운 뒤 새 작업이 없습니다.');
    expect(within(history).getByRole<HTMLButtonElement>('button', { name: '기록 비우기' }).disabled).toBe(true);
  });
});
