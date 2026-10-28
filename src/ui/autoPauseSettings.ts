import { AUTO_PAUSE_KEYS, DEFAULT_AUTO_PAUSE, type AutoPauseSettings } from '../sim/autoPause';

export const AUTO_PAUSE_STORAGE_KEY = 'geogenesis.autoPause';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadAutoPauseSettings(storage = browserStorage()): AutoPauseSettings {
  const fallback = { ...DEFAULT_AUTO_PAUSE };
  if (!storage) return fallback;
  try {
    const parsed = JSON.parse(storage.getItem(AUTO_PAUSE_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    for (const key of AUTO_PAUSE_KEYS) {
      if (typeof parsed[key] === 'boolean') fallback[key] = parsed[key];
    }
  } catch {
    // Invalid or unavailable storage falls back to the documented defaults.
  }
  return fallback;
}

export function saveAutoPauseSettings(
  settings: Readonly<AutoPauseSettings>,
  storage = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AUTO_PAUSE_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
