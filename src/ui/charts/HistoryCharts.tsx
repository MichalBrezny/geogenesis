import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { t, type MessageKey } from '../../i18n/i18n';
import type { HistorySeries } from '../../sim/history';
import { ERAS, type Era } from '../../sim/eras';
import { formatGyr, formatPpm } from '../format';

interface ChartSpec {
  series: Exclude<HistorySeries, 'year' | 'era'>;
  title: MessageKey;
  /** Converts the recorded value to the plotted one (e.g. fraction to %). */
  scale?: number;
  format: (value: number) => string;
  log?: boolean;
}

const CHARTS: readonly ChartSpec[] = [
  { series: 'meanTemperature', title: 'chart.temperature', format: (v) => `${v.toFixed(1)} °C` },
  { series: 'biodiversity', title: 'chart.biodiversity', format: (v) => v.toFixed(2) },
  { series: 'co2', title: 'chart.co2', format: (v) => `${formatPpm(v)} ppm`, log: true },
  {
    series: 'co2Ice',
    title: 'chart.co2Ice',
    format: (v) => `${(v * 1000).toFixed(2)} mbar`,
  },
  {
    series: 'surfacePressure',
    title: 'chart.surfacePressure',
    format: (v) => `${v.toFixed(2)} bar`,
    log: true,
  },
  { series: 'water', title: 'chart.water', format: (v) => `${v.toFixed(0)} m GEL` },
  { series: 'iceFraction', title: 'chart.ice', scale: 100, format: (v) => `${v.toFixed(1)}%` },
  { series: 'landFraction', title: 'chart.land', scale: 100, format: (v) => `${v.toFixed(1)}%` },
  { series: 'seaLevel', title: 'chart.seaLevel', format: (v) => `${v.toFixed(0)} m` },
  { series: 'solarInput', title: 'chart.sun', scale: 100, format: (v) => `${v.toFixed(1)}%` },
  { series: 'o2', title: 'chart.o2', scale: 100, format: (v) => `${v.toFixed(1)}%` },
  { series: 'ch4', title: 'chart.ch4', format: (v) => `${v.toFixed(1)} ppm`, log: true },
  { series: 'livingClasses', title: 'chart.livingClasses', format: (v) => v.toFixed(0) },
  {
    series: 'forestFraction',
    title: 'chart.forest',
    scale: 100,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    series: 'desertFraction',
    title: 'chart.desert',
    scale: 100,
    format: (v) => `${v.toFixed(1)}%`,
  },
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

const ERA_LABELS: Record<Era, MessageKey> = {
  geological: 'eraName.geological',
  evolution: 'eraName.evolution',
  civilization: 'eraName.civilization',
  technology: 'eraName.technology',
};

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
  const historyRef = useRef(history);
  const [hovered, setHovered] = useState<{ year: number; value: number } | null>(null);

  const scale = spec.scale ?? 1;
  const years = history.year;
  const values = history[spec.series];
  const latest = values.length > 0 ? values[values.length - 1]! * scale : undefined;

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

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
        scales: {
          x: { time: false },
          // With a single sample uPlot would pick an arbitrary range; pad around it instead.
          y: spec.log
            ? { distr: 3 }
            : {
                range: (_, min, max) =>
                  min === max ? [min - 1, max + 1] : uPlot.rangeNum(min, max, 0.1, true),
              },
        },
        axes: [
          {
            ...axis,
            // Planet age in Gyr, with enough decimals to tell neighbouring ticks apart.
            values: (u, ticks) => {
              const span = ((u.scales.x!.max ?? 0) - (u.scales.x!.min ?? 0)) / 1e9;
              const decimals = span < 0.05 ? 3 : 2;
              return ticks.map((v) => (v / 1e9).toFixed(decimals));
            },
          },
          { ...axis, size: 56 },
        ],
        series: [{}, { stroke: token('--series-1'), width: 2, points: { show: false } }],
        hooks: {
          draw: [(u) => drawEraTransitions(u, historyRef.current, token)],
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
    const plot = plotRef.current;
    if (!plot) return;
    const plotted = Array.from(values, (v) => v * scale);
    plot.setData([Array.from(years), plotted]);
    // uPlot does not pad the x range around a lone sample; give it a sensible window.
    if (years.length === 1) plot.setScale('x', { min: years[0]! - 5e6, max: years[0]! + 5e6 });
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

/** Draws all transition lines, but skips labels that would overlap a previous one. */
function drawEraTransitions(
  plot: uPlot,
  history: Props['history'],
  token: (name: string) => string,
) {
  const { year: years, era: eras } = history;
  if (years.length < 2 || eras.length !== years.length) return;
  const ratio = uPlot.pxRatio;
  const { ctx, bbox } = plot;
  const minYear = plot.scales.x!.min ?? -Infinity;
  const maxYear = plot.scales.x!.max ?? Infinity;
  let labelRight = -Infinity;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  ctx.lineWidth = ratio;
  ctx.strokeStyle = token('--text-secondary');
  ctx.fillStyle = token('--text-secondary');
  ctx.font = `${10 * ratio}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';

  for (let index = 1; index < years.length; index++) {
    if (eras[index] === eras[index - 1]) continue;
    const year = years[index]!;
    const era = ERAS[eras[index]!] as Era | undefined;
    if (!era || year < minYear || year > maxYear) continue;
    const x = Math.round(plot.valToPos(year, 'x', true)) + 0.5 * ratio;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(x, bbox.top);
    ctx.lineTo(x, bbox.top + bbox.height);
    ctx.stroke();

    const label = t(ERA_LABELS[era]);
    const labelWidth = ctx.measureText(label).width;
    const labelX = Math.min(x + 4 * ratio, bbox.left + bbox.width - labelWidth - 2 * ratio);
    if (labelX <= labelRight) continue;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 3 * ratio;
    ctx.strokeStyle = token('--surface-chart');
    ctx.strokeText(label, labelX, bbox.top + 3 * ratio);
    ctx.fillText(label, labelX, bbox.top + 3 * ratio);
    ctx.strokeStyle = token('--text-secondary');
    labelRight = labelX + labelWidth + 8 * ratio;
  }
  ctx.restore();
}
