import { useState } from 'react';
import { formatFixed, formatNumber, t, type MessageKey } from '../i18n/i18n';
import type { Frame } from '../worker/protocol';
import { formatGyr, formatPpm, formatStep } from './format';
import { GaiaFace } from './GaiaFace';
import { NewPlanetDialog, type NewPlanetChoice } from './NewPlanetDialog';
import { SaveLoadDialog, type FileDialogMode } from './SaveLoadDialog';
import { TOUR_ANCHORS } from './guide';
import type { StoredSave } from './saveStore';
import type { Settings } from './settings';
import type { AudioSettings } from '../audio/audioSettings';
import { SoundSettingsSection } from './SoundSettingsSection';
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
  onAdaptivePacingChange: (enabled: boolean) => void;
  onNewPlanet: (choice: NewPlanetChoice) => void;
  onSave: (fileName: string) => void;
  onLoad: (file: File) => void;
  onCopyShareLink: () => void;
  onShowHelp: () => void;
  onShowSettings: () => void;
  settings: Settings;
  saves: readonly StoredSave[];
  latestAutosave: StoredSave | null;
  onSaveSlot: (name: string, overwriteId?: string) => void;
  onLoadSlot: (save: StoredSave) => void;
  onRenameSlot: (id: string, name: string) => void;
  onDeleteSlot: (id: string) => void;
  error: string | null;
  newPlanetRequest: number;
  soundSettings: AudioSettings;
  onSoundSettingsChange: (settings: AudioSettings) => void;
}

/** Time controls, the planet's vital signs and the planet menu. */
export function TopBar(props: Props) {
  const { frame, running } = props;
  const [newPlanetOpen, setNewPlanetOpen] = useState(false);
  const [dismissedRequest, setDismissedRequest] = useState(0);
  const [fileDialog, setFileDialog] = useState<FileDialogMode | null>(null);
  const [soundOpen, setSoundOpen] = useState(false);
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
        <div
          className="group"
          role="group"
          aria-label={t('controls.time')}
          data-tour={TOUR_ANCHORS.time}
        >
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
        {frame && (
          <label className="compact-toggle" title={t('controls.adaptivePacingHint')}>
            <input
              type="checkbox"
              checked={frame.adaptivePacing}
              onChange={(event) => props.onAdaptivePacingChange(event.target.checked)}
            />
            {t('controls.adaptivePacing')}
          </label>
        )}
        {frame && <Vitals frame={frame} />}
        <div className="group menu" role="group" aria-label={t('controls.planet')}>
          <div className="popover-anchor">
            <div className="segmented sound-buttons">
              <button
                className={props.soundSettings.muted ? 'selected' : undefined}
                onClick={() =>
                  props.onSoundSettingsChange({
                    ...props.soundSettings,
                    muted: !props.soundSettings.muted,
                  })
                }
                title={t(props.soundSettings.muted ? 'sound.unmuteHint' : 'sound.muteHint')}
                aria-label={t(props.soundSettings.muted ? 'sound.unmute' : 'sound.mute')}
              >
                {props.soundSettings.muted ? '🔇' : '🔊'}
              </button>
              <button
                onClick={() => setSoundOpen((open) => !open)}
                title={t('sound.settingsHint')}
                aria-label={t('sound.settings')}
                aria-expanded={soundOpen}
              >
                ▾
              </button>
            </div>
            {soundOpen && (
              <div
                className="popover sound-popover"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSoundOpen(false);
                }}
              >
                <button
                  className="popover-close"
                  onClick={() => setSoundOpen(false)}
                  title={t('sound.closeHint')}
                  aria-label={t('sound.close')}
                >
                  ×
                </button>
                <SoundSettingsSection
                  settings={props.soundSettings}
                  onChange={props.onSoundSettingsChange}
                />
              </div>
            )}
          </div>
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
          {props.latestAutosave && (
            <button
              onClick={() => props.onLoadSlot(props.latestAutosave!)}
              title={t('saves.continueHint')}
            >
              {t('saves.continue')}
            </button>
          )}
          <button onClick={props.onShowSettings} title={t('settings.openHint')}>
            {t('settings.open')}
          </button>
          <button onClick={props.onCopyShareLink} disabled={!frame} title={t('share.copyHint')}>
            {t('share.copy')}
          </button>
          <button
            onClick={props.onShowHelp}
            title={t('help.shortcutsHint')}
            aria-label={t('help.title')}
          >
            ?
          </button>
        </div>
      </header>
      {(newPlanetOpen || requestedOpen) && (
        <NewPlanetDialog
          onClose={closeNewPlanet}
          onCreate={props.onNewPlanet}
          settings={props.settings}
        />
      )}
      {fileDialog && (
        <SaveLoadDialog
          mode={fileDialog}
          frame={frame}
          error={props.error}
          onClose={() => setFileDialog(null)}
          onSave={props.onSave}
          onLoad={props.onLoad}
          saves={props.saves}
          onSaveSlot={props.onSaveSlot}
          onLoadSlot={props.onLoadSlot}
          onRenameSlot={props.onRenameSlot}
          onDeleteSlot={props.onDeleteSlot}
        />
      )}
    </>
  );
}

/** The planet's vital signs; each explains itself on hover. */
function Vitals({ frame }: { frame: Frame }) {
  const stepTime = Object.values(frame.timings).reduce((sum, ms) => sum + ms, 0);
  const age = frame.stepYears >= 1e5 ? formatGyr(frame.year) : formatNumber(Math.round(frame.year));
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
    ['stat.temperature', 'stat.temperatureHint', `${formatFixed(frame.meanTemperature, 1)} °C`],
    ['stat.co2', 'stat.co2Hint', `${formatPpm(frame.co2)} ppm`],
    ['stat.pressure', 'stat.pressureHint', `${formatFixed(frame.surfacePressure, 2)} bar`],
    [
      'stat.o2',
      'stat.o2Hint',
      `${formatFixed(frame.o2 * 100, 1)}% / ${formatFixed(frame.o2Pressure, 2)} bar`,
    ],
    ['stat.life', 'stat.lifeHint', t(`biosignature.${frame.biosignature}`)],
    ['stat.ice', 'stat.iceHint', `${formatFixed(frame.iceFraction * 100, 0)}%`],
    ['stat.seaLevel', 'stat.seaLevelHint', `${formatFixed(frame.seaLevel, 0)} m`],
    ['stat.sun', 'stat.sunHint', `${formatFixed(frame.solarInput * 100, 1)}%`],
    ...(frame.civilization.species !== null || frame.fossilCarbon > 0
      ? [
          [
            'stat.fossilCarbon',
            'stat.fossilCarbonHint',
            `${formatFixed(frame.fossilCarbon, 0)} Gt C`,
          ] as [MessageKey, MessageKey, string],
          [
            'stat.pollution',
            'stat.pollutionHint',
            formatFixed(frame.pollution, 2),
            frame.pollution >= 1,
          ] as [MessageKey, MessageKey, string, boolean],
        ]
      : []),
    [
      'stat.runawayMargin',
      'stat.runawayMarginHint',
      `${formatFixed(frame.runawayMargin, 0)} W/m²`,
      frame.runawayMargin < 15,
    ],
    [
      'stat.energy',
      'stat.energyHint',
      frame.unlimitedEnergy
        ? '∞'
        : `${formatNumber(Math.floor(frame.energy))}/${formatNumber(Math.floor(frame.energyCap))}`,
    ],
  ];
  return (
    <dl className="vitals" data-tour={TOUR_ANCHORS.vitals}>
      <div className="gaia-vital">
        <dt className="visually-hidden">{t('gaia.title')}</dt>
        <dd>
          <GaiaFace gaia={frame.gaia} />
        </dd>
      </div>
      {items.map(([label, hint, value, warning]) => (
        <div
          key={label}
          title={t(hint)}
          className={warning ? 'warning' : undefined}
          data-tour={label === 'stat.era' ? TOUR_ANCHORS.era : undefined}
        >
          <dt>{t(label)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      <div className="muted" title={t('stat.computeHint')}>
        <dt>{t('stat.compute')}</dt>
        <dd>{formatFixed(stepTime, 0)} ms</dd>
      </div>
    </dl>
  );
}
