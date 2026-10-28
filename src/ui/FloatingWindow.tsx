import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { t } from '../i18n/i18n';
import type { GuidePageId } from './guide';
import { ContextHelpButton } from './ContextHelpButton';

interface Position {
  x: number;
  y: number;
}

let nextZIndex = 40;

function loadPosition(storageKey: string, fallback: Position): Position {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return fallback;
    const value = JSON.parse(stored) as Partial<Position>;
    return Number.isFinite(value.x) && Number.isFinite(value.y)
      ? { x: value.x!, y: value.y! }
      : fallback;
  } catch {
    return fallback;
  }
}

/** A draggable, persistent, non-modal window over the simulation stage. */
export function FloatingWindow(props: {
  id: string;
  title: string;
  cascadeIndex: number;
  stageRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onActivate: () => void;
  children: ReactNode;
  footer?: ReactNode;
  helpPage?: GuidePageId;
  onHelp?: (page: GuidePageId) => void;
}) {
  const windowRef = useRef<HTMLElement>(null);
  const positionKey = `geogenesis.floatingWindow.${props.id}.position`;
  const [position, setPosition] = useState(() =>
    loadPosition(positionKey, {
      x: 310 + props.cascadeIndex * 28,
      y: 92 + props.cascadeIndex * 28,
    }),
  );
  const [zIndex, setZIndex] = useState(() => ++nextZIndex);
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);

  const activate = () => {
    setZIndex(++nextZIndex);
    props.onActivate();
  };

  const clamp = useCallback((candidate: Position): Position => {
    const element = windowRef.current;
    const width = element?.offsetWidth ?? 360;
    const height = element?.offsetHeight ?? 280;
    return {
      x: Math.min(Math.max(0, candidate.x), Math.max(0, window.innerWidth - width)),
      y: Math.min(Math.max(0, candidate.y), Math.max(0, window.innerHeight - height)),
    };
  }, []);

  const centre = () => {
    const element = windowRef.current;
    const stage = props.stageRef.current?.getBoundingClientRect();
    const area = stage ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const width = element?.offsetWidth ?? 360;
    const height = element?.offsetHeight ?? 280;
    setPosition(
      clamp({
        x: area.left + (area.width - width) / 2,
        y: area.top + (area.height - height) / 2,
      }),
    );
    activate();
  };

  useEffect(() => {
    windowRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(positionKey, JSON.stringify(position));
    } catch {
      // Storage can be unavailable in private or embedded browsing contexts.
    }
  }, [position, positionKey]);

  useEffect(() => {
    const keepInsideViewport = () => setPosition((current) => clamp(current));
    window.addEventListener('resize', keepInsideViewport);
    const observer = new ResizeObserver(keepInsideViewport);
    if (windowRef.current) observer.observe(windowRef.current);
    keepInsideViewport();
    return () => {
      window.removeEventListener('resize', keepInsideViewport);
      observer.disconnect();
    };
  }, [clamp]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (window.matchMedia('(max-width: 699px)').matches) return;
    if ((event.target as HTMLElement).closest('button')) return;
    activate();
    drag.current = {
      pointerId: event.pointerId,
      dx: event.clientX - position.x,
      dy: event.clientY - position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    setPosition(clamp({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy }));
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const titleId = `floating-window-${props.id}-title`;
  return (
    <section
      ref={windowRef}
      className="floating-window"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{ left: position.x, top: position.y, zIndex }}
      onPointerDownCapture={activate}
      onFocusCapture={props.onActivate}
    >
      <header
        className="floating-window-titlebar"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={centre}
      >
        <h2 id={titleId}>{props.title}</h2>
        <div className="floating-window-actions">
          {props.helpPage && <ContextHelpButton page={props.helpPage} onHelp={props.onHelp} />}
          <button type="button" title={t('window.centreHint')} onClick={centre}>
            <span aria-hidden="true">⊙</span>
            <span className="visually-hidden">{t('window.centre')}</span>
          </button>
          <button type="button" title={t('window.closeHint')} onClick={props.onClose}>
            <span aria-hidden="true">&times;</span>
            <span className="visually-hidden">{t('window.close')}</span>
          </button>
        </div>
      </header>
      <div className="floating-window-content">{props.children}</div>
      {props.footer && <footer className="floating-window-footer">{props.footer}</footer>}
    </section>
  );
}
