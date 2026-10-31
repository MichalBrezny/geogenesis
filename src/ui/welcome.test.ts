import { describe, expect, it } from 'vitest';
import {
  initialOnboarding,
  setWelcomeAtStartup,
  shouldShowWelcome,
  tourStartAfterWelcome,
} from './welcome';
import { rememberTourComplete } from './guide';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe('welcome storage', () => {
  it('is shown on every launch until turned off, and can be turned back on', () => {
    const storage = memoryStorage();
    expect(shouldShowWelcome(storage)).toBe(true);
    expect(setWelcomeAtStartup(storage, false)).toBe(true);
    expect(shouldShowWelcome(storage)).toBe(false);
    setWelcomeAtStartup(storage, true);
    expect(shouldShowWelcome(storage)).toBe(true);
  });

  it('falls back to showing when storage is missing or unavailable', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(shouldShowWelcome(undefined)).toBe(true);
    expect(setWelcomeAtStartup(undefined, false)).toBe(false);
    expect(shouldShowWelcome(throwing)).toBe(true);
    expect(setWelcomeAtStartup(throwing, false)).toBe(false);
  });
});

describe('welcome and tour ordering', () => {
  it('does not open the tour underneath a first-launch welcome', () => {
    expect(initialOnboarding(memoryStorage())).toEqual({ welcome: true, tour: false });
  });

  it('starts an unfinished tour directly for a returning visitor', () => {
    const storage = memoryStorage();
    setWelcomeAtStartup(storage, false);
    expect(initialOnboarding(storage)).toEqual({ welcome: false, tour: true });
  });

  it('keeps a completed tour closed for a returning visitor', () => {
    const storage = memoryStorage();
    setWelcomeAtStartup(storage, false);
    rememberTourComplete(storage);
    expect(initialOnboarding(storage)).toEqual({ welcome: false, tour: false });
  });

  it('starts after exploring now and after create or load finishes', () => {
    expect(tourStartAfterWelcome('explore', true)).toBe('now');
    expect(tourStartAfterWelcome('choose', true)).toBe('after-world-change');
    expect(tourStartAfterWelcome('continue', true)).toBe('after-world-change');
    expect(tourStartAfterWelcome('continue', false)).toBe('none');
  });
});
