import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { t, type MessageKey } from '../../i18n/i18n';
import type { HistorySeries } from '../../sim/history';
import { ERAS, type Era } from '../../sim/eras';
import type { PlanetEvent } from '../../sim/events';
import type { ScenarioId } from '../../sim/scenarios';
import { formatGyr, formatPpm } from '../format';
import { CHART_ICONS, EventIcon } from '../icons';
import { describeEvent } from '../CivilizationPanel';
import {
  clampLogValue,
  formatAxisNumber,
  loadChartSelection,
  saveChartSelection,
  selectTimeUnit,
} from './historyChartUtils';

type SeriesFamily = 'climate' | 'atmosphere' | 'life' | 'civilization';
interface ChartSpec {
  series: Exclude<HistorySeries, 'year' | 'era'>;
  title: MessageKey;
  hint: MessageKey;
  unit: string;
  family: SeriesFamily;
  scale?: number;
  format: (value: number) => string;
  /** Explicit positive floor for logarithmic plots; zero samples are clamped to it. */
  logFloor?: number;
}

const CHARTS: readonly ChartSpec[] = [
  {
    series: 'runawayMargin',
    title: 'chart.runawayMargin',
    hint: 'chartHint.runawayMargin',
    unit: 'W/m²',
    family: 'climate',
    format: (v) => `${v.toFixed(1)} W/m²`,
  },
  {
    series: 'meanTemperature',
    title: 'chart.temperature',
    hint: 'chartHint.temperature',
    unit: '°C',
    family: 'climate',
    format: (v) => `${v.toFixed(1)} °C`,
  },
  {
    series: 'biodiversity',
    title: 'chart.biodiversity',
    hint: 'chartHint.biodiversity',
    unit: 'index',
    family: 'life',
    format: (v) => v.toFixed(2),
  },
  {
    series: 'co2',
    title: 'chart.co2',
    hint: 'chartHint.co2',
    unit: 'ppm',
    family: 'atmosphere',
    format: (v) => `${formatPpm(v)} ppm`,
    logFloor: 0.01,
  },
  {
    series: 'co2Ice',
    title: 'chart.co2Ice',
    hint: 'chartHint.co2Ice',
    unit: 'mbar',
    family: 'atmosphere',
    scale: 1000,
    format: (v) => `${v.toFixed(2)} mbar`,
  },
  {
    series: 'surfacePressure',
    title: 'chart.surfacePressure',
    hint: 'chartHint.surfacePressure',
    unit: 'bar',
    family: 'atmosphere',
    format: (v) => `${v.toPrecision(3)} bar`,
    logFloor: 1e-9,
  },
  {
    series: 'water',
    title: 'chart.water',
    hint: 'chartHint.water',
    unit: 'm GEL',
    family: 'climate',
    format: (v) => `${formatAxisNumber(v)} m GEL`,
  },
  {
    series: 'iceFraction',
    title: 'chart.ice',
    hint: 'chartHint.ice',
    unit: '%',
    family: 'climate',
    scale: 100,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    series: 'landFraction',
    title: 'chart.land',
    hint: 'chartHint.land',
    unit: '%',
    family: 'climate',
    scale: 100,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    series: 'seaLevel',
    title: 'chart.seaLevel',
    hint: 'chartHint.seaLevel',
    unit: 'm',
    family: 'climate',
    format: (v) => `${formatAxisNumber(v)} m`,
  },
  {
    series: 'solarInput',
    title: 'chart.sun',
    hint: 'chartHint.sun',
    unit: '% present Sun',
    family: 'climate',
    scale: 100,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    series: 'o2',
    title: 'chart.o2',
    hint: 'chartHint.o2',
    unit: '%',
    family: 'atmosphere',
    scale: 100,
    format: (v) => `${v.toFixed(2)}%`,
  },
  {
    series: 'ch4',
    title: 'chart.ch4',
    hint: 'chartHint.ch4',
    unit: 'ppm',
    family: 'atmosphere',
    format: (v) => `${formatPpm(v)} ppm`,
    logFloor: 0.01,
  },
  {
    series: 'livingClasses',
    title: 'chart.livingClasses',
    hint: 'chartHint.livingClasses',
    unit: 'classes',
    family: 'life',
    format: (v) => v.toFixed(0),
  },
  {
    series: 'dust',
    title: 'chart.dust',
    hint: 'chartHint.dust',
    unit: 'optical depth',
    family: 'atmosphere',
    format: (v) => v.toFixed(3),
  },
  {
    series: 'oceanAcidity',
    title: 'chart.oceanAcidity',
    hint: 'chartHint.oceanAcidity',
    unit: 'milli-pH',
    family: 'life',
    scale: 1000,
    format: (v) => `${v.toFixed(1)} milli-pH`,
  },
  {
    series: 'meanOceanOxygen',
    title: 'chart.meanOceanOxygen',
    hint: 'chartHint.meanOceanOxygen',
    unit: '% saturation',
    family: 'life',
    scale: 100,
    format: (v) => `${v.toFixed(1)}% saturation`,
  },
  {
    series: 'clathrateMethane',
    title: 'chart.clathrateMethane',
    hint: 'chartHint.clathrateMethane',
    unit: 'Gt C',
    family: 'climate',
    format: (v) => `${formatAxisNumber(v)} Gt C`,
  },
  {
    series: 'fossilCarbon',
    title: 'chart.fossilCarbon',
    hint: 'chartHint.fossilCarbon',
    unit: 'Gt C',
    family: 'civilization',
    format: (v) => `${formatAxisNumber(v)} Gt C`,
    logFloor: 0.1,
  },
  {
    series: 'population',
    title: 'chart.population',
    hint: 'chartHint.population',
    unit: 'billion',
    family: 'civilization',
    format: (v) =>
      v < 1 ? `${formatAxisNumber(v * 1000)} million` : `${formatAxisNumber(v)} billion`,
    logFloor: 0.000001,
  },
  {
    series: 'pollution',
    title: 'chart.pollution',
    hint: 'chartHint.pollution',
    unit: 'index',
    family: 'civilization',
    format: (v) => v.toFixed(2),
  },
  {
    series: 'carbonOutgassing',
    title: 'chart.carbonOutgassing',
    hint: 'chartHint.carbonOutgassing',
    unit: 'µbar/yr',
    family: 'atmosphere',
    format: (v) => `${v.toFixed(3)} microbar/yr`,
  },
  {
    series: 'carbonWeathering',
    title: 'chart.carbonWeathering',
    hint: 'chartHint.carbonWeathering',
    unit: 'µbar/yr',
    family: 'atmosphere',
    format: (v) => `${v.toFixed(3)} microbar/yr`,
  },
  {
    series: 'carbonBurial',
    title: 'chart.carbonBurial',
    hint: 'chartHint.carbonBurial',
    unit: 'µbar/yr',
    family: 'atmosphere',
    format: (v) => `${v.toFixed(3)} microbar/yr`,
  },
  {
    series: 'carbonNet',
    title: 'chart.carbonNet',
    hint: 'chartHint.carbonNet',
    unit: 'µbar/yr',
    family: 'atmosphere',
    format: (v) => `${v.toFixed(3)} microbar/yr`,
  },
  {
    series: 'forestFraction',
    title: 'chart.forest',
    hint: 'chartHint.forest',
    unit: '% surface',
    family: 'life',
    scale: 100,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    series: 'desertFraction',
    title: 'chart.desert',
    hint: 'chartHint.desert',
    unit: '% surface',
    family: 'climate',
    scale: 100,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    series: 'whiteDaisies',
    title: 'chart.whiteDaisies',
    hint: 'chartHint.whiteDaisies',
    unit: '% surface',
    family: 'life',
    scale: 100,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    series: 'blackDaisies',
    title: 'chart.blackDaisies',
    hint: 'chartHint.blackDaisies',
    unit: '% surface',
    family: 'life',
    scale: 100,
    format: (v) => `${v.toFixed(1)}%`,
  },
];

export type ChartSeries = ChartSpec['series'];
const AVAILABLE_CHARTS = new Set(CHARTS.map((chart) => chart.series));
const CURSOR_SYNC_KEY = 'planet-history';
const ERA_LABELS: Record<Era, MessageKey> = {
  geological: 'eraName.geological',
  evolution: 'eraName.evolution',
  civilization: 'eraName.civilization',
  technology: 'eraName.technology',
};
const MAJOR_EVENTS = new Set<PlanetEvent['key']>([
  'lifeOrigin',
  'massExtinction',
  'sentience',
  'eraReached',
  'runawayGreenhouse',
  'oceansLost',
  'civilizationCollapsed',
  'exodus',
  'goalWon',
  'goalLost',
]);

interface Props {
  history: Record<HistorySeries, Float64Array>;
  series: readonly ChartSeries[];
  scenario: ScenarioId;
  events: readonly PlanetEvent[];
}

/** Small multiples with one measure per chart and a shared, synchronized time cursor. */
export function HistoryCharts({ history, series, scenario, events }: Props) {
  const [selected, setSelected] = useState<ChartSeries[]>(() =>
    loadChartSelection(chartStorage(), scenario, series, AVAILABLE_CHARTS),
  );
  const update = (next: ChartSeries[]) => {
    setSelected(next);
    saveChartSelection(chartStorage(), scenario, next);
  };
  const specs = selected
    .map((name) => CHARTS.find((spec) => spec.series === name)!)
    .filter(Boolean);
  return (
    <section className="history" aria-label={t('chart.sectionLabel')}>
      <details className="chart-picker">
        <summary title={t('chart.pickerHint')}>{t('chart.picker')}</summary>
        <div className="chart-picker-list">
          {CHARTS.map((spec) => (
            <label key={spec.series} title={t(spec.hint)}>
              <input
                type="checkbox"
                checked={selected.includes(spec.series)}
                onChange={(event) =>
                  update(
                    event.target.checked
                      ? [...selected, spec.series]
                      : selected.filter((name) => name !== spec.series),
                  )
                }
              />
              <span className="chart-picker-icon">{CHART_ICONS[spec.series]}</span>
              {t(spec.title)}
            </label>
          ))}
        </div>
        <button type="button" title={t('chart.resetHint')} onClick={() => update([...series])}>
          {t('chart.reset')}
        </button>
      </details>
      <EraLegend />
      {specs.map((spec) => (
        <HistoryChart key={spec.series} spec={spec} history={history} events={events} />
      ))}
      {specs.length === 0 && <p className="chart-empty">{t('chart.noneSelected')}</p>}
    </section>
  );
}

function chartStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function EraLegend() {
  return (
    <ul className="era-legend" aria-label={t('chart.eraLegend')}>
      {(Object.keys(ERA_LABELS) as Era[]).map((era) => (
        <li key={era} title={t(ERA_LABELS[era])}>
          <i className={`era-swatch era-${era}`} />
          {t(ERA_LABELS[era])}
        </li>
      ))}
    </ul>
  );
}

function HistoryChart({
  spec,
  history,
  events,
}: {
  spec: ChartSpec;
  history: Props['history'];
  events: Props['events'];
}) {
  const years = history.year;
  const values = history[spec.series];
  const scale = spec.scale ?? 1;
  if (years.length === 0 || values.length === 0)
    return (
      <ChartShell spec={spec}>
        <p className="chart-state">{t('chart.noData')}</p>
      </ChartShell>
    );
  if (years.length === 1 || values.length === 1)
    return (
      <ChartShell spec={spec} value={spec.format(values[0]! * scale)}>
        <p className="chart-state">{t('chart.oneSample')}</p>
      </ChartShell>
    );
  return <PlottedChart spec={spec} history={history} events={events} />;
}

function ChartShell({
  spec,
  value,
  children,
}: {
  spec: ChartSpec;
  value?: string;
  children: ReactNode;
}) {
  return (
    <figure className={`chart chart-${spec.family}`}>
      <figcaption title={t(spec.hint)}>
        <span className="chart-heading">
          <span className="chart-title-icon">{CHART_ICONS[spec.series]}</span>
          <span className="chart-title">
            {t(spec.title)} <small>({spec.unit})</small>
          </span>
        </span>
        {value && <span className="chart-value">{value}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

function PlottedChart({
  spec,
  history,
  events,
}: {
  spec: ChartSpec;
  history: Props['history'];
  events: Props['events'];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const historyRef = useRef(history);
  const valuesRef = useRef(history[spec.series]);
  const eventsRef = useRef<readonly PlanetEvent[]>(events);
  const [hovered, setHovered] = useState<{
    year: number;
    value: number;
    era?: Era;
    event?: PlanetEvent;
  } | null>(null);
  const scale = spec.scale ?? 1;
  const years = history.year;
  const values = history[spec.series];
  const timeUnit = selectTimeUnit(years[years.length - 1]! - years[0]!);
  const majorEvents = useMemo(
    () => events.filter((event) => MAJOR_EVENTS.has(event.key)),
    [events],
  );
  useEffect(() => {
    historyRef.current = history;
    valuesRef.current = values;
    eventsRef.current = majorEvents;
  }, [history, values, majorEvents]);

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
      space: 42,
    };
    const colour = token(`--chart-${spec.family}`);
    const plot = new uPlot(
      {
        width: container.clientWidth,
        height: 154,
        legend: { show: false },
        cursor: {
          sync: { key: CURSOR_SYNC_KEY },
          drag: { x: true, y: false },
          points: { size: 8, fill: colour, stroke: token('--surface-chart') },
        },
        scales: {
          x: { time: false },
          y: spec.logFloor
            ? { distr: 3 }
            : {
                range: (_, min, max) =>
                  min === max ? [min - 1, max + 1] : uPlot.rangeNum(min, max, 0.1, true),
              },
        },
        axes: [
          {
            ...axis,
            values: (u, ticks) => {
              const unit = selectTimeUnit((u.scales.x!.max ?? 0) - (u.scales.x!.min ?? 0));
              return ticks.map((value) =>
                (value / unit.divisor).toLocaleString('en-US', {
                  maximumFractionDigits: unit.decimals,
                }),
              );
            },
          },
          { ...axis, size: 58, space: 30, values: (_, ticks) => ticks.map(formatAxisNumber) },
        ],
        series: [{}, { stroke: colour, width: 2, points: { show: false } }],
        hooks: {
          drawClear: [(u) => drawEraBands(u, historyRef.current, token)],
          draw: [(u) => drawEventTicks(u, eventsRef.current, token)],
          setCursor: [
            (u) => {
              const index = u.cursor.idx;
              if (index == null) {
                setHovered(null);
                return;
              }
              const year = u.data[0][index];
              const raw = valuesRef.current[index];
              if (year == null || raw == null) {
                setHovered(null);
                return;
              }
              const eraIndex = historyRef.current.era[index];
              const era = eraIndex == null ? undefined : (ERAS[eraIndex] as Era | undefined);
              setHovered({
                year,
                value: raw * scale,
                era,
                event: nearestEvent(u, year, eventsRef.current),
              });
            },
          ],
        },
      },
      [[], []],
      container,
    );
    plotRef.current = plot;
    const resize = new ResizeObserver(() =>
      plot.setSize({ width: container.clientWidth, height: 154 }),
    );
    resize.observe(container);
    return () => {
      resize.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [spec.family, spec.logFloor, scale]);

  useEffect(() => {
    const plotted = Array.from(values, (value) => {
      const scaled = value * scale;
      // Log charts declare a physically small display floor so zero never reaches uPlot.
      return spec.logFloor === undefined ? scaled : clampLogValue(scaled, spec.logFloor);
    });
    plotRef.current?.setData([Array.from(years), plotted]);
  }, [years, values, scale, spec.logFloor]);

  const latest = values.length - 1;
  const shown = hovered ?? {
    year: years[latest]!,
    value: values[latest]! * scale,
    era: ERAS[history.era[latest]!] as Era | undefined,
  };
  return (
    <ChartShell spec={spec}>
      <div className="chart-readout">
        <span className="chart-value">{spec.format(shown.value)}</span>
        <span className="chart-when">
          {t('chart.at', { age: formatGyr(shown.year) })}
          {shown.era ? ` · ${t(ERA_LABELS[shown.era])}` : ''}
        </span>
        {shown.event && (
          <span className="chart-event" title={describeEvent(shown.event)}>
            <EventIcon eventKey={shown.event.key} />
            {describeEvent(shown.event)}
          </span>
        )}
      </div>
      <div className="chart-plot-wrap">
        <div ref={containerRef} className="chart-plot" />
        <span className="chart-time-unit">{timeUnit.label}</span>
      </div>
    </ChartShell>
  );
}

function drawEraBands(plot: uPlot, history: Props['history'], token: (name: string) => string) {
  const { year, era } = history;
  if (year.length < 2 || era.length !== year.length) return;
  const { ctx, bbox } = plot;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  let start = 0;
  for (let index = 1; index <= year.length; index++) {
    if (index < year.length && era[index] === era[start]) continue;
    const name = ERAS[era[start]!] as Era | undefined;
    if (name) {
      const from = Math.max(bbox.left, plot.valToPos(year[start]!, 'x', true));
      const to = Math.min(
        bbox.left + bbox.width,
        plot.valToPos(index < year.length ? year[index]! : year[index - 1]!, 'x', true),
      );
      ctx.fillStyle = token(`--era-${name}`);
      ctx.fillRect(from, bbox.top, Math.max(1, to - from), bbox.height);
    }
    start = index;
  }
  ctx.restore();
}

function drawEventTicks(
  plot: uPlot,
  events: readonly PlanetEvent[],
  token: (name: string) => string,
) {
  const { ctx, bbox } = plot;
  const ratio = uPlot.pxRatio;
  ctx.save();
  ctx.strokeStyle = token('--chart-event');
  ctx.lineWidth = 1.5 * ratio;
  for (const event of events) {
    const x = plot.valToPos(event.year, 'x', true);
    if (x < bbox.left || x > bbox.left + bbox.width) continue;
    ctx.beginPath();
    ctx.moveTo(x, bbox.top + bbox.height - 7 * ratio);
    ctx.lineTo(x, bbox.top + bbox.height);
    ctx.stroke();
  }
  ctx.restore();
}

function nearestEvent(
  plot: uPlot,
  year: number,
  events: readonly PlanetEvent[],
): PlanetEvent | undefined {
  let nearest: PlanetEvent | undefined;
  let distance = 8 * uPlot.pxRatio;
  const cursorX = plot.valToPos(year, 'x', true);
  for (const event of events) {
    const next = Math.abs(plot.valToPos(event.year, 'x', true) - cursorX);
    if (next <= distance) {
      distance = next;
      nearest = event;
    }
  }
  return nearest;
}
