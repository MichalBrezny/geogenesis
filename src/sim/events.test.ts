import { describe, expect, it } from 'vitest';
import { createPlanet } from './core/planet';
import { recordEvent } from './events';

describe('recordEvent', () => {
  it('stores an optional grid cell', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    planet.globals.year = 123;
    recordEvent(planet, 'meteor', undefined, 125, 17);
    expect(planet.events).toEqual([{ year: 125, key: 'meteor', subject: undefined, cell: 17 }]);
  });
});
