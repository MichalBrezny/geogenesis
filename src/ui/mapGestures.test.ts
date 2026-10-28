import { describe, expect, it } from 'vitest';
import { isTap, pinchGesture } from './mapGestures';

describe('map gestures', () => {
  it('finds the pinch centre and scale', () => {
    expect(
      pinchGesture({ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 5, y: 30 }, { x: 45, y: 30 }),
    ).toEqual({
      startCentre: { x: 20, y: 20 },
      centre: { x: 25, y: 30 },
      scale: 2,
    });
  });

  it('handles coincident starting pointers without an invalid scale', () => {
    expect(pinchGesture({ x: 4, y: 4 }, { x: 4, y: 4 }, { x: 0, y: 0 }, { x: 8, y: 8 }).scale).toBe(
      1,
    );
  });

  it('separates taps from drags at the configured threshold', () => {
    expect(isTap({ x: 0, y: 0 }, { x: 3, y: 4 }, 6)).toBe(true);
    expect(isTap({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(false);
  });
});
