import { t, type MessageKey } from '../i18n/i18n';
import { ENERGY_SOURCE_KEYS, INVESTMENT_KEYS, type CivilizationPolicy } from '../sim/core/planet';
import { energySourceUnlocked, type CivilizationPolicyChanges } from '../sim/data/civilization';

export function CivilizationControlsPanel(props: {
  policy: CivilizationPolicy;
  age: number;
  energySupply: number;
  fossilSupply: number;
  fossilCarbon: number;
  pollution: number;
  onChange: (changes: CivilizationPolicyChanges) => void;
}) {
  return (
    <div className="civilization-controls">
      <dl className="civ-stats">
        <dt>{t('civ.energySupply')}</dt>
        <dd>{(props.energySupply * 100).toFixed(0)}%</dd>
        <dt>{t('civ.fossilSupply')}</dt>
        <dd>{(props.fossilSupply * 100).toFixed(0)}%</dd>
        <dt>{t('civ.fossilCarbon')}</dt>
        <dd>{props.fossilCarbon.toFixed(0)} Gt C</dd>
        <dt>{t('civ.pollution')}</dt>
        <dd>{props.pollution.toFixed(2)}</dd>
      </dl>
      <PolicyGroup title="civ.energyMix">
        {ENERGY_SOURCE_KEYS.map((key) => {
          const unlocked = energySourceUnlocked(key, props.age);
          return (
            <PolicySlider
              key={key}
              id={`energy-${key}`}
              name={t(`civ.energy.${key}` as MessageKey)}
              hint={t(`civ.energyHelp.${key}` as MessageKey)}
              value={props.policy.energy[key]}
              disabled={!unlocked}
              onChange={(value) => props.onChange({ energy: { [key]: value } })}
            />
          );
        })}
      </PolicyGroup>
      <PolicyGroup title="civ.investment">
        {INVESTMENT_KEYS.map((key) => (
          <PolicySlider
            key={key}
            id={`investment-${key}`}
            name={t(`civ.investment.${key}` as MessageKey)}
            hint={t(`civ.investmentHelp.${key}` as MessageKey)}
            value={props.policy.investment[key]}
            onChange={(value) => props.onChange({ investment: { [key]: value } })}
          />
        ))}
      </PolicyGroup>
    </div>
  );
}

function PolicyGroup({ title, children }: { title: MessageKey; children: ReactNode }) {
  return (
    <section>
      <h3>{t(title)}</h3>
      <div className="policy-sliders">{children}</div>
    </section>
  );
}

function PolicySlider(props: {
  id: string;
  name: string;
  hint: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const title = props.disabled ? `${props.hint} ${t('civ.locked')}` : props.hint;
  return (
    <div title={title} className={props.disabled ? 'locked' : undefined}>
      <label htmlFor={props.id}>{props.name}</label>
      <input
        id={props.id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={props.value}
        disabled={props.disabled}
        title={title}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <output htmlFor={props.id}>{props.value.toFixed(0)}%</output>
    </div>
  );
}
import type { ReactNode } from 'react';
