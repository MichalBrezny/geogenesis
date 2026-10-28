import { describe, expect, it } from 'vitest';
import { EVENT_IMPORTANCE } from '../sim/eventMetadata';
import type { EventKey } from '../sim/events';
import { cueForEvent } from './cues';

describe('event cues', () => {
  it('maps every important event and ignores minor events', () => {
    for (const [key, importance] of Object.entries(EVENT_IMPORTANCE) as [
      EventKey,
      (typeof EVENT_IMPORTANCE)[EventKey],
    ][]) {
      const cue = cueForEvent({ key, year: 0 });
      if (importance === 'minor') expect(cue).toBeNull();
      else expect(cue?.importance).toBe(importance);
    }
  });

  it('gives impacts a low falling cue and life a rising cue', () => {
    const impact = cueForEvent({ key: 'impact', year: 0 })!;
    const life = cueForEvent({ key: 'lifeOrigin', year: 0 })!;
    expect(impact.endHz).toBeLessThan(impact.startHz);
    expect(life.endHz).toBeGreaterThan(life.startHz);
  });
});
