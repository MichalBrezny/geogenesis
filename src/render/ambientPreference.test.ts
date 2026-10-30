import { describe, expect, it } from 'vitest';
import {
  AMBIENT_STORAGE_KEY,
  loadAmbientPreference,
  saveAmbientPreference,
} from './ambientPreference';

describe('ambient animation preference', () => {
  it('defaults off with reduced motion and on otherwise', () => {
    const empty = { getItem: () => null };
    expect(loadAmbientPreference(empty, true)).toBe(false);
    expect(loadAmbientPreference(empty, false)).toBe(true);
  });

  it('persists an explicit choice over the motion-sensitive default', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveAmbientPreference(true, storage);
    expect(values.get(AMBIENT_STORAGE_KEY)).toBe('true');
    expect(loadAmbientPreference(storage, true)).toBe(true);
  });
});
