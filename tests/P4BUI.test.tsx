// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HandSurface } from '../src/components/HandSurface';
import { ResourcePanel, type ResourceController } from '../src/components/ResourcePanel';
import { AppStore } from '../electron/store';
import { DEFAULT_SETTINGS, settingsSchema, type ResourceDisplay } from '../src/shared/contracts';
import type { ResourceView } from '../src/shared/resources';

afterEach(cleanup);
const root=resolve('artifacts/p4-b-unit');mkdirSync(root,{recursive:true});
function buttons(){return ['A','B','C'].map(name=><button className="card-button" key={name}>{name}</button>);}

describe('P4-B focus navigation',()=>{
  it('moves focus only, clamps boundaries, skips intermediate Tab stops, preserves the selected card',()=>{
    const click=vi.fn();render(<HandSurface mode="hand"><button className="card-button" aria-pressed="true" onClick={click}>A</button><button className="card-button" onClick={click}>B</button><button className="card-button" onClick={click}>C</button></HandSurface>);
    const [a,b,c]=screen.getAllByRole('button');for(const el of [a,b,c])el.scrollIntoView=vi.fn();
    expect([a,b,c].map(el=>el.tabIndex)).toEqual([0,-1,-1]);a.focus();fireEvent.keyDown(a,{key:'ArrowRight'});expect(document.activeElement).toBe(b);expect([a,b,c].map(el=>el.tabIndex)).toEqual([-1,0,-1]);fireEvent.keyDown(b,{key:'End'});expect(document.activeElement).toBe(c);fireEvent.keyDown(c,{key:'ArrowRight'});expect(document.activeElement).toBe(c);fireEvent.keyDown(c,{key:'Home'});expect(document.activeElement).toBe(a);expect(a.getAttribute('aria-pressed')).toBe('true');expect(click).not.toHaveBeenCalled();
  });
  it('leaves inputs and modified arrows alone and restores one Tab entry after filtering or mode changes',()=>{
    const view=render(<HandSurface mode="hand">{buttons()}<input aria-label="메모"/></HandSurface>);const input=screen.getByLabelText('메모');input.focus();fireEvent.keyDown(input,{key:'ArrowRight'});expect(document.activeElement).toBe(input);
    const a=screen.getByRole('button',{name:'A'});a.focus();fireEvent.keyDown(a,{key:'ArrowRight',ctrlKey:true});expect(document.activeElement).toBe(a);
    view.rerender(<HandSurface mode="grid"><button className="card-button">New</button></HandSurface>);expect(screen.getByRole('button').tabIndex).toBe(0);
  });
});

describe('P4-B display preferences do not change game data',()=>{
  it('reads old preferences, persists per-character folding and priority separately, and keeps P4-A preferences readable',()=>{
    const path=mkdtempSync(join(root,'settings-'));let store=new AppStore(path);expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    const resourceViews={a:{collapsedGroups:['standard'] as const,priorityIds:['counter-a']},b:{collapsedGroups:[],priorityIds:[]}};
    store.saveSettings({...DEFAULT_SETTINGS,resourceViews:{...resourceViews,a:{...resourceViews.a,collapsedGroups:['standard']}}});
    const old=JSON.parse((store.db.prepare("SELECT value_json FROM settings WHERE key='preferences'").get() as {value_json:string}).value_json);expect(old).toEqual(DEFAULT_SETTINGS);expect(store.db.prepare('PRAGMA user_version').get()?.user_version).toBe(9);store.close();store=new AppStore(path);expect(store.getSettings().resourceViews).toEqual(resourceViews);store.saveSettings({...DEFAULT_SETTINGS,reducedMotion:true});expect(store.getSettings().resourceViews).toEqual(resourceViews);store.close();
  });
  it('rejects malformed or oversized display settings without altering the last saved data',()=>{
    const store=new AppStore(mkdtempSync(join(root,'invalid-')));const good={...DEFAULT_SETTINGS,resourceViews:{a:{collapsedGroups:['counter'],priorityIds:['p']}}};store.saveSettings(good);
    for(const resourceViews of [{a:{collapsedGroups:['invented'],priorityIds:[]}},{a:{collapsedGroups:[],priorityIds:[1]}},{a:{collapsedGroups:[],priorityIds:Array(1001).fill('p')}}])expect(()=>store.saveSettings({...DEFAULT_SETTINGS,resourceViews})).toThrow();expect(store.getSettings()).toEqual(good);expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);store.close();
  });
  it('uses saved group folds and explicit priority without resource mutations',async()=>{
    const resource=(id:string):ResourceView=>({id,characterId:'a',templateId:id,name:id,unit:'점',kind:'counter',capacity:5,remaining:2,overrides:{scope:'character'},template:{id,key:id,name:id,kind:'counter',unit:'점',capacity:{type:'fixed',value:5},recovery:[],source:'user',version:1}});
    const controller:ResourceController={snapshot:{characterId:'a',revision:1,resources:[resource('one'),resource('two')],templates:[],bindings:[],events:[],warnings:[]},busy:false,error:'',perform:vi.fn(),refresh:vi.fn()};
    const saved=vi.fn();const display:ResourceDisplay={collapsedGroups:['counter'],priorityIds:['two']};const view=render(<ResourcePanel controller={controller} display={display} onDisplayChange={saved}/>);
    const group=view.container.querySelector('details.resource-group')! as HTMLDetailsElement;expect(group.open).toBe(false);expect([...view.container.querySelectorAll('.resource-status-row')].map(el=>el.getAttribute('aria-label'))).toEqual(['two 상태·수정','one 상태·수정']);
    group.open=true;fireEvent(group,new Event('toggle'));await waitFor(()=>expect(saved).toHaveBeenCalledWith({collapsedGroups:[],priorityIds:['two']}));fireEvent.click(screen.getByRole('button',{name:'two 상태·수정'}));fireEvent.click(screen.getByRole('button',{name:'우선 표시 해제'}));expect(saved).toHaveBeenLastCalledWith({collapsedGroups:[],priorityIds:[]});expect(controller.perform).not.toHaveBeenCalled();
  });
});
