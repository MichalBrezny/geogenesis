import { describe, expect, it, vi } from 'vitest';
import {
  AUDIO_SETTINGS_KEY,
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
} from './audioSettings';

describe('audio settings', () => {
  it('uses documented defaults when no settings exist', () => {
    expect(loadAudioSettings({ getItem: () => null })).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('loads values and clamps volumes', () => {
    const value = JSON.stringify({ master: 2, music: -1, effects: 0.4, muted: true });
    expect(loadAudioSettings({ getItem: () => value })).toEqual({
      master: 1,
      music: 0,
      effects: 0.4,
      muted: true,
    });
  });

  it('falls back per field for partial or corrupt data', () => {
    expect(loadAudioSettings({ getItem: () => '{bad json' })).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(loadAudioSettings({ getItem: () => JSON.stringify({ master: 0.2 }) })).toEqual({
      ...DEFAULT_AUDIO_SETTINGS,
      master: 0.2,
    });
  });

  it('saves sanitized settings and tolerates unavailable storage', () => {
    const setItem = vi.fn();
    saveAudioSettings({ master: 4, music: 0.3, effects: 0.5, muted: false }, { setItem });
    expect(setItem).toHaveBeenCalledWith(
      AUDIO_SETTINGS_KEY,
      JSON.stringify({ master: 1, music: 0.3, effects: 0.5, muted: false }),
    );
    expect(() =>
      saveAudioSettings(DEFAULT_AUDIO_SETTINGS, {
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
  });
});
