// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { DEFAULT_LIBRARY_STATE, DEFAULT_SETTINGS, type Bootstrap, type DesktopBridge } from '../src/shared/contracts';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';
import { CardBackDialog } from '../src/components/Appearance';
import { DEFAULT_APPEARANCE } from '../src/shared/contracts';

const bootstrap: Bootstrap = {
  settings: DEFAULT_SETTINGS, cards: SAMPLE_CARDS, appVersion: '0.5.2', schemaVersion: 6,
  libraryState: { ...DEFAULT_LIBRARY_STATE, activeCharacterId: 'hero' }, tags: [],
  profiles: [{ id: 'hero', name: '엘라라', activeDeckId: 'deck-a' }], decks: [{ id: 'deck-a', characterId: 'hero', name: '주문서 덱', cardIds: SAMPLE_CARDS.map(card => card.id) }], warnings: [],
};
function desktop(): DesktopBridge {
  return {
    getTrash: vi.fn(), previewTrash: vi.fn(), changeTrash: vi.fn(), retryImageCleanup: vi.fn(), getUseHistory: vi.fn(),
    previewEdit: vi.fn(), applyEdit: vi.fn(), getEditHistory: vi.fn(),
    getBootstrap: vi.fn().mockResolvedValue({ ok: true, value: structuredClone(bootstrap) }),
    saveSettings: vi.fn().mockImplementation(async settings => ({ ok: true, value: settings })),
    saveLibraryState: vi.fn().mockImplementation(async state => ({ ok: true, value: state })),
    importImages: vi.fn().mockResolvedValue({ ok: true, value: { assets: [{ id: 'img-9', name: 'party.png', url: 'app://assets/img-9', thumbnailUrl: 'app://assets/img-9/thumbnail', width: 600, height: 875 }], errors: [] } }),
    saveCards: vi.fn(), archiveCard: vi.fn(), saveTag: vi.fn(), deleteTag: vi.fn(), createProfile: vi.fn(), createDeck: vi.fn(), selectDeck: vi.fn(), setDeckCards: vi.fn(),
    previewClass: vi.fn(), previewResource: vi.fn(), changeResource: vi.fn(),
    getResources: vi.fn().mockResolvedValue({ ok: true, value: { characterId: 'hero', revision: 1, resources: [], templates: [], bindings: [], events: [], warnings: [] } }),
  } as unknown as DesktopBridge;
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.desktop = desktop();
});
afterEach(cleanup);

describe('play-mat appearance', () => {
  it('switches theme from the header menu, keeps the layout and saves only appearance', async () => {
    const view = render(<App/>);
    await screen.findByRole('button', { name: '테마' });
    const root = view.container.querySelector('.app')!;
    expect(root.getAttribute('data-theme')).toBe('oxblood');
    const zonesBefore = [...view.container.querySelectorAll('.resource-panel, .board, .detail-panel, .hand-row')].length;
    // jsdom does not run the native popover toggle; the real window is checked in the Electron screenshots.
    expect(screen.getByRole('button', { name: '테마' }).getAttribute('popovertarget')).toBe('theme-menu');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /흑단과 은/, hidden: true }));
    await waitFor(() => expect(root.getAttribute('data-theme')).toBe('ebony'));
    expect(window.desktop.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ appearance: { ...DEFAULT_APPEARANCE, theme: 'ebony' } }));
    expect([...view.container.querySelectorAll('.resource-panel, .board, .detail-panel, .hand-row')].length).toBe(zonesBefore);
    expect(screen.getByRole('menuitemradio', { name: /흑단과 은/, hidden: true }).getAttribute('aria-checked')).toBe('true');
  });
  it('opens the card-back chooser from the deck pile and applies a back to this deck only', async () => {
    render(<App/>);
    fireEvent.click(await screen.findByRole('button', { name: /카드 뒷면 바꾸기 · 주문서 덱/ }));
    const dialog = await screen.findByRole('dialog', { name: '카드 뒷면 · 슬리브' });
    expect(dialog).toBeDefined();
    fireEvent.click(screen.getByRole('radio', { name: '별자리' }));
    fireEvent.click(screen.getByRole('button', { name: '적용' }));
    await waitFor(() => expect(window.desktop.saveSettings).toHaveBeenCalled());
    const saved = vi.mocked(window.desktop.saveSettings).mock.calls.at(-1)![0];
    expect(saved.appearance?.cardBack).toEqual({ default: { type: 'builtin', id: 'dragon' }, decks: { 'deck-a': { type: 'builtin', id: 'stars' } } });
    expect(window.desktop.changeResource).not.toHaveBeenCalled();
  });
  it('imports a user image through the existing image import and selects it', async () => {
    const save = vi.fn();
    render(<CardBackDialog appearance={DEFAULT_APPEARANCE} deck={{ id: 'deck-a', name: '주문서 덱' }} onSave={save} onClose={vi.fn()}/>);
    const file = new File(['png'], 'party.png', { type: 'image/png' });
    fireEvent.change(screen.getByText('이미지 선택…').closest('label')!.querySelector('input')!, { target: { files: [file] } });
    await screen.findByRole('radio', { name: 'party' });
    expect(window.desktop.importImages).toHaveBeenCalledWith([file]);
    fireEvent.click(screen.getByRole('radio', { name: '모든 덱의 기본값' }));
    fireEvent.click(screen.getByRole('button', { name: '적용' }));
    expect(save).toHaveBeenCalledWith({ theme: 'oxblood', customBacks: [{ assetId: 'img-9', name: 'party' }], cardBack: { default: { type: 'custom', assetId: 'img-9' }, decks: {} } });
  });
});
