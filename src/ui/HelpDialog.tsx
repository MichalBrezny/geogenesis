import { t } from '../i18n/i18n';
import packageInfo from '../../package.json';
import { Dialog } from './Dialog';
import { shortcutHelpItems } from './shortcuts';

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={t('help.title')} onClose={onClose} className="help-dialog">
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
      </section>
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
    </Dialog>
  );
}
