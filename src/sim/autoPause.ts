import type { EventKey, PlanetEvent } from './events';

export const AUTO_PAUSE_KEYS = [
  'era',
  'firstLife',
  'greatOxidation',
  'snowball',
  'massExtinction',
  'cambrianExplosion',
  'sentience',
  'techAge',
  'runawayWarning',
  'goalOutcome',
] as const;

export type AutoPauseKey = (typeof AUTO_PAUSE_KEYS)[number];
export type AutoPauseSettings = Record<AutoPauseKey, boolean>;

export const DEFAULT_AUTO_PAUSE: Readonly<AutoPauseSettings> = {
  era: true,
  firstLife: true,
  greatOxidation: true,
  snowball: true,
  massExtinction: true,
  cambrianExplosion: true,
  sentience: true,
  techAge: true,
  runawayWarning: true,
  goalOutcome: true,
};

const EVENT_SETTING: Partial<Record<EventKey, AutoPauseKey>> = {
  eraReached: 'era',
  lifeOrigin: 'firstLife',
  greatOxidation: 'greatOxidation',
  snowballOnset: 'snowball',
  snowballEnded: 'snowball',
  massExtinction: 'massExtinction',
  cambrianExplosion: 'cambrianExplosion',
  sentience: 'sentience',
  ageReached: 'techAge',
  runawayWarning: 'runawayWarning',
  trendRunaway: 'runawayWarning',
  goalWon: 'goalOutcome',
  goalLost: 'goalOutcome',
};

export function autoPauseEvent(
  events: readonly PlanetEvent[],
  settings: Readonly<AutoPauseSettings>,
): PlanetEvent | undefined {
  return events.find((event) => {
    const setting = EVENT_SETTING[event.key];
    return setting !== undefined && settings[setting];
  });
}
