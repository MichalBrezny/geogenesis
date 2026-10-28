import { describe, expect, it } from 'vitest';
import { ERAS } from '../sim/eras';
import { musicParametersForEra } from './music';

describe('era music parameters', () => {
  it('defines playable parameters for every era', () => {
    for (const era of ERAS) {
      const params = musicParametersForEra(era);
      expect(params.rootHz).toBeGreaterThan(0);
      expect(params.intervals.length).toBeGreaterThan(2);
      expect(params.filterHz).toBeGreaterThan(params.rootHz);
    }
  });

  it('becomes brighter and more rhythmic in later eras', () => {
    expect(musicParametersForEra('technology').filterHz).toBeGreaterThan(
      musicParametersForEra('geological').filterHz,
    );
    expect(musicParametersForEra('geological').pulseBpm).toBeNull();
    expect(musicParametersForEra('technology').pulseBpm).toBeGreaterThan(0);
  });
});
