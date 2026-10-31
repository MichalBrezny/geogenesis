import type { EventKey, PlanetEvent } from '../sim/events';

export const EVENT_CATEGORIES = [
  'impacts',
  'volcanism',
  'disasters',
  'life',
  'civilization',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

const CATEGORY: Partial<Record<EventKey, EventCategory>> = {
  impact: 'impacts',
  meteor: 'impacts',
  iceMeteor: 'impacts',
  largeEruption: 'volcanism',
  largeIgneousProvince: 'volcanism',
  earthquake: 'disasters',
  tsunami: 'disasters',
  cyclone: 'disasters',
  drought: 'disasters',
  disasterWarning: 'disasters',
  lifeOrigin: 'life',
  classAppeared: 'life',
  classExtinct: 'life',
  massExtinction: 'life',
  cambrianExplosion: 'life',
  methaneRelease: 'life',
  greatOxidation: 'life',
  snowballOnset: 'life',
  snowballEnded: 'life',
  trendSnowball: 'life',
  trendCo2Starvation: 'life',
  trendOxygenLoss: 'life',
  trendBiodiversityLoss: 'life',
  sentience: 'civilization',
  ageReached: 'civilization',
  plague: 'civilization',
  nuclearWar: 'civilization',
  fossilFuelsRunningOut: 'civilization',
  energyTransition: 'civilization',
  pollutionCrisis: 'civilization',
  civilizationCollapsed: 'civilization',
  exodusPopulationTooLow: 'civilization',
  exodus: 'civilization',
  monolith: 'civilization',
  eraReached: 'civilization',
  goalWon: 'civilization',
  goalLost: 'civilization',
  deviceDestroyed: 'civilization',
  trendFossilLow: 'civilization',
  trendPollution: 'civilization',
};

export function eventCategory(key: EventKey): EventCategory | undefined {
  return CATEGORY[key];
}

/** Located log entries in enabled categories, retaining chronological order. */
export function filterMapEvents(
  events: readonly PlanetEvent[],
  enabled: ReadonlySet<EventCategory>,
): PlanetEvent[] {
  return events.filter((event) => {
    const category = eventCategory(event.key);
    return event.cell !== undefined && category !== undefined && enabled.has(category);
  });
}
