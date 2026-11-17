// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResourcePanel, type ResourceController } from '../src/components/ResourcePanel';
import { SlotColorEditor } from '../src/components/SlotColorEditor';
import type { DesktopBridge } from '../src/shared/contracts';
import type { ResourceSnapshot, ResourceView } from '../src/shared/resources';
import { DEFAULT_SLOT_COLOR, PARCHMENT, SLOT_PALETTE, contrastRatio, lowContrast, slotColor, tidySlotColors } from '../src/shared/slot-colors';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.desktop = { getUseHistory: vi.fn(), previewResource: vi.fn(), changeResource: vi.fn() } as unknown as DesktopBridge;
});
afterEach(cleanup);

const slots = (id: string, slotKind: 'standard' | 'pact', capacityByLevel: Record<string, number>): ResourceView => ({
  id, templateId: id, characterId: 'a', name: slotKind === 'pact' ? '계약 마법 슬롯' : '주문 슬롯', unit: '칸', kind: 'slot_track', overrides: { scope: 'character' },
  capacityByLevel, remainingByLevel: Object.fromEntries(Object.entries(capacityByLevel).map(([level, n]) => [level, Math.max(0, n - 1)])),
  template: { id, key: id, name: id, unit: '칸', kind: 'slot_track', slotKind, source: 'user', version: 1, recovery: [] },
} as unknown as ResourceView);
const counter = { id: 'ki', templateId: 'ki', characterId: 'a', name: '기', unit: '점', kind: 'counter', remaining: 2, capacity: 3, overrides: { scope: 'character' }, template: { id: 'ki', key: 'ki', name: '기', unit: '점', kind: 'counter', source: 'user', version: 1, capacity: { type: 'fixed', value: 3 }, recovery: [] } } as unknown as ResourceView;
const snapshot = (resources: ResourceView[]): ResourceSnapshot => ({ characterId: 'a', revision: 3, templates: [], resources, bindings: [], events: [], warnings: [] } as unknown as ResourceSnapshot);
const controller = (resources: ResourceView[]): ResourceController => ({ snapshot: snapshot(resources), busy: false, error: '', perform: vi.fn(), refresh: vi.fn() } as unknown as ResourceController);

describe('v1.1 Phase 4 slot colour rules', () => {
  it('keeps every palette colour readable on parchment and falls back level → kind → sapphire', () => {
    for (const swatch of SLOT_PALETTE) expect(contrastRatio(swatch.hex, PARCHMENT)).toBeGreaterThanOrEqual(3);
    expect(SLOT_PALETTE[0].hex).toBe(DEFAULT_SLOT_COLOR);
    const set = { pact: { base: '#a3283a', levels: { '5': '#2f7d4f' } } } as const;
    expect([slotColor(set, 'pact', 5), slotColor(set, 'pact', 3), slotColor(set, 'standard', 1), slotColor(undefined, 'pact')]).toEqual(['#2f7d4f', '#a3283a', DEFAULT_SLOT_COLOR, DEFAULT_SLOT_COLOR]);
    expect(lowContrast('#e0d8c0')).toBe(true); expect(lowContrast('#a3283a')).toBe(false);
    expect(tidySlotColors({ standard: { levels: {} }, pact: {} })).toBeUndefined();
    expect(tidySlotColors({ standard: { base: '#a3283a', levels: {} } })).toEqual({ standard: { base: '#a3283a' } });
  });
});

describe('v1.1 Phase 4 slot colour editor', () => {
  it('offers only the slot kinds the character has, saves picks per kind and level, and restores defaults', () => {
    const onChange = vi.fn();
    const view = render(<SlotColorEditor snapshot={snapshot([slots('std', 'standard', { 1: 4, 2: 3, 3: 2 }), counter])} characterName="미라" busy={false} onChange={onChange}/>);
    const region = screen.getByRole('region', { name: '주문 슬롯 색상' });
    expect(within(region).getByRole('heading').textContent).toBe('주문 슬롯 색상 · 미라');
    expect(within(region).queryByRole('radiogroup', { name: '계약 마법 슬롯 색상' })).toBeNull();
    const group = within(region).getByRole('radiogroup', { name: '일반 주문 슬롯 색상' });
    expect(within(group).getByRole('radio', { name: '일반 주문 슬롯 · 사파이어' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: '일반 주문 슬롯 · 루비' }));
    expect(onChange).toHaveBeenLastCalledWith({ standard: { base: '#a3283a' } });
    view.rerender(<SlotColorEditor snapshot={snapshot([slots('std', 'standard', { 1: 4, 2: 3, 3: 2 })])} busy={false} value={{ standard: { base: '#a3283a' } }} onChange={onChange}/>);
    fireEvent.click(screen.getByRole('checkbox', { name: '일반 주문 슬롯 레벨별로 지정' }));
    expect(screen.getAllByRole('radiogroup').map(g => g.getAttribute('aria-label'))).toEqual(['일반 주문 슬롯 색상', '일반 주문 슬롯 1레벨 색상', '일반 주문 슬롯 2레벨 색상', '일반 주문 슬롯 3레벨 색상']);
    expect(screen.getByRole('radio', { name: '일반 주문 슬롯 2레벨 · 루비' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '일반 주문 슬롯 2레벨 · 에메랄드' }));
    expect(onChange).toHaveBeenLastCalledWith({ standard: { base: '#a3283a', levels: { 2: '#2f7d4f' } } });
    fireEvent.click(screen.getByRole('button', { name: '기본 색상으로 복원' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('commits a custom colour when the picker closes and warns, with a rim, when it is hard to read', () => {
    const onChange = vi.fn();
    const view = render(<SlotColorEditor snapshot={snapshot([slots('pact', 'pact', { 5: 3 })])} busy={false} onChange={onChange}/>);
    const picker = screen.getByLabelText<HTMLInputElement>('계약 마법 슬롯 직접 색상');
    picker.value = '#e0d8c0'; fireEvent.input(picker);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(picker);
    expect(onChange).toHaveBeenLastCalledWith({ pact: { base: '#e0d8c0' } });
    view.rerender(<SlotColorEditor snapshot={snapshot([slots('pact', 'pact', { 5: 3 })])} busy={false} value={{ pact: { base: '#e0d8c0' } }} onChange={onChange}/>);
    expect(screen.getByRole('note').textContent).toContain('대비가 낮습니다');
    expect(view.container.querySelector('.slot-color-preview .resource-gems')!.classList.contains('low-contrast')).toBe(true);
    expect(screen.getAllByRole('radio').every(radio => radio.getAttribute('aria-checked') === 'false')).toBe(true);
  });

  it('locks every control while a save is in flight', () => {
    render(<SlotColorEditor snapshot={snapshot([slots('pact', 'pact', { 5: 3 })])} busy value={{ pact: { base: '#a3283a' } }} onChange={vi.fn()}/>);
    for (const control of [...screen.getAllByRole('radio'), screen.getByRole('checkbox'), screen.getByRole('button', { name: '기본 색상으로 복원' }), screen.getByLabelText('계약 마법 슬롯 직접 색상')]) expect((control as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('v1.1 Phase 4 ledger gems', () => {
  it('paints only spell slot gems with the chosen colours (per level), keeps counts and counters as they were', () => {
    const view = render(<ResourcePanel controller={controller([slots('std', 'standard', { 1: 4, 2: 3 }), slots('pact', 'pact', { 5: 2 }), counter])} slotColors={{ standard: { levels: { 2: '#7547a3' } }, pact: { base: '#a3283a' } }}/>);
    const gems = [...view.container.querySelectorAll<HTMLElement>('.resource-gems')].map(el => ({ kind: el.classList.contains('amber') ? 'amber' : 'sapphire', color: el.dataset.slotColor ?? null, css: el.style.getPropertyValue('--slot-gem') || null, filled: el.querySelectorAll('.gem.filled').length, all: el.querySelectorAll('.gem').length }));
    expect(gems).toEqual([
      { kind: 'sapphire', color: DEFAULT_SLOT_COLOR, css: DEFAULT_SLOT_COLOR, filled: 3, all: 4 },
      { kind: 'sapphire', color: '#7547a3', css: '#7547a3', filled: 2, all: 3 },
      { kind: 'sapphire', color: '#a3283a', css: '#a3283a', filled: 1, all: 2 },
      { kind: 'amber', color: null, css: null, filled: 2, all: 3 },
    ]);
    expect(screen.getByLabelText('주문 슬롯 2레벨 현재량').textContent).toBe('2 / 3');
    expect((view.container.querySelector('[data-group=pact]') as HTMLElement).style.getPropertyValue('--slot-gem')).toBe('#a3283a');
  });
});
