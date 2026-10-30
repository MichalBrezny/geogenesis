import { describe, expect, it } from 'vitest';
import { greedyLabelLayout } from './mapLabels';

describe('map label collision layout', () => {
  it('keeps priority order and rejects overlapping labels', () => {
    const labels = [
      { id: 'capital', box: { left: 0, top: 0, right: 40, bottom: 12 } },
      { id: 'nearby', box: { left: 38, top: 0, right: 78, bottom: 12 } },
      { id: 'clear', box: { left: 90, top: 0, right: 130, bottom: 12 } },
    ];

    expect(greedyLabelLayout(labels).map((label) => label.id)).toEqual(['capital', 'clear']);
    expect(
      greedyLabelLayout(labels, [{ left: -5, top: -5, right: 30, bottom: 17 }]).map(
        (label) => label.id,
      ),
    ).toEqual(['nearby', 'clear']);
  });
});
