// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { CardEditor } from '../src/components/CardEditor';
import type { ResourceController } from '../src/components/ResourcePanel';
import { DEFAULT_SETTINGS, DEFAULT_LIBRARY_STATE, type Bootstrap, type DesktopBridge, type LibraryState } from '../src/shared/contracts';
import type { ResourceSnapshot, ResourceView } from '../src/shared/resources';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';

const ok = <T,>(value: T) => ({ ok: true as const, value });
const emptySnapshot = (characterId: string): ResourceSnapshot => ({ characterId, revision: 3, resources: [], templates: [], bindings: [], events: [], warnings: [] });
const counter = (id: string, name: string, unit = '회', scope: 'character' | 'card' = 'character'): ResourceView => ({
  id, characterId: 'a', templateId: `t-${id}`, name, unit, kind: 'counter', capacity: 3, remaining: 2, overrides: { scope, ownerCardId: scope === 'card' ? 'sample-heal' : undefined },
  template: { id: `t-${id}`, key: `user_${id}`, name, unit, kind: 'counter', capacity: { type: 'fixed', value: 3 }, recovery: [], source: 'user', version: 1 },
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

describe('v1.2 Phase 1 · scope follows the top selectors (전체 카드/활성 덱 buttons removed)', () => {
  const library = (state: Partial<LibraryState> = {}): Bootstrap => ({
    settings: DEFAULT_SETTINGS, cards: SAMPLE_CARDS, appVersion: '1.2.0', schemaVersion: 6, tags: [], warnings: [],
    libraryState: { ...DEFAULT_LIBRARY_STATE, activeCharacterId: 'a', viewScope: 'deck', ...state },
    profiles: [{ id: 'a', name: '아린', activeDeckId: 'deck-a', level: 3, ruleset: 'dnd5e_2014' }, { id: 'b', name: '보른', activeDeckId: 'deck-b', level: 2, ruleset: 'dnd5e_2014' }],
    decks: [{ id: 'deck-a', characterId: 'a', name: '기본 덱', cardIds: ['sample-heal', 'sample-attack'] }, { id: 'deck-b', characterId: 'b', name: '기본 덱', cardIds: [] }],
  });
  function mount(boot: Bootstrap) {
    window.desktop = {
      getBootstrap: vi.fn().mockResolvedValue(ok(structuredClone(boot))),
      getResources: vi.fn().mockImplementation(async (id: string) => ok(emptySnapshot(id))),
      saveLibraryState: vi.fn().mockImplementation(async (state: LibraryState) => ok(state)),
      saveSettings: vi.fn().mockImplementation(async settings => ok(settings)),
      setDeckCards: vi.fn().mockImplementation(async ({ deckId, cardIds }: { deckId: string; cardIds: string[] }) => ok({ ...structuredClone(boot), decks: boot.decks.map(deck => deck.id === deckId ? { ...deck, cardIds } : deck) })),
      previewResource: vi.fn().mockResolvedValue(ok({ changes: [], label: '사용 불가', canUse: false, canOverride: false, reason: '비용 미설정', revision: 3, quote: 'q' })),
      getUseHistory: vi.fn(), changeResource: vi.fn(), getTrash: vi.fn(),
    } as unknown as DesktopBridge;
    return render(<App/>);
  }
  const count = () => screen.getByLabelText('표시 카드 수').textContent;

  it('shows only the character deck, has no scope buttons, and 전체 라이브러리 ↔ character switches the scope', async () => {
    mount(library());
    await screen.findByRole('button', { name: '상처 치료 카드 선택' });
    expect(screen.queryByRole('group', { name: '카드 범위' })).toBeNull();
    expect(screen.queryByRole('button', { name: '전체 카드' })).toBeNull();
    expect(screen.queryByRole('button', { name: '활성 덱' })).toBeNull();
    expect(count()).toBe('2 / 4장');
    expect(document.querySelector('.deck-label strong')!.textContent).toBe('기본 덱');
    fireEvent.change(screen.getByLabelText('활성 캐릭터'), { target: { value: '' } });
    expect(window.desktop.saveLibraryState).toHaveBeenLastCalledWith(expect.objectContaining({ activeCharacterId: undefined, viewScope: 'library' }));
    await waitFor(() => expect(count()).toBe('4 / 4장'));
    expect(document.querySelector('.deck-label strong')!.textContent).toBe('전체 라이브러리');
    fireEvent.change(screen.getByLabelText('활성 캐릭터'), { target: { value: 'a' } });
    expect(window.desktop.saveLibraryState).toHaveBeenLastCalledWith(expect.objectContaining({ activeCharacterId: 'a', viewScope: 'deck' }));
    await waitFor(() => expect(count()).toBe('2 / 4장'));
    expect(window.desktop.setDeckCards).not.toHaveBeenCalled();
  });

  it('reads an older saved “character + whole library” state as the deck view without rewriting it', async () => {
    mount(library({ viewScope: 'library' }));
    await screen.findByRole('button', { name: '상처 치료 카드 선택' });
    expect(count()).toBe('2 / 4장');
    expect(screen.queryByRole('button', { name: '빛 카드 선택' })).toBeNull();
    expect(window.desktop.saveLibraryState).not.toHaveBeenCalled();
  });

  it('builds decks from the whole library: the selected card can be put into or taken out of any character deck', async () => {
    mount(library({ activeCharacterId: undefined, viewScope: 'library' }));
    fireEvent.click(await screen.findByRole('button', { name: '빛 카드 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '관리' }));
    const menu = screen.getByRole('dialog', { name: '관리 메뉴' });
    const membership = within(menu).getByRole('group', { name: '덱에 넣기·빼기' });
    expect(within(menu).queryByRole('button', { name: '활성 덱에 추가' })).toBeNull();
    fireEvent.click(within(membership).getByRole('button', { name: '아린 · 기본 덱에 넣기' }));
    await waitFor(() => expect(window.desktop.setDeckCards).toHaveBeenCalledWith({ deckId: 'deck-a', cardIds: ['sample-heal', 'sample-attack', 'sample-utility'] }));
    expect(await within(membership).findByRole('button', { name: '아린 · 기본 덱에서 빼기' })).toBeDefined();
    expect(within(membership).getByRole('button', { name: '보른 · 기본 덱에 넣기' })).toBeDefined();
    fireEvent.click(within(membership).getByRole('button', { name: '아린 · 기본 덱에서 빼기' }));
    await waitFor(() => expect(window.desktop.setDeckCards).toHaveBeenLastCalledWith({ deckId: 'deck-a', cardIds: ['sample-heal', 'sample-attack'] }));
  });

  it('keeps the active-deck removal for a selected character and explains how to fill an empty deck', async () => {
    mount(library());
    fireEvent.click(await screen.findByRole('button', { name: '상처 치료 카드 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '관리' }));
    const menu = screen.getByRole('dialog', { name: '관리 메뉴' });
    expect(within(menu).getByRole('button', { name: '활성 덱에서 빼기' })).toBeDefined();
    expect(within(menu).queryByRole('group', { name: '덱에 넣기·빼기' })).toBeNull();
    cleanup();
    mount(library({ activeCharacterId: 'b' }));
    expect(await screen.findByText('이 덱에 아직 카드가 없어요')).toBeDefined();
    expect(screen.getByText(/관리 → 덱에 넣기/)).toBeDefined();
  });
});

describe('v1.2 Phase 1 · create a resource while registering a card', () => {
  let save: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    save = vi.fn().mockResolvedValue(ok({ cards: [], tags: [], profiles: [], decks: [], libraryState: DEFAULT_LIBRARY_STATE, warnings: [] }));
    window.desktop = { saveCards: save, importImages: vi.fn(), saveTag: vi.fn() } as unknown as DesktopBridge;
  });
  const controller = (resources: ResourceView[] = []): ResourceController => ({ snapshot: { ...emptySnapshot('a'), resources }, busy: false, error: '', perform: vi.fn(), refresh: vi.fn() } as unknown as ResourceController);
  function open(resources: ResourceView[] = [], character: string | null = 'a') {
    const characterId = character ?? undefined;
    const onClose = vi.fn();
    render(<CardEditor tags={[]} onLibrary={vi.fn()} onClose={onClose} registrationTarget={characterId ? { characterId, deckId: 'deck-a' } : null} targetLabel="아린 · 기본 덱" controller={characterId ? controller(resources) : undefined} characterId={characterId} characterName={characterId ? '아린' : undefined}/>);
    const dialog = screen.getByRole('dialog', { name: '카드 등록' });
    fireEvent.change(within(dialog).getByLabelText('카드 이름'), { target: { value: '천둥 지팡이' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: '사용 횟수' }));
    return { dialog, onClose };
  }
  function fillResource(name: string) {
    const form = screen.getByRole('dialog', { name: '새 자원 만들기' });
    fireEvent.change(within(form).getByLabelText('자원 이름'), { target: { value: name } });
    fireEvent.change(within(form).getByLabelText('최대치'), { target: { value: '7' } });
    fireEvent.change(within(form).getByLabelText('새벽 경과 회복 방식'), { target: { value: 'fixed' } });
    fireEvent.change(within(form).getByLabelText('새벽 경과 회복량'), { target: { value: '3' } });
    return form;
  }

  it('drafts the resource, keeps the card inputs, auto-selects it, and sends it with the card in one save', async () => {
    const { dialog } = open([counter('ki', '기 점수', '점')]);
    fireEvent.click(within(dialog).getByRole('button', { name: '+ 새 자원 만들기' }));
    const form = fillResource('지팡이 충전');
    expect(within(form).getByLabelText('새 자원 적용 범위').textContent).toContain('아린에 장착되는 캐릭터 공유 자원');
    fireEvent.click(within(form).getByRole('button', { name: '자원 만들고 선택' }));
    expect(screen.queryByRole('dialog', { name: '새 자원 만들기' })).toBeNull();
    expect((within(dialog).getByLabelText('카드 이름') as HTMLInputElement).value).toBe('천둥 지팡이');
    const select = within(dialog).getByLabelText('등록 사용할 자원') as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe('새 자원 · 지팡이 충전 · 최대 7회 (카드 저장 시 생성)');
    expect(within(dialog).getByLabelText('새 자원 초안').textContent).toContain('카드를 저장할 때 함께 만들어집니다');
    expect(within(dialog).getByLabelText('등록 규칙 요약').textContent).toContain('지팡이 충전 1회');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '카드 저장' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const input = save.mock.calls[0][0];
    const draft = input.initialRules.newResources[0];
    expect(input.registrationTarget).toEqual({ characterId: 'a', deckId: 'deck-a' });
    expect(input.initialRules.bindings).toEqual([{ costKey: expect.any(String), resourceInstanceId: draft.draftId }]);
    expect(draft.template).toEqual({ name: '지팡이 충전', unit: '회', kind: 'counter', capacity: { type: 'fixed', value: 7 }, recovery: [{ triggers: ['dawn'], amount: { type: 'fixed', value: 3 } }] });
  });

  it('also opens from the resource picker option, and switching to points changes the unit and rule kind', () => {
    const { dialog } = open();
    expect(within(dialog).getByText(/‘\+ 새 자원 만들기’로 바로 만들 수 있습니다/)).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText('등록 사용할 자원'), { target: { value: '__new_resource__' } });
    const form = fillResource('영혼 점수');
    fireEvent.change(within(form).getByLabelText('새 자원 종류'), { target: { value: 'points' } });
    expect((within(form).getByLabelText('새 자원 단위') as HTMLSelectElement).value).toBe('점');
    fireEvent.click(within(form).getByRole('button', { name: '자원 만들고 선택' }));
    expect((within(dialog).getByRole('radio', { name: '포인트 자원' }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText('등록 사용할 자원') as HTMLSelectElement).selectedOptions[0].textContent).toContain('영혼 점수 · 최대 7점');
  });

  it('blocks a duplicate name (case/space-insensitive) and offers the existing resource instead', () => {
    const { dialog } = open([counter('ki', 'Ki Points', '점')]);
    fireEvent.click(within(dialog).getByRole('button', { name: '+ 새 자원 만들기' }));
    const form = fillResource('  ki points ');
    expect(within(form).getByRole('alert').textContent).toContain('이미 ‘Ki Points’ 자원이 있습니다');
    expect((within(form).getByRole('button', { name: '자원 만들고 선택' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(form.querySelector('form')!);
    expect(within(dialog).queryByLabelText('새 자원 초안')).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: '기존 ‘Ki Points’ 선택' }));
    expect((within(dialog).getByLabelText('등록 사용할 자원') as HTMLSelectElement).value).toBe('ki');
    expect(within(dialog).queryByLabelText('새 자원 초안')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('never saves the card from inside the resource form, and cancelling either form leaves nothing', () => {
    const { dialog, onClose } = open();
    fireEvent.click(within(dialog).getByRole('button', { name: '+ 새 자원 만들기' }));
    const form = fillResource('지팡이 충전');
    fireEvent.click(within(form).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog', { name: '새 자원 만들기' })).toBeNull();
    expect((within(dialog).getByLabelText('등록 사용할 자원') as HTMLSelectElement).value).toBe('');
    expect(within(dialog).queryByLabelText('새 자원 초안')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '+ 새 자원 만들기' }));
    fireEvent.submit(fillResource('지팡이 충전').querySelector('form')!);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(onClose).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('can edit or drop the draft, and an unbound draft is not sent', async () => {
    const { dialog } = open();
    fireEvent.click(within(dialog).getByRole('button', { name: '+ 새 자원 만들기' }));
    fireEvent.click(within(fillResource('지팡이 충전')).getByRole('button', { name: '자원 만들고 선택' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '새 자원 고치기' }));
    const form = screen.getByRole('dialog', { name: '새 자원 만들기' });
    expect((within(form).getByLabelText('자원 이름') as HTMLInputElement).value).toBe('지팡이 충전');
    fireEvent.change(within(form).getByLabelText('최대치'), { target: { value: '9' } });
    fireEvent.click(within(form).getByRole('button', { name: '변경 적용' }));
    expect((within(dialog).getByLabelText('등록 사용할 자원') as HTMLSelectElement).selectedOptions[0].textContent).toContain('최대 9회');
    fireEvent.click(within(dialog).getByRole('radio', { name: '무소모' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '카드 저장' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].initialRules.newResources).toBeUndefined();
    fireEvent.click(within(dialog).getByRole('radio', { name: '사용 횟수' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '새 자원 취소' }));
    expect((within(dialog).getByLabelText('등록 사용할 자원') as HTMLSelectElement).value).toBe('');
    expect(within(dialog).queryByRole('option', { name: /새 자원 · 지팡이 충전/ })).toBeNull();
  });

  it('needs a character: without one the button is disabled and explains why', () => {
    const { dialog } = open([], null);
    expect((within(dialog).getByRole('button', { name: '+ 새 자원 만들기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(/캐릭터를 선택하면 등록 중에 새 자원을 만들 수 있습니다/)).toBeDefined();
    expect(within(dialog).queryByRole('option', { name: '+ 새 자원 만들기…' })).toBeNull();
  });

  it('lists card-owned counters as not selectable for a new card and keeps them out of the picker', () => {
    const { dialog } = open([counter('own', '전용 충전', '회', 'card'), counter('ki', '기 점수', '점')]);
    const options = [...(within(dialog).getByLabelText('등록 사용할 자원') as HTMLSelectElement).options].map(option => option.textContent);
    expect(options).toEqual(['자원 이름을 선택하세요', '기 점수 · 2/3 점', '+ 새 자원 만들기…']);
  });
});
