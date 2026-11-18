// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { tiltFor, tiltMargin } from '../src/components/ImageLightbox';
import { DEFAULT_SETTINGS, DEFAULT_LIBRARY_STATE, type Bootstrap, type DesktopBridge, type Settings } from '../src/shared/contracts';
import { INERTIA, glideDistance, glideOffset, glideRemaining, glideSpeed, releaseVelocity } from '../src/shared/hand-inertia';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';

describe('v1.2 Phase 2 · hand momentum maths', () => {
  const track = (velocity: number, from = 0, count = 8, step = 8) => Array.from({ length: count }, (_, i) => ({ t: from + i * step, x: 500 + velocity * i * step }));

  it('measures the release velocity over the last 100 ms and ignores a pointer that had stopped', () => {
    expect(releaseVelocity(track(-2), 56)).toBeCloseTo(-2);
    expect(releaseVelocity([...track(-2, 0, 20), { t: 160, x: 120 }], 160)).toBeLessThan(0);
    expect(releaseVelocity(track(-2), 56 + INERTIA.stale + 1)).toBe(0);
    expect(releaseVelocity([{ t: 0, x: 0 }], 1)).toBe(0);
    expect(releaseVelocity([{ t: 0, x: 0 }, { t: 0, x: 40 }], 0)).toBe(0);
  });

  it('only fast releases glide, in the drag direction, with capped speed and distance', () => {
    expect(glideDistance(-0.2, 1000)).toBe(0);
    expect(glideDistance(0.3, 1000)).toBe(0);
    expect(glideDistance(-1, 1000)).toBeCloseTo(INERTIA.timeConstant);
    expect(glideDistance(1, 1000)).toBeCloseTo(-INERTIA.timeConstant);
    expect(glideDistance(-50, 4000)).toBe(INERTIA.maxVelocity * INERTIA.timeConstant);
    expect(glideDistance(-50, 4000)).toBeLessThanOrEqual(INERTIA.maxDistance);
    expect(glideDistance(-50, 600)).toBe(600 * INERTIA.widthFactor);
    expect(glideDistance(-3.9, 4000)).toBeCloseTo(3.9 * INERTIA.timeConstant);
    expect(glideDistance(Number.NaN, 1000)).toBe(0);
  });

  it('eases out: starts at the release speed, never overshoots and slows down', () => {
    const distance = glideDistance(-2, 1000);
    expect(glideSpeed(distance, 0)).toBeCloseTo(2);
    let previous = 0;
    for (const t of [16, 100, 300, 600, 1000, 2000]) { const now = glideOffset(distance, t); expect(now).toBeGreaterThan(previous); expect(now).toBeLessThan(distance); previous = now; }
    expect(glideSpeed(distance, 600)).toBeLessThan(glideSpeed(distance, 100));
    expect(glideRemaining(distance, 3000)).toBeLessThan(INERTIA.restDistance);
  });
});

describe('v1.2 Phase 2 · tilt zone around the enlarged card', () => {
  const card = { left: 400, top: 20, width: 500, height: 720 };

  it('uses 8% of the shorter window side, kept between 60 and 100 px', () => {
    expect(tiltMargin(1366, 768)).toBe(61);
    expect(tiltMargin(1920, 1080)).toBe(86);
    expect(tiltMargin(1024, 600)).toBe(60);
    expect(tiltMargin(3840, 2160)).toBe(100);
  });

  it('keeps leaning just outside the card (held at the edge, never past 6°) and releases beyond the margin', () => {
    expect(tiltFor(card, 650, 380, 61)).toEqual({ rotateX: -0, rotateY: 0 });
    const edge = tiltFor(card, 900, 380, 61), outside = tiltFor(card, 940, 380, 61);
    expect(edge?.rotateY).toBeCloseTo(6); expect(outside).toEqual(edge);
    expect(tiltFor(card, 961, 380, 61)).toBeDefined();
    expect(tiltFor(card, 962, 380, 61)).toBeUndefined();
    expect(tiltFor(card, 650, -50, 61)).toBeUndefined();
    const corner = tiltFor(card, 330, 780, 80)!;
    expect(Math.abs(corner.rotateX)).toBeLessThanOrEqual(6); expect(Math.abs(corner.rotateY)).toBeLessThanOrEqual(6);
    expect(tiltFor({ ...card, width: 0 }, 650, 380, 61)).toBeUndefined();
  });
});

describe('v1.2 Phase 2 · 손패 관성 스크롤 setting', () => {
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  function mount(settings: Settings) {
    const boot: Bootstrap = { settings, cards: SAMPLE_CARDS, appVersion: '1.2.0', schemaVersion: 6, libraryState: DEFAULT_LIBRARY_STATE, tags: [], profiles: [], decks: [], warnings: [] };
    window.desktop = { getBootstrap: vi.fn().mockResolvedValue(ok(structuredClone(boot))), saveSettings: vi.fn().mockImplementation(async (value: Settings) => ok(value)), saveLibraryState: vi.fn(), getResources: vi.fn() } as unknown as DesktopBridge;
    return render(<App/>);
  }
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  });
  afterEach(cleanup);

  it('is on by default, saves to handScroll only, and keeps the other effects untouched', async () => {
    mount({ ...DEFAULT_SETTINGS, effects: { cardTilt: false } });
    fireEvent.click(await screen.findByRole('button', { name: '환경 설정' }));
    const box = screen.getByRole('checkbox', { name: '손패 관성 스크롤' }) as HTMLInputElement;
    expect(box.checked).toBe(true); expect(box.disabled).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(window.desktop.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ handScroll: { inertia: false }, effects: { cardTilt: false } })));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: '손패 관성 스크롤' }) as HTMLInputElement).checked).toBe(false));
  });

  it('is off and locked while 모션 줄이기 is on', async () => {
    mount({ ...DEFAULT_SETTINGS, reducedMotion: true, handScroll: { inertia: true } });
    fireEvent.click(await screen.findByRole('button', { name: '환경 설정' }));
    const box = screen.getByRole('checkbox', { name: '손패 관성 스크롤' }) as HTMLInputElement;
    expect(box.checked).toBe(false); expect(box.disabled).toBe(true);
    expect(screen.getByText(/놓은 자리에서 바로 멈춥니다/)).toBeDefined();
  });
});
