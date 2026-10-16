import { useEffect, useRef } from 'react';

/** Keyboard shortcuts: key (as in KeyboardEvent.key) to action. */
export type Shortcuts = Record<string, () => void>;

/**
 * Runs the action bound to a pressed key, unless the player is typing in a form
 * field or holding a modifier (so browser shortcuts keep working).
 */
export function useShortcuts(shortcuts: Shortcuts): void {
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
      const action = latest.current[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
