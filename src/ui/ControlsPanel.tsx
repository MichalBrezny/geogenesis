import { t, type MessageKey } from '../i18n/i18n';
import type { ModelControls } from '../sim/core/planet';

interface Slider {
  key: keyof ModelControls;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
}

const SLIDERS: readonly Slider[] = [
  { key: 'solarFactor', min: 0.8, max: 1.2, step: 0.01 },
  { key: 'obliquity', min: 0, max: 60, step: 0.1, unit: '°', digits: 1 },
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
    <div className="sliders">
      {SLIDERS.map(({ key, min, max, step, unit, digits }) => (
        <label key={key} title={t(`controlHelp.${key}` as MessageKey)}>
          <span>{t(`control.${key}` as MessageKey)}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={props.controls[key]}
            onChange={(e) => props.onChange({ [key]: Number(e.target.value) })}
          />
          <span className="slider-value">
            {unit ? '' : '×'}
            {props.controls[key].toFixed(digits ?? 2)}
            {unit}
          </span>
        </label>
      ))}
    </div>
  );
}
