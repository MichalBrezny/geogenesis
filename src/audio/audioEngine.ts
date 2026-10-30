import type { Era } from '../sim/eras';
import type { PlanetEvent } from '../sim/events';
import type { AudioSettings } from './audioSettings';
import { cueForEvent, type CueParameters } from './cues';
import { musicParametersForEra } from './music';

/** Music is switched off for now; only event cues play. The engine and settings stay in place. */
export const MUSIC_ENABLED = false;
const MUSIC_LEVEL = 0.6;
const PAUSED_DUCKING = 0.28;
const CROSSFADE_SECONDS = 2.5;
const CUE_GAP_SECONDS = 0.18;
const CUE_COOLDOWN_SECONDS = 0.9;

interface MusicLayer {
  gain: GainNode;
  oscillators: OscillatorNode[];
  pulse?: OscillatorNode;
  motifTimer?: ReturnType<typeof setInterval>;
}

/** Browser-only Web Audio graph. It remains inert where AudioContext is unavailable. */
export class AudioEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private layer: MusicLayer | null = null;
  private era: Era | null = null;
  private paused = true;
  private hidden = false;
  private settings: AudioSettings;
  private lastCueAt = -Infinity;
  private readonly lastKindAt = new Map<string, number>();

  constructor(settings: AudioSettings) {
    this.settings = settings;
  }

  get started(): boolean {
    return this.context !== null;
  }

  /** Must be called synchronously from a click or key gesture. */
  start(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    if (typeof AudioContext === 'undefined') return;
    try {
      const context = new AudioContext();
      const master = context.createGain();
      const music = context.createGain();
      const effects = context.createGain();
      music.connect(master);
      effects.connect(master);
      master.connect(context.destination);
      this.context = context;
      this.masterGain = master;
      this.musicGain = music;
      this.effectsGain = effects;
      this.applySettings(true);
      if (!this.hidden) this.replaceMusicLayer();
      if (context.state === 'suspended') void context.resume();
    } catch {
      this.context = null;
      this.masterGain = null;
      this.musicGain = null;
      this.effectsGain = null;
    }
  }

  setSettings(settings: AudioSettings): void {
    this.settings = settings;
    this.applySettings(false);
  }

  setEra(era: Era | null): void {
    if (this.era === era) return;
    this.era = era;
    if (this.context && !this.hidden) this.replaceMusicLayer();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyMusicLevel(false);
  }

  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (hidden) {
      this.stopLayer(this.layer, 0.08);
      this.layer = null;
    } else if (this.context) {
      this.replaceMusicLayer();
      if (this.context.state === 'suspended') void this.context.resume();
    }
  }

  playEvents(events: readonly PlanetEvent[]): void {
    const context = this.context;
    if (!context || this.hidden || this.settings.muted) return;
    const ranked = events
      .map((event) => cueForEvent(event))
      .filter((cue): cue is CueParameters => cue !== null)
      .sort(
        (a, b) => (a.importance === 'critical' ? -1 : 0) - (b.importance === 'critical' ? -1 : 0),
      );
    let scheduled = 0;
    for (const cue of ranked) {
      if (scheduled >= 3) break;
      const now = context.currentTime;
      const kindAt = this.lastKindAt.get(cue.kind) ?? -Infinity;
      if (now - kindAt < CUE_COOLDOWN_SECONDS) continue;
      const startAt = Math.max(now, this.lastCueAt + CUE_GAP_SECONDS);
      this.synthesizeCue(cue, startAt);
      this.lastCueAt = startAt;
      this.lastKindAt.set(cue.kind, startAt);
      scheduled++;
    }
  }

  destroy(): void {
    this.stopLayer(this.layer, 0.02);
    this.layer = null;
    if (this.context) void this.context.close();
    this.context = null;
  }

  private applySettings(immediate: boolean): void {
    const context = this.context;
    if (!context || !this.masterGain || !this.musicGain || !this.effectsGain) return;
    const at = context.currentTime;
    const set = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(at);
      if (immediate) param.setValueAtTime(value, at);
      else param.setTargetAtTime(value, at, 0.04);
    };
    set(this.masterGain.gain, this.settings.muted ? 0 : this.settings.master);
    set(this.effectsGain.gain, this.settings.effects);
    this.applyMusicLevel(immediate);
  }

  private applyMusicLevel(immediate: boolean): void {
    if (!this.context || !this.musicGain) return;
    const at = this.context.currentTime;
    const level = this.settings.music * (this.paused ? PAUSED_DUCKING : 1);
    this.musicGain.gain.cancelScheduledValues(at);
    if (immediate) this.musicGain.gain.setValueAtTime(level, at);
    else this.musicGain.gain.setTargetAtTime(level, at, 0.12);
  }

  private replaceMusicLayer(): void {
    const context = this.context;
    const destination = this.musicGain;
    if (!MUSIC_ENABLED || !context || !destination) return;
    const previous = this.layer;
    const params = musicParametersForEra(this.era);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = params.filterHz;
    filter.Q.value = 0.7;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(MUSIC_LEVEL, context.currentTime + CROSSFADE_SECONDS);
    filter.connect(gain);
    gain.connect(destination);

    const oscillators = params.intervals.map((interval, index) => {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      oscillator.type = params.waveform;
      oscillator.frequency.value = params.rootHz * interval;
      oscillator.detune.value = index % 2 === 0 ? -4 : 4;
      voiceGain.gain.value = 0.24 / params.intervals.length;
      oscillator.connect(voiceGain);
      voiceGain.connect(filter);
      oscillator.start();
      return oscillator;
    });

    let pulse: OscillatorNode | undefined;
    if (params.pulseBpm !== null) {
      pulse = context.createOscillator();
      const depth = context.createGain();
      pulse.frequency.value = params.pulseBpm / 60;
      depth.gain.value = MUSIC_LEVEL * 0.16;
      pulse.connect(depth);
      depth.connect(gain.gain);
      pulse.start();
    }

    const layer: MusicLayer = { gain, oscillators, pulse };
    if (params.motifRate > 0) {
      let note = 0;
      layer.motifTimer = setInterval(() => {
        if (!this.hidden && this.context === context) {
          const interval = params.intervals[note++ % params.intervals.length]!;
          this.synthesizeMotif(params.rootHz * interval * 2);
        }
      }, 1000 / params.motifRate);
    }
    this.layer = layer;
    this.stopLayer(previous, CROSSFADE_SECONDS);
  }

  private stopLayer(layer: MusicLayer | null, fadeSeconds: number): void {
    if (!layer || !this.context) return;
    if (layer.motifTimer) clearInterval(layer.motifTimer);
    const now = this.context.currentTime;
    layer.gain.gain.cancelScheduledValues(now);
    layer.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.01, fadeSeconds / 4));
    const stopAt = now + fadeSeconds + 0.1;
    for (const oscillator of layer.oscillators) oscillator.stop(stopAt);
    layer.pulse?.stop(stopAt);
  }

  private synthesizeMotif(frequency: number): void {
    const context = this.context;
    if (!context || !this.musicGain) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.025, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    oscillator.connect(gain);
    gain.connect(this.musicGain);
    oscillator.start(now);
    oscillator.stop(now + 0.75);
  }

  private synthesizeCue(cue: CueParameters, startAt: number): void {
    const context = this.context;
    if (!context || !this.effectsGain) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const peak = cue.importance === 'critical' ? 0.22 : 0.14;
    oscillator.type = cue.waveform;
    oscillator.frequency.setValueAtTime(cue.startHz, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(cue.endHz, startAt + cue.duration);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + cue.duration);
    oscillator.connect(gain);
    gain.connect(this.effectsGain);
    oscillator.start(startAt);
    oscillator.stop(startAt + cue.duration + 0.02);
  }
}
