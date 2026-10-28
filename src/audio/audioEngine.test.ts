import { describe, expect, it } from 'vitest';
import { AudioEngine } from './audioEngine';
import { DEFAULT_AUDIO_SETTINGS } from './audioSettings';

describe('audio engine', () => {
  it('remains inert when Web Audio is unavailable', () => {
    const engine = new AudioEngine({ ...DEFAULT_AUDIO_SETTINGS });
    expect(() => {
      engine.start();
      engine.setEra('technology');
      engine.setPaused(false);
      engine.setHidden(true);
      engine.playEvents([{ key: 'goalWon', year: 0 }]);
      engine.destroy();
    }).not.toThrow();
    expect(engine.started).toBe(false);
  });
});
