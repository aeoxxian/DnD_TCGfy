// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResourcePanel, type ResourceController } from '../src/components/ResourcePanel';
import { CardUsage } from '../src/components/CardResources';
import { SelectedCardPanel } from '../src/components/SelectedCardPanel';
import type { CardDefinition, DesktopBridge } from '../src/shared/contracts';
import type { ResourceSnapshot, ResourceView } from '../src/shared/resources';
import { planUse } from '../src/shared/resource-engine';

const card:CardDefinition={id:'c',name:'주문',kind:'spell',spellLevel:4,roles:['utility'],actions:['action'],range:{kind:'self'},tags:[],description:'긴 설명\n'.repeat(300),castOptions:[{id:'use',label:'시전',costs:[{type:'slot',costKey:'s',slotSelection:'standard',autoBind:true}]}],createdAt:'2026-11-17T00:00:00.000Z',updatedAt:'2026-11-17T00:00:00.000Z'};
const counter:ResourceView={id:'p',characterId:'a',templateId:'tp',name:'집중점',unit:'점',kind:'counter',capacity:5,remaining:2,overrides:{scope:'character'},template:{id:'tp',key:'p',name:'집중점',unit:'점',kind:'counter',capacity:{type:'fixed',value:5},recovery:[{triggers:['long_rest'],amount:{type:'full'}}],source:'user',version:1}};
const slots:ResourceView={id:'s',characterId:'a',templateId:'ts',presetKey:'2014:wizard:spell_slots',name:'주문 슬롯',unit:'슬롯',kind:'slot_track',capacityByLevel:{4:3,5:2,6:1},remainingByLevel:{4:0,5:0,6:1},overrides:{scope:'character'},template:{id:'ts',key:'s',name:'주문 슬롯',unit:'슬롯',kind:'slot_track',slotKind:'standard',slotCapacity:{4:{type:'fixed',value:3},5:{type:'fixed',value:2},6:{type:'fixed',value:1}},recovery:[],source:'class_2014',version:1}};
function controller():ResourceController {const snapshot:ResourceSnapshot={characterId:'a',revision:7,resources:structuredClone([counter,slots]),templates:[],bindings:[],events:[],warnings:[],undoTargetId:'last'};return{snapshot,busy:false,error:'',perform:vi.fn().mockResolvedValue(true),refresh:vi.fn()};}
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};});
afterEach(cleanup);

describe('P4-A player controls',()=>{
  it('shows status and numeric meters by default; expanding/collapsing never spends resources',()=>{
    const c=controller();render(<ResourcePanel controller={c}/>);expect(screen.getByLabelText('집중점 현재량').textContent).toBe('2 / 5');expect(screen.getByRole('meter',{name:'집중점 잔여량'})).toBeDefined();expect(screen.queryByRole('button',{name:'집중점 1 감소'})).toBeNull();expect(screen.queryByRole('button',{name:'자원 관리'})).toBeNull();
    const row=screen.getByRole('button',{name:'집중점 상태·수정'});fireEvent.click(row);expect(row.getAttribute('aria-expanded')).toBe('true');expect(screen.getByRole('button',{name:'집중점 1 감소'})).toBeDefined();expect(c.perform).not.toHaveBeenCalled();fireEvent.click(row);expect(row.getAttribute('aria-expanded')).toBe('false');expect(screen.queryByRole('button',{name:'집중점 1 증가'})).toBeNull();expect(c.perform).not.toHaveBeenCalled();
  });
  it('keeps manual entry, incremental adjustment and Undo routed to the existing controller',async()=>{
    const c=controller();render(<ResourcePanel controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'집중점 상태·수정'}));fireEvent.click(screen.getByRole('button',{name:'집중점 1 증가'}));expect(c.perform).toHaveBeenCalledWith({type:'adjust',resourceId:'p',slotLevel:undefined,delta:1});fireEvent.click(screen.getByRole('button',{name:'수동 조정'}));fireEvent.change(screen.getByRole('spinbutton',{name:'새 현재량'}),{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:'현재량 변경 확정'}));await waitFor(()=>expect(c.perform).toHaveBeenCalledWith({type:'adjust',resourceId:'p',slotLevel:undefined,delta:-1},7));fireEvent.click(screen.getByRole('button',{name:'직전 자원 변경 실행 취소'}));expect(c.perform).toHaveBeenCalledWith({type:'undo'});
  });
  it('keeps all four recovery events and only applies a confirmed preview',async()=>{
    const c=controller();window.desktop={previewResource:vi.fn().mockResolvedValue({ok:true,value:{label:'긴 휴식',changes:[{resourceInstanceId:'p',before:2,after:5}],revision:7,canUse:true,canOverride:false,quote:'a'.repeat(64)}})} as unknown as DesktopBridge;render(<ResourcePanel controller={c}/>);for(const name of ['짧은 휴식','긴 휴식','새벽 경과','수동 회복'])expect(screen.getByRole('button',{name})).toBeDefined();fireEvent.click(screen.getByRole('button',{name:'긴 휴식'}));await screen.findByRole('dialog',{name:'긴 휴식 확인'});expect(c.perform).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'회복 확정'}));await waitFor(()=>expect(c.perform).toHaveBeenCalledWith({type:'recover',trigger:'long_rest'},7));
  });
  it('automatically uses the only remaining legal slot and omits the redundant selector',async()=>{
    const c=controller();window.desktop={previewResource:vi.fn().mockImplementation(async input=>({ok:true,value:{...planUse(card,'use',c.snapshot!.resources,[],input.action.choices),revision:7,quote:'a'.repeat(64)}}))} as unknown as DesktopBridge;render(<CardUsage card={card} controller={c}/>);await waitFor(()=>expect((screen.getByRole('button',{name:'사용 확정'}) as HTMLButtonElement).disabled).toBe(false));expect(screen.queryByLabelText('시전 슬롯 1')).toBeNull();expect(screen.getByText('주문 · 6레벨 슬롯 1개 사용 · 다른 2개 단계 소진')).toBeDefined();expect(screen.queryByRole('button',{name:'카드 사용 규칙'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'사용 확정'}));expect(c.perform).toHaveBeenCalledWith(expect.objectContaining({type:'use',choices:{s:6}}),7);
  });
  it('separates the selected card summary, long description and confirmation region without management controls',async()=>{
    const c=controller();window.desktop={previewResource:vi.fn().mockResolvedValue({ok:false,error:'검수 미리보기'})} as unknown as DesktopBridge;render(<SelectedCardPanel card={card} tags={[]} controller={c} onClose={vi.fn()} closeRef={{current:null}}/>);expect(screen.getByRole('region',{name:'선택 카드 정보'})).toBeDefined();expect(screen.getByLabelText('카드 설명 스크롤').textContent).toContain('긴 설명');expect(screen.getByRole('button',{name:'사용 확정'}).closest('.use-confirmation')).toBeTruthy();expect(screen.queryByRole('button',{name:'정보 수정'})).toBeNull();await screen.findByText('검수 미리보기');expect(c.perform).not.toHaveBeenCalled();
  });
});
