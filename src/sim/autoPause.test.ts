import { describe, expect, it } from 'vitest';
import { autoPauseEvent, DEFAULT_AUTO_PAUSE } from './autoPause';

describe('auto-pause event selection', () => {
  it('selects enabled key moments and ignores disabled or unrelated events', () => {
    const events = [
      { year: 1, key: 'plague' as const },
      { year: 2, key: 'massExtinction' as const },
    ];
    expect(autoPauseEvent(events, DEFAULT_AUTO_PAUSE)?.key).toBe('massExtinction');
    expect(
      autoPauseEvent(events, { ...DEFAULT_AUTO_PAUSE, massExtinction: false }),
    ).toBeUndefined();
  });
});
