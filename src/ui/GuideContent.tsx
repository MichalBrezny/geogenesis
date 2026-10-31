import { useEffect, useMemo, useRef, useState } from 'react';
import { t, tp, type MessageKey } from '../i18n/i18n';
import type { MapLayer } from '../render/mapRenderer';
import { chartMessageKey, type ChartSeries } from './charts/HistoryCharts';
import { glossaryKey, glossaryTermKey, searchGlossary, type GlossaryTerm } from './glossary';
import { GUIDE_PAGES, guideKey, type GuidePageId } from './guide';

export type HelpSection = 'overview' | 'models' | 'glossary';

export function HelpNav(props: { section: HelpSection; onChange: (section: HelpSection) => void }) {
  return (
    <nav className="help-nav" aria-label={t('help.sections')}>
      {(['overview', 'models', 'glossary'] as const).map((section) => (
        <button
          key={section}
          type="button"
          className={props.section === section ? 'selected' : undefined}
          aria-pressed={props.section === section}
          title={t(`help.section.${section}Hint` as MessageKey)}
          onClick={() => props.onChange(section)}
        >
          {t(`help.section.${section}` as MessageKey)}
        </button>
      ))}
    </nav>
  );
}

export function ModelGuide(props: {
  initialPage?: GuidePageId;
  availableLayers: readonly MapLayer[];
  availableCharts: readonly ChartSeries[];
  onLayer: (layer: MapLayer) => void;
  onChart: (chart: ChartSeries) => void;
  onTerm: (term: GlossaryTerm) => void;
}) {
  const [pageId, setPageId] = useState<GuidePageId>(props.initialPage ?? 'geosphere');
  const page = GUIDE_PAGES.find((candidate) => candidate.id === pageId)!;
  return (
    <div className="model-guide">
      <nav className="guide-page-list" aria-label={t('guide.pages')}>
        {GUIDE_PAGES.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={candidate.id === page.id ? 'selected' : undefined}
            aria-current={candidate.id === page.id ? 'page' : undefined}
            title={t(guideKey(candidate.id, 'summary'))}
            onClick={() => setPageId(candidate.id)}
          >
            {t(guideKey(candidate.id, 'title'))}
          </button>
        ))}
      </nav>
      <article className="guide-page">
        <h3>{t(guideKey(page.id, 'title'))}</h3>
        <p>{t(guideKey(page.id, 'summary'))}</p>
        <div className="feedback-loop" aria-label={t('guide.feedbackLoop')}>
          {t(guideKey(page.id, 'loop'))}
        </div>
        <h4>{t('guide.controls')}</h4>
        <p>{t(guideKey(page.id, 'controls'))}</p>
        <h4>{t('guide.seeIt')}</h4>
        <p>{t(guideKey(page.id, 'views'))}</p>
        <div className="guide-links">
          {page.layers.map((layer) => {
            const available = props.availableLayers.includes(layer);
            return (
              <button
                key={layer}
                type="button"
                disabled={!available}
                title={available ? t(`layerHelp.${layer}` as MessageKey) : t('guide.notAvailable')}
                onClick={() => props.onLayer(layer)}
              >
                {t(`layer.${layer}` as MessageKey)}
              </button>
            );
          })}
          {page.charts.map((chart) => {
            const available = props.availableCharts.includes(chart);
            return (
              <button
                key={chart}
                type="button"
                disabled={!available}
                title={available ? t(chartMessageKey(chart, 'hint')) : t('guide.notAvailable')}
                onClick={() => props.onChart(chart)}
              >
                {t(chartMessageKey(chart, 'title'))}
              </button>
            );
          })}
        </div>
        <h4>{t('guide.terms')}</h4>
        <div className="guide-terms">
          {page.terms.map((term) => (
            <button
              key={term}
              type="button"
              title={t('guide.openGlossary', { term: t(glossaryTermKey(term as GlossaryTerm)) })}
              onClick={() => props.onTerm(term as GlossaryTerm)}
            >
              {t(glossaryTermKey(term as GlossaryTerm))}
            </button>
          ))}
        </div>
      </article>
    </div>
  );
}

export function Glossary({ initialTerm }: { initialTerm?: GlossaryTerm }) {
  const [query, setQuery] = useState(initialTerm ?? '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (initialTerm) input.current?.focus();
  }, [initialTerm]);
  const terms = useMemo(() => searchGlossary(query), [query]);
  return (
    <section className="glossary">
      <label htmlFor="glossary-search">{t('glossary.search')}</label>
      <input
        ref={input}
        id="glossary-search"
        type="search"
        value={query}
        placeholder={t('glossary.searchPlaceholder')}
        title={t('glossary.searchHint')}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="muted" aria-live="polite">
        {tp('glossary.results', terms.length)}
      </p>
      <dl>
        {terms.map((term) => (
          <div key={term}>
            <dt>{t(glossaryTermKey(term))}</dt>
            <dd>{t(glossaryKey(term))}</dd>
          </div>
        ))}
      </dl>
      {terms.length === 0 && <p>{t('glossary.empty')}</p>}
    </section>
  );
}
