// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardEditor } from '../src/components/CardEditor';
import type { AssetPreview, DesktopBridge, Library, RegistrationTemplate } from '../src/shared/contracts';

const ok = <T,>(value: T) => ({ ok: true as const, value });
const asset = (id: string, sha256 = id, duplicates?: AssetPreview['duplicates']): AssetPreview => ({ id, name: `file-${id}`, url: `app://assets/${id}`, thumbnailUrl: `app://assets/${id}/thumbnail`, width: 300, height: 437, sha256, duplicates });
const library = (ids: string[]): Library => ({ cards: ids.map(id => ({ id: `card-${id}`, imageAssetId: id })), tags: [], profiles: [], decks: [] } as unknown as Library);
const target = { characterId: 'a', deckId: 'deck-a' };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function bridge(save?: (input: { cards: { imageAssetId?: string; name: string }[] }) => unknown) {
  const saved: string[] = [];
  const desktop = {
    importImages: vi.fn(), saveTag: vi.fn(), discardImports: vi.fn().mockResolvedValue(ok({ discarded: 0 })),
    getResources: vi.fn().mockResolvedValue(ok({ characterId: 'a', revision: 4, resources: [], templates: [], bindings: [], events: [], warnings: [] })),
    saveCards: vi.fn().mockImplementation(async (input: { cards: { imageAssetId?: string; name: string }[] }) => {
      const custom = save?.(input); if (custom) return custom;
      saved.push(input.cards[0].imageAssetId!); return ok(library(saved));
    }),
  };
  window.desktop = desktop as unknown as DesktopBridge;
  return desktop;
}
function mount(assets: AssetPreview[], extra: Partial<Parameters<typeof CardEditor>[0]> = {}) {
  const onClose = vi.fn(); const onLibrary = vi.fn();
  render(<CardEditor tags={[]} onLibrary={onLibrary} onClose={onClose} registrationTarget={target} targetLabel="아린 · 기본 덱" characterId="a" characterName="아린" initialAssets={assets} {...extra}/>);
  return { onClose, onLibrary, dialog: screen.getByRole('dialog', { name: '카드 등록' }) };
}
const row = (n: number, name: string) => screen.getByRole('listitem', { name: `${n}번 카드 ${name}` });

describe('v1.3 Phase 2 · registering several images at once', () => {
  it('lists every image with its own name and settings, excludes a repeated image, and registers each card on its own', async () => {
    const desktop = bridge();
    const { onClose } = mount([asset('a', 'same'), asset('b', 'same'), asset('c', 'other', [{ name: '기존 카드', trashed: false }])]);
    expect((within(row(2, 'file-b')).getByRole('checkbox', { name: 'file-b 등록에 포함' }) as HTMLInputElement).checked).toBe(false);
    expect(within(row(2, 'file-b')).getByText(/이 목록의 ‘file-a’와 같은 이미지입니다/)).toBeDefined();
    expect(within(row(3, 'file-c')).getByText(/같은 이미지가 이미 ‘기존 카드’ 카드에 있습니다/)).toBeDefined();
    expect(within(row(1, 'file-a')).getAllByText('기본값')).toHaveLength(3);
    // Card 3: own kind, own cost and a description.
    fireEvent.click(within(row(3, 'file-c')).getByRole('button', { name: 'file-c 개별 설정' }));
    const editor = screen.getByRole('group', { name: 'file-c 개별 설정' });
    fireEvent.click(within(editor).getByRole('checkbox', { name: '이 카드의 속성을 따로 정하기' }));
    fireEvent.change(within(editor).getByLabelText('개별 카드 유형'), { target: { value: 'attack' } });
    fireEvent.change(within(editor).getByLabelText('개별 카드 설명'), { target: { value: '셋째만의 설명' } });
    fireEvent.change(within(editor).getByLabelText('개별 비용 방식'), { target: { value: 'own' } });
    fireEvent.click(within(editor).getByRole('radio', { name: '개별 무소모' }));
    fireEvent.change(within(row(1, 'file-a')).getByLabelText('카드 이름 1'), { target: { value: '첫 카드' } });
    expect(within(screen.getByRole('listitem', { name: '3번 카드 file-c' })).getAllByText('개별').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: '2장 등록' }));
    const check = screen.getByRole('region', { name: '등록 전 최종 확인' });
    expect(within(check).getByText('2장').tagName).toBe('STRONG');
    expect(within(check).getByText('비용: 나중에 설정 1장 · 무소모 1장')).toBeDefined();
    expect(within(check).getByText('개별 설정한 카드 1장')).toBeDefined();
    expect(within(check).getByText(/이미 있는 카드와 같은 이미지 1장/)).toBeDefined();
    expect(desktop.saveCards).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '등록 시작' }));
    await screen.findByText('2장 등록 완료');
    expect(desktop.saveCards).toHaveBeenCalledTimes(2);
    const [first, third] = desktop.saveCards.mock.calls.map(call => call[0]);
    expect(first).toMatchObject({ cards: [{ name: '첫 카드', imageAssetId: 'a', kind: 'other' }], registrationTarget: target, initialRules: { configured: false } });
    expect(third).toMatchObject({ cards: [{ name: 'file-c', imageAssetId: 'c', kind: 'attack', description: '셋째만의 설명' }], initialRules: { configured: true, expectedRevision: 4 } });
    expect(first.initialRules.requestId).not.toBe(third.initialRules.requestId);
    expect(screen.getByText('완료 2장 · 실패 0장 · 미처리 0장 · 제외 1장')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalled();
    expect(desktop.discardImports).toHaveBeenCalledWith(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('a failed card does not stop the others; retrying sends the same request again and finishes it', async () => {
    let failOnce = true;
    const desktop = bridge(input => input.cards[0].imageAssetId === 'b' && failOnce ? (failOnce = false, { ok: false, error: '저장 처리에 실패했습니다.' }) : undefined);
    mount([asset('a'), asset('b'), asset('c')]);
    fireEvent.click(screen.getByRole('button', { name: '3장 등록' }));
    fireEvent.click(screen.getByRole('button', { name: '등록 시작' }));
    await screen.findByText('완료 2장 · 실패 1장 · 미처리 0장 · 제외 0장');
    expect(within(row(2, 'file-b')).getByRole('alert').textContent).toBe('실패 · 저장 처리에 실패했습니다.');
    const failedRequest = desktop.saveCards.mock.calls[1][0].initialRules.requestId;
    fireEvent.click(screen.getByRole('button', { name: '실패·미처리 다시 등록' }));
    await screen.findByText('3장 등록 완료');
    expect(desktop.saveCards).toHaveBeenCalledTimes(4);
    expect(desktop.saveCards.mock.calls[3][0]).toMatchObject({ cards: [{ imageAssetId: 'b' }], initialRules: { requestId: failedRequest } });
  });

  it('stops after three failures in a row and leaves the rest unprocessed', async () => {
    const desktop = bridge(() => ({ ok: false, error: '디스크 오류' }));
    mount(['1', '2', '3', '4', '5'].map(id => asset(id)));
    fireEvent.click(screen.getByRole('button', { name: '5장 등록' }));
    fireEvent.click(screen.getByRole('button', { name: '등록 시작' }));
    await screen.findByText('완료 0장 · 실패 3장 · 미처리 2장 · 제외 0장');
    expect(desktop.saveCards).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/연속으로 3장이 실패해 나머지는 등록하지 않았습니다/)).toBeDefined();
    expect(within(row(5, 'file-5')).getByText('미처리')).toBeDefined();
  });

  it('a card that needs fixing blocks the final check and is opened for editing', () => {
    const desktop = bridge();
    mount([asset('a'), asset('b')]);
    fireEvent.change(within(row(2, 'file-b')).getByLabelText('카드 이름 2'), { target: { value: ' ' } });
    expect(within(screen.getByRole('listitem', { name: /^2번 카드/ })).getByText('확인 필요 · 카드 이름을 입력해 주세요.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '2장 등록' }));
    expect(screen.getByRole('alert').textContent).toContain('확인이 필요한 카드 1장');
    expect(screen.queryByRole('region', { name: '등록 전 최종 확인' })).toBeNull();
    expect(screen.getByRole('group', { name: /개별 설정$/ })).toBeDefined();
    expect(desktop.saveCards).not.toHaveBeenCalled();
  });

  it('saves the common settings as a template and applies a template to the common settings', async () => {
    bridge();
    const template: RegistrationTemplate = { id: 'tpl', name: '공격 주문', card: { kind: 'spell', spellLevel: 2, roles: ['damage'], actions: ['bonus_action'], range: { kind: 'ranged', feet: 60 }, tags: ['gone'] },
      rule: { kind: 'uses', scope: 'character', family: 'standard', homebrew: false, belowBase: false, resourceName: '없는 자원', amount: 1, variable: false, min: 1, max: 5, step: 1 }, addToDeck: false };
    const onTemplates = vi.fn().mockResolvedValue(true);
    mount([asset('a'), asset('b')], { templates: [template], onTemplates });
    fireEvent.change(screen.getByLabelText('등록 템플릿 선택'), { target: { value: 'tpl' } });
    fireEvent.click(screen.getByRole('button', { name: '템플릿 적용' }));
    expect((screen.getByLabelText('카드 유형') as HTMLSelectElement).value).toBe('spell');
    expect((screen.getByLabelText('주문 레벨 (선택)') as HTMLSelectElement).value).toBe('2');
    expect((screen.getByRole('checkbox', { name: '등록하면 ‘아린 · 기본 덱’에 넣기' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/템플릿의 자원 ‘없는 자원’을\(를\) 이 캐릭터에서 찾지 못했습니다/)).toBeDefined();
    expect(within(row(1, 'file-a')).getByText(/주문 · 2레벨/)).toBeDefined();
    fireEvent.change(screen.getByLabelText('새 템플릿 이름'), { target: { value: '두 번째' } });
    fireEvent.click(screen.getByRole('button', { name: '지금 설정을 템플릿으로 저장' }));
    await waitFor(() => expect(onTemplates).toHaveBeenCalled());
    const saved = onTemplates.mock.calls[0][0] as RegistrationTemplate[];
    expect(saved.map(item => item.name)).toEqual(['공격 주문', '두 번째']);
    expect(saved[1]).toMatchObject({ card: { kind: 'spell', spellLevel: 2, roles: ['damage'] }, rule: { kind: 'uses' }, addToDeck: false });
    expect(await screen.findByText('‘두 번째’ 템플릿을 저장했습니다.')).toBeDefined();
  });
});
