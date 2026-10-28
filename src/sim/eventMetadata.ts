import type { EventKey, PlanetEvent } from './events';

export type EventImportance = 'minor' | 'important' | 'critical';

/**
 * Presentation importance for every saved event kind. Minor events remain in
 * the history log; important and critical events may also become notifications.
 */
export const EVENT_IMPORTANCE = {
  lifeOrigin: 'critical',
  impact: 'important',
  classAppeared: 'minor',
  classExtinct: 'important',
  massExtinction: 'critical',
  cambrianExplosion: 'critical',
  sentience: 'critical',
  ageReached: 'important',
  plague: 'important',
  nuclearWar: 'critical',
  fossilFuelsRunningOut: 'important',
  energyTransition: 'important',
  pollutionCrisis: 'critical',
  civilizationCollapsed: 'critical',
  exodus: 'critical',
  meteor: 'important',
  largeEruption: 'important',
  largeIgneousProvince: 'important',
  runawayGreenhouse: 'critical',
  runawayWarning: 'critical',
  runawayEnded: 'important',
  oceansLost: 'critical',
  magneticFieldLost: 'important',
  stagnantLid: 'important',
  atmosphereLost: 'critical',
  methaneRelease: 'important',
  monolith: 'important',
  eraReached: 'critical',
  goalWon: 'critical',
  goalLost: 'critical',
  deviceDestroyed: 'important',
  iceMeteor: 'important',
  earthquake: 'important',
  tsunami: 'important',
  cyclone: 'important',
  drought: 'important',
  greatOxidation: 'critical',
  snowballOnset: 'critical',
  snowballEnded: 'important',
  trendRunaway: 'critical',
  trendSnowball: 'important',
  trendCo2Starvation: 'important',
  trendOxygenLoss: 'important',
  trendBiodiversityLoss: 'important',
  trendFossilLow: 'important',
  trendPollution: 'important',
  disasterWarning: 'important',
} as const satisfies Record<EventKey, EventImportance>;

export function isToastEvent(event: PlanetEvent): boolean {
  return EVENT_IMPORTANCE[event.key] !== 'minor';
}
