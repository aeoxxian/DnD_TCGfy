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
    getTrash:vi.fn(),previewTrash:vi.fn(),changeTrash:vi.fn(),retryImageCleanup:vi.fn(),getUseHistory:vi.fn(),
    previewEdit:vi.fn(), applyEdit:vi.fn(), getEditHistory:vi.fn(),
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
    previewClass:vi.fn(), getResources: vi.fn(), previewResource: vi.fn(), changeResource: vi.fn(),
  };
});
afterEach(cleanup);

describe('bulk selection scope',()=>{
  it('reflects motion settings immediately and restores the prior preference when saving fails',async()=>{
    let finish!: (result: {ok:false;error:string}) => void;
    vi.mocked(window.desktop.saveSettings).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<App/>);await screen.findByRole('button',{name:'환경 설정'});fireEvent.click(screen.getByRole('button',{name:'환경 설정'}));const box=screen.getByRole('checkbox',{name:'모션 줄이기'}) as HTMLInputElement;fireEvent.click(box);expect(box.checked).toBe(true);expect(box.disabled).toBe(true);
    finish({ok:false,error:'설정 저장 실패'});await waitFor(()=>expect(box.checked).toBe(false));expect(box.disabled).toBe(false);expect(window.desktop.changeResource).not.toHaveBeenCalled();
  });
  it('moves card management off the play board and keeps selection/search after closing it',async()=>{
    render(<App/>);await screen.findByRole('button',{name:'상처 치료 카드 선택'});fireEvent.change(screen.getByRole('searchbox',{name:'카드 이름 검색'}),{target:{value:'치료'}});const card=screen.getByRole('button',{name:'상처 치료 카드 선택'});fireEvent.click(card);expect(screen.queryByRole('button',{name:'카드 등록'})).toBeNull();expect(screen.queryByRole('button',{name:'정보 수정'})).toBeNull();expect(screen.queryByRole('button',{name:'카드 사용 규칙'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'관리'}));expect(screen.getByRole('button',{name:'카드 등록'})).toBeDefined();expect(screen.getByRole('button',{name:'정보 수정'})).toBeDefined();expect(screen.getByRole('button',{name:'선택 관리'})).toBeDefined();fireEvent.click(screen.getByRole('button',{name:'관리 메뉴 닫기'}));expect(card.getAttribute('aria-pressed')).toBe('true');expect((screen.getByRole('searchbox',{name:'카드 이름 검색'}) as HTMLInputElement).value).toBe('치료');expect(window.desktop.changeResource).not.toHaveBeenCalled();
  });
  it('only shows checks in selection mode and clears selections on every filter change',async()=>{
    render(<App/>);await screen.findByRole('button',{name:'관리'});fireEvent.click(screen.getByRole('button',{name:'관리'}));
    expect(screen.queryByRole('checkbox',{name:'상처 치료 일괄 선택'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'선택 관리'}));
    fireEvent.click(screen.getByRole('button',{name:'표시 카드 전체 선택'}));
    expect((screen.getByRole('checkbox',{name:'상처 치료 일괄 선택'}) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByRole('searchbox',{name:'카드 이름 검색'}),{target:{value:'검격'}});
    expect(screen.queryByRole('checkbox',{name:'상처 치료 일괄 선택'})).toBeNull();
    expect((screen.getByRole('checkbox',{name:'검격 일괄 선택'}) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'표시 카드 전체 선택'}));
    expect((screen.getByRole('checkbox',{name:'검격 일괄 선택'}) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByRole('searchbox',{name:'카드 이름 검색'}),{target:{value:''}});
    expect((screen.getByRole('checkbox',{name:'상처 치료 일괄 선택'}) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox',{name:'검격 일괄 선택'}) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'선택 관리 종료'}));
    expect(screen.queryByRole('checkbox',{name:'검격 일괄 선택'})).toBeNull();
    expect(window.desktop.applyEdit).not.toHaveBeenCalled();
  });
});

describe('P0 card board', () => {
  it('renders a Korean three-panel board and card selection never writes settings or resources', async () => {
    render(<App />);
    const card = await screen.findByRole('button', { name: '상처 치료 카드 선택' });
    expect(screen.getByRole('complementary', { name: '자원 패널' })).toBeDefined();
    fireEvent.click(card);
    expect(screen.getByRole('button', { name: '사용 확정' }).hasAttribute('disabled')).toBe(true);
    expect(window.desktop.saveSettings).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '사용 확정' })).toBeNull();
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
    fireEvent.click(screen.getByRole('button',{name:'관리'}));fireEvent.click(screen.getByRole('button', { name: '정보 수정' }));
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
    expect(screen.queryByRole('button',{name:'정보 수정'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'관리'}));expect(screen.getByRole('button',{name:'정보 수정'})).toBeDefined();
  });
});
