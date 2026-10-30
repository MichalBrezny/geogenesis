export const AMBIENT_STORAGE_KEY = 'geogenesis.ambientAnimation';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function systemPrefersReducedMotion(): boolean {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** An explicit choice wins; otherwise animation follows the system motion preference. */
export function loadAmbientPreference(
  storage: StorageReader | undefined = browserStorage(),
  reducedMotion = systemPrefersReducedMotion(),
): boolean {
  try {
    const stored = storage?.getItem(AMBIENT_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Use the motion-sensitive default when storage is unavailable.
  }
  return !reducedMotion;
}

export function saveAmbientPreference(
  enabled: boolean,
  storage: StorageWriter | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(AMBIENT_STORAGE_KEY, String(enabled));
  } catch {
    // The preference remains active for this session when storage is unavailable.
  }
}
