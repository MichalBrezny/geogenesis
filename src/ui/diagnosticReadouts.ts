import type { MessageKey } from '../i18n/i18n';
import type { CarbonBudgetDiagnostic, EnergyBalanceDiagnostic } from '../sim/core/planet';

export type CarbonTerm =
  'volcanoes' | 'weathering' | 'burial' | 'civilization' | 'clathrates' | 'devices';
export type EnergyTerm = 'co2' | 'waterVapor' | 'methane' | 'ice' | 'clouds' | 'haze' | 'aerosols';

/** Below this absolute rate, the carbon balance is described as steady. */
export const CARBON_TREND_THRESHOLD = 1e-6;
/** Radiative influences below 2 W/m2 are too small to headline in prose. */
export const ENERGY_SENTENCE_THRESHOLD = 2;

export function dominantCarbonTerm(budget: CarbonBudgetDiagnostic): CarbonTerm {
  const terms: [CarbonTerm, number][] = [
    [
      'volcanoes',
      Math.abs(budget.volcanicOutgassing.microbarPerYear + budget.lipOutgassing.microbarPerYear),
    ],
    [
      'weathering',
      Math.abs(budget.landWeathering.microbarPerYear + budget.seafloorWeathering.microbarPerYear),
    ],
    ['burial', Math.abs(budget.organicBurial.microbarPerYear)],
    ['civilization', Math.abs(budget.civilizationEmissions.microbarPerYear)],
    ['clathrates', Math.abs(budget.clathrateRelease.microbarPerYear)],
    [
      'devices',
      Math.abs(budget.deviceSources.microbarPerYear + budget.deviceSinks.microbarPerYear),
    ],
  ];
  return terms.reduce((largest, term) => (term[1] > largest[1] ? term : largest))[0];
}

export function selectCarbonSentence(budget: CarbonBudgetDiagnostic): MessageKey {
  const net = budget.net.microbarPerYear;
  if (Math.abs(net) < CARBON_TREND_THRESHOLD) return 'diagnostic.carbonSentence.steady';
  const direction = net > 0 ? 'rising' : 'falling';
  return `diagnostic.carbonSentence.${direction}.${dominantCarbonTerm(budget)}` as MessageKey;
}

export function dominantEnergyTerm(balance: EnergyBalanceDiagnostic): {
  term: EnergyTerm;
  value: number;
  warming: boolean;
} {
  const terms: { term: EnergyTerm; value: number; warming: boolean }[] = [
    { term: 'co2', value: Math.max(0, balance.greenhouse.co2), warming: true },
    { term: 'waterVapor', value: Math.max(0, balance.greenhouse.waterVapor), warming: true },
    { term: 'methane', value: Math.max(0, balance.greenhouse.methane), warming: true },
    { term: 'ice', value: Math.abs(balance.cooling.iceAlbedo), warming: false },
    { term: 'clouds', value: Math.abs(balance.cooling.cloudAlbedo), warming: false },
    { term: 'haze', value: Math.abs(balance.cooling.haze), warming: false },
    { term: 'aerosols', value: Math.abs(balance.cooling.dustAerosol), warming: false },
  ];
  return terms.reduce((largest, term) => (term.value > largest.value ? term : largest));
}

export function selectEnergySentence(balance: EnergyBalanceDiagnostic): {
  key: MessageKey;
  value: number;
} {
  const dominant = dominantEnergyTerm(balance);
  if (dominant.value < ENERGY_SENTENCE_THRESHOLD) {
    return { key: 'diagnostic.energySentence.balanced', value: dominant.value };
  }
  return {
    key: `diagnostic.energySentence.${dominant.warming ? 'warm' : 'cold'}.${dominant.term}` as MessageKey,
    value: dominant.value,
  };
}
