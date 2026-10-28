import { useState } from 'react';
import { t, type MessageKey } from '../i18n/i18n';
import type { ModelControls } from '../sim/core/planet';
import type { ControlKey } from '../sim/goals/goals';

interface Slider {
  key: keyof ModelControls;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
  /** Below this target the slider shows its `controlWarning.<key>` string. */
  warnBelow?: number;
}

const SLIDERS: readonly Slider[] = [
  { key: 'solarFactor', min: 0.8, max: 1.2, step: 0.01 },
  { key: 'obliquity', min: 0, max: 60, step: 0.1, unit: '°', digits: 1 },
  { key: 'volcanism', min: 0, max: 3, step: 0.1, warnBelow: 0.3 },
  { key: 'driftSpeed', min: 0, max: 3, step: 0.1 },
  { key: 'erosion', min: 0, max: 3, step: 0.1 },
  { key: 'mutationRate', min: 0, max: 5, step: 0.1 },
  { key: 'greenhouse', min: 0, max: 2, step: 0.05 },
  { key: 'cloudAlbedo', min: 0, max: 3, step: 0.1 },
  { key: 'surfaceAlbedo', min: 0.5, max: 1.5, step: 0.05 },
  { key: 'airSeaHeat', min: 0.1, max: 5, step: 0.1 },
  { key: 'rainfall', min: 0.2, max: 3, step: 0.1 },
  { key: 'advanceRate', min: 0, max: 5, step: 0.1 },
  { key: 'reproduction', min: 0.1, max: 5, step: 0.1 },
  { key: 'thermalTolerance', min: 0.5, max: 2, step: 0.05 },
];

export type ControlGroupId = 'geosphere' | 'atmosphere' | 'biosphere';

export const CONTROL_GROUPS: Record<ControlGroupId, readonly (keyof ModelControls)[]> = {
  geosphere: ['volcanism', 'driftSpeed', 'erosion'],
  atmosphere: [
    'solarFactor',
    'obliquity',
    'greenhouse',
    'cloudAlbedo',
    'surfaceAlbedo',
    'airSeaHeat',
    'rainfall',
  ],
  biosphere: ['advanceRate', 'mutationRate', 'reproduction', 'thermalTolerance'],
};

function SliderControl(props: {
  slider: Slider;
  value: number;
  effectiveValue: number;
  defaultValue: number;
  limit?: [number, number];
  onChange: (value: number) => void;
}) {
  const { key, step, unit, digits = 2 } = props.slider;
  const min = props.limit?.[0] ?? props.slider.min;
  const max = props.limit?.[1] ?? props.slider.max;
  const formattedValue = props.value.toFixed(digits);
  const [draft, setDraft] = useState<string | null>(null);
  const modified = props.value !== props.defaultValue;
  const lagging = Math.abs(props.effectiveValue - props.value) > Math.max(step / 20, 1e-6);
  const name = t(`control.${key}` as MessageKey);
  const hint = t('controlsPanel.sliderHint', {
    description: t(`controlHelp.${key}` as MessageKey),
  });

  const reset = () => props.onChange(props.defaultValue);
  const revert = () => setDraft(null);
  const applyDraft = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      revert();
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    const stepped = min + Math.round((clamped - min) / step) * step;
    const value = Number(Math.min(max, Math.max(min, stepped)).toFixed(digits));
    setDraft(null);
    props.onChange(value);
  };

  return (
    <div className={modified ? 'modified' : undefined} title={hint}>
      <label className="slider-name" htmlFor={`control-${key}`} onDoubleClick={reset}>
        {name}
      </label>
      <input
        id={`control-${key}`}
        type="range"
        title={hint}
        min={min}
        max={max}
        step={step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
        onDoubleClick={reset}
      />
      <span className="slider-value">
        {unit ? '' : '×'}
        <input
          type="number"
          aria-label={t('controlsPanel.valueLabel', { name })}
          title={t('controlsPanel.valueHint', { name })}
          min={min}
          max={max}
          step={step}
          value={draft ?? formattedValue}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={applyDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              applyDraft();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              revert();
            }
          }}
        />
        {unit}
      </span>
      {lagging && (
        <span
          className="control-effective"
          title={t('controlsPanel.effectiveHint', {
            value: props.effectiveValue.toFixed(digits),
          })}
        >
          {t('controlsPanel.effective', { value: props.effectiveValue.toFixed(digits) })}
        </span>
      )}
      {modified && (
        <button
          type="button"
          className="slider-reset"
          title={t('controlsPanel.resetHint', { name })}
          onClick={reset}
        >
          <span aria-hidden="true">&#8635;</span>
          <span className="visually-hidden">{t('controlsPanel.reset')}</span>
        </button>
      )}
      {props.slider.warnBelow !== undefined && props.value < props.slider.warnBelow && (
        <p className="control-warning" role="status">
          {t(`controlWarning.${key}` as MessageKey)}
        </p>
      )}
    </div>
  );
}

/** Model controls: multipliers on the planet's processes (1 = natural). */
export function ControlsPanel(props: {
  controls: ModelControls;
  effectiveControls: ModelControls;
  group: ControlGroupId;
  defaults: Readonly<ModelControls>;
  controlLimits?: Partial<Record<ControlKey, [number, number]>>;
  onChange: (controls: Partial<ModelControls>) => void;
}) {
  const sliders = CONTROL_GROUPS[props.group].map((key) =>
    SLIDERS.find((slider) => slider.key === key)!,
  );

  return (
    <div className="sliders">
      {sliders.map((slider) => (
        <SliderControl
          key={slider.key}
          slider={slider}
          value={props.controls[slider.key]}
          effectiveValue={props.effectiveControls[slider.key]}
          defaultValue={props.defaults[slider.key]}
          limit={props.controlLimits?.[slider.key]}
          onChange={(value) => props.onChange({ [slider.key]: value })}
        />
      ))}
    </div>
  );
}
