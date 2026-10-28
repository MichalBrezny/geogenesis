import { t, type MessageKey } from '../i18n/i18n';
import type { Frame } from '../worker/protocol';
import { currentTaskKey } from './currentTask';
import { ContextHelpButton } from './ContextHelpButton';
import { TOUR_ANCHORS, type GuidePageId } from './guide';

export function CurrentTaskPanel({
  frame,
  onHelp,
}: {
  frame: Frame;
  onHelp?: (page: GuidePageId) => void;
}) {
  if (frame.goal) {
    return (
      <section
        className="current-task"
        aria-label={t('currentTask.title')}
        data-tour={TOUR_ANCHORS.goal}
      >
        <h3 data-tour={TOUR_ANCHORS.era}>
          {t('currentTask.goal')} <ContextHelpButton page="goals" onHelp={onHelp} />
        </h3>
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
    <section
      className="current-task"
      aria-label={t('currentTask.title')}
      data-tour={TOUR_ANCHORS.goal}
    >
      <h3 data-tour={TOUR_ANCHORS.era}>
        {t('currentTask.title')} <ContextHelpButton page="goals" onHelp={onHelp} />
      </h3>
      <p>{t(currentTaskKey(frame))}</p>
    </section>
  );
}
