import type { SimComponent } from '../../core/component';
import { areaWeightedMean } from '../../core/grid';
import { isOcean } from '../geosphere/seaLevel';

/** Annual-mean temperatures bounding the smooth snow-fall transition. */
const ALL_SNOW_TEMPERATURE = -2;
const ALL_RAIN_TEMPERATURE = 2;
/** Slow loss from wind scour and sublimation, metres of ice per year. */
export const SUBLIMATION_RATE = 0.01;
/** Positive-degree ablation, metres of ice per year per degree above freezing. */
export const MELT_RATE = 0.3;
/** E-folding time for a land ice sheet to approach its mass-balance thickness. */
export const ICE_RESPONSE_TIME = 20_000;
/** Bounds on the characteristic thickness of a viable glacier or ice sheet. */
const MIN_ICE_THICKNESS = 300;
const MAX_ICE_THICKNESS = 2000;
/** Net accumulation at which ice reaches half its local sheet thickness, m/yr. */
const ACCUMULATION_HALF_SATURATION = 0.05;
/** A few tens of metres make a cell effectively glacier-covered. */
export const FULL_GLACIER_COVER_THICKNESS = 40;
/** Seasonal snow becomes spatially continuous around this annual precipitation. */
const SNOW_COVER_HALF_SATURATION = 100;
const WATER_TO_ICE = 1000 / 917;

/** Temperature-controlled sea-ice fraction, preserving the ice-albedo hysteresis. */
export function iceFractionAt(temperature: number): number {
  return Math.min(1, Math.max(0, (-5 - temperature) / 10));
}

/** Smooth fraction of precipitation that falls as snow. */
export function snowFractionAt(temperature: number): number {
  const x = Math.min(
    1,
    Math.max(
      0,
      (ALL_RAIN_TEMPERATURE - temperature) / (ALL_RAIN_TEMPERATURE - ALL_SNOW_TEMPERATURE),
    ),
  );
  return x * x * (3 - 2 * x);
}

/**
 * Snow or ice cover used by albedo, biomes and life. Sea ice is thermal;
 * grounded land ice comes from thickness, with precipitation-limited seasonal
 * snow on otherwise ice-free cold land. Thus a polar desert can remain bare.
 */
export function surfaceIceCover(
  ocean: boolean,
  temperature: number,
  precipitation: number,
  thickness: number,
): number {
  if (ocean) return iceFractionAt(temperature);
  const glacier = Math.min(1, Math.max(0, thickness / FULL_GLACIER_COVER_THICKNESS));
  // Lasting snow cover needs a cold climate (the same ramp as sea ice), and enough snowfall.
  const snow =
    iceFractionAt(temperature) *
    (Math.max(0, precipitation) / (Math.max(0, precipitation) + SNOW_COVER_HALF_SATURATION));
  return 1 - (1 - glacier) * (1 - snow);
}

/**
 * Grounded land ice from a climatological snow mass balance.
 *
 * Accumulation is snowfall converted to ice-equivalent depth. Ablation combines
 * a small year-round sublimation loss with positive-degree melt. The viable
 * ice extent sets a continent-scale sheet thickness, and each cell approaches
 * its share of that thickness with an exact exponential response. This is a
 * cheap flow-like relaxation: broad accumulation zones support thick sheets,
 * while isolated or marginal glaciers stay thin. The analytic update is stable
 * and nearly step-independent from historical to geological time steps.
 */
export const landIceMassBalance: SimComponent = {
  name: 'landIceMassBalance',
  inputs: ['elevation', 'airTemperature', 'precipitation', 'iceThickness'],
  outputs: ['iceThickness', 'iceCover'],
  runOneStep(state, dtYears) {
    const { grid, fields, globals } = state;
    const { elevation, airTemperature, precipitation, iceThickness, iceCover } = fields;
    const balance = new Float32Array(grid.cellCount);
    let landArea = 0;
    let viableArea = 0;

    for (let y = 0; y < grid.height; y++) {
      const area = grid.rowCellArea[y]!;
      for (let x = 0; x < grid.width; x++) {
        const i = y * grid.width + x;
        if (isOcean(elevation[i]!, globals.seaLevel)) {
          iceThickness[i] = 0;
          continue;
        }
        landArea += area;
        const snowfall =
          (Math.max(0, precipitation[i]!) / 1000) *
          WATER_TO_ICE *
          snowFractionAt(airTemperature[i]!);
        const melt = MELT_RATE * Math.max(0, airTemperature[i]!);
        const net = snowfall - melt - SUBLIMATION_RATE;
        balance[i] = net;
        if (net > 0) viableArea += area;
      }
    }

    const extent = landArea > 0 ? Math.min(1, viableArea / landArea) : 0;
    const sheetThickness =
      MIN_ICE_THICKNESS + (MAX_ICE_THICKNESS - MIN_ICE_THICKNESS) * Math.sqrt(extent);
    if (dtYears > 0) {
      for (let i = 0; i < grid.cellCount; i++) {
        if (isOcean(elevation[i]!, globals.seaLevel)) continue;
        const net = balance[i]!;
        const target = net > 0 ? sheetThickness * (net / (net + ACCUMULATION_HALF_SATURATION)) : 0;
        // Warm ice responds faster in proportion to its potential melt rate.
        const responseTime =
          net < 0
            ? Math.min(ICE_RESPONSE_TIME, sheetThickness / Math.max(-net, 1e-9))
            : ICE_RESPONSE_TIME;
        const response = 1 - Math.exp(-dtYears / responseTime);
        iceThickness[i] = Math.max(0, iceThickness[i]! + (target - iceThickness[i]!) * response);
      }
    }

    for (let i = 0; i < grid.cellCount; i++) {
      iceCover[i] = surfaceIceCover(
        isOcean(elevation[i]!, globals.seaLevel),
        airTemperature[i]!,
        precipitation[i]!,
        iceThickness[i]!,
      );
    }
    globals.iceFraction = areaWeightedMean(grid, iceCover);
  },
};
