import { t, type MessageKey } from '../i18n/i18n';
import type { MapLayer } from '../render/mapRenderer';
import { LAYER_ICONS, OVERLAY_ICONS, VIEW_ICONS } from './icons';
import { OVERLAYS, VIEWS, type Overlay, type View } from './PlanetView';

interface Props {
  layers: readonly MapLayer[];
  overlays: readonly Overlay[];
  onToggleOverlay: (overlay: Overlay) => void;
  layer: MapLayer;
  onLayerChange: (layer: MapLayer) => void;
  view: View;
  onViewChange: (view: View) => void;
}

/** Map layer and view switches above the planet; layers are numbered for the keyboard. */
export function LayerBar(props: Props) {
  const { layers, layer, onLayerChange, view, onViewChange, overlays, onToggleOverlay } = props;
  return (
    <div className="layerbar">
      <div className="segmented wrap" role="radiogroup" aria-label={t('layer.label')}>
        {layers.map((id, index) => (
          <button
            key={id}
            role="radio"
            aria-checked={layer === id}
            className={layer === id ? 'selected' : undefined}
            onClick={() => onLayerChange(id)}
            title={`${t(`layerHelp.${id}` as MessageKey)} (${index + 1})`}
          >
            {LAYER_ICONS[id]}
            {t(`layer.${id}`)}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label={t('overlay.label')}>
        {OVERLAYS.map((id) => (
          <button
            key={id}
            aria-pressed={overlays.includes(id)}
            className={overlays.includes(id) ? 'selected' : undefined}
            onClick={() => onToggleOverlay(id)}
            title={`${t(`overlayHelp.${id}` as MessageKey)} (${id === 'wind' ? 'W' : 'C'})`}
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
