import { useEffect, useRef, useState } from 'react';
import type { BackupCounts, BackupExportResult, BackupStatus, RestorePreview } from '../shared/backup';
import type { Library } from '../shared/contracts';
import { Modal } from './Modal';

const ROWS: [keyof BackupCounts, string][] = [
  ['cards', '카드'], ['trashedCards', '휴지통 카드'], ['characters', '캐릭터'], ['decks', '덱'], ['events', '사용·변경 기록'], ['assets', '이미지'], ['tags', '태그'],
];
const megabytes = (bytes: number) => `${(bytes / 2 ** 20).toFixed(bytes < 10 * 2 ** 20 ? 1 : 0)} MB`;
const when = (iso?: string) => iso ? new Date(iso).toLocaleString('ko-KR') : '아직 없음';

export function BackupManager({ onClose, onLibrary }: { onClose: () => void; onLibrary: (library: Library) => void }) {
  const [status, setStatus] = useState<BackupStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exported, setExported] = useState<BackupExportResult>();
  const [preview, setPreview] = useState<RestorePreview>();
  const [mode, setMode] = useState<'replace' | 'copy' | 'images'>('copy');
  const [phrase, setPhrase] = useState('');
  const [done, setDone] = useState('');
  const token = useRef<string | undefined>(undefined);
  useEffect(() => {
    void window.desktop.getBackupStatus().then(result => { if (result.ok) setStatus(result.value); }).catch(() => undefined);
    // Closing the dialog discards a backup that was checked but not applied.
    return () => { if (token.current) void window.desktop.discardBackup({ token: token.current }).catch(() => undefined); };
  }, []);
  async function run<T>(task: () => Promise<T>) {
    if (busy) return; setBusy(true); setError('');
    try { await task(); } catch { setError('작업 결과를 확인하지 못했습니다. 데이터 폴더를 확인해 주세요.'); } finally { setBusy(false); }
  }
  const exportZip = () => run(async () => {
    const result = await window.desktop.exportBackup();
    if (!result.ok) { setError(result.error); return; }
    if (!result.value.canceled) setExported(result.value);
  });
  const open = () => run(async () => {
    if (token.current) { await window.desktop.discardBackup({ token: token.current }); token.current = undefined; setPreview(undefined); }
    const result = await window.desktop.inspectBackup();
    if (!result.ok) { setError(result.error); return; }
    if (result.value.canceled) return;
    token.current = result.value.token; setPreview(result.value); setDone(''); setPhrase('');
    setMode(result.value.current.cards === 0 && result.value.current.characters === 0 ? 'replace' : 'copy');
  });
  const cancel = () => run(async () => { if (token.current) await window.desktop.discardBackup({ token: token.current }); token.current = undefined; setPreview(undefined); });
  const apply = () => run(async () => {
    if (!preview) return;
    const result = await window.desktop.applyBackup({ token: preview.token, mode, confirmed: true });
    if (!result.ok) { setError(result.error); return; }
    token.current = undefined; setPreview(undefined);
    if (result.value.mode === 'copy') { onLibrary(result.value.library); setDone(`카드 ${result.value.added}장을 새로 추가했습니다 (이미지 ${result.value.images}개, 새 태그 ${result.value.tagsCreated}개). 자원 연결은 카드 사용 규칙에서 다시 지정해 주세요.`); }
    else if (result.value.mode === 'images') {
      onLibrary(result.value.library);
      setDone(`원본 이미지를 카드 ${result.value.recovered}장에 다시 연결했습니다. 아직 원본을 찾지 못한 카드 ${result.value.remaining}장.`);
    } else setDone('앱을 다시 시작해 복원을 마칩니다. 이전 데이터는 앱 데이터 폴더의 backups 안에 보존됩니다.');
  });
  const canApply = !!preview && !busy && (mode === 'images' || (mode === 'copy' ? preview.backup.counts.cards > 0 : phrase.trim() === '복원'));

  return <Modal title="데이터 백업·복원" wide onClose={onClose}>
    <div className="backup-manager">
      <section className="backup-section" aria-labelledby="backup-export-title">
        <h3 id="backup-export-title">백업 내보내기</h3>
        <p className="muted">카드·이미지 원본·캐릭터·덱·자원·사용 기록·설정을 ZIP 파일 하나로 저장합니다. 앱을 쓰는 중에도 일관된 시점으로 저장하며 원본 이미지는 그대로 들어갑니다.</p>
        <div className="batch-actions"><button className="primary" disabled={busy} onClick={() => void exportZip()}>ZIP으로 내보내기…</button></div>
        {exported && <p role="status" className="backup-result">저장했습니다: <strong>{exported.path}</strong> · {megabytes(exported.bytes)} · 파일 {exported.files}개 · 카드 {exported.counts.cards}장{exported.warnings.length ? ` · 참고: ${exported.warnings.join(' / ')}` : ''}</p>}
      </section>

      <section className="backup-section" aria-labelledby="backup-auto-title">
        <h3 id="backup-auto-title">자동 백업</h3>
        <p className="muted">앱을 시작할 때 하루에 한 번 데이터베이스 스냅샷을 만들고 최근 14개를 보관합니다. 이미지는 가져온 뒤 바뀌지 않는 원본으로 보존됩니다.</p>
        <dl className="backup-facts">
          <div><dt>마지막 자동 백업</dt><dd>{when(status?.lastAutoBackup)}</dd></div>
          <div><dt>보관 중</dt><dd>{status ? `${status.autoBackups}개` : '확인 중…'}</dd></div>
          <div><dt>보관 위치</dt><dd className="backup-path">{status?.autoBackupFolder ?? '…'}</dd></div>
        </dl>
      </section>

      <section className="backup-section" aria-labelledby="backup-restore-title">
        <h3 id="backup-restore-title">백업에서 복원</h3>
        <p className="muted">파일을 고르면 먼저 형식·경로·해시·데이터베이스를 검사하고 미리보기를 보여 줍니다. 확인하기 전에는 아무것도 바뀌지 않습니다.</p>
        <div className="batch-actions"><button disabled={busy} onClick={() => void open()}>백업 파일 열기…</button></div>
        {preview && <div className="restore-preview" aria-label="복원 미리보기">
          <p><strong>{preview.fileName}</strong> · {when(preview.backup.createdAt)} · 앱 {preview.backup.appVersion} · 스키마 v{preview.backup.schemaVersion} · {megabytes(preview.backup.totalBytes)}</p>
          <table className="backup-compare"><thead><tr><th scope="col">항목</th><th scope="col">백업</th><th scope="col">현재</th></tr></thead>
            <tbody>{ROWS.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{preview.backup.counts[key]}</td><td>{preview.current[key]}</td></tr>)}</tbody></table>
          <ul className="restore-checks">{preview.checks.map(check => <li key={check}>{check}</li>)}</ul>
          {preview.warnings.length > 0 && <ul className="restore-warnings">{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          {preview.sharedCardIds > 0 && <p className="muted">현재 라이브러리와 같은 카드 {preview.sharedCardIds}장이 들어 있습니다. 이 라이브러리의 이전 백업으로 보입니다.</p>}
          <fieldset className="restore-mode"><legend>복원 방식</legend>
            <label><input type="radio" name="restore-mode" checked={mode === 'images'} onChange={() => setMode('images')}/><span><strong>끊어진 원본 이미지만 복구</strong><small>내용이 정확히 일치하는 원본을 찾아 카드에 다시 연결합니다. 현재 카드, 덱, 자원 및 사용 기록은 그대로 유지합니다.</small></span></label>
            <label><input type="radio" name="restore-mode" checked={mode === 'copy'} onChange={() => setMode('copy')}/><span><strong>카드만 새로 복제해 추가</strong><small>현재 데이터는 그대로 두고 백업의 카드 {preview.backup.counts.cards}장을 이미지·태그와 함께 새 카드로 추가합니다.{preview.duplicateNames ? ` 이름이 같은 카드 ${preview.duplicateNames}장은 두 장이 됩니다.` : ''} 캐릭터·덱·자원·기록은 가져오지 않습니다.</small></span></label>
            <label><input type="radio" name="restore-mode" checked={mode === 'replace'} onChange={() => setMode('replace')}/><span><strong>현재 데이터를 백업으로 교체</strong><small>현재 데이터는 지우지 않고 앱 데이터 폴더의 backups/replaced-… 폴더로 옮겨 보존한 뒤, 앱을 다시 시작하며 백업 내용으로 바꿉니다.</small></span></label>
          </fieldset>
          {mode === 'replace' && <label className="form-field">교체하려면 <strong>복원</strong>을 입력하세요<input value={phrase} onChange={event => setPhrase(event.target.value)} aria-label="교체 확인 문구"/></label>}
          <div className="modal-actions"><button disabled={busy} onClick={() => void cancel()}>취소</button><button className={mode === 'replace' ? 'danger' : 'primary'} disabled={!canApply} onClick={() => void apply()}>{mode === 'replace' ? '교체하고 다시 시작' : mode === 'images' ? '이미지 복구' : '카드 추가'}</button></div>
        </div>}
        {done && <p role="status" className="backup-result">{done}</p>}
      </section>
      {error && <p role="alert" className="error-banner">{error}</p>}
      {status && <p className="muted backup-path">앱 데이터 폴더: {status.dataPath}</p>}
    </div>
  </Modal>;
}
