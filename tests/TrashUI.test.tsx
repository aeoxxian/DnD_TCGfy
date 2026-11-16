// @vitest-environment jsdom
import { Modal } from '../src/components/Modal';
import { UseHistory } from '../src/components/UseHistory';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TrashReview } from '../src/components/TrashManager';
import type { DesktopBridge } from '../src/shared/contracts';
import type { TrashPreview } from '../src/shared/trash';

beforeEach(()=>{
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const preview:TrashPreview={quote:'a'.repeat(64),count:5,names:['가','나','다','라','마'],characters:['A','B'],decks:['A 덱','B 덱'],notes:['모든 덱에서 사라집니다.'],requiresPhrase:false,assetCount:0,sharedAssets:0,invalidatedBatches:0};
  window.desktop={previewTrash:vi.fn().mockResolvedValue({ok:true,value:preview}),changeTrash:vi.fn().mockResolvedValue({ok:true,value:{count:5,cardIds:['1','2','3','4','5'],type:'move',warnings:[],replayed:false}})} as unknown as DesktopBridge;
});
afterEach(cleanup);

it('previews affected cards/decks and cancellation never deletes',async()=>{
  const close=vi.fn();render(<TrashReview action={{type:'move',cardIds:['1','2','3','4','5']}} onClose={close} onDone={vi.fn()}/>);
  await screen.findByText('5장 휴지통 이동');expect(screen.getByText('대상: 가 · 나 · 다 · 라 · 마')).toBeDefined();expect(screen.getByText('영향 캐릭터: A · B')).toBeDefined();expect(screen.getByText('삭제 전 소속 덱: A 덱 / B 덱')).toBeDefined();expect(window.desktop.changeTrash).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'취소'}));expect(close).toHaveBeenCalledOnce();expect(window.desktop.changeTrash).not.toHaveBeenCalled();
});
it('requires both the irreversible acknowledgement and phrase for emptying trash, then suppresses double submit',async()=>{
  const preview:TrashPreview={quote:'b'.repeat(64),count:2,names:['가','나'],characters:[],decks:[],notes:['복원할 수 없습니다.'],requiresPhrase:true,assetCount:2,sharedAssets:1,invalidatedBatches:0};vi.mocked(window.desktop.previewTrash).mockResolvedValue({ok:true,value:preview});const done=vi.fn().mockResolvedValue(undefined);render(<TrashReview action={{type:'empty'}} onClose={vi.fn()} onDone={done}/>);await screen.findByText('2장 영구 삭제');const button=screen.getByRole('button',{name:'영구 삭제 확정'}) as HTMLButtonElement;expect(button.disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox'));expect(button.disabled).toBe(true);fireEvent.change(screen.getByRole('textbox',{name:'영구 삭제 확인 문구'}),{target:{value:'삭제'}});expect(button.disabled).toBe(true);fireEvent.change(screen.getByRole('textbox',{name:'영구 삭제 확인 문구'}),{target:{value:'영구 삭제'}});expect(button.disabled).toBe(false);fireEvent.click(button);fireEvent.click(button);await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(window.desktop.changeTrash).toHaveBeenCalledOnce();expect(vi.mocked(window.desktop.changeTrash).mock.calls[0][0]).toMatchObject({action:{type:'empty'},quote:preview.quote,confirmed:true,phrase:'영구 삭제'});
});

it('keeps incomplete legacy use snapshots readable without inventing free costs',async()=>{
  window.desktop.getUseHistory=vi.fn().mockResolvedValue({ok:true,value:{events:[{id:'legacy',characterId:'A',type:'card_used',label:'이전 사용',changes:[],timestamp:'2026-11-17T00:00:00.000Z',reversible:false,barrier:true,costSnapshot:{name:'오래된 카드',option:{label:'불완전'}}}]}});
  render(<UseHistory characterId="A" onClose={vi.fn()}/>);await screen.findByRole('heading',{name:'오래된 카드'});expect(screen.getByText('이전 기록의 당시 비용이 없거나 불완전하여 복원할 수 없습니다.')).toBeDefined();expect(screen.queryByText('당시 비용: 무소모')).toBeNull();
});

it('closes only the nested image dialog when Escape cancellation bubbles',()=>{
  const outer=vi.fn();const inner=vi.fn();render(<Modal title="휴지통" onClose={outer}><Modal title="원본" onClose={inner}>이미지</Modal></Modal>);fireEvent(screen.getByRole('dialog',{name:'원본'}),new Event('cancel',{bubbles:true,cancelable:true}));expect(inner).toHaveBeenCalledOnce();expect(outer).not.toHaveBeenCalled();
});
