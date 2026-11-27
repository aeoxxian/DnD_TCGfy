// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardFace, kindLine } from '../src/components/CardFace';
import { CardGallery } from '../src/components/CardGallery';
import { CardEditor } from '../src/components/CardEditor';
import { ImageLightbox } from '../src/components/ImageLightbox';
import type { AssetPreview, CardDefinition, DesktopBridge, Library } from '../src/shared/contracts';

const ok = <T,>(value: T) => ({ ok: true as const, value });
const card = (patch: Partial<CardDefinition> = {}): CardDefinition => ({
  id: 'c1', name: '마법 화살', kind: 'spell', spellLevel: 1, roles: ['damage'], actions: ['action', 'bonus_action'], range: { kind: 'ranged', feet: 120 },
  tags: [], castOptions: [{ id: 'o', label: '일반 사용', costs: [] }], createdAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z', ...patch,
});
const asset = (id: string, name: string): AssetPreview => ({ id, name, url: `app://assets/${id}`, thumbnailUrl: `app://assets/${id}/thumbnail`, width: 300, height: 437 });
const library: Library = { cards: [], tags: [], profiles: [], decks: [] } as unknown as Library;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('v1.3 Phase 1 · default face of a card without an image', () => {
  it('shows the name, kind line, actions and a kind emblem, and never says that an image is missing', () => {
    const { container } = render(<CardFace card={card()}/>);
    const face = screen.getByRole('img', { name: '마법 화살 기본 카드 · 주문 · 1레벨' });
    expect(within(face).getByText('마법 화살')).toBeDefined();
    expect(within(face).getByText('주문 · 1레벨')).toBeDefined();
    expect(within(face).getByText('행동 · 보너스 행동')).toBeDefined();
    expect(face.querySelector('.dc-emblem svg')).not.toBeNull();
    expect(container.textContent).not.toMatch(/이미지/);
    expect(container.querySelector('.card-face')!.className).toContain('default-face');
  });

  it('draws a different emblem for each of the six existing kinds and names cantrips', () => {
    const kinds = ['spell', 'attack', 'feature', 'feat', 'item', 'other'] as const;
    const icons = kinds.map(kind => { const { container, unmount } = render(<CardFace card={card({ kind, spellLevel: kind === 'spell' ? 1 : undefined })}/>); const html = container.querySelector('.dc-emblem svg')!.innerHTML; unmount(); return html; });
    expect(new Set(icons).size).toBe(6);
    expect(kindLine({ kind: 'spell', spellLevel: 0 })).toBe('주문 · 소마법');
    expect(kindLine({ kind: 'item' })).toBe('아이템');
  });

  it('an image that cannot be read falls back to the same face with a visible error, keeping the card data', () => {
    render(<CardFace card={card({ imageAssetId: 'missing' })}/>);
    fireEvent.error(screen.getByRole('img', { name: '마법 화살 카드 이미지' }));
    expect(screen.getByRole('img', { name: '마법 화살 기본 카드 · 주문 · 1레벨 · 이미지 파일을 읽을 수 없음' })).toBeDefined();
    expect(screen.getByText('이미지 파일을 읽을 수 없습니다.')).toBeDefined();
  });

  it('replaces the alpha mask and clears the failure when the image source changes', async () => {
    window.desktop = { assetAlpha: vi.fn().mockImplementation(async (ids: string[]) =>
      ok(Object.fromEntries(ids.map(id => [id, id === 'mask-alpha'])))) } as unknown as DesktopBridge;
    const face = (imageAssetId: string) => <CardFace card={card({ imageAssetId })} overlay={<img className="card-unusable-back" src="back.png" alt=""/>}/>;
    const { container, rerender } = render(face('mask-alpha'));
    const front = () => screen.getByRole('img', { name: '마법 화살 카드 이미지' });
    await waitFor(() => expect(container.querySelector('.card-alpha-mask image')?.getAttribute('href')).toContain('mask-alpha'));
    fireEvent.error(front());
    expect(screen.getByText('이미지 파일을 읽을 수 없습니다.')).toBeDefined();
    expect(container.querySelector('.card-alpha-mask')).toBeNull();
    rerender(face('mask-opaque'));
    expect(front().getAttribute('src')).toContain('mask-opaque');
    await waitFor(() => expect(container.querySelector<HTMLImageElement>('.card-unusable-back')?.style.visibility).toBe(''));
    expect(container.querySelector('.card-alpha-mask')).toBeNull();
    rerender(face('mask-alpha'));
    expect(front().getAttribute('src')).toContain('mask-alpha');
    expect(container.querySelector('.card-alpha-mask')).not.toBeNull();
  });

  it('a selected card without an image opens the enlargement when clicked again, which draws the default face large', () => {
    const onPreview = vi.fn(); const onSelect = vi.fn();
    render(<CardGallery cards={[card()]} mode="hand" selectedId="c1" selectedIds={[]} selectionMode={false} notes={new Map()} onSelect={onSelect} onCheck={vi.fn()} onPreview={onPreview}/>);
    fireEvent.click(screen.getByRole('button', { name: '마법 화살 카드 선택' }));
    expect(onPreview).toHaveBeenCalledWith('c1', expect.any(HTMLButtonElement)); expect(onSelect).not.toHaveBeenCalled();
    cleanup();
    render(<ImageLightbox card={card()} onClose={vi.fn()}/>);
    const dialog = screen.getByRole('dialog', { name: '마법 화살 원본 보기' });
    expect(within(dialog).getByRole('img', { name: '마법 화살 기본 카드 확대 · 주문 · 1레벨' })).toBeDefined();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });
});

describe('v1.3 Phase 1 · single-card registration form', () => {
  function bridge(importImages = vi.fn()) {
    const desktop = {
      importImages, discardImports: vi.fn().mockResolvedValue(ok({ discarded: 1 })),
      saveCards: vi.fn().mockResolvedValue(ok(library)), saveTag: vi.fn(),
    };
    window.desktop = desktop as unknown as DesktopBridge;
    return desktop;
  }
  const target = { characterId: 'a', deckId: 'deck-a' };
  const mount = (props: Partial<Parameters<typeof CardEditor>[0]> = {}) => {
    const onClose = vi.fn();
    render(<CardEditor tags={[]} onLibrary={vi.fn()} onClose={onClose} registrationTarget={target} targetLabel="아린 · 기본 덱" {...props}/>);
    return { onClose, form: screen.getByRole('dialog', { name: props.card ? '카드 정보 수정' : '카드 등록' }) };
  };
  const pick = (files = [new File(['x'], 'a.png', { type: 'image/png' })]) => fireEvent.change(screen.getByLabelText('카드 이미지 파일'), { target: { files } });

  it('previews the default card live and saves a card without an image into the active deck', async () => {
    const desktop = bridge(); mount();
    expect(screen.getByRole('img', { name: '카드 이름 기본 카드 미리보기' })).toBeDefined();
    fireEvent.change(screen.getByLabelText('카드 이름'), { target: { value: '치유 물약' } });
    fireEvent.change(screen.getByLabelText('카드 유형'), { target: { value: 'item' } });
    const preview = screen.getByRole('img', { name: '치유 물약 기본 카드 미리보기' });
    expect(within(preview).getByText('아이템')).toBeDefined();
    expect(screen.getByText(/이미지 없이 등록하면 기본 카드 디자인으로 표시됩니다/)).toBeDefined();
    expect((screen.getByRole('checkbox', { name: '등록하면 ‘아린 · 기본 덱’에 넣기' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '카드 저장' }));
    await waitFor(() => expect(desktop.saveCards).toHaveBeenCalled());
    const input = desktop.saveCards.mock.calls[0][0];
    expect(input.registrationTarget).toEqual(target); expect(input.addToDeck).toBeUndefined();
    expect(input.cards).toEqual([expect.objectContaining({ name: '치유 물약', kind: 'item' })]);
    expect(input.cards[0]).not.toHaveProperty('imageAssetId');
    expect(input.initialRules).toMatchObject({ configured: false });
  });

  it('can register into the library only, and says so when no deck is active', async () => {
    const desktop = bridge(); mount();
    fireEvent.change(screen.getByLabelText('카드 이름'), { target: { value: '라이브러리 카드' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '등록하면 ‘아린 · 기본 덱’에 넣기' }));
    fireEvent.click(screen.getByRole('button', { name: '카드 저장' }));
    await waitFor(() => expect(desktop.saveCards).toHaveBeenCalled());
    expect(desktop.saveCards.mock.calls[0][0]).toMatchObject({ registrationTarget: target, addToDeck: false });
    cleanup(); bridge(); mount({ registrationTarget: null, targetLabel: undefined });
    expect(screen.getByText(/활성 덱이 없어 라이브러리에만 등록합니다/)).toBeDefined();
    expect(screen.queryByRole('checkbox', { name: /에 넣기$/ })).toBeNull();
  });

  it('one image: a single name field that keeps a name typed while the image imports, then saves name and image', async () => {
    let finish!: (value: unknown) => void;
    const desktop = bridge(vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; })));
    mount(); pick();
    fireEvent.change(screen.getByLabelText('카드 이름'), { target: { value: '내 카드' } });
    finish(ok({ assets: [asset('img-1', 'file-name')], errors: [] }));
    expect(await screen.findByRole('img', { name: '내 카드 등록 미리보기' })).toBeDefined();
    expect((screen.getByLabelText('카드 이름') as HTMLInputElement).value).toBe('내 카드');
    expect(screen.queryByLabelText('카드 이름 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '카드 저장' }));
    await waitFor(() => expect(desktop.saveCards).toHaveBeenCalled());
    expect(desktop.saveCards.mock.calls[0][0].cards).toEqual([expect.objectContaining({ name: '내 카드', imageAssetId: 'img-1' })]);
    // After a save the dialog still hands its imports to the main process, which keeps the ones a card now uses.
    await waitFor(() => expect(desktop.discardImports).toHaveBeenCalledWith(['img-1']));
  });

  it('an untouched name takes the file name; removing the image or cancelling discards the imported files', async () => {
    const desktop = bridge(vi.fn().mockResolvedValue(ok({ assets: [asset('img-1', 'file-name')], errors: [] })));
    const { onClose } = mount(); pick();
    await screen.findByRole('img', { name: 'file-name 등록 미리보기' });
    expect((screen.getByLabelText('카드 이름') as HTMLInputElement).value).toBe('file-name');
    fireEvent.click(screen.getByRole('button', { name: '이미지 빼기' }));
    expect(desktop.discardImports).toHaveBeenCalledWith(['img-1']);
    expect(screen.getByRole('img', { name: 'file-name 기본 카드 미리보기' })).toBeDefined();
    desktop.importImages.mockResolvedValueOnce(ok({ assets: [asset('img-2', 'second')], errors: [] }));
    pick(); await screen.findByRole('img', { name: 'file-name 등록 미리보기' });
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(desktop.discardImports).toHaveBeenLastCalledWith(['img-2']);
    expect(onClose).toHaveBeenCalled(); expect(desktop.saveCards).not.toHaveBeenCalled();
  });

  it('two or more images switch to one name per image and back, keeping the typed name', async () => {
    const desktop = bridge(vi.fn().mockResolvedValueOnce(ok({ assets: [asset('img-1', 'one')], errors: [] })).mockResolvedValueOnce(ok({ assets: [asset('img-2', 'two')], errors: [] })));
    mount(); pick(); await screen.findByRole('img', { name: 'one 등록 미리보기' });
    fireEvent.change(screen.getByLabelText('카드 이름'), { target: { value: '첫 카드' } });
    pick(); await screen.findByLabelText('카드 이름 2');
    expect((screen.getByLabelText('카드 이름 1') as HTMLInputElement).value).toBe('첫 카드');
    expect(screen.getByRole('button', { name: '2장 등록' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'two 등록 목록에서 제외' }));
    expect(desktop.discardImports).toHaveBeenCalledWith(['img-2']);
    expect((screen.getByLabelText('카드 이름') as HTMLInputElement).value).toBe('첫 카드');
  });

  it('keeps the frequent fields first and the rare ones folded, and edits a card without an image in the same layout', () => {
    bridge(); const { form } = mount();
    const order = ['카드 기본 정보', '카드 태그 설정', '등록 카드 사용 규칙'].map(name => within(form).getByRole('region', { name }));
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const details = form.querySelector('details.editor-advanced') as HTMLDetailsElement;
    expect(details.open).toBe(false); expect(details.querySelector('summary')!.textContent).toBe('세부 설정 · 사거리 / 설명');
    expect(within(details).getByLabelText('사거리')).toBeDefined(); expect(within(details).getByLabelText('설명 (선택)')).toBeDefined();
    cleanup(); bridge();
    const { form: edit } = mount({ card: card({ name: '그림 없는 카드', kind: 'feat', spellLevel: undefined }) });
    expect(within(edit).getByRole('img', { name: '그림 없는 카드 기본 카드 미리보기' })).toBeDefined();
    expect(within(edit).getByText('이미지 선택')).toBeDefined();
    expect(within(edit).queryByRole('checkbox', { name: /에 넣기$/ })).toBeNull();
    expect(within(edit).getByRole('region', { name: '등록 카드 사용 규칙' })).toBeDefined();
  });
});
