import { t, type MessageKey } from '../i18n/i18n';
import type { Frame } from '../worker/protocol';
import { currentTaskKey } from './currentTask';

export function CurrentTaskPanel({ frame }: { frame: Frame }) {
  if (frame.goal) {
    return (
      <section className="current-task" aria-label={t('currentTask.title')}>
        <h3>{t('currentTask.goal')}</h3>
        <ul className="current-task-goal">
          {frame.goal.conditions.map((condition) => (
            <li key={condition.key} className={condition.met ? 'met' : undefined}>
              <span aria-hidden="true">{condition.met ? '✓' : '○'}</span>{' '}
              {t(condition.key as MessageKey)}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section className="current-task" aria-label={t('currentTask.title')}>
      <h3>{t('currentTask.title')}</h3>
      <p>{t(currentTaskKey(frame))}</p>
    </section>
  );
}
