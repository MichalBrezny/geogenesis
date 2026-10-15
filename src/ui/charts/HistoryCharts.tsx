import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { t, type MessageKey } from '../../i18n/i18n';
import type { HistorySeries } from '../../sim/history';
import { formatGyr, formatPpm } from '../format';

interface ChartSpec {
  series: Exclude<HistorySeries, 'year'>;
  title: MessageKey;
  /** Converts the recorded value to the plotted one (e.g. fraction to %). */
  scale?: number;
  format: (value: number) => string;
  log?: boolean;
}

const CHARTS: readonly ChartSpec[] = [
  { series: 'meanTemperature', title: 'chart.temperature', format: (v) => `${v.toFixed(1)} °C` },
  { series: 'co2', title: 'chart.co2', format: (v) => `${formatPpm(v)} ppm`, log: true },
  { series: 'iceFraction', title: 'chart.ice', scale: 100, format: (v) => `${v.toFixed(1)}%` },
  { series: 'landFraction', title: 'chart.land', scale: 100, format: (v) => `${v.toFixed(1)}%` },
  { series: 'solarInput', title: 'chart.sun', scale: 100, format: (v) => `${v.toFixed(1)}%` },
  {
    series: 'whiteDaisies',
    title: 'chart.whiteDaisies',
    scale: 100,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    series: 'blackDaisies',
    title: 'chart.blackDaisies',
    scale: 100,
    format: (v) => `${v.toFixed(1)}%`,
  },
];

export type ChartSeries = ChartSpec['series'];

/** Shared by all charts so hovering one shows the same moment in all of them. */
const CURSOR_SYNC_KEY = 'planet-history';

interface Props {
  history: Record<HistorySeries, Float64Array>;
  /** Which measures to chart, in this order. */
  series: readonly ChartSeries[];
}

/**
 * Small multiples of the planet's global history, one measure per chart on a
 * shared time axis (never two measures on one chart with two y-axes).
 */
export function HistoryCharts({ history, series }: Props) {
  const specs = series.map((name) => CHARTS.find((spec) => spec.series === name)!);
  return (
    <section className="history" aria-label={t('chart.sectionLabel')}>
      {specs.map((spec) => (
        <HistoryChart key={spec.series} spec={spec} history={history} />
      ))}
    </section>
  );
}

function HistoryChart({ spec, history }: { spec: ChartSpec; history: Props['history'] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [hovered, setHovered] = useState<{ year: number; value: number } | null>(null);

  const scale = spec.scale ?? 1;
  const years = history.year;
  const values = history[spec.series];
  const latest = values.length > 0 ? values[values.length - 1]! * scale : undefined;

  // Create the plot once; data updates go through setData below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const style = getComputedStyle(container);
    const token = (name: string) => style.getPropertyValue(name).trim();
    const axis: uPlot.Axis = {
      stroke: token('--text-secondary'),
      grid: { stroke: token('--grid'), width: 1 },
      ticks: { stroke: token('--grid'), width: 1 },
      font: '11px system-ui, sans-serif',
    };
    const plot = new uPlot(
      {
        width: container.clientWidth,
        height: 140,
        legend: { show: false },
        cursor: {
          sync: { key: CURSOR_SYNC_KEY },
          points: { size: 8, fill: token('--series-1'), stroke: token('--surface-chart') },
        },
        scales: { x: { time: false }, y: spec.log ? { distr: 3 } : {} },
        axes: [
          { ...axis, values: (_, ticks) => ticks.map((v) => (v / 1e9).toFixed(2)) },
          { ...axis, size: 56 },
        ],
        series: [{}, { stroke: token('--series-1'), width: 2, points: { show: false } }],
        hooks: {
          setCursor: [
            (u) => {
              const index = u.cursor.idx;
              const year = index == null ? undefined : u.data[0][index];
              const value = index == null ? undefined : u.data[1]![index];
              setHovered(year != null && value != null ? { year, value } : null);
            },
          ],
        },
      },
      [[], []],
      container,
    );
    plotRef.current = plot;
    const resize = new ResizeObserver(() =>
      plot.setSize({ width: container.clientWidth, height: 140 }),
    );
    resize.observe(container);
    return () => {
      resize.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [spec.log]);

  useEffect(() => {
    const plotted = Array.from(values, (v) => v * scale);
    plotRef.current?.setData([Array.from(years), plotted]);
  }, [years, values, scale]);

  const shown =
    hovered ?? (latest === undefined ? null : { year: years[years.length - 1]!, value: latest });

  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">{t(spec.title)}</span>
        {shown && (
          <span className="chart-value">
            {spec.format(shown.value)}
            <span className="chart-when"> {t('chart.at', { age: formatGyr(shown.year) })}</span>
          </span>
        )}
      </figcaption>
      <div ref={containerRef} className="chart-plot" />
    </figure>
  );
}
