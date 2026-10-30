import { describe, expect, it, vi } from 'vitest';
import {
  AmbientTileCache,
  ambientFeatureCounts,
  ambientHash,
  ambientPhase,
  createAmbientLayer,
  drawAmbient,
  nightFactor,
  selectWaterPattern,
  setAmbientMapView,
  type AmbientSource,
} from './ambient';

describe('ambient pixel patterns', () => {
  it('selects deterministic sparse patterns and favours open coast foam', () => {
    const coastal = Array.from({ length: 256 }, (_, cell) => selectWaterPattern(cell, true, 0));
    const open = Array.from({ length: 256 }, (_, cell) => selectWaterPattern(cell, false, 0));
    expect(coastal.filter((pattern) => pattern === 'foam').length).toBeGreaterThan(140);
    expect(open.filter(Boolean).length).toBeLessThan(15);
    expect(selectWaterPattern(41, true, 0)).toBe(selectWaterPattern(41, true, 0));
    expect(ambientHash(12, 4)).not.toBe(ambientHash(12, 5));
  });

  it('makes ice-covered water much calmer', () => {
    const open = Array.from({ length: 1000 }, (_, cell) => selectWaterPattern(cell, false, 0));
    const frozen = Array.from({ length: 1000 }, (_, cell) => selectWaterPattern(cell, false, 0.9));
    expect(frozen.filter(Boolean).length).toBeLessThan(open.filter(Boolean).length / 3);
  });
});

describe('ambient tile cache', () => {
  it('creates each sprite key once and can be invalidated with a palette change', () => {
    const cache = new AmbientTileCache<object>();
    const create = vi.fn(() => ({}));
    expect(cache.get('cloud:0:default', create)).toBe(cache.get('cloud:0:default', create));
    expect(create).toHaveBeenCalledTimes(1);
    cache.clear();
    cache.get('cloud:0:colourBlind', create);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('ambient animation timing', () => {
  it('wraps phases and sweeps a stable cosmetic terminator', () => {
    expect(ambientPhase(2500, 1000)).toBeCloseTo(0.5);
    expect(ambientPhase(500, 1000, 0.75)).toBeCloseTo(0.25);
    expect(nightFactor(180, 0)).toBe(1);
    expect(nightFactor(0, 0)).toBe(0);
    expect(nightFactor(270, 60_000)).toBe(1);
  });
});

describe('ambient candidate cost', () => {
  it('keeps a 256×128 frame sparse and selects it within a frame budget', () => {
    const width = 256;
    const height = 128;
    const cellCount = width * height;
    const elevation = new Float32Array(cellCount);
    elevation.fill(-100);
    for (let y = 0; y < height; y++) {
      for (let x = width / 2; x < width; x++) elevation[y * width + x] = 100;
    }
    const cloudCover = new Float32Array(cellCount);
    cloudCover.fill(0.7);
    const dominantClass = new Int32Array(cellCount);
    dominantClass.fill(-1);
    const source: AmbientSource = {
      worldRevision: 1,
      year: 1,
      stepYears: 1,
      grid: { width, height, cellCount },
      seaLevel: 0,
      fields: {
        elevation,
        iceCover: new Float32Array(cellCount),
        cloudCover,
        windU: new Float32Array(cellCount),
        windV: new Float32Array(cellCount),
        volcanicActivity: new Float32Array(cellCount),
        civilization: new Float32Array(cellCount),
        dominantClass,
      },
      civilization: { age: 0, cities: [] },
      events: [],
      tectonics: { hotspots: [] },
    };
    const started = performance.now();
    const layer = createAmbientLayer(source);
    const elapsed = performance.now() - started;
    const count = Object.values(ambientFeatureCounts(layer)).reduce((sum, value) => sum + value, 0);
    expect(count).toBeLessThan(cellCount / 5);
    expect(elapsed).toBeLessThan(100);

    layer.cloudSprites.fill({} as HTMLCanvasElement);
    setAmbientMapView(layer, { zoom: 1, latitude: 0, longitude: 180 }, 1280, 640);
    const context = {
      clearRect() {},
      save() {},
      restore() {},
      fillRect() {},
      drawImage() {},
      fillStyle: '',
      globalAlpha: 1,
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D;
    drawAmbient(context, layer, 0);
    const drawStarted = performance.now();
    for (let frame = 0; frame < 120; frame++) drawAmbient(context, layer, frame * 16.67);
    const millisecondsPerFrame = (performance.now() - drawStarted) / 120;
    expect(millisecondsPerFrame).toBeLessThan(8);
  });
});
