import en from './en.json';

export type MessageKey = keyof typeof en;

const messages: Record<MessageKey, string> = en;

/**
 * Looks up a UI string and fills `{name}` placeholders.
 * All user-visible text goes through this so translations can be added
 * as further JSON files next to en.json.
 */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  // A missing string shows its key instead of crashing the whole UI.
  return (messages[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
