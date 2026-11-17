import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import type { CardDefinition } from '../shared/contracts';
import { imageUrl } from './CardFace';

const DURATION = 220;
const MAX_TILT = 6;
const BACKDROP_CLEAR = 'rgba(4, 3, 2, 0)';

/** App "모션 줄이기" or the Windows reduced-motion setting turns every transition off. */
export function motionAllowed(): boolean {
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return false;
  if (document.querySelector('.app.reduced-motion')) return false;
  try { return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}
/** Translate + uniform scale that puts `box` (laid out at `to`) over `from`, keeping the image ratio. */
function placeOver(from: DOMRect, to: DOMRect): string {
  const scale = to.width && to.height ? Math.min(from.width / to.width, from.height / to.height) : 1;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

/**
 * Full-screen original view. With motion it grows out of `origin` (the hand card or IN PLAY preview) and shrinks back
 * into it on close; the optional tilt leans only the image, while the untilted frame decides what counts as "outside".
 */
export function ImageLightbox({ card, onClose, label, origin, tilt = false }: { card: CardDefinition; onClose: () => void; label?: string; origin?: Element | null; tilt?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const outside = useRef(false);
  const state = useRef<{ played: boolean; settled: boolean; closing: boolean; animate: boolean }>({ played: false, settled: false, closing: false, animate: false });
  const help = useId();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current!;
    state.current.animate = motionAllowed();
    dialog.showModal(); dialog.focus({ preventScroll: true });
    if (image.current?.complete && image.current.naturalWidth) open();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      else document.getElementById('card-name-search')?.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per opening
  }, []);
  function originRect(): DOMRect | undefined {
    if (!origin?.isConnected) return undefined;
    const r = origin.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth ? r : undefined;
  }
  function open() {
    const s = state.current; if (s.played) return; s.played = true;
    const box = frame.current, dialog = ref.current;
    if (!s.animate || !box || !dialog) { s.settled = true; return; }
    const to = box.getBoundingClientRect(); const from = originRect();
    dialog.animate([{ backgroundColor: BACKDROP_CLEAR }, { backgroundColor: getComputedStyle(dialog).backgroundColor }], { duration: DURATION, easing: 'ease-out' });
    box.animate(from ? [{ transform: placeOver(from, to), opacity: .7 }, { transform: 'none', opacity: 1 }] : [{ transform: 'scale(.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: DURATION, easing: 'cubic-bezier(.2, .8, .2, 1)' })
      .finished.then(() => { s.settled = true; }, () => undefined);
  }
  function close() {
    const s = state.current; if (s.closing) return; resetTilt();
    const box = frame.current, dialog = ref.current;
    if (!s.animate || !box || !dialog) { onClose(); return; }
    // Repeated close requests (ESC, clicks) during the shrink are ignored.
    s.closing = true; s.settled = false;
    // Continue from wherever an unfinished opening left the card.
    const current = box.getBoundingClientRect();
    for (const animation of [...box.getAnimations(), ...dialog.getAnimations()]) animation.cancel();
    const to = box.getBoundingClientRect(); const from = originRect();
    dialog.animate([{ backgroundColor: getComputedStyle(dialog).backgroundColor }, { backgroundColor: BACKDROP_CLEAR }], { duration: DURATION, easing: 'ease-in', fill: 'forwards' });
    box.animate([{ transform: placeOver(current, to), opacity: 1 }, { transform: from ? placeOver(from, to) : 'scale(.94)', opacity: from ? .7 : 0 }], { duration: DURATION, easing: 'cubic-bezier(.4, 0, .6, 1)', fill: 'forwards' })
      .finished.then(onClose, onClose);
  }
  function lean(event: PointerEvent<HTMLDivElement>) {
    const s = state.current;
    if (!tilt || !s.animate || !s.settled || s.closing || event.pointerType === 'touch' || !image.current) return;
    const r = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-.5, Math.min(.5, (event.clientX - r.left) / r.width - .5));
    const y = Math.max(-.5, Math.min(.5, (event.clientY - r.top) / r.height - .5));
    image.current.style.transform = `perspective(1400px) rotateX(${(-y * 2 * MAX_TILT).toFixed(2)}deg) rotateY(${(x * 2 * MAX_TILT).toFixed(2)}deg)`;
  }
  function resetTilt() { if (image.current) image.current.style.transform = ''; }
  return <dialog ref={ref} className="image-lightbox" tabIndex={-1} aria-modal="true" aria-label={label ?? `${card.name} 원본 보기`} aria-describedby={help}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onPointerDown={event => { outside.current = event.target === event.currentTarget; }}
    onClick={event => { if (event.target === event.currentTarget && (event.detail === 0 || outside.current)) close(); }}>
    <p id={help} className="sr-only">{card.name} 확대 화면. 카드 밖을 클릭하거나 Escape를 눌러 돌아갑니다.</p>
    {card.imageAssetId && !failed
      ? <div ref={frame} className={`lightbox-card ${tilt ? 'can-tilt' : ''}`} onPointerMove={lean} onPointerLeave={resetTilt}>
          <img ref={image} src={imageUrl(card.imageAssetId)} alt={`${card.name} 원본 확대`} draggable={false} onLoad={open} onError={() => { setFailed(true); state.current.settled = true; }}/>
        </div>
      : <p role="alert">원본 이미지를 읽을 수 없습니다. 카드 정보는 보존됩니다. ESC로 돌아가세요.</p>}
  </dialog>;
}
