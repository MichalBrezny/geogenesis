import { describe, expect, it } from 'vitest';
import { MAP_LAYERS } from '../render/mapRenderer';
import cs from './cs.json';
import en from './en.json';
import {
  formatFixed,
  initializeI18n,
  normalizeLanguageChoice,
  resetI18nForTests,
  resolveLocale,
  tp,
} from './i18n';

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

describe('UI strings', () => {
  it('has exactly the same keys and placeholders in every locale', () => {
    expect(Object.keys(cs).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(cs[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('has a name and a hint for every map layer', () => {
    const missing = MAP_LAYERS.flatMap((id) =>
      [`layer.${id}`, `layerHelp.${id}`].filter((key) => !(key in en)),
    );
    expect(missing).toEqual([]);
  });

  it('normalizes language choices and resolves Auto from the browser language', () => {
    expect(normalizeLanguageChoice('broken')).toBe('auto');
    expect(resolveLocale('auto', 'cs-CZ')).toBe('cs');
    expect(resolveLocale('auto', 'en-GB')).toBe('en');
    expect(resolveLocale('en', 'cs-CZ')).toBe('en');
  });

  it('uses Czech plural forms and decimal separators', async () => {
    await initializeI18n('cs');
    expect(tp('time.years', 1)).toBe('1 rok');
    expect(tp('time.years', 3)).toBe('3 roky');
    expect(tp('time.years', 5)).toBe('5 let');
    expect(formatFixed(1.5, 1)).toBe('1,5');
    resetI18nForTests();
  });
});
