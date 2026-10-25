import { t, type MessageKey } from '../i18n/i18n';
import type { FrameGoal } from '../worker/protocol';
import { formatStep } from './format';
import { GOAL_ICON } from './icons';

function goalKey(prefix: string, id: FrameGoal['id']): MessageKey {
  return `${prefix}.${id}` as MessageKey;
}

function formatCondition(value: number, unit: string): string {
  const digits =
    unit === 'goal.unit.celsius' ? 1 : Number.isInteger(value) ? 0 : value < 10 ? 2 : 1;
  const suffix = unit ? t(unit as MessageKey) : '';
  return `${value.toFixed(digits)}${suffix ? ` ${suffix}` : ''}`;
}

function deadline(goal: FrameGoal): number | null {
  const value = goal.memory.deadlineYear;
  return typeof value === 'number' ? value : null;
}

export function GoalPanel({ goal, year }: { goal: FrameGoal; year: number }) {
  const end = deadline(goal);
  const elapsed = Math.max(0, (goal.outcomeYear ?? year) - goal.startYear);
  const remaining = end === null ? null : Math.max(0, end - year);
  return (
    <section className="goal-panel" aria-label={t('goal.title')}>
      <h2>
        {GOAL_ICON}
        {t(goalKey('goal.name', goal.id))}
      </h2>
      <p>{t(goalKey('goal.briefing', goal.id))}</p>
      <ul className="goal-checklist">
        {goal.conditions.map((condition) => (
          <li key={condition.key} className={condition.met ? 'met' : undefined}>
            <span className="goal-check" aria-hidden="true">
              {condition.met ? '✓' : '○'}
            </span>
            <span>
              {t(condition.key as MessageKey)}
              <small>
                {formatCondition(condition.value, condition.unit)} /{' '}
                {formatCondition(condition.target, condition.unit)}
              </small>
            </span>
          </li>
        ))}
      </ul>
      <dl className="goal-stats">
        <dt>{t('goal.score')}</dt>
        <dd>{goal.score.toFixed(1)}</dd>
        <dt>{t('goal.elapsed')}</dt>
        <dd>{formatStep(elapsed)}</dd>
        {remaining !== null && (
          <>
            <dt>{t('goal.remaining')}</dt>
            <dd>{formatStep(remaining)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

export function GoalOutcome(props: {
  goal: FrameGoal;
  onKeepPlaying: () => void;
  onNewPlanet: () => void;
}) {
  const { goal } = props;
  const won = goal.status === 'won';
  const reason = goal.outcomeReason ? t(`goal.reason.${goal.outcomeReason}` as MessageKey) : '';
  return (
    <div className="overlay">
      <section
        className={`goal-outcome ${won ? 'won' : 'lost'}`}
        role="dialog"
        aria-modal="true"
        aria-label={t(won ? 'goal.won' : 'goal.lost')}
      >
        <div className="goal-outcome-icon">{GOAL_ICON}</div>
        <h2>{t(won ? 'goal.won' : 'goal.lost')}</h2>
        <p>{reason}</p>
        <p className="goal-outcome-score">
          {t('goal.finalScore', { value: goal.score.toFixed(1) })}
        </p>
        <div className="actions">
          <button type="button" title={t('goal.keepPlayingHint')} onClick={props.onKeepPlaying}>
            {t('goal.keepPlaying')}
          </button>
          <button
            type="button"
            className="primary"
            title={t('goal.newPlanetHint')}
            onClick={props.onNewPlanet}
          >
            {t('controls.newPlanet')}
          </button>
        </div>
      </section>
    </div>
  );
}
