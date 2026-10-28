import { useEffect, useId, useRef, type ReactNode } from 'react';
import { t } from '../i18n/i18n';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Returns the next focus target inside a dialog, wrapping at both ends. */
export function trappedFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? count - 1 : 1)) % count;
}

export function dialogKeyboardAction(key: string): 'close' | 'trap' | null {
  return key === 'Escape' ? 'close' : key === 'Tab' ? 'trap' : null;
}

export function Dialog({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    const focusables = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables?.[0] ?? panel.current)?.focus();
    return () => returnFocus.current?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const action = dialogKeyboardAction(event.key);
    if (action === 'close') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (action !== 'trap') return;
    const focusables = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (focusables.length === 0) {
      event.preventDefault();
      panel.current?.focus();
      return;
    }
    const current = focusables.indexOf(document.activeElement as HTMLElement);
    const next = trappedFocusIndex(current, focusables.length, event.shiftKey);
    if (
      current < 0 ||
      (event.shiftKey && current === 0) ||
      (!event.shiftKey && current === focusables.length - 1)
    ) {
      event.preventDefault();
      focusables[next]?.focus();
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={panel}
        className={`dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            title={t('dialog.closeHint')}
            aria-label={t('dialog.close')}
          >
            ×
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </section>
    </div>
  );
}
