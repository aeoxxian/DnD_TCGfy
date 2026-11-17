// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { CardGallery } from '../src/components/CardGallery';
import { cardUsability } from '../src/components/CardResources';
import { ImageLightbox } from '../src/components/ImageLightbox';
import { DEFAULT_LIBRARY_STATE, DEFAULT_SETTINGS, type Bootstrap, type DesktopBridge, type Settings } from '../src/shared/contracts';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';
import { USABILITY_NOTES, isUnusable, type CardUsability } from '../src/shared/usability';

const [a, b, c, d] = SAMPLE_CARDS.map((card, i) => ({ ...card, imageAssetId: `asset-${i}` }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

describe('v1.1 Phase 3 unusable-card overlay', () => {
  it('keeps cost-not-set, short of resources and unlinked cost apart, and drops “열람 가능”', () => {
    expect(cardUsability({ ...a, costStatus: 'unconfigured' })).toBe('unconfigured');
    expect(cardUsability(a)).toBe('unknown');
    expect(Object.values(USABILITY_NOTES).join('')).not.toContain('열람 가능');
    expect((['usable', 'unknown', 'unconfigured', 'insufficient', 'unbound'] as CardUsability[]).filter(isUnusable)).toEqual(['unconfigured', 'insufficient', 'unbound']);
  });

  it('lays the deck card back over unusable cards only, without touching the original image or blocking selection', () => {
    const usability = new Map<string, CardUsability>([[a.id, 'usable'], [b.id, 'insufficient'], [c.id, 'unconfigured'], [d.id, 'unbound']]);
    const select = vi.fn();
    const view = render(<CardGallery cards={[a, b, c, d]} mode="hand" selectedIds={[]} selectionMode={false} notes={new Map()} usability={usability} backSrc="back.png" onSelect={select} onCheck={vi.fn()} onPreview={vi.fn()}/>);
    const items = [...view.container.querySelectorAll('.card-item')];
    expect(items.map(item => item.getAttribute('data-usability'))).toEqual(['usable', 'insufficient', 'unconfigured', 'unbound']);
    expect(items.map(item => !!item.querySelector('.card-face > img.card-unusable-back'))).toEqual([false, true, true, true]);
    for (const [i, card] of [a, b, c, d].entries()) expect(items[i].querySelector(`img[alt="${card.name} 카드 이미지"]`)!.getAttribute('src')).toBe(`app://assets/asset-${i}/thumbnail`);
    const overlay = items[1].querySelector<HTMLImageElement>('.card-unusable-back')!;
    expect(overlay.getAttribute('src')).toBe('back.png'); expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: `${b.name} 카드 선택` }).getAttribute('aria-description')).toBe('사용 불가 · 자원 부족');
    fireEvent.click(screen.getByRole('button', { name: `${b.name} 카드 선택` }));
    expect(select).toHaveBeenCalledWith(b.id, expect.any(HTMLButtonElement));
  });

  it('shows no overlay without a card back (no active character to judge against)', () => {
    const view = render(<CardGallery cards={[b]} mode="grid" selectedIds={[]} selectionMode={false} notes={new Map()} usability={new Map([[b.id, 'insufficient' as const]])} onSelect={vi.fn()} onCheck={vi.fn()} onPreview={vi.fn()}/>);
    expect(view.container.querySelector('.card-unusable-back')).toBeNull();
  });
});

describe('v1.1 Phase 3 enlargement frame', () => {
  it('keeps clicks on the card frame inside the enlargement and closes from outside, with or without tilt', () => {
    for (const tilt of [true, false]) {
      const close = vi.fn();
      const view = render(<ImageLightbox card={a} tilt={tilt} onClose={close}/>);
      const frame = view.container.querySelector('.lightbox-card')!;
      expect(frame.classList.contains('can-tilt')).toBe(tilt);
      fireEvent.pointerDown(frame); fireEvent.click(frame);
      fireEvent.pointerMove(frame, { clientX: 5, clientY: 5 });
      expect(close).not.toHaveBeenCalled();
      const dialog = screen.getByRole('dialog');
      fireEvent.pointerDown(dialog); fireEvent.click(dialog);
      expect(close).toHaveBeenCalledTimes(1);
      view.unmount();
    }
  });
});

describe('v1.1 Phase 3 tilt option', () => {
  const boot = (settings: Settings): Bootstrap => ({ settings, cards: SAMPLE_CARDS, appVersion: '0.6.0', schemaVersion: 6, libraryState: DEFAULT_LIBRARY_STATE, tags: [], profiles: [], decks: [], warnings: [] });
  function mount(settings: Settings) {
    window.desktop = {
      getBootstrap: vi.fn().mockResolvedValue({ ok: true, value: boot(settings) }),
      saveSettings: vi.fn().mockImplementation(async value => ({ ok: true, value })),
      saveLibraryState: vi.fn().mockImplementation(async value => ({ ok: true, value })),
      getResources: vi.fn(), getTrash: vi.fn(), getUseHistory: vi.fn(),
    } as unknown as DesktopBridge;
    render(<App/>);
  }
  it('defaults to on, saves under effects, and is off and locked while reduced motion is on', async () => {
    mount(DEFAULT_SETTINGS);
    fireEvent.click(await screen.findByRole('button', { name: '환경 설정' }));
    const tilt = screen.getByRole<HTMLInputElement>('checkbox', { name: '확대 카드 3D 기울임' });
    expect(tilt.checked).toBe(true); expect(tilt.disabled).toBe(false);
    fireEvent.click(tilt);
    expect(window.desktop.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, effects: { cardTilt: false } });
    cleanup();
    mount({ ...DEFAULT_SETTINGS, reducedMotion: true, effects: { cardTilt: true } });
    fireEvent.click(await screen.findByRole('button', { name: '환경 설정' }));
    const locked = screen.getByRole<HTMLInputElement>('checkbox', { name: '확대 카드 3D 기울임' });
    expect(locked.checked).toBe(false); expect(locked.disabled).toBe(true);
    expect(screen.getByText('모션 줄이기가 켜져 있어 기울임과 확대 전환 효과가 꺼집니다.')).toBeDefined();
  });
});
