import { createJSONStorage, type StateStorage } from 'zustand/middleware';

/**
 * WebKit caps localStorage at 5 MiB per origin and counts values as UTF-16, so
 * a store that grows without bound eventually fills it. zustand's persist calls
 * `storage.setItem` synchronously from `setState`, so a quota error thrown there
 * escapes into whatever React render triggered the update and takes down the
 * whole app with it.
 *
 * Wrapping the backing store keeps that failure local: writes that cannot be
 * persisted are held in memory for the rest of the session instead of throwing,
 * which matches how AgentSessionRepository already degrades.
 */
export function createResilientStorage(
  getBacking: () => Storage | null,
): StateStorage {
  const memory = new Map<string, string | null>();

  const readBacking = (key: string): string | null => {
    try {
      return getBacking()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };

  return {
    getItem: (key) => {
      if (memory.has(key)) return memory.get(key) ?? null;
      const persisted = readBacking(key);
      if (persisted !== null) return persisted;
      return memory.get(key) ?? null;
    },
    setItem: (key, value) => {
      memory.set(key, value);
      try {
        getBacking()?.setItem(key, value);
      } catch {
        // Quota exhausted or storage disabled: keep serving the in-memory copy.
      }
    },
    removeItem: (key) => {
      // A tombstone prevents a failed removal from exposing the old disk value.
      memory.set(key, null);
      try {
        getBacking()?.removeItem(key);
      } catch {
        // Ignore: the in-memory copy is already gone.
      }
    },
  };
}

export const resilientLocalStateStorage = createResilientStorage(() => (
  typeof window !== 'undefined' ? window.localStorage : null
));

/** Ready-to-use `storage` option for zustand's persist, backed by localStorage. */
export const resilientLocalStorage = createJSONStorage(() => resilientLocalStateStorage);
