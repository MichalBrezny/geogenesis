import type { Atmosphere, GlobalState } from '../../core/planet';

/** Atmospheric mixing ratios stored as "ppm" are partial pressures in microbar. */
export const MICROBAR_TO_BAR = 1e-6;
/** Present global-mean precipitable-water column, represented as pressure (bar). */
export const REFERENCE_WATER_VAPOR = 0.0025;

const REFERENCE_ATMOSPHERE: Atmosphere = {
  n2: 0.78084,
  inert: 0.00934,
  co2: 280,
  ch4: 0.7,
  o2: 0.21,
  waterVapor: REFERENCE_WATER_VAPOR,
};

/**
 * Total pressure in bar. Oxygen remains stored as a volume fraction for the
 * biosphere, so pO2 is the value that makes that fraction of the complete air.
 */
export function surfacePressureOf(atmosphere: Atmosphere): number {
  const withoutOxygen =
    Math.max(0, atmosphere.n2) +
    Math.max(0, atmosphere.inert) +
    Math.max(0, atmosphere.co2) * MICROBAR_TO_BAR +
    Math.max(0, atmosphere.ch4) * MICROBAR_TO_BAR +
    Math.max(0, atmosphere.waterVapor);
  return withoutOxygen / Math.max(1e-6, 1 - Math.max(0, Math.min(0.95, atmosphere.o2)));
}

export const REFERENCE_SURFACE_PRESSURE = surfacePressureOf(REFERENCE_ATMOSPHERE);

/** Oxygen partial pressure in bar, consistent with its stored volume fraction. */
export function oxygenPartialPressure(atmosphere: Atmosphere): number {
  return Math.max(0, atmosphere.o2) * surfacePressureOf(atmosphere);
}

/** Updates the cached global pressure after a gas reservoir changes. */
export function updateSurfacePressure(globals: GlobalState): number {
  globals.surfacePressure = surfacePressureOf(globals.atmosphere);
  return globals.surfacePressure;
}

/**
 * Boiling point of water (deg C) at total pressure, from an integrated
 * Clausius-Clapeyron relation anchored at 100 deg C and 1 atmosphere. The
 * constant latent heat fit is intentionally simple over terrestrial pressures.
 */
export function boilingPointC(pressureBar: number): number {
  const pressure = Math.max(1e-6, pressureBar);
  // Below the triple-point pressure bulk liquid water is not stable.
  if (pressure <= 0.00611657) return 0.01;
  const referenceTemperature = 373.15;
  const referencePressure = 1.01325;
  const latentHeatOverGasConstant = 4890;
  const inverseTemperature =
    1 / referenceTemperature - Math.log(pressure / referencePressure) / latentHeatOverGasConstant;
  return Math.max(-120, Math.min(700, 1 / inverseTemperature - 273.15));
}
