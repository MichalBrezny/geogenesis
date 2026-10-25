import { describe, expect, it } from 'vitest';
import { biosignature } from './biosignature';

const air = { n2: 0.78, inert: 0.009, co2: 280, ch4: 0, o2: 0, waterVapor: 0.0025 };

describe('biosignature', () => {
  it('detects life from oxygen and methane together', () => {
    expect(biosignature({ ...air, o2: 0.21, ch4: 1.8 })).toBe('detected');
  });

  it('calls a single gas only a possible sign', () => {
    expect(biosignature({ ...air, o2: 0.21, ch4: 0 })).toBe('possible');
    expect(biosignature({ ...air, ch4: 100 })).toBe('possible');
    expect(biosignature({ ...air, ch4: 1 })).toBe('none');
  });
});
