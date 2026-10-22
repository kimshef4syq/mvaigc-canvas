import type { AgentInputItem } from '@openai/agents';
import {
  AgentSessionRepository,
  SESSION_STORAGE_KEY,
  assertPersistenceSafe,
  isAgentSessionRecord,
  serializeBounded,
  type AgentSessionRecord,
  type AgentSessionSummary,
  type SessionEnvelope,
  type StorageLike,
} from './agentSessionRepository';

const DATABASE_NAME = 'storyboard-copilot:canvas-agent';
const MIGRATION_KEY = 'localStorage-sessions-v1';

/** Read the previous app-version IndexedDB archive before moving desktop data to SQLite. */
export async function readIndexedDbAgentSessions(): Promise<AgentSessionRecord[]> {
  const registry = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
  if (registry.databases) {
    try {
      const databases = await registry.databases();
      if (!databases.some((database) => database.name === DATABASE_NAME)) return [];
    } catch { /* Fall back to an ordinary open when enumeration is unavailable. */ }
  }
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains('sessions')) database.createObjectStore('sessions', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('summaries')) {
      const summaries = database.createObjectStore('summaries', { keyPath: 'id' });
      summaries.createIndex('projectId', 'projectId');
    }
    if (!database.objectStoreNames.contains('migrations')) database.createObjectStore('migrations');
  };
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开旧版聊天记录数据库。'));
    request.onblocked = () => reject(new Error('旧版聊天记录仍在另一个窗口中使用，请关闭后重试迁移。'));
  });
  try {
    if (!database.objectStoreNames.contains('sessions')) return [];
    const transaction = database.transaction('sessions', 'readonly');
    const records = await requestResult<AgentSessionRecord[]>(transaction.objectStore('sessions').getAll());
    if (!records.every(isAgentSessionRecord)) throw new Error('旧版 IndexedDB 聊天记录格式无效，已保留原数据。');
    return records;
  } finally {
    database.close();
  }
}

export async function clearIndexedDbAgentSessions(): Promise<void> {
  const request = indexedDB.open(DATABASE_NAME, 1);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法清理已迁移的旧版聊天记录。'));
    request.onblocked = () => reject(new Error('旧版聊天记录仍在另一个窗口中使用，请稍后重试清理。'));
  });
  try {
    const names = ['sessions', 'summaries', 'migrations'].filter((name) => database.objectStoreNames.contains(name));
    if (!names.length) return;
    const transaction = database.transaction(names, 'readwrite');
    for (const name of names) transaction.objectStore(name).clear();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('清理旧版聊天记录失败。'));
    });
  } finally {
    database.close();
  }
}

type StoredSummary = AgentSessionSummary & { hasVisibleItems: boolean };

function localStorageOrNull(): StorageLike | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to read Agent history.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Unable to save Agent history.'));
    transaction.onerror = () => { /* onabort reports the final failure. */ };
  });
}

/**
 * Only explicitly opened sessions are cached. The history list reads a separate
 * metadata store, so it never fetches message bodies. The synchronous SDK-facing
 * methods stage changes; flush() is awaited at every async execution boundary.
 */
export class IndexedDbAgentSessionRepository extends AgentSessionRepository {
  private database?: IDBDatabase;
  private preparation?: Promise<void>;
  private sessions = new Map<string, AgentSessionRecord>();
  private serialized = new Map<string, string>();
  private dirty = new Map<string, AgentSessionRecord | null>();
  private retained = new Map<string, number>();
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly factory: IDBFactory,
    private readonly isVisible: (items: readonly AgentInputItem[]) => boolean,
    private readonly legacyStorage: StorageLike | null = localStorageOrNull(),
    private readonly databaseName = DATABASE_NAME,
  ) {
    // Run checkpoints retain their existing expiry/approval recovery behavior.
    super(legacyStorage && {
      getItem: (key) => key === SESSION_STORAGE_KEY ? null : legacyStorage.getItem(key),
      setItem: (key, value) => legacyStorage.setItem(key, value),
      removeItem: (key) => legacyStorage.removeItem(key),
    });
  }

  override async prepare(): Promise<void> {
    if (!this.preparation) {
      this.preparation = this.openAndMigrate().catch((error) => {
        this.database?.close();
        this.database = undefined;
        this.preparation = undefined;
        throw error;
      });
    }
    await this.preparation;
  }

  private async openAndMigrate(): Promise<void> {
    const request = this.factory.open(this.databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('sessions', { keyPath: 'id' });
      const summaries = database.createObjectStore('summaries', { keyPath: 'id' });
      summaries.createIndex('projectId', 'projectId');
      database.createObjectStore('migrations');
    };
    this.database = await new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to open Agent history.'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Agent history is open in another application window. Please close it and retry.'));
      };
    });
    const database = this.database;
    database.onversionchange = () => {
      database.close();
      this.database = undefined;
      this.preparation = undefined;
    };
    const raw = this.legacyStorage?.getItem(SESSION_STORAGE_KEY);
    if (!raw) return;
    // Strict validation: a bad legacy payload must never be mistaken for an
    // empty history and deleted. Preserve it until it can be recovered.
    const legacy = JSON.parse(raw) as Partial<SessionEnvelope>;
    if (legacy.version !== 1 || !Array.isArray(legacy.sessions)
      || !legacy.sessions.every(isAgentSessionRecord)) {
      throw new Error('旧聊天记录格式无效，已保留原数据，无法自动迁移。');
    }
    assertPersistenceSafe(legacy);
    const sourceDigest = Array.from(new Uint8Array(await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(raw),
    )), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const transaction = database.transaction(['sessions', 'summaries', 'migrations'], 'readwrite');
    const done = transactionDone(transaction);
    let migrationError: unknown;
    const abort = (error: unknown) => {
      migrationError = error;
      try { transaction.abort(); } catch { /* Already aborted. */ }
    };
    // Queue dependent writes inside IDB events, rather than awaiting mid-
    // transaction: WebKit can otherwise make the transaction inactive early.
    const marker = transaction.objectStore('migrations').get(MIGRATION_KEY);
    marker.onsuccess = () => {
      try {
        if (marker.result && marker.result !== sourceDigest) {
          throw new Error('旧聊天记录在迁移后发生变化，已保留原数据，请先恢复这些记录。');
        }
        if (marker.result) return;
        for (const session of legacy.sessions!) {
          // A previous successful write wins over a stale legacy copy.
          const lookup = transaction.objectStore('sessions').getKey(session.id);
          lookup.onsuccess = () => {
            try {
              if (lookup.result !== undefined) return;
              transaction.objectStore('sessions').put(session);
              transaction.objectStore('summaries').put(this.summary(session));
            } catch (error) { abort(error); }
          };
        }
        transaction.objectStore('migrations').put(sourceDigest, MIGRATION_KEY);
      } catch (error) { abort(error); }
    };
    try { await done; } catch (error) { throw migrationError ?? error; }
    // Commit is the durability boundary. Never remove the source before it.
    // A blocked remove leaves a duplicate that the marker prevents reimporting.
    try {
      if (this.legacyStorage?.getItem(SESSION_STORAGE_KEY) === raw) {
        this.legacyStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch { /* The database is committed; cleanup can retry next time. */ }
  }

  private summary(session: AgentSessionRecord): StoredSummary {
    const { id, projectId, title, modelRef, createdAt, updatedAt } = session;
    return { id, projectId, title, modelRef, createdAt, updatedAt, hasVisibleItems: this.isVisible(session.items) };
  }

  override async listSessionSummaries(projectId: string): Promise<AgentSessionSummary[]> {
    await this.prepare();
    await this.flush();
    const transaction = this.database!.transaction('summaries', 'readonly');
    const records = await requestResult<StoredSummary[]>(
      transaction.objectStore('summaries').index('projectId').getAll(projectId),
    );
    return records.filter((record) => record.hasVisibleItems)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(({ hasVisibleItems: _visible, ...summary }) => summary);
  }

  override async loadSession(sessionId: string): Promise<void> {
    await this.prepare();
    await this.flush();
    if (this.sessions.has(sessionId)) return;
    const transaction = this.database!.transaction('sessions', 'readonly');
    const record = await requestResult<AgentSessionRecord | undefined>(transaction.objectStore('sessions').get(sessionId));
    if (!record) return;
    if (!isAgentSessionRecord(record)) throw new Error('聊天记录格式无效。');
    assertPersistenceSafe(record);
    this.sessions.set(record.id, record);
    this.serialized.set(record.id, serializeBounded(record));
  }

  override async releaseSessions(): Promise<void> {
    await this.flush();
    for (const id of this.sessions.keys()) {
      if (this.retained.has(id)) continue;
      this.sessions.delete(id);
      this.serialized.delete(id);
    }
  }

  override retainSession(sessionId: string): () => void {
    this.retained.set(sessionId, (this.retained.get(sessionId) ?? 0) + 1);
    return () => {
      const remaining = (this.retained.get(sessionId) ?? 1) - 1;
      if (remaining > 0) this.retained.set(sessionId, remaining);
      else this.retained.delete(sessionId);
    };
  }

  protected override readSessions(): SessionEnvelope {
    if (!this.database) throw new Error('请先打开聊天记录存储。');
    return { version: 1, sessions: structuredClone(Array.from(this.sessions.values())) };
  }

  protected override writeSessions(envelope: SessionEnvelope): void {
    if (!this.database) throw new Error('请先打开聊天记录存储。');
    const next = new Map(envelope.sessions.map((record) => [record.id, record]));
    // Validate the complete change before staging any part of it.
    const serialized = new Map(envelope.sessions.map((record) => [record.id, serializeBounded(record)]));
    for (const id of this.sessions.keys()) {
      if (!next.has(id)) this.dirty.set(id, null);
    }
    for (const [id, record] of next) {
      if (serialized.get(id) !== this.serialized.get(id)) this.dirty.set(id, record);
    }
    this.sessions = next;
    this.serialized = serialized;
  }

  override async flush(): Promise<void> {
    const write = this.pending.then(async () => {
      if (!this.dirty.size) return;
      if (!this.database) throw new Error('聊天记录存储已关闭，请重新打开后再试。');
      const changes = Array.from(this.dirty);
      const transaction = this.database.transaction(['sessions', 'summaries'], 'readwrite');
      const done = transactionDone(transaction);
      try {
        for (const [id, record] of changes) {
          if (record) {
            transaction.objectStore('sessions').put(record);
            transaction.objectStore('summaries').put(this.summary(record));
          } else {
            transaction.objectStore('sessions').delete(id);
            transaction.objectStore('summaries').delete(id);
          }
        }
      } catch (error) {
        try { transaction.abort(); } catch { /* Already aborted. */ }
        await done.catch(() => undefined);
        throw error;
      }
      await done;
      for (const [id, record] of changes) {
        if (this.dirty.get(id) === record) this.dirty.delete(id);
      }
    });
    // Failure remains visible to this caller; dirty snapshots remain for retry.
    this.pending = write.catch(() => undefined);
    await write;
  }
}
