import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTO_PAUSE } from '../sim/autoPause';
import {
  AUTO_PAUSE_STORAGE_KEY,
  loadAutoPauseSettings,
  saveAutoPauseSettings,
  type StorageLike,
} from './autoPauseSettings';

describe('auto-pause settings storage', () => {
  it('round-trips settings and merges them with defaults', () => {
    const values = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    };
    const settings = { ...DEFAULT_AUTO_PAUSE, era: false, sentience: false };
    expect(saveAutoPauseSettings(settings, storage)).toBe(true);
    expect(values.has(AUTO_PAUSE_STORAGE_KEY)).toBe(true);
    expect(loadAutoPauseSettings(storage)).toEqual(settings);
  });

  it('uses defaults when storage access or parsing fails', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadAutoPauseSettings(throwing)).toEqual(DEFAULT_AUTO_PAUSE);
    expect(saveAutoPauseSettings(DEFAULT_AUTO_PAUSE, throwing)).toBe(false);
  });
});
