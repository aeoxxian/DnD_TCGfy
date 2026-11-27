import { useEffect, useState } from 'react';
import type { ResourceTemplate } from '../shared/resources';

type Kind = 'uses'|'points'|'standard'|'pact'|'generic';
export const definitionTypes: Record<Kind,string> = {
  uses:'사용 횟수',points:'포인트',standard:'일반 주문 슬롯',pact:'계약 마법 슬롯',generic:'레벨별 자원',
};
export function definitionType(template: ResourceTemplate): Kind {
  return template.kind==='slot_track' ? template.slotKind??'generic' : template.unit==='점'?'points':'uses';
}

export function useResourceDefinitions() {
  const [definitions,setDefinitions] = useState<ResourceTemplate[]>([]);
  const [error,setError] = useState('');
  useEffect(()=>{
    let live=true;
    void Promise.resolve(window.desktop?.getResourceDefinitions?.()).then(result=>{
      if (!live||!result) return;
      if (result.ok) setDefinitions(current=>[...result.value,...current.filter(item=>!result.value.some(value=>value.id===item.id))]);
      else setError(result.error);
    }).catch(()=>{if(live)setError('자원 정의를 읽지 못했습니다.');});
    return ()=>{live=false;};
  },[]);
  async function create(name:string,type:Kind) {
    const result = await window.desktop.createResourceDefinition({name,type});
    if (!result.ok) throw new Error(result.error);
    setDefinitions(current=>[...current,result.value]);
    return result.value;
  }
  return {definitions,error,create};
}

export type ResourceCatalog = ReturnType<typeof useResourceDefinitions>;
export function ResourceDefinitionPicker({catalog,value,label,onChange,types,defaultType,emptyLabel='자원 이름을 고르세요',disabled}: {
  catalog:ResourceCatalog; value?:string; label:string; onChange:(key:string|undefined,template?:ResourceTemplate)=>void;
  types?:Kind[]; defaultType:Kind; emptyLabel?:string; disabled?:boolean;
}) {
  const [adding,setAdding]=useState(false);
  const [name,setName]=useState('');
  const [type,setType]=useState(defaultType);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const allowed=types??(Object.keys(definitionTypes) as Kind[]);
  const options=catalog.definitions.filter(item=>allowed.includes(definitionType(item)));
  const hits=options.filter(item=>item.key===value||item.matchKey===value);
  const selected=options.find(item=>item.key===value)??(hits.length===1?hits[0]:undefined);
  const optionLabel=(item:ResourceTemplate)=>{
    const same=options.filter(other=>other.name===item.name&&definitionType(other)===definitionType(item));
    return `${item.name} · ${definitionTypes[definitionType(item)]}${same.length>1?` (${same.indexOf(item)+1})`:''}${item.definitionOnly?' · 미장착 정의':''}`;
  };
  async function add() {
    if(!name.trim()||saving)return;
    setError('');setSaving(true);
    try {
      const definition=await catalog.create(name.trim(),type);
      onChange(definition.key,definition);setAdding(false);setName('');
    } catch(error){setError((error as Error).message);}
    finally{setSaving(false);}
  }
  return <div className="resource-definition-picker">
    <label className="form-field">{label}<select aria-label={label} disabled={disabled||saving}
      value={selected?.id??(value?'previous':'')} onChange={event=>{
        const item=options.find(option=>option.id===event.target.value);
        onChange(item?.key,item);
      }}>
      <option value="">{emptyLabel}</option>
      {value&&!selected&&<option value="previous" disabled>{hits.length>1?'이전 설정 · 같은 연결 후보가 여러 개':'이전 설정 · 정의를 확인해 주세요'}</option>}
      {options.map(item=><option key={item.id} value={item.id}>{optionLabel(item)}</option>)}
    </select></label>
    {!adding&&<button type="button" disabled={disabled} onClick={()=>{setType(defaultType);setAdding(true);}}>새 자원 정의</button>}
    {adding&&<div className="inline-confirm">
      <label className="form-field">정의 이름<input maxLength={100} value={name} disabled={saving||disabled} onChange={event=>setName(event.target.value)}/></label>
      <label className="form-field">정의 종류<select value={type} disabled={saving||disabled} onChange={event=>setType(event.target.value as Kind)}>
        {allowed.map(item=><option key={item} value={item}>{definitionTypes[item]}</option>)}
      </select></label>
      <p>카드가 요구할 자원 이름과 종류를 등록합니다. 최대량과 회복은 캐릭터에 장착할 때 설정합니다.</p>
      <button type="button" disabled={disabled||saving||!name.trim()} onClick={()=>void add()}>정의 등록</button>
      <button type="button" disabled={saving} onClick={()=>{setAdding(false);setError('');}}>취소</button>
    </div>}
    {(error||catalog.error)&&<p role="alert">{error||catalog.error}</p>}
  </div>;
}
