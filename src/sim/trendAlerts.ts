import type { SimComponent } from './core/component';
import type { PlanetState } from './core/planet';
import { LIFE_CLASSES } from './data/lifeClasses';
import { recordEvent, type EventKey } from './events';
import { oxygenPartialPressure } from './models/atmosphere/atmosphere';

export const TREND_ALERT_KEYS = [
  'runaway',
  'snowball',
  'co2Starvation',
  'oxygenLoss',
  'biodiversityLoss',
  'fossilLow',
  'pollution',
] as const;
export type TrendAlertKey = (typeof TREND_ALERT_KEYS)[number];

export interface TrendSnapshot {
  year: number;
  runawayMargin: number;
  iceFraction: number;
  co2: number;
  oxygenPressure: number;
  biodiversity: number;
  fossilCarbon: number;
  pollution: number;
}

/** Saved diagnostic memory. No physical model reads these values. */
export interface AlertDiagnostics {
  initialized: boolean;
  previous: TrendSnapshot | null;
  armed: Record<TrendAlertKey, boolean>;
  snowball: boolean;
  greatOxidationReached: boolean;
  disaster: {
    droughtArmed: boolean;
    localHazardArmed: boolean;
    volcanicArmed: boolean;
    impactArmed: boolean;
  };
}

/**
 * All thresholds live here. Trend rates use per million years except pollution,
 * whose fast civilization-scale rate is per century.
 */
export const ALERT_THRESHOLDS = {
  greatOxidationBar: 0.01,
  snowballOnset: 0.85,
  snowballEnd: 0.65,
  runaway: { danger: 30, shrinkPerMyr: 2, safe: 40 },
  snowball: { danger: 0.45, risePerMyr: 0.04, safe: 0.3 },
  co2Starvation: { danger: 200, fallPerMyr: 3, safe: 240 },
  oxygenLoss: { dangerBar: 0.055, fallBarPerMyr: 0.002, safeBar: 0.07 },
  biodiversityLoss: { fallPerMyr: 0.05, minimumBeforeDrop: 0.2, safe: 0.65 },
  fossilLow: { dangerGtC: 1_000, safeGtC: 1_500 },
  pollution: { danger: 0.65, risePerCentury: 0.02, safe: 0.4 },
  disaster: {
    droughtExposure: 0.35,
    droughtSafe: 0.2,
    annualMortality: 3e-5,
    annualMortalitySafe: 1e-5,
    volcanicActivity: 2.5,
    volcanicSafe: 1,
    impactFluxPerYear: 1e-6,
    impactFluxSafe: 2e-7,
  },
} as const;

export function createAlertDiagnostics(): AlertDiagnostics {
  return {
    initialized: false,
    previous: null,
    armed: Object.fromEntries(TREND_ALERT_KEYS.map((key) => [key, true])) as Record<
      TrendAlertKey,
      boolean
    >,
    snowball: false,
    greatOxidationReached: false,
    disaster: {
      droughtArmed: true,
      localHazardArmed: true,
      volcanicArmed: true,
      impactArmed: true,
    },
  };
}

function snapshot(state: PlanetState, year: number): TrendSnapshot {
  const g = state.globals;
  return {
    year,
    runawayMargin: g.runawayMargin,
    iceFraction: g.iceFraction,
    co2: g.atmosphere.co2,
    oxygenPressure: oxygenPartialPressure(g.atmosphere),
    biodiversity: g.biodiversity,
    fossilCarbon: g.fossilCarbon,
    pollution: g.pollution,
  };
}

const plantIndex = LIFE_CLASSES.findIndex((lifeClass) => lifeClass.key === 'plants');

/** Pure deterministic diagnostic component: it records alerts but changes no model input. */
export const trendAlerts: SimComponent = {
  name: 'trendAlerts',
  inputs: [],
  outputs: [],
  runOneStep(state, dtYears) {
    const memory = state.alertDiagnostics;
    const endYear = state.globals.year + Math.max(0, dtYears);
    const current = snapshot(state, endYear);
    const previous = memory.previous;
    if (!memory.initialized || previous === null || !(current.year > previous.year)) {
      memory.initialized = true;
      memory.previous = current;
      memory.snowball = current.iceFraction >= ALERT_THRESHOLDS.snowballOnset;
      memory.greatOxidationReached =
        memory.greatOxidationReached ||
        current.oxygenPressure >= ALERT_THRESHOLDS.greatOxidationBar;
      return;
    }

    const elapsed = current.year - previous.year;
    const perMyr = 1e6 / elapsed;
    const perCentury = 100 / elapsed;
    const fire = (key: TrendAlertKey, event: EventKey) => {
      if (!memory.armed[key]) return;
      recordEvent(state, event, undefined, endYear);
      memory.armed[key] = false;
    };

    if (
      !memory.greatOxidationReached &&
      previous.oxygenPressure < ALERT_THRESHOLDS.greatOxidationBar &&
      current.oxygenPressure >= ALERT_THRESHOLDS.greatOxidationBar
    ) {
      recordEvent(state, 'greatOxidation', undefined, endYear);
      memory.greatOxidationReached = true;
    }
    if (!memory.snowball && current.iceFraction >= ALERT_THRESHOLDS.snowballOnset) {
      recordEvent(state, 'snowballOnset', undefined, endYear);
      memory.snowball = true;
    } else if (memory.snowball && current.iceFraction <= ALERT_THRESHOLDS.snowballEnd) {
      recordEvent(state, 'snowballEnded', undefined, endYear);
      memory.snowball = false;
    }

    const runawayRate = (current.runawayMargin - previous.runawayMargin) * perMyr;
    if (
      current.runawayMargin <= ALERT_THRESHOLDS.runaway.danger &&
      runawayRate <= -ALERT_THRESHOLDS.runaway.shrinkPerMyr
    )
      fire('runaway', 'trendRunaway');
    else if (current.runawayMargin >= ALERT_THRESHOLDS.runaway.safe) memory.armed.runaway = true;

    const iceRate = (current.iceFraction - previous.iceFraction) * perMyr;
    if (
      current.iceFraction >= ALERT_THRESHOLDS.snowball.danger &&
      iceRate >= ALERT_THRESHOLDS.snowball.risePerMyr
    )
      fire('snowball', 'trendSnowball');
    else if (current.iceFraction <= ALERT_THRESHOLDS.snowball.safe) memory.armed.snowball = true;

    const hasPlants = plantIndex >= 0 && state.biota.appeared[plantIndex] !== null;
    const co2Rate = (current.co2 - previous.co2) * perMyr;
    if (
      hasPlants &&
      current.co2 <= ALERT_THRESHOLDS.co2Starvation.danger &&
      co2Rate <= -ALERT_THRESHOLDS.co2Starvation.fallPerMyr
    )
      fire('co2Starvation', 'trendCo2Starvation');
    else if (current.co2 >= ALERT_THRESHOLDS.co2Starvation.safe) memory.armed.co2Starvation = true;

    const hasComplexLife = LIFE_CLASSES.some(
      (lifeClass, index) => lifeClass.tier !== 'microbes' && state.biota.appeared[index] !== null,
    );
    const oxygenRate = (current.oxygenPressure - previous.oxygenPressure) * perMyr;
    if (
      hasComplexLife &&
      current.oxygenPressure <= ALERT_THRESHOLDS.oxygenLoss.dangerBar &&
      oxygenRate <= -ALERT_THRESHOLDS.oxygenLoss.fallBarPerMyr
    )
      fire('oxygenLoss', 'trendOxygenLoss');
    else if (current.oxygenPressure >= ALERT_THRESHOLDS.oxygenLoss.safeBar)
      memory.armed.oxygenLoss = true;

    const biodiversityRate = (current.biodiversity - previous.biodiversity) * perMyr;
    if (
      previous.biodiversity >= ALERT_THRESHOLDS.biodiversityLoss.minimumBeforeDrop &&
      biodiversityRate <= -ALERT_THRESHOLDS.biodiversityLoss.fallPerMyr
    )
      fire('biodiversityLoss', 'trendBiodiversityLoss');
    else if (current.biodiversity >= ALERT_THRESHOLDS.biodiversityLoss.safe)
      memory.armed.biodiversityLoss = true;

    const hasCivilization = state.civilization.species !== null;
    if (
      hasCivilization &&
      current.fossilCarbon <= ALERT_THRESHOLDS.fossilLow.dangerGtC &&
      current.fossilCarbon < previous.fossilCarbon
    )
      fire('fossilLow', 'trendFossilLow');
    else if (current.fossilCarbon >= ALERT_THRESHOLDS.fossilLow.safeGtC)
      memory.armed.fossilLow = true;

    const pollutionRate = (current.pollution - previous.pollution) * perCentury;
    if (
      hasCivilization &&
      current.pollution >= ALERT_THRESHOLDS.pollution.danger &&
      pollutionRate >= ALERT_THRESHOLDS.pollution.risePerCentury
    )
      fire('pollution', 'trendPollution');
    else if (current.pollution <= ALERT_THRESHOLDS.pollution.safe) memory.armed.pollution = true;

    memory.previous = current;
  },
};
