import { useState } from 'react';
import { t, type MessageKey } from '../i18n/i18n';
import type { Frame } from '../worker/protocol';
import { formatGyr, formatPpm, formatStep } from './format';
import { GaiaFace } from './GaiaFace';
import { NewPlanetDialog, type NewPlanetChoice } from './NewPlanetDialog';
import { SaveLoadDialog, type FileDialogMode } from './SaveLoadDialog';
export { RESOLUTIONS } from './menuOptions';

export const SPEEDS = { slow: 500, normal: 120, fast: 0 } as const;
export type Speed = keyof typeof SPEEDS;

interface Props {
  frame: Frame | null;
  running: boolean;
  onToggleRunning: () => void;
  onStep: () => void;
  speed: Speed;
  onSpeedChange: (speed: Speed) => void;
  onNewPlanet: (choice: NewPlanetChoice) => void;
  onSave: (fileName: string) => void;
  onLoad: (file: File) => void;
  onShowHelp: () => void;
  error: string | null;
  newPlanetRequest: number;
}

/** Time controls, the planet's vital signs and the planet menu. */
export function TopBar(props: Props) {
  const { frame, running } = props;
  const [newPlanetOpen, setNewPlanetOpen] = useState(false);
  const [dismissedRequest, setDismissedRequest] = useState(0);
  const [fileDialog, setFileDialog] = useState<FileDialogMode | null>(null);
  const requestedOpen = props.newPlanetRequest > dismissedRequest;
  const closeNewPlanet = () => {
    setNewPlanetOpen(false);
    setDismissedRequest(props.newPlanetRequest);
  };

  return (
    <>
      <header className="topbar">
        <h1>
          <img className="logo" src={`${import.meta.env.BASE_URL}icon-180.png`} alt="" />
          {t('app.title')} <span className="subtitle">{t('app.subtitle')}</span>
        </h1>
        <div className="group" role="group" aria-label={t('controls.time')}>
          <button
            className="primary"
            onClick={props.onToggleRunning}
            disabled={!frame}
            title={t(running ? 'controls.pauseHint' : 'controls.playHint')}
          >
            {running ? t('controls.pause') : t('controls.play')}
          </button>
          <button
            onClick={props.onStep}
            disabled={running || !frame}
            title={t('controls.stepHint')}
          >
            {t('controls.step')}
          </button>
          <div className="segmented" role="radiogroup" aria-label={t('controls.speed')}>
            {(Object.keys(SPEEDS) as Speed[]).map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={props.speed === id}
                className={props.speed === id ? 'selected' : undefined}
                onClick={() => props.onSpeedChange(id)}
                title={t('controls.speedHint')}
              >
                {t(`speed.${id}`)}
              </button>
            ))}
          </div>
        </div>
        {frame && <Vitals frame={frame} />}
        <div className="group menu" role="group" aria-label={t('controls.planet')}>
          <button onClick={() => setNewPlanetOpen(true)} title={t('controls.newPlanetHint')}>
            {t('controls.newPlanet')}
          </button>
          <button
            onClick={() => setFileDialog('save')}
            disabled={!frame}
            title={t('controls.saveHint')}
          >
            {t('controls.save')}
          </button>
          <button onClick={() => setFileDialog('load')} title={t('controls.loadHint')}>
            {t('controls.load')}
          </button>
          <button
            onClick={props.onShowHelp}
            title={t('help.shortcutsHint')}
            aria-label={t('help.shortcuts')}
          >
            ?
          </button>
        </div>
      </header>
      {(newPlanetOpen || requestedOpen) && (
        <NewPlanetDialog onClose={closeNewPlanet} onCreate={props.onNewPlanet} />
      )}
      {fileDialog && (
        <SaveLoadDialog
          mode={fileDialog}
          frame={frame}
          error={props.error}
          onClose={() => setFileDialog(null)}
          onSave={props.onSave}
          onLoad={props.onLoad}
        />
      )}
    </>
  );
}

/** The planet's vital signs; each explains itself on hover. */
function Vitals({ frame }: { frame: Frame }) {
  const stepTime = Object.values(frame.timings).reduce((sum, ms) => sum + ms, 0);
  const age =
    frame.stepYears >= 1e5 ? formatGyr(frame.year) : Math.round(frame.year).toLocaleString('en');
  const items: [MessageKey, MessageKey, string, boolean?][] = [
    ...(frame.era
      ? [
          ['stat.era', 'stat.eraHint', t(`eraName.${frame.era}`)] as [
            MessageKey,
            MessageKey,
            string,
          ],
        ]
      : []),
    ['stat.age', 'stat.ageHint', age],
    ['stat.step', 'stat.stepHint', formatStep(frame.stepYears)],
    ['stat.temperature', 'stat.temperatureHint', `${frame.meanTemperature.toFixed(1)} °C`],
    ['stat.co2', 'stat.co2Hint', `${formatPpm(frame.co2)} ppm`],
    ['stat.pressure', 'stat.pressureHint', `${frame.surfacePressure.toFixed(2)} bar`],
    [
      'stat.o2',
      'stat.o2Hint',
      `${(frame.o2 * 100).toFixed(1)}% / ${frame.o2Pressure.toFixed(2)} bar`,
    ],
    ['stat.life', 'stat.lifeHint', t(`biosignature.${frame.biosignature}`)],
    ['stat.ice', 'stat.iceHint', `${(frame.iceFraction * 100).toFixed(0)}%`],
    ['stat.seaLevel', 'stat.seaLevelHint', `${frame.seaLevel.toFixed(0)} m`],
    ['stat.sun', 'stat.sunHint', `${(frame.solarInput * 100).toFixed(1)}%`],
    ...(frame.civilization.species !== null || frame.fossilCarbon > 0
      ? [
          [
            'stat.fossilCarbon',
            'stat.fossilCarbonHint',
            `${frame.fossilCarbon.toFixed(0)} Gt C`,
          ] as [MessageKey, MessageKey, string],
          [
            'stat.pollution',
            'stat.pollutionHint',
            frame.pollution.toFixed(2),
            frame.pollution >= 1,
          ] as [MessageKey, MessageKey, string, boolean],
        ]
      : []),
    [
      'stat.runawayMargin',
      'stat.runawayMarginHint',
      `${frame.runawayMargin.toFixed(0)} W/m2`,
      frame.runawayMargin < 15,
    ],
    [
      'stat.energy',
      'stat.energyHint',
      frame.unlimitedEnergy ? '∞' : Math.floor(frame.energy).toLocaleString('en'),
    ],
  ];
  return (
    <dl className="vitals">
      <div className="gaia-vital">
        <dt className="visually-hidden">{t('gaia.title')}</dt>
        <dd>
          <GaiaFace gaia={frame.gaia} />
        </dd>
      </div>
      {items.map(([label, hint, value, warning]) => (
        <div key={label} title={t(hint)} className={warning ? 'warning' : undefined}>
          <dt>{t(label)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      <div className="muted" title={t('stat.computeHint')}>
        <dt>{t('stat.compute')}</dt>
        <dd>{stepTime.toFixed(0)} ms</dd>
      </div>
    </dl>
  );
}
