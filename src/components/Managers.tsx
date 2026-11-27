import { useState, type FormEvent } from 'react';
import type { Library, Tag, Result, ProfileTrashEntry } from '../shared/contracts';
import { Modal } from './Modal';

function TagRow({ tag, onLibrary }: { tag: Tag; onLibrary: (value: Library) => void }) {
  const [name, setName] = useState(tag.name);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(remove: boolean) {
    setBusy(true); setError('');
    try {
      const result = remove ? await window.desktop.deleteTag(tag.id) : await window.desktop.saveTag({ id: tag.id, name });
      if (result.ok) { onLibrary(result.value); setConfirm(false); }
      else setError(result.error);
    } catch { setError('태그를 변경하지 못했습니다.'); } finally { setBusy(false); }
  }
  return <div className="tag-row"><label>{tag.name} · {tag.usageCount}장 연결<input aria-label={`${tag.name} 태그 이름`} maxLength={60} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><div className="tag-actions"><button disabled={busy || name === tag.name || !name.trim()} onClick={() => void submit(false)} aria-label={`${tag.name} 태그 이름 저장`}>이름 저장</button><button disabled={busy} onClick={() => setConfirm(true)} aria-label={`${tag.name} 태그 삭제`}>삭제</button></div>{confirm && <div className="inline-confirm"><p>{tag.usageCount}장의 카드에서 이 공통 태그를 해제합니다. 카드의 나머지 정보는 유지됩니다.</p><button disabled={busy} onClick={() => void submit(true)}>태그 삭제 확인</button><button disabled={busy} onClick={() => setConfirm(false)}>취소</button></div>}{error && <p role="alert" className="error-banner">{error}</p>}</div>;
}
export function TagManager({ library, onLibrary, onClose }: { library: Library; onLibrary: (value: Library) => void; onClose: () => void }) {
  const [name, setName] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await window.desktop.saveTag({ name }); if (result.ok) { onLibrary(result.value); setName(''); } else setError(result.error); }
    catch { setError('태그를 추가하지 못했습니다.'); } finally { setBusy(false); }
  }
  return <Modal title="공통 태그 관리" onClose={onClose}><p className="manager-help">이름 수정과 삭제는 이 태그를 연결한 모든 카드에 적용됩니다. 한 카드의 태그만 바꾸려면 카드 정보 수정을 이용하세요.</p><form className="inline-form" onSubmit={event => void create(event)}><label>새 공통 태그<input maxLength={60} required value={name} onChange={event => setName(event.target.value)} /></label><button disabled={busy}>추가</button></form>{error && <p role="alert" className="error-banner">{error}</p>}<div className="tag-list">{library.tags.map(tag => <TagRow key={tag.id} tag={tag} onLibrary={onLibrary} />)}</div></Modal>;
}
export function ProfileManager({library,onLibrary,onClose,onClass,cardBack}: {
  library:Library; onLibrary:(value:Library)=>void; onClose:()=>void; onClass?:()=>void;
  cardBack?:{src:string;deckName?:string;onOpen:()=>void};
}) {
  const [characterName,setCharacterName]=useState('');
  const [deckName,setDeckName]=useState('');
  const [managedId,setManagedId]=useState('');
  const [deletion,setDeletion]=useState<ProfileTrashEntry>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const active=library.libraryState.activeCharacterId;
  const profile=library.profiles.find(item=>item.id===managedId)??library.profiles.find(item=>item.id===active)??library.profiles[0];
  const decks=library.decks.filter(deck=>deck.characterId===profile?.id);
  const trash=library.profileTrash??[];
  async function perform(request:()=>Promise<Result<Library>>,after:()=>void) {
    setBusy(true);setError('');
    try {
      const result=await request();
      if(result.ok){onLibrary(result.value);after();}else setError(result.error);
    } catch {setError('캐릭터 또는 덱을 저장하지 못했습니다.');}
    finally {setBusy(false);}
  }
  function changeTrash(item:ProfileTrashEntry,restore:boolean) {
    void perform(()=>window.desktop.changeProfileTrash({kind:item.kind,id:item.id,restore}),()=>setDeletion(undefined));
  }
  return <Modal title="캐릭터와 덱" onClose={onClose}>
    <form className="inline-form" onSubmit={event=>{event.preventDefault();void perform(()=>window.desktop.createProfile({name:characterName}),()=>{setCharacterName('');setManagedId('');});}}>
      <label>새 캐릭터 이름<input required maxLength={100} value={characterName} disabled={busy} onChange={event=>setCharacterName(event.target.value)}/></label><button disabled={busy}>캐릭터 만들기</button>
    </form>
    {profile&&<>
      <div className="inline-form">
        <label>관리할 캐릭터<select value={profile.id} disabled={busy} onChange={event=>setManagedId(event.target.value)}>{library.profiles.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {onClass&&profile.id===active&&<button onClick={onClass}>클래스·레벨 설정</button>}
        <button disabled={busy} onClick={()=>setDeletion({kind:'profile',id:profile.id,name:profile.name})}>캐릭터 삭제</button>
      </div>
      <h3 className="manager-subtitle">{profile.name}의 덱</h3>
      <ul className="deck-list">{decks.map(deck=><li key={deck.id}><strong>{deck.name}</strong><span>{deck.cardIds.length}장</span><button disabled={busy} aria-label={`${deck.name} 삭제`} onClick={()=>setDeletion({kind:'deck',id:deck.id,name:deck.name})}>덱 삭제</button></li>)}</ul>
      <form className="inline-form" onSubmit={event=>{event.preventDefault();void perform(()=>window.desktop.createDeck({characterId:profile.id,name:deckName}),()=>setDeckName(''));}}>
        <label>새 덱 이름<input required maxLength={100} value={deckName} disabled={busy} onChange={event=>setDeckName(event.target.value)}/></label><button disabled={busy}>덱 만들기</button>
      </form>
    </>}
    {trash.length>0&&<details><summary>캐릭터·덱 휴지통 ({trash.length})</summary><ul className="deck-list">{trash.map(item=><li key={item.id}>
      <span>{item.characterName ? `${item.characterName} · ` : ''}{item.name} · {item.kind==='deck'?'덱':'캐릭터'}</span>
      <button disabled={busy} aria-label={`${item.name} 복원`} onClick={()=>changeTrash(item,true)}>복원</button></li>)}</ul></details>}
    {cardBack&&<section className="card-back-entry" aria-label="카드 뒷면"><img src={cardBack.src} alt="" draggable={false}/>
      <div><h3>카드 뒷면</h3><button type="button" disabled={busy} aria-label={`카드 뒷면 바꾸기 · ${cardBack.deckName??'모든 덱 기본값'}`} onClick={cardBack.onOpen}>카드 뒷면 바꾸기</button></div></section>}
    {error&&!deletion&&<p role="alert" className="error-banner">{error}</p>}
    {deletion&&<Modal title={deletion.kind==='deck'?'덱 삭제 확인':'캐릭터 삭제 확인'} onClose={()=>{if(!busy)setDeletion(undefined);}}>
      <p>{deletion.name}을(를) 휴지통으로 이동합니다.</p>
      <p>{deletion.kind==='deck'?'이 덱은 플레이 목록에서 숨겨집니다. 카드 원본과 다른 덱은 유지되고, 카드 구성과 순서는 복원할 수 있습니다.':
        `이 캐릭터와 소속 덱 ${decks.length}개가 플레이 목록에서 숨겨집니다. 자원 잔여량, 사용 기록과 소속 덱을 그대로 복원할 수 있습니다. 라이브러리의 카드와 다른 캐릭터는 유지됩니다.`}</p>
      {error&&<p role="alert" className="error-banner">{error}</p>}
      <div className="modal-actions"><button disabled={busy} onClick={()=>setDeletion(undefined)}>취소</button>
        <button className="danger" disabled={busy} onClick={()=>changeTrash(deletion,false)}>휴지통으로 이동</button></div>
    </Modal>}
  </Modal>;
}
