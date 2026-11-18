import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { INERTIA, glideDistance, glideOffset, glideRemaining, glideSpeed, releaseVelocity, type PointerSample } from '../shared/hand-inertia';

function osReducedMotion(): boolean { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }

/**
 * The hand (or grid) of cards. In hand mode a mouse drag scrolls it; with `inertia` (v1.2) a fast release keeps it
 * gliding and easing out. The glide writes scrollLeft from requestAnimationFrame only (no React state), stops at the
 * ends, and any press, wheel, arrow-key move, view switch or new card list (`resetKey`) stops it at once.
 */
export function HandSurface({ mode, inertia = false, resetKey, children }: { mode: 'hand' | 'grid'; inertia?: boolean; resetKey?: unknown; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef({ pointerId: -1, x: 0, scroll: 0, dragging: false, suppress: false });
  const samples = useRef<PointerSample[]>([]);
  const glide = useRef<{ frame: number; start: number; from: number; distance: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const stopGlide = useCallback(() => {
    const current = glide.current; if (!current) return;
    cancelAnimationFrame(current.frame); glide.current = null;
    if (ref.current) delete ref.current.dataset.gliding;
  }, []);
  function startGlide(distance: number) {
    const element = ref.current; if (!element) return;
    stopGlide();
    const state = { frame: 0, start: performance.now(), from: element.scrollLeft, distance };
    const step = (now: number) => {
      if (glide.current !== state) return;
      const elapsed = now - state.start;
      const target = state.from + glideOffset(distance, elapsed);
      const max = Math.max(0, element.scrollWidth - element.clientWidth);
      const next = Math.max(0, Math.min(max, target));
      element.scrollLeft = next;
      // Stop at either end of the hand, when (almost) nothing is left, or when the hand left the page.
      if (next !== target || glideRemaining(distance, elapsed) < INERTIA.restDistance || !element.isConnected) { stopGlide(); return; }
      state.frame = requestAnimationFrame(step);
    };
    glide.current = state; element.dataset.gliding = 'true';
    state.frame = requestAnimationFrame(step);
  }
  // A new card list (filter, scope), a switch between hand and grid, turning the option off or unmounting ends a glide.
  useEffect(() => stopGlide, [resetKey, mode, inertia, stopGlide]);
  useLayoutEffect(() => {
    const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('.card-button'));
    const entry = buttons.find(button => button === document.activeElement) ?? buttons.find(button => button.tabIndex === 0) ?? buttons[0];
    for (const button of buttons) button.tabIndex = button === entry ? 0 : -1;
  }, [children]);
  useEffect(() => {
    const element = ref.current!;
    if (mode !== 'hand') return;
    function wheel(event: WheelEvent) {
      stopGlide();
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || element.scrollWidth <= element.clientWidth) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? element.clientWidth * .7 : 1);
      const next = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + Math.max(-180, Math.min(180, delta))));
      if (next !== element.scrollLeft) { event.preventDefault(); element.scrollLeft = next; }
    }
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [mode, stopGlide]);
  function finish(pointerId: number, releasedAt?: number) {
    if (gesture.current.pointerId !== pointerId) return;
    const wasDragging = gesture.current.dragging;
    gesture.current.pointerId = -1; gesture.current.dragging = false; setDragging(false);
    // Only a real release (not a cancel) of a fast drag glides; slow drags and paused pointers stop where they are.
    if (wasDragging && releasedAt !== undefined && inertia && mode === 'hand' && !osReducedMotion() && ref.current) {
      const distance = glideDistance(releaseVelocity(samples.current, releasedAt), ref.current.clientWidth);
      if (distance) startGlide(distance);
    }
    samples.current = [];
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
      stopGlide();
      event.preventDefault(); buttons[next]?.focus({ preventScroll: true });
      buttons[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }}
    onDragStart={event => event.preventDefault()}
    onPointerDown={event => {
      // Pressing while the hand still glides fast only stops it, so a moving card is never picked by accident.
      const current = glide.current;
      const caught = !!current && glideSpeed(current.distance, performance.now() - current.start) > INERTIA.catchVelocity;
      stopGlide();
      if (mode !== 'hand' || event.button !== 0 || event.pointerType !== 'mouse') return;
      gesture.current = { pointerId: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft, dragging: false, suppress: caught };
      samples.current = [{ t: event.timeStamp, x: event.clientX }];
    }}
    onPointerMove={event => {
      const g = gesture.current;
      if (mode !== 'hand' || g.pointerId !== event.pointerId) return;
      const delta = event.clientX - g.x;
      samples.current.push({ t: event.timeStamp, x: event.clientX });
      if (samples.current.length > 32) samples.current.splice(0, samples.current.length - 32);
      if (!g.dragging && Math.abs(delta) >= 6) { g.dragging = true; g.suppress = true; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }
      if (g.dragging) { event.preventDefault(); event.currentTarget.scrollLeft = g.scroll - delta; }
    }}
    onPointerUp={event => finish(event.pointerId, event.timeStamp)} onPointerCancel={event => finish(event.pointerId)} onLostPointerCapture={event => finish(event.pointerId)}
    // A drag is never a click, so it can never count as re-clicking the selected card (v1.1: re-click enlarges).
    onClickCapture={event => { if (gesture.current.suppress) { event.preventDefault(); event.stopPropagation(); gesture.current.suppress = false; } }}>
    {children}
  </div>;
}
