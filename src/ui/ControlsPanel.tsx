import { t, type MessageKey } from '../i18n/i18n';
import type { ModelControls } from '../sim/core/planet';

interface Slider {
  key: keyof ModelControls;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: readonly Slider[] = [
  { key: 'solarFactor', min: 0.8, max: 1.2, step: 0.01 },
  { key: 'volcanism', min: 0, max: 3, step: 0.1 },
  { key: 'driftSpeed', min: 0, max: 3, step: 0.1 },
  { key: 'erosion', min: 0, max: 3, step: 0.1 },
  { key: 'mutationRate', min: 0, max: 5, step: 0.1 },
];

/** Model controls: multipliers on the planet's processes (1 = natural). */
export function ControlsPanel(props: {
  controls: ModelControls;
  onChange: (controls: Partial<ModelControls>) => void;
}) {
  return (
    <section className="panel" aria-label={t('controlsPanel.title')}>
      <h2>{t('controlsPanel.title')}</h2>
      <div className="sliders">
        {SLIDERS.map(({ key, min, max, step }) => (
          <label key={key}>
            <span>{t(`control.${key}` as MessageKey)}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={props.controls[key]}
              onChange={(e) => props.onChange({ [key]: Number(e.target.value) })}
            />
            <span className="slider-value">×{props.controls[key].toFixed(2)}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
