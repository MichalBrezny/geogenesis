import type { PlanetState } from './core/planet';
import { nearestActiveCity } from './models/civilization/cities';

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
  /** Nearest inhabited city at the time of a located event. */
  detail?: string;
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
  | 'fossilFuelsRunningOut'
  | 'energyTransition'
  | 'pollutionCrisis'
  | 'civilizationCollapsed'
  | 'exodus'
  | 'meteor'
  | 'largeEruption'
  | 'largeIgneousProvince'
  | 'runawayGreenhouse'
  | 'runawayWarning'
  | 'runawayEnded'
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
  | 'drought'
  | 'greatOxidation'
  | 'snowballOnset'
  | 'snowballEnded'
  | 'trendRunaway'
  | 'trendSnowball'
  | 'trendCo2Starvation'
  | 'trendOxygenLoss'
  | 'trendBiodiversityLoss'
  | 'trendFossilLow'
  | 'trendPollution'
  | 'disasterWarning';

/** Only the most recent events are kept. */
export const MAX_EVENTS = 100;

export function recordEvent(
  state: PlanetState,
  key: EventKey,
  subject?: string,
  year = state.globals.year,
  cell?: number,
): void {
  const detail =
    cell !== undefined && cell >= 0 && cell < state.grid.cellCount
      ? nearestActiveCity(state, cell)?.name
      : undefined;
  state.events.push({
    year,
    key,
    subject,
    ...(cell === undefined ? {} : { cell }),
    ...(detail === undefined ? {} : { detail }),
  });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}
