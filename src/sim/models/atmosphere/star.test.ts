import { describe, expect, it } from 'vitest';
import { stellarWindFactor, stellarXuvFactor } from './star';

describe('stellar XUV and wind', () => {
  it('leaves a G star at 1 AU as the plain solar age law', () => {
    const age = 3e9;
    expect(stellarXuvFactor(age, 'G', 1)).toBeCloseTo((4.57e9 / age) ** 1.2, 12);
    expect(stellarWindFactor(age, 'G', 1)).toBeCloseTo((4.57e9 / age) ** 0.6, 12);
  });

  it('scales with stellar luminosity so an M dwarf planet is not baked by XUV', () => {
    const xuv = stellarXuvFactor(4.5e9, 'M', 0.08);
    expect(xuv).toBeGreaterThan(0.5);
    expect(xuv).toBeLessThan(10);
  });

  it('decays the K and F activity boost over their active years', () => {
    const young = stellarXuvFactor(1e8, 'K', 1);
    const old = stellarXuvFactor(8e9, 'K', 1);
    const gOld = stellarXuvFactor(8e9, 'G', 1);
    expect(young).toBeGreaterThan(0);
    // After many active lifetimes K matches the G age law times luminosity (0.8^4).
    expect(old).toBeCloseTo(gOld * 0.8 ** 4, 6);
  });
});
