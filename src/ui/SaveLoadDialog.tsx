import { useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n/i18n';
import type { Frame } from '../worker/protocol';
import { formatGyr } from './format';
import { Dialog } from './Dialog';

export type FileDialogMode = 'save' | 'load';

function safeFileName(value: string): string {
  const base = value
    .trim()
    .replace(/\.geogenesis$/i, '')
    .replace(/[<>:"/\\|?*]/g, '-');
  return `${base || 'planet'}.geogenesis`;
}

export function SaveLoadDialog({
  mode,
  frame,
  error,
  onClose,
  onSave,
  onLoad,
}: {
  mode: FileDialogMode;
  frame: Frame | null;
  error: string | null;
  onClose: () => void;
  onSave: (fileName: string) => void;
  onLoad: (file: File) => void;
}) {
  const [fileName, setFileName] = useState(`planet-${Math.round(frame?.year ?? 0)}.geogenesis`);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const initialFrame = useRef(frame);
  const loading = useRef(false);
  const load = (file?: File) => {
    if (!file) return;
    loading.current = true;
    onLoad(file);
  };
  useEffect(() => {
    if (loading.current && frame !== initialFrame.current && !error) onClose();
  }, [error, frame, onClose]);
  return (
    <Dialog
      title={t(mode === 'save' ? 'file.saveTitle' : 'file.loadTitle')}
      onClose={onClose}
      className="file-dialog"
    >
      {mode === 'save' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(safeFileName(fileName));
            onClose();
          }}
        >
          <label title={t('file.nameHint')}>
            {t('file.name')}
            <input
              autoFocus
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              title={t('file.nameHint')}
            />
          </label>
          {frame && <SavedSummary frame={frame} />}
          <div className="actions">
            <button type="button" onClick={onClose} title={t('controls.cancel')}>
              {t('controls.cancel')}
            </button>
            <button type="submit" className="primary" title={t('controls.saveHint')}>
              {t('controls.save')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            type="button"
            className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onClick={() => input.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              load(event.dataTransfer.files[0]);
            }}
            title={t('file.dropHint')}
          >
            <strong>{t('file.drop')}</strong>
            <span>{t('file.choose')}</span>
          </button>
          <input
            ref={input}
            type="file"
            accept=".geogenesis,.simearth"
            hidden
            onChange={(event) => {
              load(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {error && (
            <p className="dialog-error" role="alert">
              {friendlyLoadError(error)}
            </p>
          )}
          <p className="muted">{t('file.compatibility')}</p>
        </>
      )}
    </Dialog>
  );
}

function SavedSummary({ frame }: { frame: Frame }) {
  return (
    <section className="saved-summary">
      <h3>{t('file.includes')}</h3>
      <dl>
        <dt>{t('controls.scenario')}</dt>
        <dd>{t(`scenario.${frame.scenario}` as MessageKey)}</dd>
        <dt>{t('file.planetAge')}</dt>
        <dd>{formatGyr(frame.year)}</dd>
        <dt>{t('file.grid')}</dt>
        <dd>
          {frame.grid.width} × {frame.grid.height}
        </dd>
      </dl>
    </section>
  );
}

function friendlyLoadError(error: string): string {
  const version = /Unsupported save version (\d+) \(expected (\d+)\)/.exec(error);
  if (version) return t('file.versionError', { version: version[1]!, expected: version[2]! });
  if (error.includes('Not a Geogenesis save file')) return t('file.formatError');
  if (error.includes('truncated')) return t('file.truncatedError');
  return t('file.loadError', { error: error.replace(/^Error:\s*/, '') });
}
