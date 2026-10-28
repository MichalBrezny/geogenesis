import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCESSIBILITY_STORAGE_KEY,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  loadAccessibilitySettings,
  saveAccessibilitySettings,
  setAccessibilitySettings,
} from './accessibilitySettings';
import { categoricalColor, temperaturePalette } from './palettes';

afterEach(() => setAccessibilitySettings(DEFAULT_ACCESSIBILITY_SETTINGS));

describe('accessibility settings', () => {
  it('loads typed settings and ignores unknown values', () => {
    const valid = {
      getItem: () => JSON.stringify({ palette: 'colourBlind', highContrast: true }),
    };
    expect(loadAccessibilitySettings(valid)).toEqual({
      palette: 'colourBlind',
      highContrast: true,
    });

    const invalid = {
      getItem: () => JSON.stringify({ palette: 'rainbow', highContrast: 'yes' }),
    };
    expect(loadAccessibilitySettings(invalid)).toEqual(DEFAULT_ACCESSIBILITY_SETTINGS);
  });

  it('keeps working when storage reads or writes throw', () => {
    expect(
      loadAccessibilitySettings({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual(DEFAULT_ACCESSIBILITY_SETTINGS);
    expect(() =>
      saveAccessibilitySettings(
        { palette: 'colourBlind', highContrast: true },
        {
          setItem: () => {
            throw new Error('blocked');
          },
        },
      ),
    ).not.toThrow();
  });

  it('uses one stable storage key', () => {
    let writtenKey = '';
    saveAccessibilitySettings(DEFAULT_ACCESSIBILITY_SETTINGS, {
      setItem: (key) => {
        writtenKey = key;
      },
    });
    expect(writtenKey).toBe(ACCESSIBILITY_STORAGE_KEY);
  });

  it('switches sequential and categorical map colours at runtime', () => {
    setAccessibilitySettings({ palette: 'default', highContrast: false });
    const defaultTemperature = temperaturePalette(10);
    const defaultCategory = categoricalColor(1, [1, 2, 3]);

    setAccessibilitySettings({ palette: 'colourBlind', highContrast: false });
    expect(temperaturePalette(10)).not.toEqual(defaultTemperature);
    expect(categoricalColor(1, [1, 2, 3])).not.toEqual(defaultCategory);
  });
});
