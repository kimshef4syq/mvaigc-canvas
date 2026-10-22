use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub model_ref: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct AgentHistoryDb(Mutex<Option<Connection>>);

impl AgentHistoryDb {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

impl Default for AgentHistoryDb {
    fn default() -> Self {
        Self::new()
    }
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("agent.db"))
}

fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS agent_sessions (
           id TEXT PRIMARY KEY NOT NULL,
           project_id TEXT NOT NULL,
           title TEXT NOT NULL,
           model_ref TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL,
           has_visible_items INTEGER NOT NULL,
           record_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_updated
           ON agent_sessions(project_id, updated_at DESC);
         CREATE TABLE IF NOT EXISTS agent_session_archives (
           id TEXT PRIMARY KEY NOT NULL,
           project_id TEXT NOT NULL,
           title TEXT NOT NULL,
           model_ref TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL,
           has_visible_items INTEGER NOT NULL,
           record_json TEXT NOT NULL,
           archived_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_agent_session_archives_project_updated
           ON agent_session_archives(project_id, updated_at DESC);",
        )
        .map_err(|error| format!("初始化 Agent 数据库失败：{error}"))
}

fn with_db<F, R>(app: &AppHandle, state: &State<AgentHistoryDb>, operation: F) -> Result<R, String>
where
    F: FnOnce(&mut Connection) -> Result<R, String>,
{
    let mut slot = state
        .0
        .lock()
        .map_err(|error| format!("Agent 数据库锁异常：{error}"))?;
    if slot.is_none() {
        let connection = Connection::open(
            database_path(app).map_err(|error| format!("打开 Agent 数据库失败：{error}"))?,
        )
        .map_err(|error| format!("打开 Agent 数据库失败：{error}"))?;
        initialize(&connection)?;
        *slot = Some(connection);
    }
    operation(slot.as_mut().expect("database initialized"))
}

fn visible_items(record: &Value) -> bool {
    record
        .get("items")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().any(|item| {
                if !matches!(
                    item.get("role").and_then(Value::as_str),
                    Some("user" | "assistant")
                ) {
                    return false;
                }
                match item.get("content") {
                    Some(Value::String(text)) => !text.trim().is_empty(),
                    Some(Value::Array(parts)) => parts.iter().any(|part| {
                        part.get("text")
                            .and_then(Value::as_str)
                            .is_some_and(|text| !text.trim().is_empty())
                            || matches!(
                                part.get("type").and_then(Value::as_str),
                                Some("input_image" | "image")
                            )
                    }),
                    _ => false,
                }
            })
        })
}

fn validate_session(record: &Value) -> Result<AgentSessionSummary, String> {
    let string = |key: &str| {
        record
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| format!("聊天记录缺少有效的 {key}"))
    };
    let number = |key: &str| {
        record
            .get(key)
            .and_then(Value::as_i64)
            .ok_or_else(|| format!("聊天记录缺少有效的 {key}"))
    };
    if !record.get("items").is_some_and(Value::is_array) {
        return Err("聊天记录消息格式无效".into());
    }
    Ok(AgentSessionSummary {
        id: string("id")?,
        project_id: string("projectId")?,
        title: string("title")?,
        model_ref: string("modelRef")?,
        created_at: number("createdAt")?,
        updated_at: number("updatedAt")?,
    })
}

fn upsert_in_transaction(transaction: &Transaction<'_>, record: &Value) -> Result<(), String> {
    let summary = validate_session(record)?;
    let json = serde_json::to_string(record).map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO agent_sessions(id, project_id, title, model_ref, created_at, updated_at, has_visible_items, record_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, title=excluded.title,
           model_ref=excluded.model_ref, created_at=excluded.created_at, updated_at=excluded.updated_at,
           has_visible_items=excluded.has_visible_items, record_json=excluded.record_json
         WHERE excluded.updated_at >= agent_sessions.updated_at",
        params![summary.id, summary.project_id, summary.title, summary.model_ref, summary.created_at,
            summary.updated_at, visible_items(record) as i64, json],
    ).map_err(|error| format!("保存 Agent 会话失败：{error}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_agent_session_summaries(
    app: AppHandle,
    db: State<AgentHistoryDb>,
    project_id: String,
) -> Result<Vec<AgentSessionSummary>, String> {
    with_db(&app, &db, |connection| {
        let mut statement = connection.prepare(
            "SELECT id, project_id, title, model_ref, created_at, updated_at
             FROM agent_sessions WHERE project_id=?1 AND has_visible_items=1 ORDER BY updated_at DESC")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([project_id], |row| {
                Ok(AgentSessionSummary {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    title: row.get(2)?,
                    model_ref: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub fn list_archived_agent_session_summaries(
    app: AppHandle,
    db: State<AgentHistoryDb>,
    project_id: String,
) -> Result<Vec<AgentSessionSummary>, String> {
    with_db(&app, &db, |connection| {
        let mut statement = connection.prepare(
            "SELECT id, project_id, title, model_ref, created_at, updated_at
             FROM agent_session_archives WHERE project_id=?1 AND has_visible_items=1 ORDER BY updated_at DESC")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([project_id], |row| {
                Ok(AgentSessionSummary {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    title: row.get(2)?,
                    model_ref: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub fn get_agent_session(
    app: AppHandle,
    db: State<AgentHistoryDb>,
    session_id: String,
) -> Result<Option<Value>, String> {
    with_db(&app, &db, |connection| {
        connection
            .query_row(
                "SELECT record_json FROM agent_sessions WHERE id=?1
                 UNION ALL SELECT record_json FROM agent_session_archives WHERE id=?1 LIMIT 1",
                [session_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .map(|json| serde_json::from_str(&json).map_err(|error| error.to_string()))
            .transpose()
    })
}

#[tauri::command]
pub fn archive_agent_session(
    app: AppHandle,
    db: State<AgentHistoryDb>,
    session_id: String,
) -> Result<(), String> {
    with_db(&app, &db, |connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let changed = transaction.execute(
            "INSERT OR IGNORE INTO agent_session_archives
             (id, project_id, title, model_ref, created_at, updated_at, has_visible_items, record_json, archived_at)
             SELECT id, project_id, title, model_ref, created_at, updated_at, has_visible_items, record_json,
               CAST(strftime('%s','now') AS INTEGER) * 1000 FROM agent_sessions WHERE id=?1",
            [&session_id],
        ).map_err(|error| format!("归档 Agent 会话失败：{error}"))?;
        if changed == 0 {
            return Err("找不到可归档的 Agent 会话。".into());
        }
        transaction
            .execute("DELETE FROM agent_sessions WHERE id=?1", [&session_id])
            .map_err(|error| format!("移动 Agent 会话到归档失败：{error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("提交 Agent 会话归档失败：{error}"))
    })
}

#[tauri::command]
pub fn restore_archived_agent_session(
    app: AppHandle,
    db: State<AgentHistoryDb>,
    session_id: String,
) -> Result<(), String> {
    with_db(&app, &db, |connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let changed = transaction.execute(
            "INSERT OR IGNORE INTO agent_sessions
             (id, project_id, title, model_ref, created_at, updated_at, has_visible_items, record_json)
             SELECT id, project_id, title, model_ref, created_at, updated_at, has_visible_items, record_json
             FROM agent_session_archives WHERE id=?1",
            [&session_id],
        ).map_err(|error| format!("恢复 Agent 会话失败：{error}"))?;
        if changed == 0 {
            return Err("找不到可恢复的归档 Agent 会话。".into());
        }
        transaction
            .execute(
                "DELETE FROM agent_session_archives WHERE id=?1",
                [&session_id],
            )
            .map_err(|error| format!("移出 Agent 归档失败：{error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("提交 Agent 会话恢复失败：{error}"))
    })
}

#[tauri::command]
pub fn upsert_agent_session(
    app: AppHandle,
    db: State<AgentHistoryDb>,
    session: Value,
) -> Result<(), String> {
    with_db(&app, &db, |connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        upsert_in_transaction(&transaction, &session)?;
        transaction
            .commit()
            .map_err(|error| format!("提交 Agent 会话失败：{error}"))
    })
}

#[tauri::command]
pub fn import_agent_sessions(
    app: AppHandle,
    db: State<AgentHistoryDb>,
    sessions: Vec<Value>,
) -> Result<usize, String> {
    if sessions.len() > 10_000 {
        return Err("待迁移的会话数量超出安全上限".into());
    }
    with_db(&app, &db, |connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for session in &sessions {
            upsert_in_transaction(&transaction, session)?;
        }
        transaction
            .commit()
            .map_err(|error| format!("提交 Agent 聊天记录迁移失败：{error}"))?;
        Ok(sessions.len())
    })
}

#[tauri::command]
pub fn delete_agent_session(
    app: AppHandle,
    db: State<AgentHistoryDb>,
    session_id: String,
) -> Result<(), String> {
    with_db(&app, &db, |connection| {
        connection
            .execute("DELETE FROM agent_sessions WHERE id=?1", [session_id])
            .map_err(|error| format!("删除 Agent 会话失败：{error}"))?;
        Ok(())
    })
}
