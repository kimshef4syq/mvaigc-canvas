import { describe, expect, it } from 'vitest';
import { createResilientStorage } from './persistStorage';

function quotaError() {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}

function stubLocalStorage(overrides: Partial<Storage> = {}): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => { items.clear(); },
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => Array.from(items.keys())[index] ?? null,
    removeItem: (key: string) => { items.delete(key); },
    setItem: (key: string, value: string) => { items.set(key, value); },
    ...overrides,
  } as Storage;
}

describe('createResilientStorage', () => {
  it('persists through localStorage when writes succeed', () => {
    const backing = stubLocalStorage();
    const storage = createResilientStorage(() => backing);

    storage.setItem('k', 'v');

    expect(backing.getItem('k')).toBe('v');
    expect(storage.getItem('k')).toBe('v');
  });

  it('does not throw when localStorage is full, and keeps the newest value readable', () => {
    const backing = stubLocalStorage({ setItem: () => { throw quotaError(); } });
    const storage = createResilientStorage(() => backing);

    expect(() => storage.setItem('k', 'v')).not.toThrow();
    expect(storage.getItem('k')).toBe('v');
  });

  it('serves the newest value when overwriting an existing key exceeds quota', () => {
    const backing = stubLocalStorage();
    backing.setItem('k', 'old');
    backing.setItem = () => { throw quotaError(); };
    const storage = createResilientStorage(() => backing);

    storage.setItem('k', 'new');

    expect(backing.getItem('k')).toBe('old');
    expect(storage.getItem('k')).toBe('new');
  });

  it('keeps a removed value hidden when the backing store rejects removal', () => {
    const backing = stubLocalStorage();
    backing.setItem('k', 'old');
    backing.removeItem = () => { throw quotaError(); };
    const storage = createResilientStorage(() => backing);

    storage.removeItem('k');

    expect(storage.getItem('k')).toBeNull();
    storage.setItem('k', 'replacement');
    expect(storage.getItem('k')).toBe('replacement');
  });

  it('reads existing values from localStorage on a fresh session', () => {
    const backing = stubLocalStorage();
    backing.setItem('existing', 'from-disk');

    const storage = createResilientStorage(() => backing);

    expect(storage.getItem('existing')).toBe('from-disk');
  });

  it('does not throw when removeItem fails', () => {
    const backing = stubLocalStorage({ removeItem: () => { throw quotaError(); } });
    const storage = createResilientStorage(() => backing);

    expect(() => storage.removeItem('k')).not.toThrow();
  });

  it('falls back to an in-memory store when localStorage is unavailable', () => {
    const storage = createResilientStorage(() => null);

    expect(() => storage.setItem('k', 'v')).not.toThrow();
    expect(storage.getItem('k')).toBe('v');
  });
});
