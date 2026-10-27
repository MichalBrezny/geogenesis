import { describe, expect, it } from 'vitest';
import { createCarbonBudgetDiagnostic, createEnergyBalanceDiagnostic } from '../sim/core/planet';
import {
  dominantCarbonTerm,
  selectCarbonSentence,
  selectEnergySentence,
} from './diagnosticReadouts';

describe('diagnostic sentences', () => {
  it('chooses the dominant carbon term', () => {
    const budget = createCarbonBudgetDiagnostic();
    budget.landWeathering.microbarPerYear = -3;
    budget.net.microbarPerYear = -2;
    expect(dominantCarbonTerm(budget)).toBe('weathering');
    expect(selectCarbonSentence(budget)).toBe('diagnostic.carbonSentence.falling.weathering');
  });

  it('chooses the dominant energy term above the documented threshold', () => {
    const balance = createEnergyBalanceDiagnostic();
    balance.cooling.iceAlbedo = 18;
    expect(selectEnergySentence(balance)).toEqual({
      key: 'diagnostic.energySentence.cold.ice',
      value: 18,
    });
  });
});
