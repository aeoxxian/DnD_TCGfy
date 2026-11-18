/**
 * v1.2: momentum for the hand after a mouse drag. Pure helpers so the numbers can be tested;
 * HandSurface drives them with requestAnimationFrame and writes scrollLeft directly.
 */
export const INERTIA = {
  /** Pointer samples (ms) used for the release velocity. */
  window: 100,
  /** A pointer that rested this long (ms) before release has no momentum. */
  stale: 80,
  /** Slower releases (px/ms, = 350 px/s) stop at once, as before. */
  minVelocity: 0.35,
  /** Fastest glide start (px/ms). */
  maxVelocity: 4,
  /** Exponential decay time constant (ms): the glide covers ~63% of its distance in this time. */
  timeConstant: 325,
  /** Longest glide (px), also limited to this many hand widths. */
  maxDistance: 1400,
  widthFactor: 1.25,
  /** A press while the glide is still faster than this (px/ms) only stops it (no card selection). */
  catchVelocity: 0.1,
  /** The glide ends once less than this many px remain. */
  restDistance: 1,
};

export interface PointerSample { t: number; x: number }

/** Pointer velocity in px/ms (+ = moving right) over the last samples before release; 0 if it had stopped. */
export function releaseVelocity(samples: PointerSample[], releaseAt: number): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (releaseAt - last.t > INERTIA.stale) return 0;
  let first = samples.find(sample => last.t - sample.t <= INERTIA.window) ?? last;
  if (first === last) first = samples[samples.length - 2];
  const elapsed = last.t - first.t;
  if (elapsed <= 0 || elapsed > INERTIA.window * 2) return 0;
  return (last.x - first.x) / elapsed;
}

/** How far the hand keeps scrolling (px, + = scrollLeft grows) after a release; 0 means stop now. */
export function glideDistance(pointerVelocity: number, viewportWidth: number): number {
  const scrollVelocity = -pointerVelocity; // dragging the cards left reveals the cards to the right
  if (!Number.isFinite(scrollVelocity) || Math.abs(scrollVelocity) < INERTIA.minVelocity) return 0;
  const speed = Math.min(Math.abs(scrollVelocity), INERTIA.maxVelocity);
  const limit = Math.min(INERTIA.maxDistance, Math.max(0, viewportWidth) * INERTIA.widthFactor);
  return Math.sign(scrollVelocity) * Math.min(speed * INERTIA.timeConstant, limit);
}

/** Distance already covered `elapsed` ms into a glide (eases out towards `distance`). */
export function glideOffset(distance: number, elapsed: number): number {
  return distance * (1 - Math.exp(-Math.max(0, elapsed) / INERTIA.timeConstant));
}
/** Current glide speed (px/ms). */
export function glideSpeed(distance: number, elapsed: number): number {
  return Math.abs(distance) / INERTIA.timeConstant * Math.exp(-Math.max(0, elapsed) / INERTIA.timeConstant);
}
/** Distance still to go (px). */
export function glideRemaining(distance: number, elapsed: number): number {
  return Math.abs(distance) * Math.exp(-Math.max(0, elapsed) / INERTIA.timeConstant);
}
