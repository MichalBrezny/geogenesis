import type { MessageKey } from '../i18n/i18n';

export const GLOSSARY_TERMS = [
  'abiogenesis',
  'aerosol',
  'albedo',
  'anoxia',
  'biome',
  'biosignature',
  'clathrate',
  'Exodus',
  'GEL',
  'Great Oxidation',
  'Hadley cell',
  'hazard',
  'hold time',
  'ITCZ',
  'large igneous province',
  'mass extinction',
  'objective',
  'outgassing',
  'partial pressure',
  'plate tectonics',
  'pollution',
  'runaway greenhouse',
  'score',
  'sentience',
  'upwelling',
  'water vapour',
  'weathering',
  'Ω energy',
] as const;

export type GlossaryTerm = (typeof GLOSSARY_TERMS)[number];

export function glossaryKey(term: GlossaryTerm): MessageKey {
  return `glossary.${term}.definition` as MessageKey;
}

export function glossaryTermKey(term: GlossaryTerm): MessageKey {
  return `glossary.${term}.term` as MessageKey;
}

export function searchGlossary(query: string): GlossaryTerm[] {
  const normalized = query.trim().toLocaleLowerCase('en');
  return normalized
    ? GLOSSARY_TERMS.filter((term) => term.toLocaleLowerCase('en').includes(normalized))
    : [...GLOSSARY_TERMS];
}
