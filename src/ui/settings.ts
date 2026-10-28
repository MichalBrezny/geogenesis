export const SETTINGS_STORAGE_KEY = 'geogenesis.settings';

export const AUTOSAVE_INTERVALS = [0, 5, 10, 20] as const;
export type AutosaveInterval = (typeof AUTOSAVE_INTERVALS)[number];
export type DefaultSpeed = 'slow' | 'normal' | 'fast';

export interface Settings {
  resolutionIndex: number;
  speed: DefaultSpeed;
  adaptivePacing: boolean;
  autosaveInterval: AutosaveInterval;
  particleDensity: number;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  resolutionIndex: 1,
  speed: 'fast',
  adaptivePacing: true,
  autosaveInterval: 10,
  particleDensity: 1,
};

function browserStorage(): SettingsStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeSettings(value: unknown): Settings {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const resolutionIndex = Math.round(
    finiteNumber(source.resolutionIndex, DEFAULT_SETTINGS.resolutionIndex),
  );
  const particleDensity = finiteNumber(source.particleDensity, DEFAULT_SETTINGS.particleDensity);
  const speed = ['slow', 'normal', 'fast'].includes(String(source.speed))
    ? (source.speed as DefaultSpeed)
    : DEFAULT_SETTINGS.speed;
  const interval = finiteNumber(source.autosaveInterval, DEFAULT_SETTINGS.autosaveInterval);
  const autosaveInterval = AUTOSAVE_INTERVALS.reduce((closest, option) =>
    Math.abs(option - interval) < Math.abs(closest - interval) ? option : closest,
  );
  return {
    resolutionIndex: Math.max(0, Math.min(2, resolutionIndex)),
    speed,
    adaptivePacing:
      typeof source.adaptivePacing === 'boolean'
        ? source.adaptivePacing
        : DEFAULT_SETTINGS.adaptivePacing,
    autosaveInterval,
    particleDensity: Math.max(0.25, Math.min(2, particleDensity)),
  };
}

export function loadSettings(storage = browserStorage()): Settings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Readonly<Settings>, storage = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}
