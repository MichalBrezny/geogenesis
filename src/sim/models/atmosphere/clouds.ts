import type { SimComponent } from '../../core/component';
import { areaWeightedMean } from '../../core/grid';
import { isOcean } from '../geosphere/seaLevel';
import { potentialEvapotranspiration } from '../hydrology';
import { REFERENCE_WATER_VAPOR } from './atmosphere';

/** Rain (mm/yr) at which convective and frontal cloud reaches half its maximum. */
const CONVECTIVE_HALF_RAIN = 700;
const MAX_CONVECTIVE_CLOUD = 0.8;
/** Low cloud over the open sea, and how much it thickens per °C of cold water (stratus decks). */
const SEA_LOW_CLOUD = 0.4;
const STRATUS_PER_DEGREE = 0.06;
/** Low cloud over land ranges from desert skies to humid lowlands with the aridity index. */
const DRY_LAND_LOW_CLOUD = 0.1;
const HUMID_LAND_LOW_CLOUD = 0.45;
/**
 * Low cloud already contained in the "typical cloud" surface albedos, so only
 * departures from it change the planet's albedo (about Earth's area mean).
 */
export const REFERENCE_LOW_CLOUD = 0.31;
/**
 * Extra planetary albedo per unit of low cloud above the reference. Low clouds
 * are bright and warm-topped, so they reflect much more sunlight than they trap
 * heat: they cool. High convective clouds roughly cancel and get no net term.
 */
export const LOW_CLOUD_ALBEDO = 0.3;
/**
 * Share of the reference (Earth) water-vapour column below which low cloud thins out:
 * clouds need water. Earth, even in glaciations, stays above it; a frozen Mars-like
 * world (vapour ~1% of Earth) or a dry Venus (none) loses its water clouds.
 */
const CLOUD_VAPOR_SHARE = 0.05;

/**
 * Cloud cover diagnosed from the moisture budget's results.
 *
 * High (convective and frontal) cloud grows with rain: the ITCZ, storm tracks
 * and windward mountains. Low cloud covers much of the sea and thickens into
 * stratus decks over cold currents and upwelling; over land it follows how
 * humid the climate is, so deserts have clear skies. Total cover combines both.
 *
 * The climate reads `lowCloud` (from the last step, like the ocean anomaly):
 * low cloud above the reference brightens and cools a cell, below it darkens
 * and warms it — so cold upwelling cools its coast further, and drying land
 * warms. The global mean stays near the reference, keeping the calibration.
 */
export const cloudModel: SimComponent = {
  name: 'clouds',
  inputs: ['elevation', 'airTemperature', 'precipitation', 'oceanAnomaly'],
  outputs: ['cloudCover', 'lowCloud'],
  runOneStep(state) {
    const { grid, fields, globals } = state;
    const { elevation, airTemperature, precipitation, oceanAnomaly, cloudCover, lowCloud } = fields;
    const moisture = Math.min(
      1,
      globals.atmosphere.waterVapor / (CLOUD_VAPOR_SHARE * REFERENCE_WATER_VAPOR),
    );
    for (let i = 0; i < grid.cellCount; i++) {
      const rain = Math.max(0, precipitation[i]!);
      const high = (MAX_CONVECTIVE_CLOUD * rain) / (rain + CONVECTIVE_HALF_RAIN);
      let low: number;
      if (isOcean(elevation[i]!, globals.seaLevel)) {
        // Stratus needs cold water and is broken up by deep convection.
        low = SEA_LOW_CLOUD + STRATUS_PER_DEGREE * Math.max(0, -oceanAnomaly[i]!) - 0.2 * high;
      } else {
        const pet = potentialEvapotranspiration(airTemperature[i]!);
        const humidity = pet > 0 ? Math.min(1, rain / pet) : 1;
        low = DRY_LAND_LOW_CLOUD + (HUMID_LAND_LOW_CLOUD - DRY_LAND_LOW_CLOUD) * humidity;
      }
      low = Math.max(0, Math.min(0.9, low)) * moisture;
      lowCloud[i] = low;
      cloudCover[i] = 1 - (1 - high) * (1 - low);
    }
    globals.cloudCover = areaWeightedMean(grid, cloudCover);
  },
};
