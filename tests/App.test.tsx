// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { DEFAULT_SETTINGS, DEFAULT_LIBRARY_STATE, type Bootstrap } from '../src/shared/contracts';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';

const bootstrap: Bootstrap = { settings: DEFAULT_SETTINGS, cards: SAMPLE_CARDS, appVersion: '0.2.0', schemaVersion: 2, libraryState: DEFAULT_LIBRARY_STATE, tags: [], profiles: [], decks: [], warnings: [] };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.desktop = {
    getBootstrap: vi.fn().mockResolvedValue({ ok: true, value: structuredClone(bootstrap) }),
    saveSettings: vi.fn().mockImplementation(async settings => ({ ok: true, value: settings })),
    saveLibraryState: vi.fn().mockImplementation(async state => ({ ok: true, value: state })),
    importImages: vi.fn().mockResolvedValue({ ok: true, value: { assets: [], errors: [] } }),
    saveCards: vi.fn().mockResolvedValue({ ok: true, value: structuredClone(bootstrap) }),
    archiveCard: vi.fn().mockResolvedValue({ ok: true, value: structuredClone(bootstrap) }),
    saveTag: vi.fn().mockResolvedValue({ ok: true, value: structuredClone(bootstrap) }),
    deleteTag: vi.fn().mockResolvedValue({ ok: true, value: structuredClone(bootstrap) }),
    createProfile: vi.fn().mockResolvedValue({ ok: true, value: structuredClone(bootstrap) }),
    createDeck: vi.fn().mockResolvedValue({ ok: true, value: structuredClone(bootstrap) }),
    selectDeck: vi.fn().mockResolvedValue({ ok: true, value: structuredClone(bootstrap) }),
    setDeckCards: vi.fn().mockResolvedValue({ ok: true, value: structuredClone(bootstrap) }),
  };
});
afterEach(cleanup);

describe('P0 card board', () => {
  it('renders a Korean three-panel board and card selection never writes settings or resources', async () => {
    render(<App />);
    const card = await screen.findByRole('button', { name: '상처 치료 카드 선택' });
    expect(screen.getByRole('complementary', { name: '자원 패널' })).toBeDefined();
    fireEvent.click(card);
    expect(screen.getByRole('button', { name: '사용 · 준비 중' }).hasAttribute('disabled')).toBe(true);
    expect(window.desktop.saveSettings).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '사용 · 준비 중' })).toBeNull();
    expect(document.activeElement).toBe(card);
  });
  it('saves view mode through the allowlisted bridge', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '격자' }));
    await waitFor(() => expect(window.desktop.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, viewMode: 'grid' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '격자' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('status').textContent).toContain('저장됨');
  });
  it('keeps the existing UI state and reports failed persistence', async () => {
    window.desktop.saveSettings = vi.fn().mockResolvedValue({ ok: false, error: '저장 실패' });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '격자' }));
    expect((await screen.findByRole('alert')).textContent).toBe('저장 실패');
    expect(screen.getByRole('button', { name: '손패' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('shows startup failure with an explicit retry', async () => {
    window.desktop.getBootstrap = vi.fn().mockRejectedValue(new Error('bridge disconnected'));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('데스크톱 연결');
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeDefined();
  });
  it('updates OR role filters and name search immediately while persistence is pending', async () => {
    window.desktop.saveLibraryState = vi.fn().mockImplementation(() => new Promise(() => {}));
    render(<App />);
    await screen.findByRole('button', { name: '상처 치료 카드 선택' });
    fireEvent.click(screen.getByRole('group', { name: '역할 필터' }).querySelector('button')!); // damage
    expect(screen.queryByRole('button', { name: '상처 치료 카드 선택' })).toBeNull();
    expect(screen.getByRole('button', { name: '검격 카드 선택' })).toBeDefined();
    fireEvent.change(screen.getByRole('searchbox', { name: '카드 이름 검색' }), { target: { value: '없음' } });
    expect(screen.queryByRole('button', { name: '검격 카드 선택' })).toBeNull();
    expect(screen.getByText('조건에 맞는 카드가 없어요')).toBeDefined();
  });
  it('preserves card identity and sends only editable metadata from the editor', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '상처 치료 카드 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '정보 수정' }));
    fireEvent.change(screen.getByRole('textbox', { name: '카드 이름' }), { target: { value: '바뀐 이름' } });
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
    await waitFor(() => expect(window.desktop.saveCards).toHaveBeenCalled());
    const argument = vi.mocked(window.desktop.saveCards).mock.calls[0][0].cards[0];
    expect(argument.id).toBe(SAMPLE_CARDS[0].id);
    expect(argument.name).toBe('바뀐 이름');
    expect(argument).not.toHaveProperty('castOptions');
  });
  it('shows image failure without hiding card metadata or edit controls', async () => {
    window.desktop.getBootstrap = vi.fn().mockResolvedValue({ ok: true, value: { ...bootstrap, cards: [{ ...SAMPLE_CARDS[0], imageAssetId: 'missing' }] } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '상처 치료 카드 선택' }));
    const images = screen.getAllByRole('img', { name: '상처 치료 카드 이미지' });
    for (const image of images) fireEvent.error(image);
    expect(screen.getAllByText('이미지 파일을 읽을 수 없습니다.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '정보 수정' })).toBeDefined();
  });
});
