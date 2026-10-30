import { describe, expect, it } from 'vitest';
import { createPlanet } from './core/planet';
import { SENTIENCE_POTENTIAL } from './data/civilization';
import type { LifeClassKey } from './data/lifeClasses';
import {
  generateCityName,
  generateFeatureName,
  isPronounceableName,
  updateMapNames,
} from './mapNames';

describe('map feature names', () => {
  it('is deterministic and always follows the pronounceability rules', () => {
    const first = Array.from({ length: 100 }, (_, ordinal) =>
      generateFeatureName(0x12345678, 'continent', ordinal),
    );
    const second = Array.from({ length: 100 }, (_, ordinal) =>
      generateFeatureName(0x12345678, 'continent', ordinal),
    );
    expect(second).toEqual(first);
    expect(first.every(isPronounceableName)).toBe(true);
    expect(new Set(first).size).toBeGreaterThan(90);
  });

  it('keeps a landmass name on the larger piece after a split', () => {
    const planet = createPlanet({ width: 12, height: 4, seed: 77 });
    planet.fields.elevation.fill(-1000);
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 8; x++) planet.fields.elevation[y * 12 + x] = 500;
    }
    updateMapNames(planet);
    const original = planet.mapNaming.features.find(
      (feature) => feature.kind === 'continent' || feature.kind === 'island',
    )!;

    for (let y = 1; y <= 2; y++) planet.fields.elevation[y * 12 + 5] = -1000;
    updateMapNames(planet);

    const larger = planet.mapNaming.features.find(
      (feature) =>
        (feature.kind === 'continent' || feature.kind === 'island') &&
        feature.footprint.some((cell) => cell % 12 <= 4),
    );
    const smaller = planet.mapNaming.features.find(
      (feature) =>
        (feature.kind === 'continent' || feature.kind === 'island') &&
        feature.footprint.some((cell) => cell % 12 >= 6),
    );
    expect(larger?.name).toBe(original.name);
    expect(smaller?.name).not.toBe(original.name);
  });

  it('generates deterministic, pronounceable names from each sentient species palette', () => {
    const initials: Partial<Record<LifeClassKey, RegExp>> = {
      arthropods: /^[KPTZ]/,
      mollusks: /^[LMNV]/,
      trichordates: /^[DLRT]/,
      fish: /^[FLSV]/,
      insects: /^[KPTV]/,
      amphibians: /^[BGLM]/,
      reptiles: /^[KRSZ]/,
      dinosaurs: /^[DKRT]/,
      avians: /^[LRSV]/,
      mammals: /^[BDMNV]/,
      cetaceans: /^[HLMNW]/,
    };
    const species = Object.keys(SENTIENCE_POTENTIAL) as LifeClassKey[];
    const signatures = species.map((key) => {
      const names = Array.from({ length: 40 }, (_, ordinal) =>
        generateCityName(0x12345678, key, ordinal),
      );
      expect(names).toEqual(
        Array.from({ length: 40 }, (_, ordinal) => generateCityName(0x12345678, key, ordinal)),
      );
      expect(names.every(isPronounceableName)).toBe(true);
      expect(names.every((name) => initials[key]!.test(name))).toBe(true);
      return names.join('|');
    });
    expect(new Set(signatures).size).toBe(species.length);
  });
});
