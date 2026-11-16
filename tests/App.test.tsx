// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { DEFAULT_SETTINGS, type Bootstrap } from '../src/shared/contracts';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';

const bootstrap: Bootstrap = { settings: DEFAULT_SETTINGS, cards: SAMPLE_CARDS, appVersion: '0.1.0', schemaVersion: 1 };
beforeEach(() => {
  window.desktop = {
    getBootstrap: vi.fn().mockResolvedValue({ ok: true, value: structuredClone(bootstrap) }),
    saveSettings: vi.fn().mockImplementation(async settings => ({ ok: true, value: settings })),
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
});
