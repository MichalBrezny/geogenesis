export const AUDIO_SETTINGS_KEY = 'geogenesis.audioSettings';

export interface AudioSettings {
  master: number;
  music: number;
  effects: number;
  muted: boolean;
}

/** Quiet music under clearly audible event cues. Volumes are normalized 0..1. */
export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = {
  master: 0.7,
  music: 0.25,
  effects: 0.65,
  muted: false,
};

function clampVolume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function sanitizeAudioSettings(value: unknown): AudioSettings {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    master: clampVolume(record.master, DEFAULT_AUDIO_SETTINGS.master),
    music: clampVolume(record.music, DEFAULT_AUDIO_SETTINGS.music),
    effects: clampVolume(record.effects, DEFAULT_AUDIO_SETTINGS.effects),
    muted: typeof record.muted === 'boolean' ? record.muted : DEFAULT_AUDIO_SETTINGS.muted,
  };
}

export function loadAudioSettings(storage?: Pick<Storage, 'getItem'>): AudioSettings {
  try {
    const source = storage ?? globalThis.localStorage;
    const saved = source.getItem(AUDIO_SETTINGS_KEY);
    return saved === null
      ? { ...DEFAULT_AUDIO_SETTINGS }
      : sanitizeAudioSettings(JSON.parse(saved));
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(
  settings: AudioSettings,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    (storage ?? globalThis.localStorage).setItem(
      AUDIO_SETTINGS_KEY,
      JSON.stringify(sanitizeAudioSettings(settings)),
    );
  } catch {
    // Audio still works for the current session when storage is unavailable.
  }
}
