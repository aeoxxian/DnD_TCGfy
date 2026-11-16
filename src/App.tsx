import { useEffect, useRef, useState } from 'react';
import type { Bootstrap, CardDefinition, Role, Settings } from './shared/contracts';

const roleNames: Record<Role, string> = { heal: '힐', damage: '딜', utility: '유틸', other: '기타' };
const roleSymbols: Record<Role, string> = { heal: '✚', damage: '⟡', utility: '✦', other: '◇' };
const kindNames = { spell: '주문', feature: '특성', attack: '공격', item: '아이템', feat: '재주', other: '기타' };
const actionNames = { action: '행동', bonus_action: '보너스 행동', reaction: '반응', no_action: '행동 없음', passive: '상시', special: '특수' };

function CardFace({ card }: { card: CardDefinition }) {
  const role = card.roles[0] ?? 'other';
  return <div className={`card-face role-${role}`}>
    <div className="card-heading"><span>{kindNames[card.kind]}</span><span>{card.spellLevel === undefined ? '—' : `${card.spellLevel} 레벨`}</span></div>
    <div className="placeholder-art" aria-hidden="true"><span>{roleSymbols[role]}</span></div>
    <div className="card-copy"><h3>{card.name}</h3><p>{card.actions.map(a => actionNames[a]).join(' · ')}</p><div className="card-rule" /><p className="placeholder-label">카드 이미지 자리</p><p className="placeholder-note">원본 이미지는 등록 후<br />비율을 유지해 표시합니다.</p></div>
    <div className="card-footer">SAMPLE <span>{roleNames[role]}</span></div>
  </div>;
}

export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<CardDefinition>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await window.desktop.getBootstrap();
      if (result.ok) setBootstrap(result.value);
      else setError(result.error);
    } catch { setError('데스크톱 연결을 확인할 수 없습니다. 앱을 다시 실행해 주세요.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (selected) closeButton.current?.focus();
  }, [selected]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false);
        else { setSelected(undefined); selectedButton.current?.focus(); }
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [settingsOpen]);

  async function updateSettings(patch: Partial<Settings>) {
    if (!bootstrap || saving) return;
    setSaving(true);
    setStatus('');
    setError('');
    try {
      const result = await window.desktop.saveSettings({ ...bootstrap.settings, ...patch });
      if (result.ok) {
        setBootstrap(current => current ? { ...current, settings: result.value } : current);
        setStatus('환경 설정 저장됨');
      } else setError(result.error);
    } catch { setError('환경 설정을 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }

  if (!bootstrap) return <main className="startup" aria-busy={loading}><div className="brand-mark">◇</div><h1>DnD TCG-fy</h1>{loading ? <p>로컬 카드 보드를 여는 중…</p> : <><p role="alert">{error}</p><button onClick={() => void load()}>다시 시도</button></>}</main>;
  const { settings, cards } = bootstrap;
  const closeSelection = () => { setSelected(undefined); selectedButton.current?.focus(); };
  return <div className={`app ${settings.reducedMotion ? 'reduced-motion' : ''} ${settings.resourcePanelCollapsed ? 'resources-collapsed' : ''}`}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">◇</span><div><h1>DnD <span>TCG-fy</span></h1><p>나의 선택을 손패 위에</p></div></div>
      <div className="profile-summary"><span className="avatar" aria-hidden="true">P</span><div><strong>미리보기 보드</strong><small>샘플 덱 · {cards.length}장</small></div></div>
      <div className="top-actions"><span className="local-badge"><span />로컬 저장</span><button aria-expanded={settingsOpen} onClick={() => setSettingsOpen(v => !v)}>환경 설정</button></div>
    </header>
    {settingsOpen && <section className="settings-panel" aria-label="환경 설정"><div><h2>환경 설정</h2><p>이 기기에 저장되며 다시 실행해도 유지됩니다.</p></div><label><input type="checkbox" checked={settings.reducedMotion} disabled={saving} onChange={e => void updateSettings({ reducedMotion: e.target.checked })} /> 모션 줄이기</label><button onClick={() => setSettingsOpen(false)}>닫기</button></section>}
    <div className="workspace">
      <aside className="resource-panel" aria-label="자원 패널">
        <div className="panel-title"><h2>{settings.resourcePanelCollapsed ? '자원' : '나의 자원'}</h2><button className="collapse-button" aria-label={settings.resourcePanelCollapsed ? '자원 패널 펼치기' : '자원 패널 접기'} disabled={saving} onClick={() => void updateSettings({ resourcePanelCollapsed: !settings.resourcePanelCollapsed })}>{settings.resourcePanelCollapsed ? '›' : '‹'}</button></div>
        {!settings.resourcePanelCollapsed && <><div className="empty-resources"><span aria-hidden="true">◌</span><h3>아직 연결된 자원이 없어요</h3><p>캐릭터의 슬롯과 사용 횟수가<br />이곳에 표시됩니다.</p></div><div className="resource-note"><span className="eyebrow">카드 보드 안내</span><p>카드를 고르는 동안에는<br />자원이 소모되지 않습니다.</p></div><div className="history"><h3>최근 작업</h3><p>아직 기록된 작업이 없습니다.</p></div></>}
      </aside>
      <main className="board" aria-label="카드 보드">
        <div className="board-title"><div><span className="eyebrow">YOUR CARD TABLE</span><h2>손끝에서 고르는 다음 행동</h2><p>카드를 펼쳐 살펴보고, 나의 선택을 준비하세요.</p></div><span className="milestone">P0 · 미리보기</span></div>
        <div className="board-toolbar"><div className="deck-label"><span aria-hidden="true">▱</span><strong>샘플 손패</strong><span>{cards.length}장</span></div><div className="view-switch" role="group" aria-label="카드 보기 방식"><button aria-pressed={settings.viewMode === 'hand'} disabled={saving} onClick={() => void updateSettings({ viewMode: 'hand' })}>손패</button><button aria-pressed={settings.viewMode === 'grid'} disabled={saving} onClick={() => void updateSettings({ viewMode: 'grid' })}>격자</button></div></div>
        <div className={`cards-area ${settings.viewMode}`} aria-label="샘플 카드 목록">{cards.map(card => <button key={card.id} className={`card-button ${selected?.id === card.id ? 'selected' : ''}`} aria-label={`${card.name} 카드 선택`} aria-pressed={selected?.id === card.id} onClick={event => { selectedButton.current = event.currentTarget; setSelected(current => current?.id === card.id ? undefined : card); }}><CardFace card={card} /><span className="card-caption">{card.roles.map(r => roleNames[r]).join(' · ')}<span>살펴보기 ↗</span></span></button>)}</div>
        <div className="table-note"><span aria-hidden="true">◇</span><p>카드를 선택하면 오른쪽에서 크게 볼 수 있습니다.<br /><small>현재 카드는 화면 검수용 샘플이며 실제 덱에 저장되지 않습니다.</small></p></div>
        <footer className="board-status"><span role="status" aria-live="polite">{saving ? '저장 중…' : status || '로컬 카드 보드 준비됨'}</span><span>v{bootstrap.appVersion}</span></footer>
        {error && <p className="error-banner" role="alert">{error}</p>}
      </main>
      <aside className="detail-panel" aria-label="선택 카드 상세">
        <div className="panel-title"><h2>카드 살펴보기</h2>{selected && <button ref={closeButton} aria-label="카드 선택 닫기" onClick={closeSelection}>닫기</button>}</div>
        {selected ? <div className="selection" key={selected.id}><div className="detail-card"><CardFace card={selected} /></div><div className="selection-info"><h2>{selected.name}</h2><p>{selected.description}</p><div className="cost-preview"><span>예상 비용</span><strong>미연결 · 샘플 카드</strong></div><button className="use-button" disabled>사용 · 준비 중</button><p className="selection-hint">자원 연결과 사용은 후속 단계에서 지원합니다.</p></div></div> : <div className="empty-selection"><div className="empty-card" aria-hidden="true">◇</div><h3>어떤 카드를 고를까요?</h3><p>손패에서 카드 한 장을 선택하세요.<br />카드의 내용과 사용 비용을<br />이곳에서 확인할 수 있습니다.</p><span className="keyboard-hint">ESC <span>선택 닫기</span></span></div>}
      </aside>
    </div>
  </div>;
}
