import { invoke } from '@tauri-apps/api/core';
import {
  AgentSessionRepository,
  SESSION_STORAGE_KEY,
  isAgentSessionRecord,
  serializeBounded,
  type AgentSessionRecord,
  type AgentSessionSummary,
  type SessionEnvelope,
  type StorageLike,
} from './agentSessionRepository';
import { clearIndexedDbAgentSessions, readIndexedDbAgentSessions } from './indexedDbAgentSessionRepository';

function localStorageOrNull(): StorageLike | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Tauri desktop repository: SQLite is the durable store; only active sessions are cached. */
export class TauriAgentSessionRepository extends AgentSessionRepository {
  private prepared?: Promise<void>;
  private sessions = new Map<string, AgentSessionRecord>();
  private serialized = new Map<string, string>();
  private dirty = new Map<string, AgentSessionRecord | null>();
  private retained = new Map<string, number>();
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly legacyStorage: StorageLike | null = localStorageOrNull(),
  ) {
    // Run approval checkpoints keep their existing recovery/expiry behavior.
    super(legacyStorage && {
      getItem: (key) => key === SESSION_STORAGE_KEY ? null : legacyStorage.getItem(key),
      setItem: (key, value) => legacyStorage.setItem(key, value),
      removeItem: (key) => legacyStorage.removeItem(key),
    });
  }

  override async prepare(): Promise<void> {
    if (!this.prepared) this.prepared = this.migrateLegacyHistory().catch((error) => {
      this.prepared = undefined;
      throw error;
    });
    await this.prepared;
  }

  private async migrateLegacyHistory(): Promise<void> {
    let legacyRaw: string | null = null;
    try { legacyRaw = this.legacyStorage?.getItem(SESSION_STORAGE_KEY) ?? null; }
    catch { throw new Error('读取旧版 localStorage 聊天记录失败，原记录已保留。'); }
    const recordsById = new Map<string, AgentSessionRecord>();
    if (legacyRaw) {
      let envelope: Partial<SessionEnvelope>;
      try { envelope = JSON.parse(legacyRaw) as Partial<SessionEnvelope>; }
      catch { throw new Error('旧版聊天记录格式无效，原记录已保留，无法迁移。'); }
      if (envelope.version !== 1 || !Array.isArray(envelope.sessions)
        || !envelope.sessions.every(isAgentSessionRecord)) {
        throw new Error('旧版聊天记录格式无效，原记录已保留，无法迁移。');
      }
      for (const record of envelope.sessions) recordsById.set(record.id, record);
    }

    // The earlier implementation briefly used IndexedDB. Import it too so a
    // desktop build launched during that transition cannot strand its history.
    if (typeof indexedDB !== 'undefined') {
      const previousIndexedDbRecords = await readIndexedDbAgentSessions();
      for (const record of previousIndexedDbRecords) {
        const existing = recordsById.get(record.id);
        if (!existing || record.updatedAt > existing.updatedAt) recordsById.set(record.id, record);
      }
    }

    const records = Array.from(recordsById.values());
    for (const record of records) serializeBounded(record);
    // The command commits the entire import in one SQLite transaction. Source
    // data is removed only after this succeeds.
    await invoke<number>('import_agent_sessions', { sessions: records });
    if (legacyRaw !== null) {
      try {
        if (this.legacyStorage?.getItem(SESSION_STORAGE_KEY) === legacyRaw) {
          this.legacyStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } catch { /* SQLite has the records; retry source cleanup on next launch. */ }
    }
    if (records.length) await clearIndexedDbAgentSessions();
  }

  override async listSessionSummaries(projectId: string): Promise<AgentSessionSummary[]> {
    await this.prepare();
    await this.flush();
    return invoke<AgentSessionSummary[]>('list_agent_session_summaries', { projectId });
  }

  override async loadSession(sessionId: string): Promise<void> {
    await this.prepare();
    await this.flush();
    if (this.sessions.has(sessionId)) return;
    const record = await invoke<AgentSessionRecord | null>('get_agent_session', { sessionId });
    if (!record) return;
    if (!isAgentSessionRecord(record)) throw new Error('聊天记录格式无效。');
    serializeBounded(record);
    this.sessions.set(sessionId, record);
    this.serialized.set(sessionId, serializeBounded(record));
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
    if (!this.prepared) throw new Error('请先初始化 Agent 聊天数据库。');
    return { version: 1, sessions: structuredClone(Array.from(this.sessions.values())) };
  }

  protected override writeSessions(envelope: SessionEnvelope): void {
    const next = new Map(envelope.sessions.map((record) => [record.id, record]));
    const serialized = new Map(envelope.sessions.map((record) => [record.id, serializeBounded(record)]));
    for (const id of this.sessions.keys()) if (!next.has(id)) this.dirty.set(id, null);
    for (const [id, record] of next) {
      if (serialized.get(id) !== this.serialized.get(id)) this.dirty.set(id, record);
    }
    this.sessions = next;
    this.serialized = serialized;
  }

  override async flush(): Promise<void> {
    const write = this.pending.then(async () => {
      if (!this.dirty.size) return;
      const changes = Array.from(this.dirty);
      await Promise.all(changes.map(([sessionId, session]) => session
        ? invoke('upsert_agent_session', { session })
        : invoke('delete_agent_session', { sessionId })));
      for (const [id, record] of changes) if (this.dirty.get(id) === record) this.dirty.delete(id);
    });
    this.pending = write.catch(() => undefined);
    await write;
  }

}
