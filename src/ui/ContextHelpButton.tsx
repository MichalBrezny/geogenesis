import { t, type MessageKey } from '../i18n/i18n';
import type { GuidePageId } from './guide';

export function ContextHelpButton({
  page,
  onHelp,
}: {
  page: GuidePageId;
  onHelp?: (page: GuidePageId) => void;
}) {
  if (!onHelp) return null;
  return (
    <button
      type="button"
      className="context-help"
      title={t('guide.contextHint')}
      aria-label={t('guide.context', { page: t(`guide.${page}.title` as MessageKey) })}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onHelp(page);
      }}
    >
      ?
    </button>
  );
}
