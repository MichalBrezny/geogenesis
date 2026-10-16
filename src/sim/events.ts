import type { PlanetState } from './core/planet';

/**
 * Notable moments in the planet's history, for the event log. `key` selects
 * the message (`event.<key>` in the UI strings) and `subject` fills it in
 * (e.g. a life class key or a tech age key).
 */
export interface PlanetEvent {
  year: number;
  key: EventKey;
  subject?: string;
}

export type EventKey =
  | 'classAppeared'
  | 'classExtinct'
  | 'sentience'
  | 'ageReached'
  | 'plague'
  | 'nuclearWar'
  | 'civilizationCollapsed'
  | 'exodus'
  | 'meteor'
  | 'monolith';

/** Only the most recent events are kept. */
export const MAX_EVENTS = 100;

export function recordEvent(state: PlanetState, key: EventKey, subject?: string): void {
  state.events.push({ year: state.globals.year, key, subject });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}
