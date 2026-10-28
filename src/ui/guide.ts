import type { MapLayer } from '../render/mapRenderer';
import type { MessageKey } from '../i18n/i18n';
import type { ChartSeries } from './charts/HistoryCharts';
import type { GlossaryTerm } from './glossary';

export const GUIDE_PAGE_IDS = [
  'geosphere',
  'climate',
  'atmosphereWater',
  'carbon',
  'oceans',
  'life',
  'turningPoints',
  'civilization',
  'disasters',
  'goals',
] as const;

export type GuidePageId = (typeof GUIDE_PAGE_IDS)[number];

export interface GuidePage {
  id: GuidePageId;
  layers: readonly MapLayer[];
  charts: readonly ChartSeries[];
  terms: readonly GlossaryTerm[];
}

export const GUIDE_PAGES: readonly GuidePage[] = [
  {
    id: 'geosphere',
    layers: ['terrain', 'plates', 'volcanism'],
    charts: ['landFraction', 'seaLevel'],
    terms: ['outgassing', 'weathering', 'plate tectonics'],
  },
  {
    id: 'climate',
    layers: ['airTemperature', 'seasons', 'clouds'],
    charts: ['meanTemperature', 'iceFraction', 'runawayMargin'],
    terms: ['albedo', 'Hadley cell', 'ITCZ', 'runaway greenhouse'],
  },
  {
    id: 'atmosphereWater',
    layers: ['pressure', 'precipitation', 'clouds'],
    charts: ['surfacePressure', 'water', 'o2'],
    terms: ['partial pressure', 'water vapour', 'biosignature'],
  },
  {
    id: 'carbon',
    layers: ['volcanism', 'biomes'],
    charts: ['co2', 'carbonOutgassing', 'carbonWeathering'],
    terms: ['outgassing', 'weathering', 'clathrate'],
  },
  {
    id: 'oceans',
    layers: ['oceanCurrents', 'oceanOxygen', 'nutrients'],
    charts: ['meanOceanOxygen', 'oceanAcidity', 'seaLevel'],
    terms: ['upwelling', 'anoxia', 'GEL'],
  },
  {
    id: 'life',
    layers: ['biomes', 'life', 'diversity'],
    charts: ['livingClasses', 'biodiversity', 'o2'],
    terms: ['biome', 'abiogenesis', 'sentience'],
  },
  {
    id: 'turningPoints',
    layers: ['oceanOxygen', 'clathrates', 'hazard'],
    charts: ['biodiversity', 'dust', 'oceanAcidity'],
    terms: ['Great Oxidation', 'clathrate', 'mass extinction'],
  },
  {
    id: 'civilization',
    layers: ['civilization', 'hazard'],
    charts: ['population', 'pollution', 'fossilCarbon'],
    terms: ['Ω energy', 'pollution', 'Exodus'],
  },
  {
    id: 'disasters',
    layers: ['hazard', 'volcanism'],
    charts: ['dust', 'biodiversity'],
    terms: ['aerosol', 'hazard', 'large igneous province'],
  },
  {
    id: 'goals',
    layers: ['terrain', 'life'],
    charts: ['meanTemperature', 'co2'],
    terms: ['objective', 'hold time', 'score'],
  },
] as const;

export type TourAnchor = 'map' | 'time' | 'vitals' | 'windows' | 'tool' | 'era' | 'goal';

export const TOUR_ANCHORS: Record<TourAnchor, TourAnchor> = {
  map: 'map',
  time: 'time',
  vitals: 'vitals',
  windows: 'windows',
  tool: 'tool',
  era: 'era',
  goal: 'goal',
};

export const TOUR_STEPS: readonly { anchor: TourAnchor; key: MessageKey }[] = [
  { anchor: 'map', key: 'tour.step.map' },
  { anchor: 'time', key: 'tour.step.time' },
  { anchor: 'vitals', key: 'tour.step.vitals' },
  { anchor: 'windows', key: 'tour.step.windows' },
  { anchor: 'tool', key: 'tour.step.tool' },
  { anchor: 'era', key: 'tour.step.era' },
  { anchor: 'goal', key: 'tour.step.goal' },
] as const;

export const TOUR_STORAGE_KEY = 'geogenesis.firstGameGuide.complete';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function shouldStartTour(storage: StorageLike | undefined): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(TOUR_STORAGE_KEY) !== 'true';
  } catch {
    return true;
  }
}

export function rememberTourComplete(storage: StorageLike | undefined): boolean {
  if (!storage) return false;
  try {
    storage.setItem(TOUR_STORAGE_KEY, 'true');
    return true;
  } catch {
    return false;
  }
}

export function guideKey(
  id: GuidePageId,
  part: 'title' | 'summary' | 'loop' | 'controls' | 'views',
): MessageKey {
  return `guide.${id}.${part}` as MessageKey;
}
