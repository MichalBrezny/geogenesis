import en from '../i18n/en.json';
import { initializeI18n, resetI18nForTests } from '../i18n/i18n';
import { describe, expect, it } from 'vitest';
import {
  GLOSSARY_TERMS,
  glossaryKey,
  glossaryTermKey,
  normalizeSearchText,
  searchGlossary,
} from './glossary';

describe('glossary search', () => {
  it('matches without case and returns all terms for an empty query', () => {
    expect(searchGlossary('HADLEY')).toEqual(['Hadley cell']);
    expect(searchGlossary('oxid')).toEqual(['Great Oxidation']);
    expect(searchGlossary('')).toHaveLength(GLOSSARY_TERMS.length);
    expect(normalizeSearchText('ZVĚTRÁVÁNÍ')).toBe('zvetravani');
  });

  it('has a definition for every term', () => {
    for (const term of GLOSSARY_TERMS) {
      expect(en).toHaveProperty(glossaryTermKey(term));
      expect(en).toHaveProperty(glossaryKey(term));
    }
  });

  it('finds Czech terms without diacritics', async () => {
    await initializeI18n('cs');
    expect(searchGlossary('zvetravani')).toEqual(['weathering']);
    resetI18nForTests();
  });
});
