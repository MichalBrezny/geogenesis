import type { SimComponent } from '../../core/component';
import { areaWeightedMean, type Grid } from '../../core/grid';
import { MICROBAR_TO_BAR, updateSurfacePressure } from './atmosphere';

/** CO2 frost albedo on Mars; clean seasonal frost is about 0.60-0.65. */
export const CO2_FROST_ALBEDO = 0.65;
/** One tenth of a millibar local column is already optically thick frost. */
export const CO2_FROST_OPTICAL_DEPTH_BAR = 1e-4;
/** Surface-atmosphere exchange is seasonal, effectively instant on geological steps. */
export const CO2_FROST_RELAXATION_YEARS = 1;
/** Below 1 mbar CO2 its frost point is outside the modelled climate range. */
export const CO2_FROST_GUARD_MICROBAR = 1000;
/** The compact collapse model is only active for tenuous atmospheres. */
export const CO2_FROST_MAX_ACTIVE_PRESSURE_BAR = 0.1;
/** Seed a saved/permanent reservoir over the coldest winter terrain before albedo feedback. */
const CAP_SEED_TEMPERATURE_RANGE = 20;
/** Keeps already saturated cells in the distributed cap despite Float32 rounding. */
const CAP_DISTRIBUTION_MARGIN = 0.5;
/** Annual-harmonic temperatures omit the cap's full latent-heat budget; avoid spurious ablation. */
const CAP_SUBLIMATION_MARGIN_K = 10;

const KELVIN_OFFSET = 273.15;
const PASCALS_PER_BAR = 100_000;

/**
 * CO2 sublimation temperature from partial pressure. The fit is the
 * James et al. (1992) Clausius-Clapeyron fit, with p converted from Pa to hPa:
 * T = 3182.48 / (23.3494 - ln(p / 100)). It gives 147.6 K at 6 mbar.
 */
export function co2FrostPointK(partialPressureBar: number): number {
  const pressurePa = Math.max(1e-12, partialPressureBar) * PASCALS_PER_BAR;
  return 3182.48 / (23.3494 - Math.log(pressurePa / 100));
}

/** Inverse of co2FrostPointK: equilibrium CO2 vapour pressure in bar. */
export function co2VaporPressureBar(temperatureK: number): number {
  const temperature = Math.max(1, temperatureK);
  return (100 * Math.exp(23.3494 - 3182.48 / temperature)) / PASCALS_PER_BAR;
}

/** Fraction of a cell visibly covered by its local CO2-frost column. */
export function co2FrostCover(localColumnBar: number): number {
  return localColumnBar <= 0
    ? 0
    : 1 - Math.exp(-localColumnBar / CO2_FROST_OPTICAL_DEPTH_BAR);
}

/**
 * Leighton-Murray CO2 buffer. The coldest winter surface sets the vapour
 * pressure; mass moves exactly between atmosphere and cap with exponential
 * relaxation, making geological-step results independent of step length.
 */
export const co2FrostCycle: SimComponent = {
  name: 'co2Frost',
  inputs: ['airTemperature', 'seasonalAmplitude'],
  outputs: ['co2Ice'],
  runOneStep(state, dtYears) {
    const { globals, fields, grid } = state;
    const atmosphericBar = Math.max(0, globals.atmosphere.co2) * MICROBAR_TO_BAR;
    const capBar = Math.max(0, globals.co2Ice);

    // This is both an Earth-neutrality guarantee and the normal fast path: no
    // field scan or floating-point state change when CO2 cannot frost.
    if (
      capBar <= 0 &&
      (globals.atmosphere.co2 < CO2_FROST_GUARD_MICROBAR ||
        globals.surfacePressure >= CO2_FROST_MAX_ACTIVE_PRESSURE_BAR)
    ) {
      return;
    }

    let coldestK = Infinity;
    for (let i = 0; i < grid.cellCount; i++) {
      coldestK = Math.min(
        coldestK,
        fields.airTemperature[i]! - fields.seasonalAmplitude[i]! + KELVIN_OFFSET,
      );
    }

    const totalBar = atmosphericBar + capBar;
    const currentFrostK = co2FrostPointK(atmosphericBar);
    const equilibriumAtmosphere =
      capBar > 0 && coldestK <= currentFrostK + CAP_SUBLIMATION_MARGIN_K
        ? atmosphericBar
        : Math.min(totalBar, co2VaporPressureBar(coldestK));
    const relaxation = dtYears > 0 ? -Math.expm1(-dtYears / CO2_FROST_RELAXATION_YEARS) : 0;
    const nextAtmosphere = atmosphericBar + (equilibriumAtmosphere - atmosphericBar) * relaxation;
    globals.atmosphere.co2 = Math.max(0, nextAtmosphere) / MICROBAR_TO_BAR;
    globals.co2Ice = Math.max(0, totalBar - nextAtmosphere);
    updateSurfacePressure(globals);

    distributeCap(
      grid,
      fields.airTemperature,
      fields.seasonalAmplitude,
      fields.co2Ice,
      globals.co2Ice,
      nextAtmosphere,
      state.planetParams.tidallyLocked,
    );

    // Latent heat pins the coldest-month cap surface at the current frost point.
    const frostC = co2FrostPointK(nextAtmosphere) - KELVIN_OFFSET;
    for (let i = 0; i < grid.cellCount; i++) {
      if (fields.co2Ice[i]! <= 0) continue;
      if (fields.airTemperature[i]! < frostC) fields.airTemperature[i] = frostC;
      fields.seasonalAmplitude[i] = Math.min(
        fields.seasonalAmplitude[i]!,
        Math.max(0, fields.airTemperature[i]! - frostC),
      );
    }
    globals.meanTemperature = areaWeightedMean(grid, fields.airTemperature);
  },
};

function distributeCap(
  grid: Grid,
  temperature: Float32Array,
  seasonalAmplitude: Float32Array,
  localIce: Float32Array,
  capBar: number,
  atmosphericBar: number,
  tidallyLocked: boolean,
): void {
  if (capBar <= 0) {
    localIce.fill(0);
    return;
  }
  const frostC = co2FrostPointK(atmosphericBar) - KELVIN_OFFSET;
  let weightedCold = 0;
  let coldest = 0;
  let coldestTemperature = Infinity;
  for (let i = 0; i < grid.cellCount; i++) {
    const winter = temperature[i]! - seasonalAmplitude[i]!;
    if (winter < coldestTemperature) {
      coldestTemperature = winter;
      coldest = i;
    }
    const latitude = Math.abs(grid.rowLatitude[Math.floor(i / grid.width)]!);
    const polarSeed = tidallyLocked ? 0 : Math.max(0, (latitude - 55) / 35);
    const cold = Math.max(polarSeed, frostC + CAP_DISTRIBUTION_MARGIN - winter, 0);
    weightedCold += cold * grid.rowAreaWeight[Math.floor(i / grid.width)]!;
  }
  localIce.fill(0);
  if (weightedCold <= 0) {
    let weightedSeed = 0;
    for (let i = 0; i < grid.cellCount; i++) {
      const winter = temperature[i]! - seasonalAmplitude[i]!;
      const seed = Math.max(0, coldestTemperature + CAP_SEED_TEMPERATURE_RANGE - winter);
      weightedSeed += seed * grid.rowAreaWeight[Math.floor(i / grid.width)]!;
    }
    if (weightedSeed <= 0) {
      const weight = grid.rowAreaWeight[Math.floor(coldest / grid.width)]!;
      localIce[coldest] = capBar / weight;
      return;
    }
    const seedScale = capBar / weightedSeed;
    for (let i = 0; i < grid.cellCount; i++) {
      const winter = temperature[i]! - seasonalAmplitude[i]!;
      localIce[i] =
        Math.max(0, coldestTemperature + CAP_SEED_TEMPERATURE_RANGE - winter) * seedScale;
    }
    return;
  }
  const scale = capBar / weightedCold;
  for (let i = 0; i < grid.cellCount; i++) {
    const winter = temperature[i]! - seasonalAmplitude[i]!;
    const latitude = Math.abs(grid.rowLatitude[Math.floor(i / grid.width)]!);
    const polarSeed = tidallyLocked ? 0 : Math.max(0, (latitude - 55) / 35);
    localIce[i] =
      Math.max(polarSeed, frostC + CAP_DISTRIBUTION_MARGIN - winter, 0) * scale;
  }
}
