import type { Era } from '../sim/eras';
import type { ScenarioId } from '../sim/scenarios';

export type SaveKind = 'manual' | 'autosave';

export interface SaveMetadata {
  name: string;
  scenario: ScenarioId;
  planetAge: number;
  era: Era | null;
  savedAt: number;
}

export interface StoredSave extends SaveMetadata {
  id: string;
  kind: SaveKind;
  bytes: ArrayBuffer;
}

export interface SaveStore {
  getAll(): Promise<StoredSave[]>;
  put(save: StoredSave): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

const DATABASE_NAME = 'geogenesis';
const STORE_NAME = 'saves';
const DATABASE_VERSION = 1;
export const AUTOSAVE_LIMIT = 3;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function openDatabase(): Promise<IDBDatabase | null> {
  try {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      try {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      } catch {
        // The open request will report an unusable database to its caller.
      }
    };
    return await requestResult(request);
  } catch {
    return null;
  }
}

async function transactionRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const database = await openDatabase();
  if (!database) return undefined;
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const result = await requestResult(run(transaction.objectStore(STORE_NAME)));
    database.close();
    return result;
  } catch {
    try {
      database.close();
    } catch {
      // Closing a failed database is best effort.
    }
    return undefined;
  }
}

export function createBrowserSaveStore(): SaveStore {
  return {
    async getAll() {
      return (await transactionRequest('readonly', (store) => store.getAll())) ?? [];
    },
    async put(save) {
      return (await transactionRequest('readwrite', (store) => store.put(save))) !== undefined;
    },
    async delete(id) {
      const database = await openDatabase();
      if (!database) return false;
      try {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        await requestResult(transaction.objectStore(STORE_NAME).delete(id));
        database.close();
        return true;
      } catch {
        try {
          database.close();
        } catch {
          // Closing a failed database is best effort.
        }
        return false;
      }
    },
  };
}

export async function listSaves(store: SaveStore): Promise<StoredSave[]> {
  return (await store.getAll()).sort((a, b) => b.savedAt - a.savedAt);
}

export async function saveManualSlot(
  store: SaveStore,
  save: Omit<StoredSave, 'kind'>,
): Promise<boolean> {
  return store.put({ ...save, kind: 'manual' });
}

export async function renameSave(store: SaveStore, id: string, name: string): Promise<boolean> {
  const save = (await store.getAll()).find((item) => item.id === id);
  const trimmed = name.trim();
  if (!save || !trimmed) return false;
  return store.put({ ...save, name: trimmed });
}

export async function addAutosave(
  store: SaveStore,
  save: Omit<StoredSave, 'kind'>,
): Promise<boolean> {
  if (!(await store.put({ ...save, kind: 'autosave' }))) return false;
  const autosaves = (await store.getAll())
    .filter((item) => item.kind === 'autosave')
    .sort((a, b) => b.savedAt - a.savedAt);
  const results = await Promise.all(
    autosaves.slice(AUTOSAVE_LIMIT).map((item) => store.delete(item.id)),
  );
  return results.every(Boolean);
}

export async function latestAutosave(store: SaveStore): Promise<StoredSave | null> {
  return (await listSaves(store)).find((save) => save.kind === 'autosave') ?? null;
}
