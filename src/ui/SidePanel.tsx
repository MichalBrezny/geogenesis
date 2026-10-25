import { useState, type ReactNode } from 'react';
import { t, type MessageKey } from '../i18n/i18n';

export interface Tab {
  id: string;
  label: MessageKey;
  content: ReactNode;
}

/** A sidebar with tabs; only the selected tab's content is mounted. */
export function TabbedPanel({ tabs, label }: { tabs: readonly Tab[]; label: MessageKey }) {
  const [selected, setSelected] = useState(tabs[0]?.id);
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
              onClick={() => setSelected(tab.id)}
            >
              {t(tab.label)}
            </button>
          ))}
        </div>
      )}
      <div className="tab-content" role="tabpanel">
        {current?.content}
      </div>
    </section>
  );
}

/** A panel that can be folded away to its title. */
export function Collapsible(props: { title: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="panel" open={props.open ?? true}>
      <summary>{props.title}</summary>
      {props.children}
    </details>
  );
}
