import en from './en.json';

export type MessageKey = keyof typeof en;
export type LanguageChoice = 'auto' | 'en' | 'cs';
export type Locale = 'en' | 'cs';

const LANGUAGE_STORAGE_KEY = 'geogenesis.language';

type Messages = Record<MessageKey, string>;

let messages: Messages = en;
let locale: Locale = 'en';

export function normalizeLanguageChoice(value: unknown): LanguageChoice {
  return value === 'en' || value === 'cs' ? value : 'auto';
}

export function resolveLocale(preference: LanguageChoice, browserLanguage?: string): Locale {
  if (preference !== 'auto') return preference;
  return browserLanguage?.toLocaleLowerCase().startsWith('cs') ? 'cs' : 'en';
}

export function getLanguageChoice(): LanguageChoice {
  try {
    return normalizeLanguageChoice(globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function saveLanguageChoice(choice: LanguageChoice): boolean {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguageChoice(choice));
    return globalThis.localStorage !== undefined;
  } catch {
    return false;
  }
}

function setDocumentLanguage(next: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

/** Loads the selected catalogue before React mounts. Czech is optional; English is always available. */
export async function initializeI18n(
  preference: LanguageChoice,
  browserLanguage = typeof navigator === 'undefined' ? undefined : navigator.language,
): Promise<Locale> {
  const requested = resolveLocale(preference, browserLanguage);
  if (requested === 'cs') {
    try {
      const bundle = (await import('./cs.json')).default as Partial<Messages>;
      messages = { ...en, ...bundle };
      locale = 'cs';
    } catch {
      messages = en;
      locale = 'en';
    }
  } else {
    messages = en;
    locale = 'en';
  }
  setDocumentLanguage(locale);
  return locale;
}

export function getLocale(): Locale {
  return locale;
}

export const getActiveLocale = getLocale;

export function getNumberLocale(): string {
  return locale === 'cs' ? 'cs-CZ' : 'en-US';
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(getNumberLocale(), options);
}

export function formatFixed(value: number, digits: number): string {
  return formatNumber(value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Looks up a UI string and fills `{name}` placeholders. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return (messages[key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export type PluralMessageKey = 'time.years' | 'glossary.results' | 'export.everyFrames';

/** Selects one/few/other forms. English maps `few` to `other`; Czech uses all three. */
export function tp(
  key: PluralMessageKey,
  count: number,
  params: Record<string, string | number> = {},
): string {
  const category = new Intl.PluralRules(getNumberLocale()).select(count);
  const suffix = category === 'one' ? 'one' : category === 'few' ? 'few' : 'other';
  return t(`${key}.${suffix}` as MessageKey, { ...params, count: formatNumber(count) });
}

/** Keeps locale-sensitive tests independent. */
export function resetI18nForTests(): void {
  messages = en;
  locale = 'en';
}
