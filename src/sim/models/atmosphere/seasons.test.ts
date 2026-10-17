import { describe, expect, it } from 'vitest';
import { coldestMonth, fractionOfYearBelow, positiveDegreeDays, warmestMonth } from './seasons';

describe('seasonal temperature helpers', () => {
  it('finds the warmest and coldest monthly means', () => {
    expect(warmestMonth(8, 12)).toBe(20);
    expect(coldestMonth(8, 12)).toBe(-4);
  });

  it('reduces positive degree days to the annual mean result at zero amplitude', () => {
    expect(positiveDegreeDays(6, 0)).toBe(6);
    expect(positiveDegreeDays(-6, 0)).toBe(0);
  });

  it('handles symmetric seasonal cycles', () => {
    expect(positiveDegreeDays(0, 10)).toBeCloseTo(10 / Math.PI, 10);
    expect(fractionOfYearBelow(0, 10, 0)).toBeCloseTo(0.5, 10);
    expect(fractionOfYearBelow(4, 10, 4)).toBeCloseTo(0.5, 10);
  });
});
