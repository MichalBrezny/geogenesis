import { formatFixed, formatNumber, t } from '../i18n/i18n';
import type { MonthlyClimate } from '../sim/models/atmosphere/climateDiagram';

const WIDTH = 220;
const HEIGHT = 140;
const LEFT = 27;
const RIGHT = 194;
const TOP = 20;
const BOTTOM = 111;
const MONTH_KEYS = [
  'month.jan',
  'month.feb',
  'month.mar',
  'month.apr',
  'month.may',
  'month.jun',
  'month.jul',
  'month.aug',
  'month.sep',
  'month.oct',
  'month.nov',
  'month.dec',
] as const;

interface Props {
  climate: MonthlyClimate;
  elevation: number;
  latitude: number;
}

/** Compact Walter-Lieth diagram for the cell inspector. */
export function ClimateDiagram({ climate, elevation, latitude }: Props) {
  const shift = latitude < 0 ? 6 : 0;
  const temperature = rotate(climate.temperature, shift);
  const precipitation = rotate(climate.precipitation, shift);
  const precipitationScale = precipitation.map(precipitationEquivalent);
  const minValue = Math.min(-10, ...temperature);
  const maxValue = Math.max(50, ...temperature, ...precipitationScale);
  const yMin = Math.floor(minValue / 10) * 10;
  const yMax = Math.ceil(maxValue / 10) * 10;
  const x = (month: number) => LEFT + (month * (RIGHT - LEFT)) / 11;
  const y = (value: number) => BOTTOM - ((value - yMin) / (yMax - yMin)) * (BOTTOM - TOP);
  const temperaturePoints = temperature.map((value, month) => ({ x: x(month), y: value }));
  const precipitationPoints = precipitationScale.map((value, month) => ({
    x: x(month),
    y: value,
  }));
  const regions = splitRegions(temperaturePoints, precipitationPoints);
  const wetAbove100 = aboveThreshold(precipitationPoints, 50);
  const annualTemperature = climate.temperature.reduce((sum, value) => sum + value, 0) / 12;
  const annualPrecipitation = climate.precipitation.reduce((sum, value) => sum + value, 0);
  const label = t('climate.aria', {
    temperature: formatFixed(annualTemperature, 1),
    precipitation: formatNumber(Math.round(annualPrecipitation)),
  });
  const line = (points: Point[]) => points.map((point) => `${point.x},${y(point.y)}`).join(' ');

  return (
    <svg
      className="climate-diagram"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <defs>
        <pattern id="climate-humid" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M1 0V4" className="climate-humid-hatch" />
        </pattern>
        <pattern id="climate-arid" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="0.8" className="climate-arid-dot" />
        </pattern>
        <pattern id="climate-frost" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M0 4L4 0" className="climate-frost-hatch" />
        </pattern>
      </defs>
      <text x={WIDTH / 2} y="9" textAnchor="middle" className="climate-header">
        {t('climate.header', {
          elevation: formatNumber(Math.round(elevation)),
          temperature: formatFixed(annualTemperature, 1),
          precipitation: formatNumber(Math.round(annualPrecipitation)),
        })}
      </text>

      <path d={`M${LEFT} ${TOP}V${BOTTOM}H${RIGHT}V${TOP}`} className="climate-axis" />
      {regions.humid.map((polygon, index) => (
        <path key={`h${index}`} d={polygonPath(polygon, y)} fill="url(#climate-humid)" />
      ))}
      {regions.arid.map((polygon, index) => (
        <path key={`a${index}`} d={polygonPath(polygon, y)} fill="url(#climate-arid)" />
      ))}
      {wetAbove100.map((polygon, index) => (
        <path key={`w${index}`} d={polygonPath(polygon, y)} className="climate-heavy-rain" />
      ))}
      <polyline points={line(temperaturePoints)} className="climate-temperature" />
      <polyline points={line(precipitationPoints)} className="climate-precipitation" />

      {[yMin, 0, yMax].map((value) => (
        <g key={`t${value}`}>
          <line x1={LEFT - 2} x2={LEFT} y1={y(value)} y2={y(value)} className="climate-axis" />
          <text x={LEFT - 4} y={y(value) + 2.5} textAnchor="end" className="climate-tick">
            {value}
          </text>
        </g>
      ))}
      {[...new Set([0, 100, precipitationFromEquivalent(yMax)])].map((value) => (
        <text
          key={`p${value}`}
          x={RIGHT + 4}
          y={y(precipitationEquivalent(value)) + 2.5}
          className="climate-tick"
        >
          {Math.round(value)}
        </text>
      ))}
      <text x="3" y={TOP - 3} className="climate-axis-label">
        {t('climate.temperatureUnit')}
      </text>
      <text x={RIGHT + 4} y={TOP - 3} className="climate-axis-label">
        {t('climate.precipitationUnit')}
      </text>

      {temperature.map((value, month) => {
        const barX = x(month) - (RIGHT - LEFT) / 24;
        const className = value < 0 ? 'climate-frost-solid' : undefined;
        return value < 5 ? (
          <rect
            key={`f${month}`}
            x={barX}
            y={BOTTOM + 3}
            width={(RIGHT - LEFT) / 12}
            height="5"
            className={className}
            fill={value >= 0 ? 'url(#climate-frost)' : undefined}
          />
        ) : null;
      })}
      {temperature.map((_value, month) => (
        <text key={`m${month}`} x={x(month)} y="132" textAnchor="middle" className="climate-month">
          {t(MONTH_KEYS[(month + shift) % 12]!)}
        </text>
      ))}
    </svg>
  );
}

interface Point {
  x: number;
  /** Value on the shared Walter-Lieth temperature-equivalent axis. */
  y: number;
}

function splitRegions(temperature: Point[], precipitation: Point[]) {
  const humid: Point[][] = [];
  const arid: Point[][] = [];
  for (let i = 0; i < temperature.length - 1; i++) {
    const t0 = temperature[i]!;
    const t1 = temperature[i + 1]!;
    const p0 = precipitation[i]!;
    const p1 = precipitation[i + 1]!;
    const d0 = p0.y - t0.y;
    const d1 = p1.y - t1.y;
    if (d0 * d1 < 0) {
      const fraction = d0 / (d0 - d1);
      const crossing = interpolate(t0, t1, fraction);
      (d0 > 0 ? humid : arid).push([t0, p0, crossing]);
      (d1 > 0 ? humid : arid).push([crossing, p1, t1]);
    } else {
      ((d0 + d1) / 2 >= 0 ? humid : arid).push([t0, p0, p1, t1]);
    }
  }
  return { humid, arid };
}

function aboveThreshold(points: Point[], threshold: number): Point[][] {
  const polygons: Point[][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (a.y <= threshold && b.y <= threshold) continue;
    if (a.y > threshold && b.y > threshold) {
      polygons.push([a, b, { x: b.x, y: threshold }, { x: a.x, y: threshold }]);
    } else {
      const fraction = (threshold - a.y) / (b.y - a.y);
      const crossing = interpolate(a, b, fraction);
      const wet = a.y > threshold ? a : b;
      polygons.push([wet, crossing, { x: wet.x, y: threshold }]);
    }
  }
  return polygons;
}

function polygonPath(points: Point[], y: (value: number) => number): string {
  return `${points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${y(point.y)}`).join('')}Z`;
}

function interpolate(a: Point, b: Point, fraction: number): Point {
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}

function precipitationEquivalent(mm: number): number {
  return mm <= 100 ? mm / 2 : 50 + (mm - 100) / 20;
}

function precipitationFromEquivalent(value: number): number {
  return value <= 50 ? value * 2 : 100 + (value - 50) * 20;
}

function rotate(values: readonly number[], shift: number): number[] {
  return values.map((_value, index) => values[(index + shift) % values.length]!);
}
