import type { SimComponent } from '../../core/component';
import { SEA_LEVEL } from '../geosphere/flowRouting';

/**
 * Distance (m) over which inland air loses about 63% of its moisture without mountains.
 * Long, because vegetation and soils re-evaporate much of the rain (moisture recycling).
 */
const INLAND_DECAY_LENGTH = 4_000_000;
/** Climbs smaller than this (m per cell) are terrain noise and do not force rain out. */
const OROGRAPHIC_THRESHOLD = 150;
/** Fraction of the remaining moisture rained out per 1000 m of terrain the wind climbs. */
const OROGRAPHIC_RAINOUT = 0.35;
/** Extra rain on windward slopes: multiplier per 1000 m climbed within one cell. */
const OROGRAPHIC_BOOST = 1.5;
/** Precipitation increases by this fraction per °C (Clausius–Clapeyron, damped). */
const TEMPERATURE_SENSITIVITY = 0.03;
const REFERENCE_TEMPERATURE = 15;

/**
 * Zonal-mean precipitation (mm/yr) of an Earth-like planet at a latitude: wet
 * tropics (ITCZ), dry subtropics, wetter mid-latitude storm tracks, dry poles.
 */
export function zonalPrecipitation(latitudeDeg: number): number {
  const a = Math.abs(latitudeDeg);
  const tropics = 1700 * Math.exp(-((a / 9) ** 2));
  const subtropicalDryness = 450 * Math.exp(-(((a - 27) / 9) ** 2));
  const stormTracks = 450 * Math.exp(-(((a - 50) / 12) ** 2));
  const polarDryness = Math.max(0, (a - 60) / 30) * 300;
  return Math.max(100, 750 + tropics - subtropicalDryness + stormTracks - polarDryness);
}

/** Prevailing surface wind along a latitude: +1 blows towards the east, −1 towards the west. */
export function prevailingWind(latitudeDeg: number): 1 | -1 {
  const a = Math.abs(latitudeDeg);
  return a >= 30 && a < 60 ? 1 : -1;
}

/**
 * Share of a latitude's rain that falls regardless of how much moisture the wind
 * brings: high in the convective tropics, low where rain comes from passing air.
 */
function localShare(latitudeDeg: number): number {
  return 0.25 + 0.5 * Math.exp(-((latitudeDeg / 12) ** 2));
}

/**
 * Annual precipitation (mm/yr).
 *
 * Moisture is carried along each latitude row by the prevailing wind: it is
 * replenished over the ocean, slowly lost over land, and rained out where the
 * wind climbs mountains, which leaves rain shadows behind them. The result
 * scales the zonal-mean precipitation of the row and is adjusted for
 * temperature, since warmer air carries more water.
 */
export const precipitationModel: SimComponent = {
  name: 'precipitation',
  inputs: ['elevation', 'airTemperature'],
  outputs: ['precipitation'],
  runOneStep(state) {
    const { grid, fields } = state;
    const { elevation, airTemperature, precipitation } = fields;
    const { width } = grid;

    for (let y = 0; y < grid.height; y++) {
      const latitude = grid.rowLatitude[y]!;
      const zonal = zonalPrecipitation(latitude);
      const wind = prevailingWind(latitude);
      const dx = grid.rowDx[y]!;
      const row = y * width;
      const decay = Math.exp(-dx / INLAND_DECAY_LENGTH);
      const local = localShare(latitude);

      // Start just downwind of an ocean cell if the row has one; go round twice so the
      // moisture arriving at the start of the sweep is consistent with the wrap-around.
      let start = 0;
      for (let x = 0; x < width; x++) {
        if (elevation[row + x]! < SEA_LEVEL) {
          start = x;
          break;
        }
      }
      let moisture = 1;
      let previousHeight = Math.max(SEA_LEVEL, elevation[row + start]!);
      for (let step = 0; step < 2 * width; step++) {
        const x = (((start + wind * step) % width) + width) % width;
        const i = row + x;
        const height = elevation[i]!;
        let amount: number;
        if (height < SEA_LEVEL) {
          moisture = 1;
          amount = zonal;
          previousHeight = SEA_LEVEL;
        } else {
          const climb = Math.max(0, height - previousHeight - OROGRAPHIC_THRESHOLD) / 1000;
          amount = zonal * (local + (1 - local) * moisture) * (1 + OROGRAPHIC_BOOST * climb);
          moisture *= decay * Math.max(0, 1 - OROGRAPHIC_RAINOUT * climb);
          previousHeight = height;
        }
        if (step >= width) {
          const warmth = Math.exp(
            TEMPERATURE_SENSITIVITY * (airTemperature[i]! - REFERENCE_TEMPERATURE),
          );
          precipitation[i] = amount * Math.min(3, warmth);
        }
      }
    }
    smoothNorthSouth(precipitation, grid.width, grid.height);
  },
};

/**
 * Rows are computed independently, which leaves east-west streaks; one [1 2 1]
 * pass across rows blends them, as real weather systems span many latitudes.
 */
function smoothNorthSouth(values: Float32Array, width: number, height: number): void {
  const source = Float32Array.from(values);
  for (let y = 0; y < height; y++) {
    const north = Math.max(0, y - 1) * width;
    const south = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      values[i] = (source[north + x]! + 2 * source[i]! + source[south + x]!) / 4;
    }
  }
}
