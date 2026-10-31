import { formatNumber, t, tp } from '../i18n/i18n';

/** CO₂ spans 1 ppm to a pure-CO₂ atmosphere, so show it with adaptive precision. */
export function formatPpm(ppm: number): string {
  return formatNumber(ppm < 10 ? ppm : Math.round(ppm), {
    minimumFractionDigits: ppm < 10 ? 1 : 0,
    maximumFractionDigits: ppm < 10 ? 1 : 0,
  });
}

/** Planet age in billions of years. */
export function formatGyr(years: number): string {
  return `${formatNumber(years / 1e9, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} Gyr`;
}

/** A calendar year of the planet, in full (events of a civilization are years apart). */
export function formatYear(year: number): string {
  return t('time.year', { year: formatNumber(Math.round(year)) });
}

/** Length of one simulation step: millions of years early on, years in the space age. */
export function formatStep(years: number): string {
  return years >= 1e6
    ? t('time.myr', { value: formatNumber(years / 1e6) })
    : tp('time.years', years);
}
