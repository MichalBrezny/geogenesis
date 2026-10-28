import { describe, expect, it } from 'vitest';
import { dialogKeyboardAction, trappedFocusIndex } from './Dialog';

describe('dialog focus trap', () => {
  it('wraps forwards and backwards', () => {
    expect(trappedFocusIndex(2, 3, false)).toBe(0);
    expect(trappedFocusIndex(0, 3, true)).toBe(2);
    expect(trappedFocusIndex(1, 3, false)).toBe(2);
  });

  it('selects an edge when focus begins outside the dialog', () => {
    expect(trappedFocusIndex(-1, 3, false)).toBe(0);
    expect(trappedFocusIndex(-1, 3, true)).toBe(2);
    expect(trappedFocusIndex(-1, 0, false)).toBe(-1);
  });

  it('maps Escape to close and Tab to focus trapping', () => {
    expect(dialogKeyboardAction('Escape')).toBe('close');
    expect(dialogKeyboardAction('Tab')).toBe('trap');
    expect(dialogKeyboardAction('Enter')).toBeNull();
  });
});
