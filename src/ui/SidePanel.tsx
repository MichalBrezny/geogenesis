import { useState, type ReactNode } from 'react';
import { t, type MessageKey } from '../i18n/i18n';
import type { GuidePageId } from './guide';
import { ContextHelpButton } from './ContextHelpButton';

export interface Tab {
  id: string;
  label: MessageKey;
  content: ReactNode;
}

/** A sidebar with tabs; only the selected tab's content is mounted. */
export function TabbedPanel({
  tabs,
  label,
  selectedId,
  onSelect,
  onHelp,
}: {
  tabs: readonly Tab[];
  label: MessageKey;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onHelp?: (page: GuidePageId) => void;
}) {
  const [internalSelected, setInternalSelected] = useState(tabs[0]?.id);
  const selected = selectedId ?? internalSelected;
  const current = tabs.find((tab) => tab.id === selected) ?? tabs[0];
  return (
    <section className="tabbed" aria-label={t(label)}>
      {tabs.length > 1 && (
        <div className="tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={tab === current}
              className={tab === current ? 'selected' : undefined}
              title={t(tab.label)}
              onClick={() => {
                setInternalSelected(tab.id);
                onSelect?.(tab.id);
              }}
            >
              {t(tab.label)}
            </button>
          ))}
        </div>
      )}
      <div className="tab-content" role="tabpanel">
        {current && (
          <div className="panel-context-help">
            <ContextHelpButton
              page={
                current.id === 'goal'
                  ? 'goals'
                  : current.id === 'civilization'
                    ? 'civilization'
                    : current.id === 'life'
                      ? 'life'
                      : 'climate'
              }
              onHelp={onHelp}
            />
          </div>
        )}
        {current?.content}
      </div>
    </section>
  );
}

/** A panel that can be folded away to its title. */
export function Collapsible(props: {
  title: ReactNode;
  children: ReactNode;
  open?: boolean;
  helpPage?: GuidePageId;
  onHelp?: (page: GuidePageId) => void;
  tourAnchor?: string;
}) {
  return (
    <details className="panel" open={props.open ?? true} data-tour={props.tourAnchor}>
      <summary>
        <span>{props.title}</span>
        {props.helpPage && <ContextHelpButton page={props.helpPage} onHelp={props.onHelp} />}
      </summary>
      {props.children}
    </details>
  );
}
