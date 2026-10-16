import { t, type MessageKey } from '../i18n/i18n';
import { LIFE_TIER_COLORS, type MapLayer } from '../render/mapRenderer';
import { LIFE_TIERS } from '../sim/data/lifeClasses';
import {
  elevationPalette,
  precipitationPalette,
  temperaturePalette,
  type Rgb,
} from '../render/palettes';
import { BIOME_IDS, BIOMES } from '../sim/data/biomes';

const css = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

interface Scale {
  palette: (value: number) => Rgb;
  min: number;
  max: number;
  ticks: number[];
  unit: string;
}

const SCALES: Partial<Record<MapLayer, Scale>> = {
  terrain: {
    palette: elevationPalette,
    min: -8000,
    max: 6000,
    ticks: [-6000, 0, 3000, 6000],
    unit: 'm',
  },
  airTemperature: {
    palette: temperaturePalette,
    min: -40,
    max: 40,
    ticks: [-40, -10, 10, 25, 40],
    unit: '°C',
  },
  precipitation: {
    palette: precipitationPalette,
    min: 0,
    max: 4000,
    ticks: [0, 600, 1200, 2500, 4000],
    unit: 'mm/yr',
  },
};

const DAISY_SWATCHES: readonly { color: Rgb; label: MessageKey }[] = [
  { color: [245, 245, 235], label: 'legend.whiteDaisies' },
  { color: [22, 22, 28], label: 'legend.blackDaisies' },
  { color: [196, 168, 118], label: 'legend.bareGround' },
];

/** Legend for the current map layer: swatches for categories, a colour bar for quantities. */
export function MapLegend({ layer }: { layer: MapLayer }) {
  if (layer === 'biomes') {
    return (
      <ul className="legend" aria-label={t('legend.label')}>
        {BIOME_IDS.map((id) => (
          <li key={id}>
            <span className="swatch" style={{ background: css(BIOMES[id].color) }} />
            {t(`biome.${BIOMES[id].key}` as MessageKey)}
          </li>
        ))}
      </ul>
    );
  }
  if (layer === 'civilization') {
    return (
      <ul className="legend" aria-label={t('legend.label')}>
        <li>
          <span className="swatch" style={{ background: 'rgb(235, 104, 52)' }} />
          {t('legend.settlement')}
        </li>
      </ul>
    );
  }
  if (layer === 'life') {
    const tiers = ['none', ...LIFE_TIERS] as const;
    return (
      <ul className="legend" aria-label={t('legend.label')}>
        {tiers.map((tier, index) => (
          <li key={tier}>
            <span className="swatch" style={{ background: css(LIFE_TIER_COLORS[index]!) }} />
            {t(`lifeTier.${tier}`)}
          </li>
        ))}
      </ul>
    );
  }
  if (layer === 'daisies') {
    return (
      <ul className="legend" aria-label={t('legend.label')}>
        {DAISY_SWATCHES.map(({ color, label }) => (
          <li key={label}>
            <span className="swatch" style={{ background: css(color) }} />
            {t(label)}
          </li>
        ))}
      </ul>
    );
  }
  const scale = SCALES[layer];
  if (!scale) return null;
  const stops = Array.from({ length: 12 }, (_, k) => {
    const value = scale.min + ((scale.max - scale.min) * k) / 11;
    return `${css(scale.palette(value))} ${((k / 11) * 100).toFixed(1)}%`;
  });
  return (
    <div className="legend-scale" aria-label={t('legend.label')}>
      <div
        className="legend-bar"
        style={{ background: `linear-gradient(to right, ${stops.join(', ')})` }}
      />
      <div className="legend-ticks">
        {scale.ticks.map((tick) => (
          <span
            key={tick}
            style={{ left: `${((tick - scale.min) / (scale.max - scale.min)) * 100}%` }}
          >
            {tick.toLocaleString('en')}
          </span>
        ))}
      </div>
      <span className="legend-unit">{scale.unit}</span>
    </div>
  );
}
