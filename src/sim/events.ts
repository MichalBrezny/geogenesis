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
  /** Grid cell where the event happened; absent for global events and old saves. */
  cell?: number;
}

export type EventKey =
  | 'lifeOrigin'
  | 'impact'
  | 'classAppeared'
  | 'classExtinct'
  | 'massExtinction'
  | 'cambrianExplosion'
  | 'sentience'
  | 'ageReached'
  | 'plague'
  | 'nuclearWar'
  | 'civilizationCollapsed'
  | 'exodus'
  | 'meteor'
  | 'largeEruption'
  | 'largeIgneousProvince'
  | 'runawayGreenhouse'
  | 'oceansLost'
  | 'magneticFieldLost'
  | 'stagnantLid'
  | 'atmosphereLost'
  | 'methaneRelease'
  | 'monolith'
  | 'eraReached'
  | 'goalWon'
  | 'goalLost'
  | 'deviceDestroyed'
  | 'iceMeteor'
  | 'earthquake'
  | 'tsunami'
  | 'cyclone'
  | 'drought';

/** Only the most recent events are kept. */
export const MAX_EVENTS = 100;

export function recordEvent(
  state: PlanetState,
  key: EventKey,
  subject?: string,
  year = state.globals.year,
  cell?: number,
): void {
  state.events.push({ year, key, subject, ...(cell === undefined ? {} : { cell }) });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}
