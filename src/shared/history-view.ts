import type { HistoryView } from './contracts';
import type { ResourceEvent } from './resources';

/**
 * Recent actions shown in the resource panel. `events` is newest-first and play events are append-only
 * (Undo adds a record), so a "hidden through" mark is enough: everything newer than the marked event shows.
 * When the marked event is outside the loaded window (or gone, e.g. after restoring an older backup),
 * fall back to its timestamp.
 */
export function visibleHistory(events: ResourceEvent[], view?: HistoryView): ResourceEvent[] {
  if (!view) return events;
  const index = events.findIndex(event => event.id === view.clearedEventId);
  if (index >= 0) return events.slice(0, index);
  return events.filter(event => event.timestamp > view.clearedAt);
}

/** The mark for "hide everything shown now"; undefined when there is nothing to hide. */
export function historyMark(events: ResourceEvent[]): HistoryView | undefined {
  const newest = events[0];
  return newest ? { clearedEventId: newest.id, clearedAt: new Date(newest.timestamp).toISOString() } : undefined;
}
