import { formatNumber } from '../../i18n/i18n';
import type { ChartSeries } from './HistoryCharts';

export interface TimeUnit {
  divisor: number;
  label: 'Gyr' | 'Myr' | 'kyr' | 'years';
  decimals: number;
}

/** Chooses a planet-age unit from the visible time span, not the absolute age. */
export function selectTimeUnit(spanYears: number): TimeUnit {
  const span = Math.abs(spanYears);
  if (span >= 1e9) return { divisor: 1e9, label: 'Gyr', decimals: span < 5e9 ? 2 : 1 };
  if (span >= 1e6) return { divisor: 1e6, label: 'Myr', decimals: span < 5e6 ? 2 : 1 };
  if (span >= 1e3) return { divisor: 1e3, label: 'kyr', decimals: span < 5e3 ? 2 : 1 };
  return { divisor: 1, label: 'years', decimals: span < 20 ? 1 : 0 };
}

/** Compact axis labels retain separators for ordinary values and use SI for large ones. */
export function formatAxisNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  const suffixes: readonly [number, string][] = [
    [1e12, 'T'],
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];
  for (const [threshold, suffix] of suffixes) {
    if (absolute >= threshold)
      return `${formatNumber(value / threshold, { maximumFractionDigits: 1 })}${suffix}`;
  }
  const smallSuffixes: readonly [number, string][] = [
    [1e-3, 'm'],
    [1e-6, 'µ'],
    [1e-9, 'n'],
  ];
  if (absolute > 0 && absolute < 0.1) {
    for (const [threshold, suffix] of smallSuffixes) {
      if (absolute >= threshold)
        return `${formatNumber(value / threshold, { maximumFractionDigits: 1 })}${suffix}`;
    }
  }
  return formatNumber(value, {
    maximumFractionDigits: absolute < 1 ? 3 : absolute < 10 ? 2 : 1,
  });
}

/** uPlot's logarithmic distribution cannot accept zero or negative samples. */
export function clampLogValue(value: number, floor: number): number {
  return Number.isFinite(value) ? Math.max(floor, value) : floor;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const pickerKey = (scenario: string) => `geogenesis.historyCharts.${scenario}`;

export function loadChartSelection(
  storage: StorageLike | undefined,
  scenario: string,
  defaults: readonly ChartSeries[],
  available: ReadonlySet<ChartSeries>,
): ChartSeries[] {
  if (!storage) return [...defaults];
  try {
    const raw = storage.getItem(pickerKey(scenario));
    if (raw === null) return [...defaults];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...defaults];
    const selected = parsed.filter(
      (item): item is ChartSeries => typeof item === 'string' && available.has(item as ChartSeries),
    );
    if (parsed.length > 0 && selected.length === 0) return [...defaults];
    return [...new Set(selected)];
  } catch {
    return [...defaults];
  }
}

export function saveChartSelection(
  storage: StorageLike | undefined,
  scenario: string,
  selected: readonly ChartSeries[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(pickerKey(scenario), JSON.stringify(selected));
    return true;
  } catch {
    return false;
  }
}
