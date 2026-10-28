import { useEffect, useRef } from 'react';
import type { MessageKey } from '../i18n/i18n';

/** Keyboard shortcuts: key (as in KeyboardEvent.key) to action. */
export type Shortcuts = Record<string, () => void>;

/** The single presentation table used by keyboard handling and the Help dialog. */
export const SHORTCUT_DEFINITIONS: readonly { keys: string; label: MessageKey }[] = [
  { keys: 'Space', label: 'help.keyPlay' },
  { keys: 'S', label: 'help.keyStep' },
  { keys: '1–9 / 0', label: 'help.keyLayer' },
  { keys: 'G', label: 'help.keyView' },
  { keys: 'W / C / P / T / N / I / V', label: 'help.keyOverlay' },
  { keys: 'E / A / B / D', label: 'help.keyWindows' },
  { keys: '+ / −', label: 'help.keyZoom' },
  { keys: 'M', label: 'help.keyMinimap' },
  { keys: 'Esc', label: 'help.keyEscape' },
  { keys: '?', label: 'help.keyHelp' },
  { keys: ',', label: 'help.keySettings' },
];

export function shortcutHelpItems() {
  return SHORTCUT_DEFINITIONS.map((item) => ({ ...item }));
}

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
      // A modal dialog owns the keyboard; it handles Esc itself.
      if (document.querySelector('[aria-modal="true"]')) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const action = latest.current[key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
