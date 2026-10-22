import { IDBFactory, IDBIndex, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { IndexedDbAgentSessionRepository } from './indexedDbAgentSessionRepository';
import { SESSION_STORAGE_KEY, type AgentSessionRecord, type StorageLike } from './agentSessionRepository';

function session(id: string, projectId = 'project-1'): AgentSessionRecord {
  return {
    id, projectId, title: `Conversation ${id}`, modelRef: 'custom:p:m',
    createdAt: 1, updatedAt: 2, appliedTransactions: {},
    items: [{ role: 'user', content: `History for ${id}` }],
  };
}

function legacyStorage(records: AgentSessionRecord[]): StorageLike {
  const values = new Map([[SESSION_STORAGE_KEY, JSON.stringify({ version: 1, sessions: records })]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const visible = (items: readonly unknown[]) => items.length > 0;

function repository(factory = new IDBFactory(), storage: StorageLike | null = null) {
  return new IndexedDbAgentSessionRepository(factory, visible, storage, 'test-agent');
}

describe('IndexedDbAgentSessionRepository', () => {
  it('migrates history durably, lists metadata only, and loads just the selected session', async () => {
    const storage = legacyStorage([session('one'), session('two'), session('other', 'project-2')]);
    const factory = new IDBFactory();
    const first = repository(factory, storage);
    await first.prepare();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(first.getSession('one')).toBeNull();

    const getAll = vi.spyOn(IDBIndex.prototype, 'getAll');
    const summaries = await first.listSessionSummaries('project-1');
    expect(summaries.map((item) => item.id)).toEqual(['one', 'two']);
    expect(summaries[0]).not.toHaveProperty('items');
    expect(getAll.mock.contexts.map((index) => (index as IDBIndex).objectStore.name)).toEqual(['summaries']);
    getAll.mockRestore();
    expect(first.getSession('two')).toBeNull();

    await first.loadSession('one');
    expect(first.getSession('one')?.items[0]).toMatchObject({ content: 'History for one' });
    expect(first.getSession('two')).toBeNull();

    const reopened = repository(factory, storage);
    await reopened.prepare();
    expect(reopened.getSession('one')).toBeNull();
    await reopened.loadSession('two');
    expect(reopened.getSession('two')?.items).toHaveLength(1);
  });

  it('does not remove the source if the migration transaction aborts', async () => {
    const storage = legacyStorage([session('one')]);
    const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore) {
      this.transaction.abort();
      return {} as IDBRequest;
    });
    const repo = repository(new IDBFactory(), storage);
    try {
      await expect(repo.prepare()).rejects.toBeDefined();
      expect(storage.getItem(SESSION_STORAGE_KEY)).toContain('History for one');
    } finally {
      write.mockRestore();
    }
    // A retry after storage recovers imports the intact source.
    await repo.prepare();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(await repo.listSessionSummaries('project-1')).toHaveLength(1);
  });

  it('preserves malformed legacy history rather than deleting it as empty', async () => {
    const storage = legacyStorage([]);
    storage.setItem(SESSION_STORAGE_KEY, '{invalid JSON');
    await expect(repository(new IDBFactory(), storage).prepare()).rejects.toBeDefined();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe('{invalid JSON');
  });

  it('does not resurrect deleted history when legacy cleanup previously failed', async () => {
    const storage = legacyStorage([session('one')]);
    storage.removeItem = () => { throw new Error('Storage disabled'); };
    const factory = new IDBFactory();
    const first = repository(factory, storage);
    await first.loadSession('one');
    first.deleteSession('one');
    await first.flush();
    const reopened = repository(factory, storage);
    expect(await reopened.listSessionSummaries('project-1')).toEqual([]);
  });

  it('saves new conversations without rewriting or loading older bodies', async () => {
    const storage = legacyStorage([session('one'), session('two')]);
    const factory = new IDBFactory();
    const repo = repository(factory, storage);
    await repo.prepare();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const created = repo.createSession({ projectId: 'project-1', modelRef: 'custom:p:m' });
    await repo.createSdkSession(created.id).addItems([{ role: 'user', content: 'New conversation' }]);
    expect(put.mock.calls.every(([record]) => record.id === created.id)).toBe(true);
    put.mockRestore();
    expect(repo.getSession('one')).toBeNull();
    await repo.releaseSessions();
    expect(repo.getSession(created.id)).toBeNull();
    const reopened = repository(factory, storage);
    await reopened.loadSession(created.id);
    expect(reopened.getSession(created.id)?.items).toHaveLength(1);
    await reopened.loadSession('one');
    expect(reopened.getSession('one')?.items[0]).toMatchObject({ content: 'History for one' });
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('reports failed message writes and keeps them available for a durable retry', async () => {
    const factory = new IDBFactory();
    const repo = repository(factory);
    await repo.prepare();
    const created = repo.createSession({ projectId: 'project-1', modelRef: 'custom:p:m' });
    await repo.flush();
    const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore) {
      this.transaction.abort();
      throw new Error('Disk unavailable');
    });
    try {
      await expect(repo.createSdkSession(created.id).addItems([
        { role: 'user', content: 'Keep this message' },
      ])).rejects.toThrow('Disk unavailable');
      expect(repo.getSession(created.id)?.items).toHaveLength(1);
    } finally {
      write.mockRestore();
    }
    await repo.flush();
    const reopened = repository(factory);
    await reopened.loadSession(created.id);
    expect(reopened.getSession(created.id)?.items[0]).toMatchObject({ content: 'Keep this message' });
  });

  it('preserves legacy records changed after an earlier migration', async () => {
    const factory = new IDBFactory();
    const storage = legacyStorage([session('one')]);
    const repo = repository(factory, storage);
    await repo.prepare();
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: 1, sessions: [session('new-legacy')] }));
    await expect(repository(factory, storage).prepare()).rejects.toThrow('迁移后发生变化');
    expect(storage.getItem(SESSION_STORAGE_KEY)).toContain('new-legacy');
    await repo.loadSession('one');
    expect(repo.getSession('one')).not.toBeNull();
  });

  it('retains in-flight sessions while releasing inactive message bodies', async () => {
    const repo = repository(new IDBFactory(), legacyStorage([session('one'), session('two')]));
    await repo.loadSession('one');
    await repo.loadSession('two');
    const release = repo.retainSession('one');
    await repo.releaseSessions();
    expect(repo.getSession('one')).not.toBeNull();
    expect(repo.getSession('two')).toBeNull();
    release();
    await repo.releaseSessions();
    expect(repo.getSession('one')).toBeNull();
  });
});
