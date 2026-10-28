import { describe, expect, it } from 'vitest';
import type { StoredSave, SaveStore } from './saveStore';
import { addAutosave, latestAutosave, listSaves, renameSave, saveManualSlot } from './saveStore';

class MemorySaveStore implements SaveStore {
  saves = new Map<string, StoredSave>();
  async getAll() {
    return [...this.saves.values()];
  }
  async put(save: StoredSave) {
    this.saves.set(save.id, save);
    return true;
  }
  async delete(id: string) {
    return this.saves.delete(id);
  }
}

function saved(id: string, savedAt: number): Omit<StoredSave, 'kind'> {
  return {
    id,
    name: id,
    scenario: 'random',
    planetAge: 1e9,
    era: 'geological',
    savedAt,
    bytes: new ArrayBuffer(2),
  };
}

describe('save slot logic', () => {
  it('creates, overwrites, renames and deletes manual slots', async () => {
    const store = new MemorySaveStore();
    expect(await saveManualSlot(store, saved('slot', 1))).toBe(true);
    expect(await saveManualSlot(store, { ...saved('slot', 2), name: 'Earth' })).toBe(true);
    expect(await renameSave(store, 'slot', 'Gaia')).toBe(true);
    expect((await listSaves(store))[0]).toMatchObject({ name: 'Gaia', savedAt: 2 });
    expect(await store.delete('slot')).toBe(true);
    expect(await listSaves(store)).toEqual([]);
  });

  it('keeps only the three newest rolling autosaves', async () => {
    const store = new MemorySaveStore();
    for (let index = 1; index <= 5; index++)
      await addAutosave(store, saved(`auto-${index}`, index));
    expect((await listSaves(store)).map((save) => save.id)).toEqual(['auto-5', 'auto-4', 'auto-3']);
    expect((await latestAutosave(store))?.id).toBe('auto-5');
  });
});
