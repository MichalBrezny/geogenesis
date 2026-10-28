import { describe, expect, it } from 'vitest';
import type { PlanetEvent } from '../sim/events';
import { mergeToastEvents } from './toastQueue';

describe('notification rate limiting', () => {
  it('coalesces repeated important events and leaves minor events in the log only', () => {
    const plague = (year: number): PlanetEvent => ({ year, key: 'plague' });
    let queue = mergeToastEvents([], [plague(1), { year: 1, key: 'classAppeared' }], 100);
    queue = mergeToastEvents(queue, [plague(2), plague(3)], 200);
    expect(queue).toHaveLength(1);
    expect(queue[0]?.event.year).toBe(3);
    expect(queue[0]?.count).toBe(3);
  });
});
