import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../i18n/i18n';
import { TOUR_STEPS } from './guide';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function FirstGameTour({ onFinish }: { onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const card = useRef<HTMLElement>(null);
  const step = TOUR_STEPS[index]!;
  useLayoutEffect(() => {
    const update = () => {
      const element = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (!element) {
        setRect(null);
        return;
      }
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const next = element.getBoundingClientRect();
      setRect({ left: next.left, top: next.top, width: next.width, height: next.height });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step.anchor]);
  useEffect(() => {
    card.current?.focus();
  }, [index]);
  const previous = () => setIndex((value) => Math.max(0, value - 1));
  const next = () =>
    index === TOUR_STEPS.length - 1 ? onFinish() : setIndex((value) => value + 1);
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') onFinish();
    if (event.key === 'ArrowRight') next();
    if (event.key === 'ArrowLeft') previous();
    if (event.key !== 'Tab') return;
    const buttons = [...(card.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (buttons.length === 0) return;
    const active = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.shiftKey
      ? active <= 0
        ? buttons.length - 1
        : active - 1
      : active >= buttons.length - 1
        ? 0
        : active + 1;
    event.preventDefault();
    buttons[nextIndex]?.focus();
  };
  return (
    <div
      className="tour"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      onKeyDown={handleKey}
    >
      {rect && (
        <div
          className="tour-highlight"
          style={{
            left: rect.left - 5,
            top: rect.top - 5,
            width: rect.width + 10,
            height: rect.height + 10,
          }}
        />
      )}
      <article ref={card} className="tour-card" tabIndex={-1}>
        <small>{t('tour.progress', { current: index + 1, total: TOUR_STEPS.length })}</small>
        <h2 id="tour-title">{t(`tour.title.${step.anchor}`)}</h2>
        <p>{t(step.key)}</p>
        <div className="actions">
          <button type="button" title={t('tour.skipHint')} onClick={onFinish}>
            {t('tour.skip')}
          </button>
          <span />
          {index > 0 && (
            <button type="button" title={t('tour.backHint')} onClick={previous}>
              {t('tour.back')}
            </button>
          )}
          <button
            type="button"
            className="primary"
            title={t(index === TOUR_STEPS.length - 1 ? 'tour.finishHint' : 'tour.nextHint')}
            onClick={next}
          >
            {t(index === TOUR_STEPS.length - 1 ? 'tour.finish' : 'tour.next')}
          </button>
        </div>
      </article>
    </div>
  );
}
