import { getActiveLocale, t, type MessageKey } from '../i18n/i18n';

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
  const normalized = normalizeSearchText(query);
  return normalized
    ? GLOSSARY_TERMS.filter((term) =>
        normalizeSearchText(`${term} ${t(glossaryTermKey(term))} ${t(glossaryKey(term))}`).includes(
          normalized,
        ),
      )
    : [...GLOSSARY_TERMS];
}

export function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase(getActiveLocale())
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}
