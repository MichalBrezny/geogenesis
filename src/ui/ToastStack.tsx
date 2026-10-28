import { useEffect } from 'react';
import { t } from '../i18n/i18n';
import { EVENT_IMPORTANCE } from '../sim/eventMetadata';
import { describeEvent } from './CivilizationPanel';
import { EventIcon } from './icons';
import type { EventToast } from './toastQueue';

export function ToastStack({
  toasts,
  onDismiss,
  onCentre,
}: {
  toasts: readonly EventToast[];
  onDismiss: (id: number) => void;
  onCentre: (cell: number) => void;
}) {
  useEffect(() => {
    if (toasts.length === 0) return;
    const delay = Math.max(
      0,
      Math.min(...toasts.map((toast) => toast.expiresAt)) - performance.now(),
    );
    const timer = window.setTimeout(() => {
      const now = performance.now();
      for (const toast of toasts) if (toast.expiresAt <= now) onDismiss(toast.id);
    }, delay + 20);
    return () => window.clearTimeout(timer);
  }, [toasts, onDismiss]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const dismissNewest = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss(toasts[toasts.length - 1]!.id);
    };
    window.addEventListener('keydown', dismissNewest);
    return () => window.removeEventListener('keydown', dismissNewest);
  }, [toasts, onDismiss]);

  return (
    <section className="toast-stack" aria-live="polite" aria-label={t('notifications.title')}>
      {toasts.map((toast) => (
        <article
          key={toast.id}
          className={`event-toast ${EVENT_IMPORTANCE[toast.event.key]}`}
          role={EVENT_IMPORTANCE[toast.event.key] === 'critical' ? 'alert' : 'status'}
        >
          <EventIcon eventKey={toast.event.key} />
          <p>
            {describeEvent(toast.event)}
            {toast.count > 1 && (
              <span className="toast-count">
                {' '}
                {t('notifications.count', { count: toast.count })}
              </span>
            )}
          </p>
          {toast.event.cell !== undefined && (
            <button
              type="button"
              className="toast-map"
              title={t('notifications.showOnMapHint')}
              onClick={() => onCentre(toast.event.cell!)}
            >
              {t('notifications.showOnMap')}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            aria-label={t('notifications.dismiss')}
            title={t('notifications.dismissHint')}
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </article>
      ))}
    </section>
  );
}
