import { describe, expect, it } from 'vitest';
import type { PlanetCreation } from '../worker/protocol';
import { decodePlanetHash, encodePlanetHash } from './planetShare';

const creation: PlanetCreation = {
  scenario: 'random',
  seed: 4_294_967_295,
  width: 256,
  height: 128,
  start: 'microbial',
  continentalFraction: 0.35,
  planetParams: {
    radius: 7_000_000,
    orbitalDistanceAu: 0.9,
    starType: 'K',
    rotationPeriodHours: -30,
    hasMoon: false,
    initialWaterGel: 123,
  },
  difficulty: 'hard',
  adaptivePacing: false,
};

describe('planet share hashes', () => {
  it('round-trips a complete starting-planet recipe', () => {
    expect(decodePlanetHash(encodePlanetHash(creation))).toEqual(creation);
  });

  it.each([
    '',
    '#planet=v2;scenario=random;seed=1;w=256;h=128;start=young;difficulty=normal;pace=1',
    '#planet=v1;scenario=unknown;seed=1;w=256;h=128;start=young;difficulty=normal;pace=1',
    '#planet=v1;scenario=random;seed=-1;w=256;h=128;start=young;difficulty=normal;pace=1',
    '#planet=v1;scenario=random;seed=1;w=oops;h=128;start=young;difficulty=normal;pace=1',
    '#planet=v1;scenario=random;seed=1;w=256;h=128;start=ancient;difficulty=normal;pace=1',
    '#planet=v1;scenario=random;seed=1;w=256;h=128;start=young;difficulty=normal;pace=1;params=!!!',
    '#planet=v1;scenario=random;seed=1;w=256;h=128;start=young;difficulty=normal;pace=1;params=eyJyYWRpdXMiOi0xfQ',
  ])('rejects malformed input: %s', (hash) => {
    expect(decodePlanetHash(hash)).toBeNull();
  });
});
