/** Potential evapotranspiration (mm/yr) per °C above the freezing-climate offset. */
const PET_PER_DEGREE = 60;
const PET_ZERO = -5;

/**
 * Annual potential evapotranspiration (mm/yr), using the same simple
 * temperature relationship throughout runoff, lakes and biome aridity.
 */
export function potentialEvapotranspiration(temperature: number): number {
  return PET_PER_DEGREE * Math.max(0, temperature - PET_ZERO);
}
