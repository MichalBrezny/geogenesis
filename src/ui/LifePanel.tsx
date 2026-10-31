import { formatFixed, t, type MessageKey } from '../i18n/i18n';
import { LIFE_CLASSES } from '../sim/data/lifeClasses';
import type { Frame } from '../worker/protocol';
import { formatGyr } from './format';

/**
 * Table of life classes: whether each is alive, how much of the planet it
 * covers, and when it first appeared. Doubles as the accessible table view of
 * the life map layer.
 */
export function LifePanel({ life }: { life: Frame['life'] }) {
  return (
    <section className="life-panel" aria-label={t('life.title')}>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('life.class')}</th>
            <th scope="col">{t('life.status')}</th>
            <th scope="col" className="numeric">
              {t('life.cover')}
            </th>
            <th scope="col" className="numeric">
              {t('life.appeared')}
            </th>
          </tr>
        </thead>
        <tbody>
          {LIFE_CLASSES.map((lifeClass, c) => {
            const cover = life.cover[c]!;
            const appeared = life.appeared[c] ?? null;
            const status: MessageKey =
              cover > 0 ? 'life.alive' : appeared === null ? 'life.notYet' : 'life.extinct';
            return (
              <tr key={lifeClass.key} className={cover > 0 ? undefined : 'muted'}>
                <th scope="row">{t(`lifeClass.${lifeClass.key}`)}</th>
                <td>{t(status)}</td>
                <td className="numeric">{cover > 0 ? `${formatFixed(cover * 100, 1)}%` : '–'}</td>
                <td className="numeric">{appeared === null ? '–' : formatGyr(appeared)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
