import { describe, expect, it } from 'vitest';
import { newPlanetChoice, SCENARIO_GROUPS, type NewPlanetForm } from './NewPlanetDialog';
import { SCENARIO_IDS } from '../sim/scenarios';

const form: NewPlanetForm = {
  scenario: 'random',
  seed: 42,
  resolutionIndex: 1,
  start: 'microbial',
  difficulty: 'hard',
  adaptivePacing: false,
  radiusKm: 7000,
  distanceAu: 0.9,
  starType: 'K',
  rotationHours: 30,
  hasMoon: false,
  initialWater: '123',
  landTargetPercent: 35,
};

describe('new planet choices', () => {
  it('offers every scenario once across the sandbox and challenge groups', () => {
    const grouped = SCENARIO_GROUPS.flatMap((group) => group.scenarios);
    expect(grouped).toHaveLength(SCENARIO_IDS.length);
    expect(new Set(grouped)).toEqual(new Set(SCENARIO_IDS));
  });

  it('preserves random-world settings and custom parameters', () => {
    expect(newPlanetChoice(form)).toEqual({
      scenario: 'random',
      seed: 42,
      resolutionIndex: 1,
      start: 'microbial',
      difficulty: 'hard',
      adaptivePacing: false,
      continentalFraction: 0.35,
      planetParams: {
        radius: 7_000_000,
        orbitalDistanceAu: 0.9,
        starType: 'K',
        rotationPeriodHours: 30,
        hasMoon: false,
        initialWaterGel: 123,
      },
    });
  });

  it('keeps the same start setting for every scenario without leaking random-only settings', () => {
    for (const scenario of SCENARIO_IDS) {
      const choice = newPlanetChoice({ ...form, scenario });
      expect(choice.start).toBe('microbial');
      if (scenario !== 'random') {
        expect(choice.planetParams).toBeUndefined();
        expect(choice.continentalFraction).toBeUndefined();
      }
    }
  });
});
