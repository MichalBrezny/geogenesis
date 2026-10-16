import { t } from '../i18n/i18n';

/** CO₂ spans 1 ppm to a pure-CO₂ atmosphere, so show it with adaptive precision. */
export function formatPpm(ppm: number): string {
  return ppm < 10 ? ppm.toFixed(1) : Math.round(ppm).toLocaleString('en');
}

/** Planet age in billions of years. */
export function formatGyr(years: number): string {
  return `${(years / 1e9).toFixed(3)} Gyr`;
}

/** A calendar year of the planet, in full (events of a civilization are years apart). */
export function formatYear(year: number): string {
  return t('time.year', { year: Math.round(year).toLocaleString('en') });
}

/** Length of one simulation step: millions of years early on, years in the space age. */
export function formatStep(years: number): string {
  return years >= 1e6
    ? t('time.myr', { value: (years / 1e6).toLocaleString('en') })
    : t('time.years', { value: years.toLocaleString('en') });
}
