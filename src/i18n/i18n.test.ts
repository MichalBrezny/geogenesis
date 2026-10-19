import { describe, expect, it } from 'vitest';
import { MAP_LAYERS } from '../render/mapRenderer';
import en from './en.json';

describe('UI strings', () => {
  it('has a name and a hint for every map layer', () => {
    const missing = MAP_LAYERS.flatMap((id) =>
      [`layer.${id}`, `layerHelp.${id}`].filter((key) => !(key in en)),
    );
    expect(missing).toEqual([]);
  });
});
