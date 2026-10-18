import { t, type MessageKey } from '../i18n/i18n';
import { BIOMES, type Biome } from '../sim/data/biomes';
import { PEOPLE_PER_KM2 } from '../sim/data/civilization';
import { LIFE_CLASSES, LIFE_TIERS } from '../sim/data/lifeClasses';
import type { CellLife } from '../sim/models/biosphere/diversity';
import { RIVER_MIN_DISCHARGE } from '../render/mapRenderer';
import { LakeType } from '../sim/models/geosphere/flowRouting';
import type { Frame } from '../worker/protocol';

/** Cell under the pointer and where to draw the readout (page coordinates). */
export interface HoveredCell {
  index: number;
  latitude: number;
  longitude: number;
  left: number;
  top: number;
}

/** Floating readout of the map cell under the pointer. */
export function CellInspector({
  frame,
  cell,
  life,
}: {
  frame: Frame;
  cell: HoveredCell;
  /** Per-class life of this cell from the worker, once it has answered. */
  life?: CellLife | null;
}) {
  const f = frame.fields;
  const i = cell.index;
  const ocean = f.elevation[i]! < frame.seaLevel;
  const height = Math.abs(f.elevation[i]! - frame.seaLevel);
  const tier = f.lifeTier[i]!;
  const rows: [MessageKey, string][] = [
    ['inspect.position', formatPosition(cell.latitude, cell.longitude)],
    [ocean ? 'inspect.depth' : 'inspect.elevation', `${Math.round(height).toLocaleString('en')} m`],
    ['inspect.temperature', `${f.airTemperature[i]!.toFixed(1)} °C`],
    ['inspect.warmestMonth', `${(f.airTemperature[i]! + f.seasonalAmplitude[i]!).toFixed(1)} °C`],
    ['inspect.coldestMonth', `${(f.airTemperature[i]! - f.seasonalAmplitude[i]!).toFixed(1)} °C`],
    ['inspect.precipitation', `${Math.round(f.precipitation[i]!).toLocaleString('en')} mm/yr`],
    ['inspect.volcanism', `${f.volcanicActivity[i]!.toFixed(2)} × Earth mean`],
    ['inspect.wind', formatWind(f.windU[i]!, f.windV[i]!)],
    ['inspect.clouds', `${Math.round(f.cloudCover[i]! * 100)}%`],
    ['inspect.biome', t(`biome.${BIOMES[f.biome[i] as Biome].key}` as MessageKey)],
    ['inspect.life', t(`lifeTier.${tier === 0 ? 'none' : LIFE_TIERS[tier - 1]!}` as MessageKey)],
  ];
  if (f.co2Ice[i]! > 0) {
    rows.splice(5, 0, ['inspect.co2Ice', `${(f.co2Ice[i]! * 1000).toFixed(2)} mbar`]);
  }
  if (frame.scenario !== 'daisyworld') {
    rows.splice(3, 0, ['inspect.pressure', `${f.pressure[i]!.toFixed(0)} hPa`]);
  }
  const lake = f.lakeType[i]!;
  if (lake === LakeType.Fresh || lake === LakeType.Salt) {
    rows.push([
      'inspect.lake',
      t('inspect.lakeValue', {
        kind: t(lake === LakeType.Fresh ? 'lake.fresh' : 'lake.salt'),
        depth: Math.round(f.lakeDepth[i]!).toLocaleString('en'),
      }),
    ]);
  } else if (lake === LakeType.SaltFlat) {
    rows.push(['inspect.lake', t('lake.saltFlat')]);
  }
  if (!ocean && f.discharge[i]! >= RIVER_MIN_DISCHARGE) {
    const perSecond = f.discharge[i]! / SECONDS_PER_YEAR;
    rows.push(['inspect.river', `${Math.round(perSecond).toLocaleString('en')} m³/s`]);
  }
  if (!ocean) rows.push(['inspect.plants', `${Math.round(f.vegetation[i]! * 100)}%`]);
  if (f.civilization[i]! > 0) {
    rows.push(['inspect.people', `${(f.civilization[i]! * PEOPLE_PER_KM2).toFixed(2)} / km²`]);
  }
  const present = life && life.cell === i ? life.classes : [];
  return (
    <div className="inspector" style={{ left: cell.left, top: cell.top }} role="status">
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {present.length > 0 && (
        <div className="inspector-life">
          <h4>{t('inspect.lifeClasses')}</h4>
          <ul>
            {present.map((entry) => (
              <li key={entry.index} title={t(habitatKey(entry.suitability))}>
                <span>{t(`lifeClass.${LIFE_CLASSES[entry.index]!.key}` as MessageKey)}</span>
                <span>
                  {Math.round(entry.population * 100)}% · {t(habitatKey(entry.suitability))}
                </span>
              </li>
            ))}
          </ul>
          <p>
            {t('inspect.lineage')}: {lineage(present[0]!.index)}
          </p>
        </div>
      )}
    </div>
  );
}

/** Rating of a class's habitat from the life model's carrying capacity (0..1). */
function habitatKey(suitability: number): MessageKey {
  if (suitability >= 0.6) return 'inspect.habitatGood';
  if (suitability >= 0.25) return 'inspect.habitatFair';
  return 'inspect.habitatPoor';
}

/** "ancestor → class → next" for a class index, from the class data. */
export function lineage(index: number): string {
  const lifeClass = LIFE_CLASSES[index]!;
  const name = (key: string) => t(`lifeClass.${key}` as MessageKey);
  const next = LIFE_CLASSES.filter((c) => c.ancestor === lifeClass.key).map((c) => name(c.key));
  return t('inspect.lineageValue', {
    from: lifeClass.ancestor ? name(lifeClass.ancestor) : t('inspect.lineageNone'),
    class: name(lifeClass.key),
    next: next.length > 0 ? next.join(', ') : t('inspect.lineageNone'),
  });
}

const SECONDS_PER_YEAR = 365.25 * 86_400;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Wind speed and the direction it blows from, e.g. "6 m/s from E". */
function formatWind(u: number, v: number): string {
  const speed = Math.hypot(u, v);
  if (speed < 0.3) return t('inspect.calm');
  // Meteorological convention: the direction the wind comes from, clockwise from north.
  const from = (Math.atan2(-u, -v) * 180) / Math.PI;
  const sector = Math.round((((from % 360) + 360) % 360) / 45) % 8;
  return t('inspect.windValue', { speed: speed.toFixed(0), from: COMPASS[sector]! });
}

function formatPosition(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(0)}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lon = longitude > 180 ? 360 - longitude : longitude;
  return `${lat}, ${lon.toFixed(0)}° ${longitude > 180 ? 'W' : 'E'}`;
}
