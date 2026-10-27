import { describe, expect, it } from 'vitest';
import {
  clampLogValue,
  formatAxisNumber,
  loadChartSelection,
  saveChartSelection,
  selectTimeUnit,
} from './historyChartUtils';

describe('history chart formatting', () => {
  it('selects a time unit from the visible span', () => {
    expect(selectTimeUnit(2e9).label).toBe('Gyr');
    expect(selectTimeUnit(25e6).label).toBe('Myr');
    expect(selectTimeUnit(80_000).label).toBe('kyr');
    expect(selectTimeUnit(75).label).toBe('years');
  });

  it('formats ordinary and decade-spanning axis values compactly', () => {
    expect(formatAxisNumber(12_345)).toBe('12.3k');
    expect(formatAxisNumber(999)).toBe('999');
    expect(formatAxisNumber(0.125)).toBe('0.125');
    expect(formatAxisNumber(0.002)).toBe('2m');
    expect(formatAxisNumber(0.000002)).toBe('2µ');
  });

  it('clamps invalid logarithmic samples to the declared floor', () => {
    expect(clampLogValue(0, 0.01)).toBe(0.01);
    expect(clampLogValue(-5, 0.01)).toBe(0.01);
    expect(clampLogValue(2, 0.01)).toBe(2);
  });
});

describe('history chart picker persistence', () => {
  const available = new Set(['co2', 'water', 'o2'] as const);
  const defaults = ['co2', 'water'] as const;

  it('round-trips a per-scenario selection', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    expect(saveChartSelection(storage, 'mars', ['o2'])).toBe(true);
    expect(loadChartSelection(storage, 'mars', defaults, available)).toEqual(['o2']);
    expect(loadChartSelection(storage, 'venus', defaults, available)).toEqual(defaults);
  });

  it('falls back when localStorage throws or contains unusable data', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadChartSelection(throwing, 'random', defaults, available)).toEqual(defaults);
    expect(saveChartSelection(throwing, 'random', ['co2'])).toBe(false);
    expect(
      loadChartSelection(
        { getItem: () => '["missing"]', setItem: () => undefined },
        'random',
        defaults,
        available,
      ),
    ).toEqual(defaults);
  });
});
