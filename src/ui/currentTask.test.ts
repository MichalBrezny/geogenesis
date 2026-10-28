import { describe, expect, it } from 'vitest';
import type { Frame } from '../worker/protocol';
import { currentTaskKey } from './currentTask';

function frame(changes: Partial<Frame> = {}): Frame {
  return {
    runawayMargin: 50,
    iceFraction: 0.1,
    co2: 300,
    o2Pressure: 0.1,
    fossilCarbon: 2_000,
    pollution: 0,
    life: { cover: [0, 0, 0], appeared: [null, null, null] },
    era: 'geological',
    ...changes,
  } as Frame;
}

describe('current task selection', () => {
  it('prioritizes immediate climate danger and otherwise follows the era', () => {
    expect(currentTaskKey(frame())).toBe('currentTask.life');
    expect(currentTaskKey(frame({ runawayMargin: 10 }))).toBe('currentTask.runaway');
    expect(currentTaskKey(frame({ iceFraction: 0.9 }))).toBe('currentTask.snowball');
    expect(currentTaskKey(frame({ era: 'technology', life: { cover: [1], appeared: [0] } }))).toBe(
      'currentTask.technology',
    );
  });

  it('selects state-specific biosphere and industry guidance', () => {
    const cover = Array(15).fill(0) as number[];
    cover[2] = 0.4;
    expect(currentTaskKey(frame({ life: { cover, appeared: Array(15).fill(0) }, co2: 100 }))).toBe(
      'currentTask.plantCo2',
    );
    expect(
      currentTaskKey(
        frame({
          era: 'technology',
          life: { cover, appeared: Array(15).fill(0) },
          pollution: 0.7,
        }),
      ),
    ).toBe('currentTask.pollution');
  });
});
