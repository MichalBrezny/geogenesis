import { describe, expect, it } from 'vitest';
import type { PlanetEvent } from '../sim/events';
import { filterMapEvents } from './eventMap';

describe('event map filters', () => {
  it('keeps only located events in enabled categories', () => {
    const events: PlanetEvent[] = [
      { year: 1, key: 'impact', cell: 4 },
      { year: 2, key: 'largeEruption', cell: 5 },
      { year: 3, key: 'earthquake', cell: 6 },
      { year: 4, key: 'lifeOrigin', cell: 7 },
      { year: 5, key: 'sentience', cell: 8 },
      { year: 6, key: 'meteor' },
    ];
    expect(filterMapEvents(events, new Set(['impacts', 'life']))).toEqual([
      events[0],
      events[3],
    ]);
  });
});
