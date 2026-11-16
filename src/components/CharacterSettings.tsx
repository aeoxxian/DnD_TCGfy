import { useState } from 'react';
import { CLASS_NAMES, type ClassInput, type ClassPreview } from '../shared/class-contracts';
import { CLASS_PRESETS } from '../shared/presets';
import type { ResourceView } from '../shared/resources';
import type { ResourceController } from './ResourcePanel';
import { Modal } from './Modal';

function amounts(resource?:ResourceView){
  if(!resource)return '없음';if(resource.unlimited)return '무제한';
  return resource.kind==='counter'?`${resource.remaining}/${resource.capacity} ${resource.unit}`:Object.keys(resource.capacityByLevel!).map(level=>`${level}레벨 ${resource.remainingByLevel![level]}/${resource.capacityByLevel![level]}`).join(' · ');
}
export function CharacterSettings({controller,onSaved,onClose}:{controller:ResourceController;onSaved:()=>Promise<void>;onClose:()=>void}){
  const snapshot=controller.snapshot;const [configuration,setConfiguration]=useState<ClassInput>({classId:snapshot?.profile?.classId&&snapshot.profile.classId in CLASS_NAMES?snapshot.profile.classId as ClassInput['classId']:'homebrew',level:snapshot?.profile?.level??1,charisma:snapshot?.profile?.abilityScores?.CHA,retire:'keep'});
  const [preview,setPreview]=useState<ClassPreview>();const [confirmed,setConfirmed]=useState(false);const [error,setError]=useState('');const [reading,setReading]=useState(false);
  function change(patch:Partial<ClassInput>){setConfiguration({...configuration,...patch});setPreview(undefined);setConfirmed(false);setError('');}
  async function inspect(){if(!snapshot)return;setReading(true);setError('');try{const result=await window.desktop.previewClass({characterId:snapshot.characterId,configuration});if(result.ok)setPreview(result.value);else setError(result.error);}catch{setError('변경 미리보기를 읽지 못했습니다.');}finally{setReading(false);}}
  const needsCharisma=configuration.classId==='bard'||configuration.classId==='paladin';
  return <Modal title="클래스·레벨 설정" wide onClose={onClose}>{!snapshot?<p>먼저 캐릭터를 선택해 주세요.</p>:<>
    <p className="manager-help">2014 PHB 단일 클래스 프리셋입니다. 기존 홈브루 자원과 수동 최대치를 유지합니다. 미리보기를 확인한 뒤에만 변경됩니다.</p>
    <div className="form-columns"><label className="form-field">클래스<select aria-label="클래스" disabled={controller.busy} value={configuration.classId} onChange={event=>change({classId:event.target.value as ClassInput['classId']})}><option value="homebrew">홈브루 · 프리셋 없음</option>{Object.entries(CLASS_NAMES).map(([id,name])=><option key={id} value={id}>{name} · 2014</option>)}</select></label><label className="form-field">클래스 레벨<input aria-label="클래스 레벨" type="number" min={1} max={20} step={1} disabled={controller.busy} value={configuration.level} onChange={event=>change({level:Number(event.target.value)})}/></label></div>
    {needsCharisma&&<label className="form-field">매력 능력치<input aria-label="매력 능력치" type="number" min={1} max={30} step={1} required value={configuration.charisma??''} onChange={event=>change({charisma:event.target.value?Number(event.target.value):undefined})}/></label>}
    {configuration.classId!=='homebrew'&&<p className="registration-note">{CLASS_PRESETS[configuration.classId]?.notes}</p>}
    <label className="form-field">사라지는 프리셋 자원<select aria-label="사라지는 프리셋 자원" value={configuration.retire} onChange={event=>change({retire:event.target.value as 'keep'|'archive'})}><option value="keep">현재 상태로 수동 자원으로 유지</option><option value="archive">확인 후 연결 해제 · 원본과 기록 보존</option></select></label>
    <p className="manager-help">소비량을 보존합니다. 새 일반 슬롯 단계는 최대량으로 시작하고, 계약 슬롯은 전체 소비 개수를 새 단계로 이월합니다. 아래 변경은 이후 사용/회복을 먼저 되돌린 뒤 실행 취소할 수 있습니다.</p>
    <button disabled={reading||controller.busy||(needsCharisma&&configuration.charisma===undefined)} onClick={()=>void inspect()}>변경 미리보기</button>
    {preview&&<section className="class-change-preview" aria-label="클래스 변경 미리보기"><h3>{preview.before.level} → {preview.after.level}레벨</h3>{preview.resources.length?<ul>{preview.resources.map(resource=><li key={resource.id}><strong>{resource.name} · {{create:'신규',update:'갱신',keep:'유지',archive:'연결 해제'}[resource.disposition]}</strong><span>{amounts(resource.before)} → {amounts(resource.after)}</span></li>)}</ul>:<p>이 레벨의 기본 소모 자원은 없습니다. 기존 카드와 덱은 유지합니다.</p>}{preview.warnings.map((warning,i)=><p className="registration-note" key={i}>{warning}</p>)}{preview.requiresRetireConfirmation&&<label className="checkbox-line"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>기존 자원 연결 해제와 연결 카드의 사용 불가 가능성을 확인했습니다.</label>}<div className="modal-actions"><button disabled={controller.busy||(preview.requiresRetireConfirmation&&!confirmed)} onClick={async()=>{if(await controller.perform({type:'configure_class',configuration,quote:preview.quote,confirmRetire:confirmed},preview.revision)){await onSaved();onClose();}}}>클래스 변경 확정</button></div></section>}
    {(error||controller.error)&&<p className="error-banner" role="alert">{error||controller.error}</p>}
  </>}</Modal>;
}
