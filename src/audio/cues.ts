import { EVENT_IMPORTANCE, type EventImportance } from '../sim/eventMetadata';
import type { EventKey, PlanetEvent } from '../sim/events';

export type CueKind = 'impact' | 'eruption' | 'loss' | 'life' | 'milestone' | 'warning' | 'victory';

export interface CueParameters {
  kind: CueKind;
  startHz: number;
  endHz: number;
  duration: number;
  waveform: OscillatorType;
  importance: EventImportance;
}

const CUE_KEYS: Record<CueKind, readonly EventKey[]> = {
  impact: ['impact', 'meteor', 'iceMeteor', 'earthquake', 'tsunami', 'cyclone'],
  eruption: ['largeEruption', 'largeIgneousProvince'],
  loss: [
    'classExtinct',
    'massExtinction',
    'nuclearWar',
    'civilizationCollapsed',
    'oceansLost',
    'atmosphereLost',
    'goalLost',
    'deviceDestroyed',
    'snowballOnset',
    'trendBiodiversityLoss',
    'trendOxygenLoss',
  ],
  life: ['lifeOrigin', 'classAppeared', 'cambrianExplosion', 'sentience', 'greatOxidation'],
  milestone: [
    'ageReached',
    'fossilFuelsRunningOut',
    'energyTransition',
    'exodus',
    'runawayEnded',
    'magneticFieldLost',
    'stagnantLid',
    'monolith',
    'eraReached',
    'snowballEnded',
  ],
  warning: [
    'plague',
    'pollutionCrisis',
    'runawayGreenhouse',
    'runawayWarning',
    'methaneRelease',
    'drought',
    'trendRunaway',
    'trendSnowball',
    'trendCo2Starvation',
    'trendFossilLow',
    'trendPollution',
    'disasterWarning',
  ],
  victory: ['goalWon'],
};

const CUE_SHAPES: Record<CueKind, Omit<CueParameters, 'kind' | 'importance'>> = {
  impact: { startHz: 130, endHz: 42, duration: 0.55, waveform: 'sine' },
  eruption: { startHz: 95, endHz: 58, duration: 0.8, waveform: 'sawtooth' },
  loss: { startHz: 330, endHz: 110, duration: 0.8, waveform: 'triangle' },
  life: { startHz: 330, endHz: 660, duration: 0.65, waveform: 'sine' },
  milestone: { startHz: 440, endHz: 554.37, duration: 0.5, waveform: 'triangle' },
  warning: { startHz: 240, endHz: 180, duration: 0.48, waveform: 'square' },
  victory: { startHz: 440, endHz: 880, duration: 1.1, waveform: 'triangle' },
};

const KIND_BY_KEY = Object.fromEntries(
  Object.entries(CUE_KEYS).flatMap(([kind, keys]) => keys.map((key) => [key, kind])),
) as Partial<Record<EventKey, CueKind>>;

/** Maps the toast event importance table to a compact family of synthesized cues. */
export function cueForEvent(event: PlanetEvent): CueParameters | null {
  const importance = EVENT_IMPORTANCE[event.key];
  if (importance === 'minor') return null;
  const kind = KIND_BY_KEY[event.key] ?? 'milestone';
  return { kind, importance, ...CUE_SHAPES[kind] };
}
