import { t, type MessageKey } from '../i18n/i18n';
import { TEMPERATURE_MONTHS, type MapLayer, type TemperatureMonth } from '../render/mapRenderer';
import { LAYER_ICONS, OVERLAY_ICONS, VIEW_ICONS } from './icons';
import { OVERLAYS, VIEWS, type Overlay, type View } from './PlanetView';
import { TOUR_ANCHORS } from './guide';

interface Props {
  layers: readonly MapLayer[];
  overlays: readonly Overlay[];
  onToggleOverlay: (overlay: Overlay) => void;
  layer: MapLayer;
  onLayerChange: (layer: MapLayer) => void;
  view: View;
  onViewChange: (view: View) => void;
  temperatureMonth: TemperatureMonth;
  onTemperatureMonthChange: (month: TemperatureMonth) => void;
}

/** Map layer and view switches above the planet; layers are numbered for the keyboard. */
export function LayerBar(props: Props) {
  const { layers, layer, onLayerChange, view, onViewChange, overlays, onToggleOverlay } = props;
  return (
    <div className="layerbar" data-tour={TOUR_ANCHORS.map}>
      <div className="segmented wrap" role="radiogroup" aria-label={t('layer.label')}>
        {layers.map((id, index) => (
          <button
            key={id}
            role="radio"
            aria-checked={layer === id}
            className={layer === id ? 'selected' : undefined}
            onClick={() => onLayerChange(id)}
            title={`${t(`layerHelp.${id}` as MessageKey)} (${index === 9 ? '0' : index + 1})`}
          >
            {LAYER_ICONS[id]}
            {t(`layer.${id}`)}
          </button>
        ))}
      </div>
      {layer === 'airTemperature' && (
        <label className="temperature-month" title={t('temperatureMonth.hint')}>
          <span>{t('temperatureMonth.label')}</span>
          <select
            value={props.temperatureMonth}
            onChange={(event) =>
              props.onTemperatureMonthChange(event.target.value as TemperatureMonth)
            }
          >
            {TEMPERATURE_MONTHS.map((month) => (
              <option key={month} value={month}>
                {t(`temperatureMonth.${month}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="segmented" role="group" aria-label={t('overlay.label')}>
        {OVERLAYS.map((id) => (
          <button
            key={id}
            aria-pressed={overlays.includes(id)}
            className={overlays.includes(id) ? 'selected' : undefined}
            onClick={() => onToggleOverlay(id)}
            title={
              overlayKey(id)
                ? `${t(`overlayHelp.${id}` as MessageKey)} (${overlayKey(id)})`
                : t(`overlayHelp.${id}` as MessageKey)
            }
          >
            {OVERLAY_ICONS[id]}
            {t(`overlay.${id}` as MessageKey)}
          </button>
        ))}
      </div>
      <div className="segmented" role="radiogroup" aria-label={t('view.label')}>
        {VIEWS.map((id) => (
          <button
            key={id}
            role="radio"
            aria-checked={view === id}
            className={view === id ? 'selected' : undefined}
            onClick={() => onViewChange(id)}
            title={`${t(`viewHelp.${id}` as MessageKey)} (G)`}
          >
            {VIEW_ICONS[id]}
            {t(`view.${id}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

function overlayKey(id: Overlay): string {
  return {
    ambient: '',
    wind: 'W',
    currents: 'C',
    isobars: 'P',
    mantle: 'T',
    names: 'N',
    icons: 'I',
    events: 'V',
  }[id];
}
