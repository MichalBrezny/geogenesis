import en from '../i18n/en.json';
import { describe, expect, it } from 'vitest';
import { GLOSSARY_TERMS, glossaryKey, glossaryTermKey, searchGlossary } from './glossary';

describe('glossary search', () => {
  it('matches without case and returns all terms for an empty query', () => {
    expect(searchGlossary('HADLEY')).toEqual(['Hadley cell']);
    expect(searchGlossary('oxid')).toEqual(['Great Oxidation']);
    expect(searchGlossary('')).toHaveLength(GLOSSARY_TERMS.length);
  });

  it('has a definition for every term', () => {
    for (const term of GLOSSARY_TERMS) {
      expect(en).toHaveProperty(glossaryTermKey(term));
      expect(en).toHaveProperty(glossaryKey(term));
    }
  });
});
