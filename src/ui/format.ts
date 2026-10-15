/** CO₂ spans 1 ppm to a pure-CO₂ atmosphere, so show it with adaptive precision. */
export function formatPpm(ppm: number): string {
  return ppm < 10 ? ppm.toFixed(1) : Math.round(ppm).toLocaleString('en');
}

/** Planet age in billions of years. */
export function formatGyr(years: number): string {
  return `${(years / 1e9).toFixed(3)} Gyr`;
}
