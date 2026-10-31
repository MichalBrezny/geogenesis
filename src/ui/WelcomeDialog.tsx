import { useState } from 'react';
import { getLanguageChoice, saveLanguageChoice, t } from '../i18n/i18n';
import { Dialog } from './Dialog';
import { LanguageSelect } from './LanguageSelect';
import { LAYER_ICONS, TOOL_ICONS, VIEW_ICONS, WINDOW_ICONS } from './icons';
import type { StoredSave } from './saveStore';
import { browserStorage, setWelcomeAtStartup, shouldShowWelcome } from './welcome';

export function WelcomeDialog(props: {
  latestAutosave: StoredSave | null;
  onChoosePlanet: () => void;
  onContinue: (save: StoredSave) => void;
  onExplore: () => void;
}) {
  const [showAtStartup, setShowAtStartup] = useState(() => shouldShowWelcome(browserStorage()));
  const items = [
    { icon: VIEW_ICONS.globe, text: t('welcome.do.watch') },
    { icon: TOOL_ICONS.raise, text: t('welcome.do.tools') },
    { icon: WINDOW_ICONS.geosphere, text: t('welcome.do.systems') },
    { icon: LAYER_ICONS.civilization, text: t('welcome.do.goals') },
  ];

  return (
    <Dialog title={t('welcome.title')} onClose={props.onExplore} className="welcome-dialog">
      <div className="welcome-language">
        <LanguageSelect
          value={getLanguageChoice()}
          onChange={(language) => {
            // Reload in the new language; the welcome has not been dismissed, so it shows again.
            if (language !== getLanguageChoice() && saveLanguageChoice(language)) {
              window.location.reload();
            }
          }}
        />
      </div>
      <p className="welcome-pitch">{t('welcome.pitch')}</p>
      <section>
        <h3>{t('welcome.whatYouDo')}</h3>
        <ul className="welcome-items">
          {items.map((item) => (
            <li key={item.text}>
              <span className="welcome-icon">{item.icon}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </section>
      <aside className="welcome-start">
        <strong>{t('welcome.howToStart')}</strong>
        <span>{t('welcome.startHint')}</span>
      </aside>
      <details className="welcome-privacy">
        <summary>{t('privacy.title')}</summary>
        <p>{t('privacy.summary')}</p>
        <p>{t('privacy.preferences')}</p>
        <p>{t('privacy.remove')}</p>
      </details>
      <label className="welcome-startup" title={t('welcome.showAtStartup')}>
        <input
          type="checkbox"
          checked={showAtStartup}
          onChange={(event) => {
            setShowAtStartup(event.target.checked);
            setWelcomeAtStartup(browserStorage(), event.target.checked);
          }}
        />
        {t('welcome.showAtStartup')}
      </label>
      <div className="actions welcome-actions">
        <button type="button" onClick={props.onExplore} title={t('welcome.explore')}>
          {t('welcome.explore')}
        </button>
        {props.latestAutosave && (
          <button
            type="button"
            onClick={() => props.onContinue(props.latestAutosave!)}
            title={t('welcome.continue')}
          >
            {t('welcome.continue')}
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={props.onChoosePlanet}
          title={t('welcome.choosePlanet')}
        >
          {t('welcome.choosePlanet')}
        </button>
      </div>
    </Dialog>
  );
}
