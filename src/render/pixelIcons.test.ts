import { describe, expect, it, vi } from 'vitest';
import { TECH_AGES } from '../sim/data/civilization';
import { LIFE_CLASS_KEYS } from '../sim/data/lifeClasses';
import { EVENT_IMPORTANCE } from '../sim/eventMetadata';
import { DEVICE_KINDS } from '../sim/tools/devices';
import {
  CITY_PIXEL_ICONS,
  DEVICE_PIXEL_ICONS,
  EVENT_GROUP_PIXEL_ICONS,
  EVENT_PIXEL_ICONS,
  LIFE_PIXEL_ICONS,
  PIXEL_ICONS,
  PIXEL_ICON_KEYS,
  PIXEL_ICON_SIZE,
  PIXEL_ICON_SYMBOLS,
  PixelIconCache,
  pixelIconPalette,
  pixelIconScale,
} from './pixelIcons';

describe('pixel icon data', () => {
  it('contains valid 16 by 16 grids with a dark outline around coloured pixels', () => {
    for (const icon of Object.values(PIXEL_ICONS)) {
      expect(icon.rows).toHaveLength(PIXEL_ICON_SIZE);
      for (const row of icon.rows) {
        expect(row).toHaveLength(PIXEL_ICON_SIZE);
        for (const symbol of row) expect(PIXEL_ICON_SYMBOLS).toContain(symbol);
      }
      for (let y = 0; y < PIXEL_ICON_SIZE; y++) {
        for (let x = 0; x < PIXEL_ICON_SIZE; x++) {
          const symbol = icon.rows[y]![x]!;
          if (symbol === '.' || symbol === 'o') continue;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const neighbour = icon.rows[y + oy]?.[x + ox];
              expect(neighbour).not.toBe('.');
              expect(neighbour).toBeDefined();
            }
          }
        }
      }
    }
  });

  it('has complete life, city, device, event and category mappings', () => {
    expect(Object.keys(LIFE_PIXEL_ICONS)).toEqual([...LIFE_CLASS_KEYS]);
    expect(Object.keys(CITY_PIXEL_ICONS)).toEqual(TECH_AGES.map((age) => age.key));
    expect(Object.keys(DEVICE_PIXEL_ICONS)).toEqual([...DEVICE_KINDS]);
    expect(Object.keys(EVENT_PIXEL_ICONS)).toEqual(Object.keys(EVENT_IMPORTANCE));
    expect(Object.keys(EVENT_GROUP_PIXEL_ICONS)).toEqual([
      'geology',
      'climate',
      'life',
      'civilization',
      'goal',
      'impacts',
      'device',
    ]);
    for (const key of [
      ...Object.values(LIFE_PIXEL_ICONS),
      ...Object.values(CITY_PIXEL_ICONS),
      ...Object.values(DEVICE_PIXEL_ICONS),
      ...Object.values(EVENT_PIXEL_ICONS),
      ...Object.values(EVENT_GROUP_PIXEL_ICONS),
    ]) {
      expect(PIXEL_ICON_KEYS).toContain(key);
    }
  });

  it('uses distinct silhouettes for frequent located events', () => {
    const keys = [
      EVENT_PIXEL_ICONS.impact,
      EVENT_PIXEL_ICONS.largeEruption,
      EVENT_PIXEL_ICONS.plague,
      EVENT_PIXEL_ICONS.nuclearWar,
      EVENT_PIXEL_ICONS.earthquake,
      EVENT_PIXEL_ICONS.tsunami,
      EVENT_PIXEL_ICONS.cyclone,
      EVENT_PIXEL_ICONS.exodus,
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives each reviewed animal a distinct silhouette and colour family', () => {
    const animalKeys = [
      'arthropods',
      'radiates',
      'mollusks',
      'trichordates',
      'fish',
      'insects',
      'amphibians',
      'reptiles',
      'dinosaurs',
      'avians',
      'mammals',
      'cetaceans',
    ] as const;
    const icons = animalKeys.map((key) => PIXEL_ICONS[LIFE_PIXEL_ICONS[key]]);
    const silhouettes = icons.map((icon) =>
      icon.rows.map((row) => row.replace(/[sbla]/gu, '#')).join('\n'),
    );
    const colourFamilies = icons.map((icon) => icon.palette.slice(2).join(','));
    expect(new Set(silhouettes).size).toBe(animalKeys.length);
    expect(new Set(colourFamilies).size).toBe(animalKeys.length);
  });

  it('gives every device its own machine silhouette', () => {
    const silhouettes = Object.values(DEVICE_PIXEL_ICONS).map((key) =>
      PIXEL_ICONS[key].rows.map((row) => row.replace(/[sbla]/gu, '#')).join('\n'),
    );
    expect(new Set(silhouettes).size).toBe(DEVICE_KINDS.length);
  });

  it('supplies complete, distinct colour-vision palettes', () => {
    for (const key of PIXEL_ICON_KEYS) {
      const normal = pixelIconPalette(key, 'default');
      const safe = pixelIconPalette(key, 'colourBlind');
      expect(normal).toHaveLength(PIXEL_ICON_SYMBOLS.length);
      expect(safe).toHaveLength(PIXEL_ICON_SYMBOLS.length);
      expect(safe).not.toEqual(normal);
    }
  });
});

describe('pixel icon cache and scale', () => {
  it('chooses only crisp integer scales', () => {
    expect(pixelIconScale(14)).toBe(1);
    expect(pixelIconScale(23)).toBe(2);
    expect(pixelIconScale(38)).toBe(3);
  });

  it('creates once per icon, scale and palette tuple', () => {
    const cache = new PixelIconCache<object>();
    const create = vi.fn(() => ({}));
    const first = cache.get('lifePlants', 1, 'default', create);
    expect(cache.get('lifePlants', 1, 'default', create)).toBe(first);
    cache.get('lifePlants', 2, 'default', create);
    cache.get('lifePlants', 1, 'colourBlind', create);
    cache.get('lifeFish', 1, 'default', create);
    expect(create).toHaveBeenCalledTimes(4);
    expect(cache.size).toBe(4);
  });
});
