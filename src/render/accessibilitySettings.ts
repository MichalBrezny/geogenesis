export const PALETTE_MODES = ['default', 'colourBlind'] as const;
export type PaletteMode = (typeof PALETTE_MODES)[number];

export interface AccessibilitySettings {
  palette: PaletteMode;
  highContrast: boolean;
}

export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  palette: 'default',
  highContrast: false,
};

export const ACCESSIBILITY_STORAGE_KEY = 'geogenesis.accessibility';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Loads only known values and falls back when storage is absent or corrupt. */
export function loadAccessibilitySettings(
  storage: StorageReader | undefined = browserStorage(),
): AccessibilitySettings {
  try {
    const raw = storage?.getItem(ACCESSIBILITY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ACCESSIBILITY_SETTINGS };
    const value = JSON.parse(raw) as Partial<AccessibilitySettings>;
    return {
      palette: PALETTE_MODES.includes(value.palette as PaletteMode)
        ? (value.palette as PaletteMode)
        : DEFAULT_ACCESSIBILITY_SETTINGS.palette,
      highContrast:
        typeof value.highContrast === 'boolean'
          ? value.highContrast
          : DEFAULT_ACCESSIBILITY_SETTINGS.highContrast,
    };
  } catch {
    return { ...DEFAULT_ACCESSIBILITY_SETTINGS };
  }
}

export function saveAccessibilitySettings(
  settings: AccessibilitySettings,
  storage: StorageWriter | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Preferences remain active for this session when persistent storage is unavailable.
  }
}

let currentSettings = loadAccessibilitySettings();
const listeners = new Set<() => void>();

export function getAccessibilitySettings(): AccessibilitySettings {
  return currentSettings;
}

export function setAccessibilitySettings(settings: AccessibilitySettings): void {
  currentSettings = { ...settings };
  saveAccessibilitySettings(currentSettings);
  for (const listener of listeners) listener();
}

export function subscribeAccessibilitySettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
