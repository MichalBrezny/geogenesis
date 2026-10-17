/**
 * Warmest monthly-mean temperature for a sinusoidal annual cycle.
 *
 * The stored amplitude is defined in monthly-mean terms, so no additional
 * averaging factor is applied here.
 */
export function warmestMonth(meanTemperature: number, amplitude: number): number {
  return meanTemperature + Math.max(0, amplitude);
}

/** Coldest monthly-mean temperature for a sinusoidal annual cycle. */
export function coldestMonth(meanTemperature: number, amplitude: number): number {
  return meanTemperature - Math.max(0, amplitude);
}

/**
 * Annual integral of temperature above freezing for T + A cos(theta), in
 * °C·yr. With no seasonal cycle this is exactly max(0, T).
 */
export function positiveDegreeDays(meanTemperature: number, amplitude: number): number {
  const a = Math.max(0, amplitude);
  if (a === 0) return Math.max(0, meanTemperature);
  if (meanTemperature >= a) return meanTemperature;
  if (meanTemperature <= -a) return 0;
  const warmLimit = Math.acos(-meanTemperature / a);
  return (meanTemperature * warmLimit + a * Math.sin(warmLimit)) / Math.PI;
}

/** Fraction of a sinusoidal year spent below a temperature threshold. */
export function fractionOfYearBelow(
  meanTemperature: number,
  amplitude: number,
  threshold: number,
): number {
  const a = Math.max(0, amplitude);
  if (a === 0) return meanTemperature < threshold ? 1 : 0;
  if (threshold <= meanTemperature - a) return 0;
  if (threshold >= meanTemperature + a) return 1;
  return 1 - Math.acos((threshold - meanTemperature) / a) / Math.PI;
}
