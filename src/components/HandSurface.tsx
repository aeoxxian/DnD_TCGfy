import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function HandSurface({ mode, children }: { mode: 'hand' | 'grid'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef({ pointerId: -1, x: 0, scroll: 0, dragging: false, suppress: false });
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('.card-button'));
    const entry = buttons.find(button => button === document.activeElement) ?? buttons.find(button => button.tabIndex === 0) ?? buttons[0];
    for (const button of buttons) button.tabIndex = button === entry ? 0 : -1;
  }, [children]);
  useEffect(() => {
    const element = ref.current!;
    if (mode !== 'hand') return;
    function wheel(event: WheelEvent) {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || element.scrollWidth <= element.clientWidth) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? element.clientWidth * .7 : 1);
      const next = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + Math.max(-180, Math.min(180, delta))));
      if (next !== element.scrollLeft) { event.preventDefault(); element.scrollLeft = next; }
    }
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [mode]);
  function finish(pointerId: number) {
    if (gesture.current.pointerId !== pointerId) return;
    gesture.current.pointerId = -1; gesture.current.dragging = false; setDragging(false);
    if (ref.current?.hasPointerCapture(pointerId)) ref.current.releasePointerCapture(pointerId);
    setTimeout(() => { gesture.current.suppress = false; }, 0);
  }
  return <div ref={ref} className={`cards-area ${mode} ${dragging ? 'is-dragging' : ''}`} aria-label="카드 목록" aria-describedby="card-navigation-help"
    onFocusCapture={event => {
      if (!(event.target instanceof HTMLButtonElement) || !event.target.matches('.card-button')) return;
      for (const button of event.currentTarget.querySelectorAll<HTMLButtonElement>('.card-button')) button.tabIndex = button === event.target ? 0 : -1;
    }}
    onKeyDown={event => {
      if (!(event.target instanceof HTMLButtonElement) || !event.target.matches('.card-button') || event.altKey || event.ctrlKey || event.metaKey) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.card-button'));
      const index = buttons.indexOf(event.target);
      const next = event.key === 'ArrowRight' ? Math.min(index + 1, buttons.length - 1) : event.key === 'ArrowLeft' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined;
      if (next === undefined) return;
      event.preventDefault(); buttons[next]?.focus({ preventScroll: true });
      buttons[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }}
    onDragStart={event => event.preventDefault()}
    onPointerDown={event => {
      if (mode !== 'hand' || event.button !== 0 || event.pointerType !== 'mouse') return;
      gesture.current = { pointerId: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft, dragging: false, suppress: false };
    }}
    onPointerMove={event => {
      const g = gesture.current;
      if (mode !== 'hand' || g.pointerId !== event.pointerId) return;
      const delta = event.clientX - g.x;
      if (!g.dragging && Math.abs(delta) >= 6) { g.dragging = true; g.suppress = true; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }
      if (g.dragging) { event.preventDefault(); event.currentTarget.scrollLeft = g.scroll - delta; }
    }}
    onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)} onLostPointerCapture={event => finish(event.pointerId)}
    // A drag is never a click, so it can never count as re-clicking the selected card (v1.1: re-click enlarges).
    onClickCapture={event => { if (gesture.current.suppress) { event.preventDefault(); event.stopPropagation(); gesture.current.suppress = false; } }}>
    {children}
  </div>;
}
