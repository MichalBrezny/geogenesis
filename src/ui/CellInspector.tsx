import { t, type MessageKey } from '../i18n/i18n';
import { BIOMES, type Biome } from '../sim/data/biomes';
import { PEOPLE_PER_KM2 } from '../sim/data/civilization';
import { LIFE_TIERS } from '../sim/data/lifeClasses';
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
export function CellInspector({ frame, cell }: { frame: Frame; cell: HoveredCell }) {
  const f = frame.fields;
  const i = cell.index;
  const ocean = f.elevation[i]! < 0;
  const tier = f.lifeTier[i]!;
  const rows: [MessageKey, string][] = [
    ['inspect.position', formatPosition(cell.latitude, cell.longitude)],
    [
      ocean ? 'inspect.depth' : 'inspect.elevation',
      `${Math.abs(Math.round(f.elevation[i]!)).toLocaleString('en')} m`,
    ],
    ['inspect.temperature', `${f.airTemperature[i]!.toFixed(1)} °C`],
    ['inspect.precipitation', `${Math.round(f.precipitation[i]!).toLocaleString('en')} mm/yr`],
    ['inspect.biome', t(`biome.${BIOMES[f.biome[i] as Biome].key}` as MessageKey)],
    ['inspect.life', t(`lifeTier.${tier === 0 ? 'none' : LIFE_TIERS[tier - 1]!}` as MessageKey)],
  ];
  if (!ocean) rows.push(['inspect.plants', `${Math.round(f.vegetation[i]! * 100)}%`]);
  if (f.civilization[i]! > 0) {
    rows.push(['inspect.people', `${(f.civilization[i]! * PEOPLE_PER_KM2).toFixed(2)} / km²`]);
  }
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
    </div>
  );
}

function formatPosition(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(0)}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lon = longitude > 180 ? 360 - longitude : longitude;
  return `${lat}, ${lon.toFixed(0)}° ${longitude > 180 ? 'W' : 'E'}`;
}
