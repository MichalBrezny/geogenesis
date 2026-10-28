import { isToastEvent } from '../sim/eventMetadata';
import type { PlanetEvent } from '../sim/events';

export const TOAST_DURATION_MS = 8_000;
export const TOAST_REPEAT_WINDOW_MS = 15_000;

export interface EventToast {
  id: number;
  event: PlanetEvent;
  count: number;
  updatedAt: number;
  expiresAt: number;
}

let nextToastId = 1;

function sameRepeat(a: PlanetEvent, b: PlanetEvent): boolean {
  return a.key === b.key && a.subject === b.subject;
}

export function mergeToastEvents(
  current: readonly EventToast[],
  events: readonly PlanetEvent[],
  now: number,
): EventToast[] {
  const next = current.filter((toast) => toast.expiresAt > now).map((toast) => ({ ...toast }));
  for (const event of events) {
    if (!isToastEvent(event)) continue;
    const repeated = [...next]
      .reverse()
      .find(
        (toast) =>
          sameRepeat(toast.event, event) && now - toast.updatedAt <= TOAST_REPEAT_WINDOW_MS,
      );
    if (repeated) {
      repeated.event = event;
      repeated.count++;
      repeated.updatedAt = now;
      repeated.expiresAt = now + TOAST_DURATION_MS;
    } else {
      next.push({
        id: nextToastId++,
        event,
        count: 1,
        updatedAt: now,
        expiresAt: now + TOAST_DURATION_MS,
      });
    }
  }
  return next.slice(-5);
}

export function eventSignature(event: PlanetEvent): string {
  return `${event.year}|${event.key}|${event.subject ?? ''}|${event.cell ?? ''}`;
}

export function eventsAfter(
  events: readonly PlanetEvent[],
  previousSignature: string | undefined,
): PlanetEvent[] {
  if (previousSignature === undefined) return [];
  for (let i = events.length - 1; i >= 0; i--) {
    if (eventSignature(events[i]!) === previousSignature) return Array.from(events.slice(i + 1));
  }
  return Array.from(events);
}
