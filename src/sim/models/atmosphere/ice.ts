import type { SimComponent } from '../../core/component';
import { areaWeightedMean } from '../../core/grid';
import type { PlanetState } from '../../core/planet';
import { atmosphericWaterGel, isOcean, landIceWaterGel } from '../geosphere/seaLevel';
import { fractionOfYearBelow, positiveDegreeDays } from './seasons';

/** Annual-mean temperatures bounding the smooth snow-fall transition. */
const ALL_SNOW_TEMPERATURE = -2;
const ALL_RAIN_TEMPERATURE = 2;
/** Slow loss from wind scour and sublimation, metres of ice per year. */
export const SUBLIMATION_RATE = 0.01;
/** Positive-degree ablation, metres of ice per °C·yr of positive degree days. */
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
/** Largest share of a planet's non-vapour water its land ice can lock up. */
const MAX_ICE_SHARE = 0.8;

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

/** Mean snowfall share over a sinusoidal year with precipitation spread evenly through it. */
export function seasonalSnowFractionAt(temperature: number, amplitude: number): number {
  if (amplitude <= 0) return snowFractionAt(temperature);
  let snow = 0;
  for (const cosine of SEASONAL_COSINES) {
    snow += snowFractionAt(temperature + amplitude * cosine);
  }
  return snow / SEASONAL_COSINES.length;
}

/** Albedo-relevant seasonal ice from the sunlit fraction of the year below the ice ramp. */
function seasonalThermalIceCover(temperature: number, amplitude: number): number {
  if (amplitude <= 0) return iceFractionAt(temperature);
  // Most cells are far outside the narrow ice-edge band. These bounds produce
  // exactly the same all-zero/all-one quadrature result without three inverse
  // cosine evaluations per cell in every climate iteration.
  if (
    temperature >= -5 &&
    temperature - amplitude >= -10 + 5 * ICE_QUADRATURE_NODES[2]!
  ) {
    return 0;
  }
  if (
    temperature <= -15 &&
    temperature + amplitude <= -10 + 5 * ICE_QUADRATURE_NODES[0]!
  ) {
    return 1;
  }
  let ice = 0;
  for (let sample = 0; sample < ICE_QUADRATURE_NODES.length; sample++) {
    const threshold = -10 + 5 * ICE_QUADRATURE_NODES[sample]!;
    ice +=
      0.5 *
      ICE_QUADRATURE_WEIGHTS[sample]! *
      sunlitFractionBelow(temperature, amplitude, threshold);
  }
  const seasonal = Math.max(0, Math.min(1, ice));
  const blend = Math.min(1, amplitude / 0.5);
  return iceFractionAt(temperature) * (1 - blend) + seasonal * blend;
}

/** Threshold-crossing fraction weighted by 1 + s cos(phase), with phase zero in summer. */
function sunlitFractionBelow(temperature: number, amplitude: number, threshold: number): number {
  const fraction = fractionOfYearBelow(temperature, amplitude, threshold);
  const x = (threshold - temperature) / amplitude;
  if (x <= -1 || x >= 1) return fraction;
  return Math.max(0, fraction - (SUMMER_SUN_WEIGHT * Math.sqrt(1 - x * x)) / Math.PI);
}

const SUMMER_SUN_WEIGHT = 0.65;
/** Eight midpoint samples; constants avoid trigonometry in the climate's albedo iteration. */
const SEASONAL_COSINES = [
  0.9238795325, 0.3826834324, -0.3826834324, -0.9238795325, -0.9238795325, -0.3826834324,
  0.3826834324, 0.9238795325,
] as const;
const ICE_QUADRATURE_NODES = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)] as const;
const ICE_QUADRATURE_WEIGHTS = [5 / 9, 8 / 9, 5 / 9] as const;

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
  seasonalAmplitude = 0,
): number {
  const thermalIce = seasonalThermalIceCover(temperature, seasonalAmplitude);
  if (ocean) return thermalIce;
  const glacier = Math.min(1, Math.max(0, thickness / FULL_GLACIER_COVER_THICKNESS));
  // Lasting snow cover needs a cold climate (the same ramp as sea ice), and enough snowfall.
  const snow =
    thermalIce *
    (Math.max(0, precipitation) / (Math.max(0, precipitation) + SNOW_COVER_HALF_SATURATION));
  return 1 - (1 - glacier) * (1 - snow);
}

/**
 * Land ice cannot hold more water than the planet has. The mass balance is driven
 * by last step's precipitation, so on a nearly dry world (Mars: 0.1 m GEL) it could
 * lock up more than the whole inventory, emptying the sea that fed the snow; the next
 * step then had no snow, the ice vanished and the sea returned (a period-two flip).
 * The ice volume D is limited smoothly against the non-vapour water A: unchanged up
 * to D = A/2, then saturating (continuous slope) towards MAX_ICE_SHARE · A. The snow
 * that feeds the ice evaporates from the sea, and a sea shrunk to its deepest pools
 * stops supplying it before it is gone, so a small sea and a steady state remain.
 * Earth's ice (< 3 % of its water) is never touched.
 */
function limitIceToInventory(state: PlanetState): void {
  const available = Math.max(0, state.globals.water - atmosphericWaterGel(state));
  const demand = landIceWaterGel(state);
  if (demand <= available / 2) return;
  const excess = demand - available / 2;
  const room = (MAX_ICE_SHARE - 0.5) * available;
  const allowed = available / 2 + (room * excess) / (excess + room);
  const scale = Math.max(0, allowed / demand);
  const thickness = state.fields.iceThickness;
  for (let i = 0; i < thickness.length; i++) thickness[i] = thickness[i]! * scale;
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
  inputs: ['elevation', 'airTemperature', 'seasonalAmplitude', 'precipitation', 'iceThickness'],
  outputs: ['iceThickness', 'iceCover'],
  runOneStep(state, dtYears) {
    const { grid, fields, globals } = state;
    const { elevation, airTemperature, seasonalAmplitude, precipitation, iceThickness, iceCover } =
      fields;
    const balance = new Float32Array(grid.cellCount);
    const frozen = new Uint8Array(grid.cellCount);
    let landArea = 0;
    let oceanArea = 0;
    let viableArea = 0;

    for (let y = 0; y < grid.height; y++) {
      const area = grid.rowCellArea[y]!;
      for (let x = 0; x < grid.width; x++) {
        const i = y * grid.width + x;
        if (isOcean(elevation[i]!, globals.seaLevel)) {
          iceThickness[i] = 0;
          oceanArea += area;
          continue;
        }
        landArea += area;
        const snowfall =
          (Math.max(0, precipitation[i]!) / 1000) *
          WATER_TO_ICE *
          seasonalSnowFractionAt(airTemperature[i]!, seasonalAmplitude[i]!);
        const melt = MELT_RATE * positiveDegreeDays(airTemperature[i]!, seasonalAmplitude[i]!);
        const net = snowfall - melt - SUBLIMATION_RATE;
        balance[i] = net;
        if (melt <= 0) frozen[i] = 1;
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
        // With no sea left to carry it away, ice that never melts only sublimates and
        // frosts out again nearby (cold trapping), so it persists instead of vanishing
        // for want of snowfall (which needs a sea to evaporate from).
        if (oceanArea === 0 && frozen[i] && net <= 0) continue;
        const target = net > 0 ? sheetThickness * (net / (net + ACCUMULATION_HALF_SATURATION)) : 0;
        // Warm ice responds faster in proportion to its potential melt rate.
        const responseTime =
          net < 0
            ? Math.min(ICE_RESPONSE_TIME, sheetThickness / Math.max(-net, 1e-9))
            : ICE_RESPONSE_TIME;
        const response = 1 - Math.exp(-dtYears / responseTime);
        iceThickness[i] = Math.max(0, iceThickness[i]! + (target - iceThickness[i]!) * response);
      }
      limitIceToInventory(state);
    }

    for (let i = 0; i < grid.cellCount; i++) {
      iceCover[i] = surfaceIceCover(
        isOcean(elevation[i]!, globals.seaLevel),
        airTemperature[i]!,
        precipitation[i]!,
        iceThickness[i]!,
        seasonalAmplitude[i]!,
      );
    }
    globals.iceFraction = areaWeightedMean(grid, iceCover);
  },
};
