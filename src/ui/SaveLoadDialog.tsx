import { useEffect, useRef, useState } from 'react';
import { getNumberLocale, t, type MessageKey } from '../i18n/i18n';
import type { Frame } from '../worker/protocol';
import { formatGyr } from './format';
import { Dialog } from './Dialog';
import type { StoredSave } from './saveStore';

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
  saves,
  onSaveSlot,
  onLoadSlot,
  onRenameSlot,
  onDeleteSlot,
}: {
  mode: FileDialogMode;
  frame: Frame | null;
  error: string | null;
  onClose: () => void;
  onSave: (fileName: string) => void;
  onLoad: (file: File) => void;
  saves: readonly StoredSave[];
  onSaveSlot: (name: string, overwriteId?: string) => void;
  onLoadSlot: (save: StoredSave) => void;
  onRenameSlot: (id: string, name: string) => void;
  onDeleteSlot: (id: string) => void;
}) {
  const [fileName, setFileName] = useState(`planet-${Math.round(frame?.year ?? 0)}.geogenesis`);
  const [slotName, setSlotName] = useState(t('saves.defaultName'));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
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
        <>
          {frame && <SavedSummary frame={frame} />}
          <form
            className="slot-create"
            onSubmit={(event) => {
              event.preventDefault();
              if (slotName.trim()) onSaveSlot(slotName.trim());
            }}
          >
            <label title={t('saves.nameHint')}>
              {t('saves.name')}
              <input
                autoFocus
                value={slotName}
                onChange={(event) => setSlotName(event.target.value)}
                title={t('saves.nameHint')}
              />
            </label>
            <button type="submit" className="primary" title={t('saves.saveNewHint')}>
              {t('saves.saveNew')}
            </button>
          </form>
          <SaveList
            saves={saves.filter((save) => save.kind === 'manual')}
            mode={mode}
            renaming={renaming}
            renameValue={renameValue}
            onRenameStart={(save) => {
              setRenaming(save.id);
              setRenameValue(save.name);
            }}
            onRenameValue={setRenameValue}
            onRename={(save) => {
              onRenameSlot(save.id, renameValue);
              setRenaming(null);
            }}
            onOverwrite={(save) => onSaveSlot(save.name, save.id)}
            onDelete={onDeleteSlot}
            onLoad={onLoadSlot}
          />
          <details className="file-transfer">
            <summary title={t('file.exportHint')}>{t('file.export')}</summary>
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
                  value={fileName}
                  onChange={(event) => setFileName(event.target.value)}
                  title={t('file.nameHint')}
                />
              </label>
              <button type="submit" title={t('file.exportHint')}>
                {t('file.export')}
              </button>
            </form>
          </details>
        </>
      ) : (
        <>
          <SaveList
            saves={saves}
            mode={mode}
            renaming={renaming}
            renameValue={renameValue}
            onRenameStart={(save) => {
              setRenaming(save.id);
              setRenameValue(save.name);
            }}
            onRenameValue={setRenameValue}
            onRename={(save) => {
              onRenameSlot(save.id, renameValue);
              setRenaming(null);
            }}
            onOverwrite={(save) => onSaveSlot(save.name, save.id)}
            onDelete={onDeleteSlot}
            onLoad={(save) => {
              onLoadSlot(save);
              onClose();
            }}
          />
          <h3>{t('file.import')}</h3>
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
            title={t('file.dropHint')}
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

function SaveList({
  saves,
  mode,
  renaming,
  renameValue,
  onRenameStart,
  onRenameValue,
  onRename,
  onOverwrite,
  onDelete,
  onLoad,
}: {
  saves: readonly StoredSave[];
  mode: FileDialogMode;
  renaming: string | null;
  renameValue: string;
  onRenameStart: (save: StoredSave) => void;
  onRenameValue: (value: string) => void;
  onRename: (save: StoredSave) => void;
  onOverwrite: (save: StoredSave) => void;
  onDelete: (id: string) => void;
  onLoad: (save: StoredSave) => void;
}) {
  return (
    <section className="save-slots">
      <h3>{t(mode === 'save' ? 'saves.manual' : 'saves.browser')}</h3>
      {saves.length === 0 ? (
        <p className="muted">{t('saves.empty')}</p>
      ) : (
        <ul>
          {saves.map((save) => (
            <li key={save.id}>
              <div className="save-slot-summary">
                {renaming === save.id ? (
                  <input
                    value={renameValue}
                    onChange={(event) => onRenameValue(event.target.value)}
                    title={t('saves.renameHint')}
                    aria-label={t('saves.name')}
                  />
                ) : (
                  <strong>{save.name}</strong>
                )}
                <small>
                  {t(`scenario.${save.scenario}` as MessageKey)} · {formatGyr(save.planetAge)} ·{' '}
                  {save.era ? t(`eraName.${save.era}`) : t('saves.noEra')} ·{' '}
                  {new Date(save.savedAt).toLocaleString(getNumberLocale())}
                </small>
              </div>
              <div className="save-slot-actions">
                {mode === 'load' && (
                  <button type="button" onClick={() => onLoad(save)} title={t('saves.loadHint')}>
                    {t('controls.load')}
                  </button>
                )}
                {mode === 'save' && (
                  <button
                    type="button"
                    onClick={() => onOverwrite(save)}
                    title={t('saves.overwriteHint')}
                  >
                    {t('saves.overwrite')}
                  </button>
                )}
                {save.kind === 'manual' &&
                  (renaming === save.id ? (
                    <button
                      type="button"
                      onClick={() => onRename(save)}
                      title={t('saves.renameHint')}
                    >
                      {t('saves.renameSave')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRenameStart(save)}
                      title={t('saves.renameHint')}
                    >
                      {t('saves.rename')}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t('saves.deleteConfirm', { name: save.name })))
                      onDelete(save.id);
                  }}
                  title={t('saves.deleteHint')}
                >
                  {t('saves.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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
