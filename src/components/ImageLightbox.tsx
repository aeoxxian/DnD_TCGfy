import { useEffect, useId, useRef, useState } from 'react';
import type { CardDefinition } from '../shared/contracts';
import { imageUrl } from './CardFace';

export function ImageLightbox({ card, onClose, label }: { card: CardDefinition; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const outside = useRef(false);
  const help = useId();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current!;
    dialog.showModal(); dialog.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      else document.getElementById('card-name-search')?.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="image-lightbox" tabIndex={-1} aria-modal="true" aria-label={label ?? `${card.name} 원본 보기`} aria-describedby={help}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onPointerDown={event => { outside.current = event.target === event.currentTarget; }}
    onClick={event => { if (event.target === event.currentTarget && (event.detail === 0 || outside.current)) onClose(); }}>
    <p id={help} className="sr-only">{card.name} 확대 화면. 카드 밖을 클릭하거나 Escape를 눌러 돌아갑니다.</p>
    {card.imageAssetId && !failed ? <img src={imageUrl(card.imageAssetId)} alt={`${card.name} 원본 확대`} draggable={false} onError={() => setFailed(true)}/> : <p role="alert">원본 이미지를 읽을 수 없습니다. 카드 정보는 보존됩니다. ESC로 돌아가세요.</p>}
  </dialog>;
}
