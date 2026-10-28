import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from './settings';

describe('settings storage', () => {
  it('uses defaults for missing and corrupt data', () => {
    const storage: SettingsStorage = {
      getItem: () => '{broken',
      setItem: () => undefined,
    };
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps values and ignores unknown keys', () => {
    expect(
      normalizeSettings({
        resolutionIndex: 99,
        speed: 'warp',
        adaptivePacing: 'yes',
        autosaveInterval: 17,
        particleDensity: -4,
        unknown: true,
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      resolutionIndex: 2,
      autosaveInterval: 20,
      particleDensity: 0.25,
    });
  });

  it('round-trips normalized settings and survives unavailable storage', () => {
    const values = new Map<string, string>();
    const storage: SettingsStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    };
    const settings = { ...DEFAULT_SETTINGS, speed: 'slow' as const, particleDensity: 1.5 };
    expect(saveSettings(settings, storage)).toBe(true);
    expect(values.has(SETTINGS_STORAGE_KEY)).toBe(true);
    expect(loadSettings(storage)).toEqual(settings);

    const unavailable: SettingsStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(unavailable)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(settings, unavailable)).toBe(false);
  });
});
