// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardEditor } from '../src/components/CardEditor';
import { ImageLightbox } from '../src/components/ImageLightbox';
import { CardGallery } from '../src/components/CardGallery';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';
import type { DesktopBridge } from '../src/shared/contracts';
import type { ResourceController } from '../src/components/ResourcePanel';

const c={...SAMPLE_CARDS[0],imageAssetId:'original-asset'};
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};window.desktop={saveCards:vi.fn().mockResolvedValue({ok:false,error:'검수 저장 실패'}),importImages:vi.fn()} as unknown as DesktopBridge;});
afterEach(cleanup);
const controller=():ResourceController=>({snapshot:{characterId:'a',revision:4,templates:[],resources:[{id:'p',templateId:'p',characterId:'a',name:'영력',unit:'점',kind:'counter',remaining:5,capacity:5,overrides:{scope:'character'},template:{id:'p',key:'p',name:'영력',unit:'점',kind:'counter',source:'user',version:1,capacity:{type:'fixed',value:5},recovery:[]}}],bindings:[],events:[],warnings:[]},busy:false,error:'',perform:vi.fn(),refresh:vi.fn()});
function editor(){render(<CardEditor tags={[]} controller={controller()} characterId="a" onClose={vi.fn()} onLibrary={vi.fn()}/>);fireEvent.change(screen.getByRole('textbox',{name:'카드 이름'}),{target:{value:'새 카드'}});}

describe('P4-C registration controls',()=>{
  it('defaults to unconfigured, makes explicit free separate and reuses request ID after a failed response',async()=>{
    editor();expect((screen.getByRole('radio',{name:'나중에 설정'}) as HTMLInputElement).checked).toBe(true);fireEvent.click(screen.getByRole('radio',{name:'무소모'}));fireEvent.click(screen.getByRole('button',{name:'카드 저장'}));await screen.findByRole('alert');let calls=vi.mocked(window.desktop.saveCards).mock.calls;const first=calls[0][0].initialRules!;expect(first.configured).toBe(true);expect(first.scope).toBe('character');expect(first.castOptions[0].costs).toEqual([]);fireEvent.click(screen.getByRole('button',{name:'카드 저장'}));await waitFor(()=>expect(window.desktop.saveCards).toHaveBeenCalledTimes(2));calls=vi.mocked(window.desktop.saveCards).mock.calls;expect(calls[1][0].initialRules!.requestId).toBe(first.requestId);
  });
  it('keeps the same registration intent after refreshing the resource revision following a lost response',async()=>{
    const control=controller();const props={tags:[],controller:control,characterId:'a',onClose:vi.fn(),onLibrary:vi.fn()};const view=render(<CardEditor {...props}/>);fireEvent.change(screen.getByRole('textbox',{name:'카드 이름'}),{target:{value:'재시도'}});fireEvent.click(screen.getByRole('radio',{name:'무소모'}));fireEvent.click(screen.getByRole('button',{name:'카드 저장'}));await screen.findByRole('alert');const first=vi.mocked(window.desktop.saveCards).mock.calls[0][0].initialRules!;
    view.rerender(<CardEditor {...props} controller={{...control,snapshot:{...control.snapshot!,revision:5}}}/>);fireEvent.click(screen.getByRole('button',{name:'카드 저장'}));await waitFor(()=>expect(window.desktop.saveCards).toHaveBeenCalledTimes(2));const second=vi.mocked(window.desktop.saveCards).mock.calls[1][0].initialRules!;expect(second.requestId).toBe(first.requestId);expect(second.expectedRevision).toBe(5);
  });
  it('saves automatic upcasting once and only shows the relevant slot fields',async()=>{
    editor();fireEvent.click(screen.getByRole('radio',{name:'주문 슬롯'}));fireEvent.change(screen.getByLabelText('등록 기본 주문 레벨'),{target:{value:'4'}});expect(screen.queryByLabelText('등록 사용할 양')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'카드 저장'}));await screen.findByRole('alert');const input=vi.mocked(window.desktop.saveCards).mock.calls[0][0];expect(input.cards[0]).toMatchObject({kind:'spell',spellLevel:4});expect(input.initialRules!.castOptions[0].costs).toEqual([expect.objectContaining({type:'slot',autoBind:true,slotSelection:'standard'})]);
  });
  it('exposes range fields only for variable points and keeps advanced edits local until the card is saved',async()=>{
    const control=controller();render(<CardEditor tags={[]} controller={control} characterId="a" onClose={vi.fn()} onLibrary={vi.fn()}/>);fireEvent.change(screen.getByRole('textbox',{name:'카드 이름'}),{target:{value:'포인트'}});fireEvent.click(screen.getByRole('radio',{name:'포인트 자원'}));fireEvent.change(screen.getByLabelText('등록 사용할 자원'),{target:{value:'p'}});expect(screen.queryByLabelText('등록 포인트 min')).toBeNull();const advanced=screen.getByText('고급 사용 규칙').closest('details')!;advanced.open=true;fireEvent.click(screen.getByRole('checkbox',{name:'사용할 때 포인트 양을 고르기'}));expect(screen.getByLabelText('등록 포인트 min')).toBeDefined();expect(screen.queryByLabelText('등록 사용할 양')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'등록 고급 규칙 편집'}));await screen.findByRole('dialog',{name:'등록 카드 고급 사용 규칙'});fireEvent.click(screen.getByRole('button',{name:'사용 방식 추가'}));fireEvent.click(screen.getByRole('button',{name:'등록 규칙에 적용'}));await screen.findByRole('dialog',{name:'카드 등록'});expect(control.perform).not.toHaveBeenCalled();expect(window.desktop.saveCards).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'카드 저장'}));await screen.findByRole('alert');expect(vi.mocked(window.desktop.saveCards).mock.calls[0][0].initialRules!.castOptions).toHaveLength(2);
  });
});

describe('P4-C image-only lightbox',()=>{
  it('has an accessible name with no visible controls; image clicks stay open and background/ESC close',()=>{
    const close=vi.fn();render(<ImageLightbox card={c} onClose={close}/>);const dialog=screen.getByRole('dialog',{name:`${c.name} 원본 보기`}),img=screen.getByRole('img');expect(screen.queryAllByRole('button')).toHaveLength(0);fireEvent.click(img);expect(close).not.toHaveBeenCalled();fireEvent.pointerDown(dialog);fireEvent.click(dialog);expect(close).toHaveBeenCalledTimes(1);fireEvent(dialog,new Event('cancel',{cancelable:true}));expect(close).toHaveBeenCalledTimes(2);
  });
  it('restores the opener focus when closed',()=>{
    const opener=document.createElement('button');document.body.appendChild(opener);opener.focus();const view=render(<ImageLightbox card={c} onClose={vi.fn()}/>);expect(document.activeElement).toBe(screen.getByRole('dialog'));view.unmount();expect(document.activeElement).toBe(opener);opener.remove();
  });
  it('v1.1: a click selects, clicking the selected card again enlarges it, and a double click adds nothing else',()=>{
    const select=vi.fn(),preview=vi.fn();const props={cards:[c],mode:'hand' as const,selectedIds:[],selectionMode:false,notes:new Map<string,string>(),onSelect:select,onCheck:vi.fn(),onPreview:preview};
    const view=render(<CardGallery {...props}/>);const button=screen.getByRole('button');
    fireEvent.click(button,{detail:1});expect(select).toHaveBeenCalledTimes(1);expect(preview).not.toHaveBeenCalled();
    fireEvent.doubleClick(button);expect(select).toHaveBeenCalledTimes(1);expect(preview).not.toHaveBeenCalled();
    view.rerender(<CardGallery {...props} selectedId={c.id}/>);
    fireEvent.click(button,{detail:2});expect(preview).toHaveBeenCalledTimes(1);expect(select).toHaveBeenCalledTimes(1);
    fireEvent.click(button,{detail:0});expect(preview).toHaveBeenCalledTimes(2);
  });
});
