import data from '../data/classes-2014.json';
import { templateDraftSchema, type TemplateDraft } from './resources';
import { CLASS_NAMES, type ClassId, type ClassInput } from './class-contracts';

interface PresetResource extends Omit<TemplateDraft,'id'> { key:string; startLevel:number; unlimitedAt?:number; recoveryByLevel?:Record<string,TemplateDraft['recovery']> }
interface PresetClass { name:string; sourcePages:number[]; notes:string; resources:PresetResource[] }
export const CLASS_PRESETS = data.classes as unknown as Record<ClassId,PresetClass>;
export function classResources(input:ClassInput): {key:string;template:TemplateDraft}[] {
  if (!Number.isInteger(input.level) || input.level<1 || input.level>20) throw new Error('클래스 레벨은 1~20입니다.');
  if (input.classId==='homebrew') return [];
  if (!(input.classId in CLASS_NAMES)) throw new Error('지원하지 않는 클래스입니다.');
  const definition=CLASS_PRESETS[input.classId];
  return definition.resources.filter(resource=>resource.startLevel<=input.level).map(resource=>{
    const { key,startLevel,unlimitedAt,recoveryByLevel,...draft }=resource;
    if(startLevel>input.level)throw new Error('프리셋 시작 레벨 오류');
    const recoveryOverride=Object.keys(recoveryByLevel??{}).map(Number).filter(level=>level<=input.level).sort((a,b)=>b-a)[0];
    const template=templateDraftSchema.parse({...draft,unlimited:unlimitedAt!==undefined&&input.level>=unlimitedAt,recovery:recoveryOverride?recoveryByLevel![String(recoveryOverride)]:draft.recovery});
    return {key:`2014:${input.classId}:${key}`,template};
  });
}
