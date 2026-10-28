import { describe, expect, it } from 'vitest';
import { SHORTCUT_DEFINITIONS, shortcutHelpItems } from './shortcuts';

describe('shortcut help', () => {
  it('is generated from the shared shortcut table', () => {
    expect(shortcutHelpItems()).toEqual(SHORTCUT_DEFINITIONS);
    expect(shortcutHelpItems().map((item) => item.keys)).toContain('Space');
    expect(shortcutHelpItems().map((item) => item.keys)).toContain('Arrow keys');
    expect(new Set(shortcutHelpItems().map((item) => item.keys)).size).toBe(
      shortcutHelpItems().length,
    );
  });
});
