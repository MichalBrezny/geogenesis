import { describe, expect, it } from 'vitest';
import { EVENT_IMPORTANCE } from './eventMetadata';
import type { EventKey } from './events';

describe('event importance', () => {
  it('has one importance entry for every event key', () => {
    const keys = Object.keys(EVENT_IMPORTANCE) as EventKey[];
    expect(keys.length).toBeGreaterThan(0);
    expect(
      keys.every((key) => ['minor', 'important', 'critical'].includes(EVENT_IMPORTANCE[key])),
    ).toBe(true);
  });
});
