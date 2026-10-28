import type { Era } from '../sim/eras';

export interface MusicParameters {
  rootHz: number;
  intervals: readonly number[];
  waveform: OscillatorType;
  pulseBpm: number | null;
  motifRate: number;
  filterHz: number;
}

const MUSIC_BY_ERA: Record<Era, MusicParameters> = {
  geological: {
    rootHz: 55,
    intervals: [1, 1.5, 2],
    waveform: 'sine',
    pulseBpm: null,
    motifRate: 0,
    filterHz: 280,
  },
  evolution: {
    rootHz: 73.42,
    intervals: [1, 1.25, 1.5, 2],
    waveform: 'triangle',
    pulseBpm: null,
    motifRate: 0.12,
    filterHz: 700,
  },
  civilization: {
    rootHz: 110,
    intervals: [1, 1.25, 1.5, 1.875],
    waveform: 'triangle',
    pulseBpm: 48,
    motifRate: 0.32,
    filterHz: 1_300,
  },
  technology: {
    rootHz: 146.83,
    intervals: [1, 1.25, 1.5, 2],
    waveform: 'sawtooth',
    pulseBpm: 84,
    motifRate: 0.55,
    filterHz: 2_400,
  },
};

/** Stable musical character for each simulation era. */
export function musicParametersForEra(era: Era | null): MusicParameters {
  return MUSIC_BY_ERA[era ?? 'geological'];
}
