import { useState } from 'react';
import { t } from '../i18n/i18n';
import packageInfo from '../../package.json';
import { Dialog } from './Dialog';
import { shortcutHelpItems } from './shortcuts';
import type { MapLayer } from '../render/mapRenderer';
import type { ChartSeries } from './charts/HistoryCharts';
import type { GlossaryTerm } from './glossary';
import type { GuidePageId } from './guide';
import { Glossary, HelpNav, ModelGuide, type HelpSection } from './GuideContent';
import { AccessibilitySettingsSection } from './AccessibilitySettingsSection';

export function HelpDialog(props: {
  onClose: () => void;
  onRestartTour: () => void;
  initialPage?: GuidePageId;
  availableLayers: readonly MapLayer[];
  availableCharts: readonly ChartSeries[];
  onLayer: (layer: MapLayer) => void;
  onChart: (chart: ChartSeries) => void;
}) {
  const [section, setSection] = useState<HelpSection>(props.initialPage ? 'models' : 'overview');
  const [term, setTerm] = useState<GlossaryTerm | undefined>();
  const openTerm = (next: GlossaryTerm) => {
    setTerm(next);
    setSection('glossary');
  };
  return (
    <Dialog title={t('help.title')} onClose={props.onClose} className="help-dialog">
      <HelpNav section={section} onChange={setSection} />
      {section === 'overview' && (
        <>
          <section>
            <h3>{t('help.shortcuts')}</h3>
            <dl className="shortcut-list">
              {shortcutHelpItems().map(({ keys, label }) => (
                <div key={keys}>
                  <dt>
                    <kbd>{keys}</kbd>
                  </dt>
                  <dd>{t(label)}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>{t('help.howToPlay')}</h3>
            <p>{t('help.howToPlayText')}</p>
            <p className="muted">{t('help.mouse')}</p>
            <button type="button" title={t('tour.restartHint')} onClick={props.onRestartTour}>
              {t('tour.restart')}
            </button>
          </section>
          <AccessibilitySettingsSection />
          <section>
            <h3>{t('help.about')}</h3>
            <p>{t('help.aboutText', { version: packageInfo.version })}</p>
            <p>
              {t('help.license', { license: packageInfo.license })} ·{' '}
              <a
                href="https://github.com/MichalBrezny/geogenesis"
                target="_blank"
                rel="noreferrer"
                title={t('help.repositoryHint')}
              >
                {t('help.repository')}
              </a>
            </p>
          </section>
        </>
      )}
      {section === 'models' && (
        <ModelGuide
          initialPage={props.initialPage}
          availableLayers={props.availableLayers}
          availableCharts={props.availableCharts}
          onLayer={props.onLayer}
          onChart={props.onChart}
          onTerm={openTerm}
        />
      )}
      {section === 'glossary' && <Glossary initialTerm={term} />}
    </Dialog>
  );
}
