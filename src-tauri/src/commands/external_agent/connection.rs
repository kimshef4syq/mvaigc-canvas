use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager, State};
use tempfile::Builder as TempFileBuilder;
use tracing::warn;
use uuid::Uuid;

use super::codex::toml_string;
use super::process::LaunchTarget;
use super::protocol::validate_tools;
use super::session::terminate_session;
use super::{
    now_millis, BrokerCredentials, ExternalAgentCommandError, ExternalAgentInner,
    ExternalAgentRuntime, ExternalAgentSession, ExternalAgentState, ExternalAgentToolDefinition,
    SessionWorkspace, CAPABILITY_LIFETIME_MS,
};

const CONNECTION_DESCRIPTOR_SCHEMA_VERSION: u8 = 1;
const HYPIT_PROJECTS_DIR_NAME: &str = "hypit-projects";
const HYPIT_PROJECT_NAME_MAX_CHARS: usize = 32;
const CONNECTION_DESCRIPTOR_FILE: &str = "canvas-mcp-current.json";
const CONNECTION_PARAMS_FILE: &str = "connection-params.json";
const LEGACY_DESCRIPTOR_PREFIX: &str = "canvas-mcp-";

/// Host-owned connection policy. Missing persisted values keep legacy manual approval.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalAgentPermissionMode {
    #[default]
    Manual,
    Analysis,
    Collaboration,
}

impl ExternalAgentPermissionMode {
    fn code(self) -> u8 {
        match self {
            Self::Manual => 0,
            Self::Analysis => 1,
            Self::Collaboration => 2,
        }
    }

    fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Analysis,
            2 => Self::Collaboration,
            _ => Self::Manual,
        }
    }
}

fn default_write_claude_config() -> bool {
    true
}

fn new_connection_mode() -> ExternalAgentPermissionMode {
    ExternalAgentPermissionMode::Analysis
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateExternalAgentConnectionRequest {
    pub project_id: String,
    pub project_name: String,
    #[serde(default)]
    pub tools: Vec<ExternalAgentToolDefinition>,
    #[serde(default = "new_connection_mode")]
    pub permission_mode: ExternalAgentPermissionMode,
    #[serde(default)]
    pub claude_code_project_dir: Option<String>,
    #[serde(default = "default_write_claude_config")]
    pub write_claude_config: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentConnectionProject {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentProviderConfig {
    pub format: &'static str,
    pub contents: String,
    pub destination_macos: &'static str,
    pub destination_windows: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentConnectionConfigs {
    pub codex: ExternalAgentProviderConfig,
    pub claude: ExternalAgentProviderConfig,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentConnectionInfo {
    pub schema_version: u8,
    pub connection_id: Option<String>,
    pub status: String,
    pub project: Option<ExternalAgentConnectionProject>,
    pub scope: Vec<String>,
    pub permission_mode: ExternalAgentPermissionMode,
    pub created_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub connected_at: Option<u64>,
    pub last_activity_at: Option<u64>,
    pub call_count: u64,
    pub descriptor_path: Option<String>,
    pub hypit_project_dir: Option<String>,
    pub configs: Option<ExternalAgentConnectionConfigs>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalAgentConnectionDescriptor {
    pub schema_version: u8,
    pub broker_address: String,
    pub capability_token: String,
    pub session_id: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionParams {
    pub schema_version: u8,
    pub project_id: String,
    pub project_name: String,
    pub tools: Vec<ExternalAgentToolDefinition>,
    #[serde(default)]
    pub claude_code_project_dir: Option<String>,
    #[serde(default = "default_write_claude_config")]
    pub write_claude_config: bool,
    #[serde(default)]
    pub permission_mode: ExternalAgentPermissionMode,
}

fn validate_project_text(
    value: String,
    field: &str,
    max_chars: usize,
) -> Result<String, ExternalAgentCommandError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > max_chars
        || trimmed.chars().any(char::is_control)
    {
        return Err(ExternalAgentCommandError::invalid_request(format!(
            "External Agent {field} has an invalid format."
        )));
    }
    Ok(trimmed.to_string())
}

fn write_connection_descriptor(
    descriptor_root: &Path,
    descriptor: &ExternalAgentConnectionDescriptor,
) -> Result<PathBuf, ExternalAgentCommandError> {
    std::fs::create_dir_all(descriptor_root).map_err(|error| {
        ExternalAgentCommandError::process(format!(
            "Failed to prepare the Canvas MCP descriptor directory: {error}"
        ))
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(descriptor_root, std::fs::Permissions::from_mode(0o700)).map_err(
            |error| {
                ExternalAgentCommandError::process(format!(
                    "Failed to protect the Canvas MCP descriptor directory: {error}"
                ))
            },
        )?;
    }

    let path = descriptor_root.join(CONNECTION_DESCRIPTOR_FILE);
    let bytes = serde_json::to_vec(descriptor).map_err(|_| {
        ExternalAgentCommandError::process("Failed to encode the Canvas MCP descriptor.")
    })?;
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|error| {
        ExternalAgentCommandError::process(format!(
            "Failed to create the Canvas MCP descriptor: {error}"
        ))
    })?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = std::fs::remove_file(&path);
        return Err(ExternalAgentCommandError::process(format!(
            "Failed to persist the Canvas MCP descriptor: {error}"
        )));
    }
    Ok(path)
}

fn cleanup_legacy_descriptors(descriptor_root: &Path) {
    let Ok(entries) = std::fs::read_dir(descriptor_root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with(LEGACY_DESCRIPTOR_PREFIX)
            && name.ends_with(".json")
            && name != CONNECTION_DESCRIPTOR_FILE
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn is_slug_safe_char(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || matches!(character as u32, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF)
}

/// 目录名派生：同一画布项目永远得到同一个视频工程目录，无需额外注册表。
pub(crate) fn hypit_project_slug(project_id: &str, project_name: &str) -> String {
    let sanitized: String = project_name
        .trim()
        .chars()
        .map(|character| {
            if is_slug_safe_char(character) {
                character
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    let name: String = if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed.chars().take(HYPIT_PROJECT_NAME_MAX_CHARS).collect()
    };
    let id_fragment: String = project_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(8)
        .collect();
    format!("{name}-{id_fragment}")
}

/// 创建（首次）或复用视频工程目录。已存在时不覆盖 `package.json`，
/// 以免抹掉 hypit 自己写进该文件的内容。
pub(crate) fn ensure_hypit_project_dir(
    app: &AppHandle,
    project_id: &str,
    project_name: &str,
) -> Result<PathBuf, ExternalAgentCommandError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        ExternalAgentCommandError::process(format!(
            "Failed to resolve the app data directory for the Hypit project: {error}"
        ))
    })?;
    prepare_hypit_project_dir(&app_data_dir, project_id, project_name)
}

fn prepare_hypit_project_dir(
    app_data_dir: &Path,
    project_id: &str,
    project_name: &str,
) -> Result<PathBuf, ExternalAgentCommandError> {
    let slug = hypit_project_slug(project_id, project_name);
    let root = app_data_dir.join(HYPIT_PROJECTS_DIR_NAME);
    let mut directory = root.join(&slug);
    if let Ok(entries) = std::fs::read_dir(&root) {
        let suffix = format!("-{}", project_id.chars().take(8).collect::<String>());
        let matches: Vec<_> = entries
            .flatten()
            .filter(|entry| {
                entry
                    .file_type()
                    .map(|t| t.is_dir() && !t.is_symlink())
                    .unwrap_or(false)
            })
            .filter(|entry| {
                let marker = entry.path().join(".canvas-project-id");
                match std::fs::read_to_string(&marker) {
                    Ok(id) => id == project_id,
                    Err(_) => entry.file_name().to_string_lossy().ends_with(&suffix),
                }
            })
            .map(|entry| entry.path())
            .collect();
        if matches.len() > 1 {
            return Err(ExternalAgentCommandError::invalid_request("Multiple Hypit directories match this project; resolve the duplicate directories first."));
        }
        if let Some(existing) = matches.first() {
            directory = existing.clone();
        }
    }
    std::fs::create_dir_all(&directory).map_err(|error| {
        ExternalAgentCommandError::process(format!(
            "Failed to prepare the Hypit project directory: {error}"
        ))
    })?;
    std::fs::write(directory.join(".canvas-project-id"), project_id).map_err(|error| {
        ExternalAgentCommandError::process(format!("Failed to record project identity: {error}"))
    })?;
    let manifest = directory.join("package.json");
    if !manifest.exists() {
        let contents = serde_json::to_vec_pretty(&serde_json::json!({
            "name": slug,
            "version": "0.0.0",
            "private": true,
            "type": "module",
            "hypit": { "project": true },
        }))
        .map_err(|error| {
            ExternalAgentCommandError::process(format!(
                "Failed to encode the Hypit project manifest: {error}"
            ))
        })?;
        std::fs::write(&manifest, contents).map_err(|error| {
            ExternalAgentCommandError::process(format!(
                "Failed to write the Hypit project manifest: {error}"
            ))
        })?;
    }
    Ok(directory)
}

/// `~/.claude.json` 里要写画布 MCP 条目的目录。视频工程目录总是写；用户设置的
/// `claudeCodeProjectDir` 为空时跳过，保持既有语义。
fn mcp_target_dirs(claude_code_project_dir: Option<&str>, hypit_project_dir: &Path) -> Vec<String> {
    let mut dirs = Vec::new();
    if let Some(dir) = claude_code_project_dir.filter(|dir| !dir.trim().is_empty()) {
        dirs.push(dir.to_string());
    }
    dirs.push(hypit_project_dir.to_string_lossy().into_owned());
    dirs
}

fn write_connection_params(
    descriptor_root: &Path,
    params: &ConnectionParams,
) -> Result<(), ExternalAgentCommandError> {
    std::fs::create_dir_all(descriptor_root).map_err(|error| {
        ExternalAgentCommandError::process(format!(
            "Failed to prepare the External Agent connection directory: {error}"
        ))
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(descriptor_root, std::fs::Permissions::from_mode(0o700)).map_err(
            |error| {
                ExternalAgentCommandError::process(format!(
                    "Failed to protect the External Agent connection directory: {error}"
                ))
            },
        )?;
    }

    let path = descriptor_root.join(CONNECTION_PARAMS_FILE);
    let bytes = serde_json::to_vec(params).map_err(|_| {
        ExternalAgentCommandError::process("Failed to encode the External Agent connection params.")
    })?;
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|error| {
        ExternalAgentCommandError::process(format!(
            "Failed to create the External Agent connection params: {error}"
        ))
    })?;
    file.write_all(&bytes).map_err(|error| {
        ExternalAgentCommandError::process(format!(
            "Failed to persist the External Agent connection params: {error}"
        ))
    })?;
    Ok(())
}

fn read_connection_params(descriptor_root: &Path) -> Option<ConnectionParams> {
    let bytes = std::fs::read(descriptor_root.join(CONNECTION_PARAMS_FILE)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn build_provider_configs(
    executable: &Path,
    descriptor_path: &Path,
) -> Result<ExternalAgentConnectionConfigs, ExternalAgentCommandError> {
    let executable = executable.to_string_lossy();
    let descriptor_path = descriptor_path.to_string_lossy();
    let codex = format!(
        "[mcp_servers.storyboard_canvas]\ncommand = {}\nargs = [\"--external-agent-mcp\", {}]\nstartup_timeout_sec = 10\ntool_timeout_sec = 3600\n",
        toml_string(&executable),
        toml_string(&descriptor_path),
    );
    let claude = serde_json::to_string_pretty(&json!({
        "mcpServers": {
            "storyboard_canvas": {
                "type": "stdio",
                "command": executable.as_ref(),
                "args": ["--external-agent-mcp", descriptor_path.as_ref()],
                "env": {}
            }
        }
    }))
    .map_err(|_| ExternalAgentCommandError::process("Failed to encode Claude Code MCP config."))?;
    Ok(ExternalAgentConnectionConfigs {
        codex: ExternalAgentProviderConfig {
            format: "toml",
            contents: codex,
            destination_macos: "~/.codex/config.toml",
            destination_windows: "%USERPROFILE%\\.codex\\config.toml",
        },
        claude: ExternalAgentProviderConfig {
            format: "json",
            contents: claude,
            destination_macos: "~/.claude.json (project mcpServers entry)",
            destination_windows: "%USERPROFILE%\\.claude.json (project mcpServers entry)",
        },
    })
}

fn disconnected_connection() -> ExternalAgentConnectionInfo {
    ExternalAgentConnectionInfo {
        schema_version: 1,
        connection_id: None,
        status: "disconnected".to_string(),
        project: None,
        scope: Vec::new(),
        permission_mode: ExternalAgentPermissionMode::Manual,
        created_at: None,
        expires_at: None,
        connected_at: None,
        last_activity_at: None,
        call_count: 0,
        descriptor_path: None,
        hypit_project_dir: None,
        configs: None,
    }
}

pub(crate) fn connection_info(
    session: &ExternalAgentSession,
) -> Result<ExternalAgentConnectionInfo, ExternalAgentCommandError> {
    let descriptor_path = session.descriptor_path.as_ref().ok_or_else(|| {
        ExternalAgentCommandError::not_found("External Agent connection descriptor is unavailable.")
    })?;
    let executable = std::env::current_exe().map_err(|error| {
        ExternalAgentCommandError::process(format!(
            "Failed to resolve the bundled Canvas MCP executable: {error}"
        ))
    })?;
    let now = now_millis();
    let connected_at = session.connected_at.load(Ordering::SeqCst);
    let last_activity_at = session.last_activity_at.load(Ordering::SeqCst);
    let status = if now >= session.capability_expires_at {
        "expired"
    } else if connected_at > 0 {
        "connected"
    } else {
        "ready"
    };
    let mut scope = session.tools.keys().cloned().collect::<Vec<_>>();
    scope.sort();
    Ok(ExternalAgentConnectionInfo {
        schema_version: 1,
        connection_id: Some(session.id.clone()),
        status: status.to_string(),
        project: Some(ExternalAgentConnectionProject {
            id: session.project_id.clone().unwrap_or_default(),
            name: session.project_name.clone().unwrap_or_default(),
        }),
        scope,
        permission_mode: ExternalAgentPermissionMode::from_code(
            session.permission_mode.load(Ordering::SeqCst),
        ),
        created_at: Some(session.created_at),
        expires_at: Some(session.capability_expires_at),
        connected_at: (connected_at > 0).then_some(connected_at),
        last_activity_at: (last_activity_at > 0).then_some(last_activity_at),
        call_count: session.call_count.load(Ordering::SeqCst),
        descriptor_path: Some(descriptor_path.to_string_lossy().into_owned()),
        hypit_project_dir: session
            .hypit_project_dir
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        configs: Some(build_provider_configs(&executable, descriptor_path)?),
    })
}

#[tauri::command]
pub async fn create_external_agent_connection(
    app: AppHandle,
    state: State<'_, ExternalAgentState>,
    request: CreateExternalAgentConnectionRequest,
) -> Result<ExternalAgentConnectionInfo, ExternalAgentCommandError> {
    establish_connection(
        &state.inner,
        &app,
        request.project_id,
        request.project_name,
        request.tools,
        request.claude_code_project_dir,
        request.permission_mode,
        request.write_claude_config,
    )
    .await
}

pub(crate) async fn establish_connection(
    inner: &Arc<ExternalAgentInner>,
    app: &AppHandle,
    project_id: String,
    project_name: String,
    tools: Vec<ExternalAgentToolDefinition>,
    claude_code_project_dir: Option<String>,
    permission_mode: ExternalAgentPermissionMode,
    write_claude_config: bool,
) -> Result<ExternalAgentConnectionInfo, ExternalAgentCommandError> {
    if !inner.broker_started.load(Ordering::SeqCst) {
        return Err(ExternalAgentCommandError::unavailable(
            inner
                .broker_initialization_error
                .clone()
                .unwrap_or_else(|| "Canvas MCP broker is not running.".to_string()),
        ));
    }
    let project_id = validate_project_text(project_id, "project id", 256)?;
    let project_name = validate_project_text(project_name, "project name", 256)?;
    let tools = validate_tools(tools)?
        .into_iter()
        .map(|mut tool| {
            tool.requires_approval = true;
            tool
        })
        .collect::<Vec<_>>();
    if tools.is_empty() {
        return Err(ExternalAgentCommandError::invalid_request(
            "At least one bounded Canvas MCP tool is required.",
        ));
    }

    if let Some(previous_id) = inner.managed_connection_id.read().await.clone() {
        terminate_session(inner, app, &previous_id, None).await;
    }

    let address = inner.broker_address.ok_or_else(|| {
        ExternalAgentCommandError::unavailable("Canvas MCP broker address is unavailable.")
    })?;
    let connection_id = Uuid::new_v4().to_string();
    let capability_token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let created_at = now_millis();
    let expires_at = created_at.saturating_add(CAPABILITY_LIFETIME_MS);
    let descriptor_root = inner
        .connection_descriptor_root
        .lock()
        .map_err(|_| ExternalAgentCommandError::process("Descriptor root lock is poisoned."))?
        .clone();
    let descriptor = ExternalAgentConnectionDescriptor {
        schema_version: CONNECTION_DESCRIPTOR_SCHEMA_VERSION,
        broker_address: address.to_string(),
        capability_token: capability_token.clone(),
        session_id: connection_id.clone(),
        expires_at,
    };
    let descriptor_path = write_connection_descriptor(&descriptor_root, &descriptor)?;
    let _ = cleanup_legacy_descriptors(&descriptor_root);
    let workspace = TempFileBuilder::new()
        .prefix("managed-mcp-")
        .tempdir_in(&descriptor_root)
        .map_err(|error| {
            let _ = std::fs::remove_file(&descriptor_path);
            ExternalAgentCommandError::process(format!(
                "Failed to create the managed MCP workspace: {error}"
            ))
        })?;
    let hypit_project_dir = ensure_hypit_project_dir(app, &project_id, &project_name)?;
    let broker = BrokerCredentials {
        address: address.to_string(),
        token: capability_token.clone(),
        session_id: connection_id.clone(),
    };
    let target = LaunchTarget::from_direct(
        std::env::current_exe().map_err(|error| {
            ExternalAgentCommandError::process(format!(
                "Failed to resolve the bundled Canvas MCP executable: {error}"
            ))
        })?,
        ExternalAgentRuntime::Codex,
    );
    let session = Arc::new(ExternalAgentSession {
        id: connection_id.clone(),
        runtime: ExternalAgentRuntime::Codex,
        capability_token,
        capability_expires_at: expires_at,
        broker,
        target,
        workspace: std::sync::Mutex::new(Some(SessionWorkspace::Temporary(workspace))),
        tools: tools
            .into_iter()
            .map(|tool| (tool.name.clone(), tool))
            .collect(),
        provider_session_id: tokio::sync::RwLock::new(None),
        model: None,
        created_at,
        cancelled: std::sync::atomic::AtomicBool::new(false),
        active_turn_id: tokio::sync::RwLock::new(Some(format!("managed-{connection_id}"))),
        active_process: tokio::sync::Mutex::new(None),
        codex_stdin: tokio::sync::Mutex::new(None),
        next_rpc_id: std::sync::atomic::AtomicU64::new(1),
        pending_rpc: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        claude_has_history: std::sync::atomic::AtomicBool::new(false),
        turn_gate: tokio::sync::Mutex::new(()),
        turn_workspaces: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        user_managed: true,
        permission_mode: std::sync::atomic::AtomicU8::new(permission_mode.code()),
        project_id: Some(project_id.clone()),
        project_name: Some(project_name.clone()),
        hypit_project_dir: Some(hypit_project_dir.clone()),
        descriptor_path: Some(descriptor_path.clone()),
        connected_at: std::sync::atomic::AtomicU64::new(0),
        last_activity_at: std::sync::atomic::AtomicU64::new(0),
        call_count: std::sync::atomic::AtomicU64::new(0),
    });
    inner
        .sessions
        .write()
        .await
        .insert(connection_id.clone(), session.clone());
    *inner.managed_connection_id.write().await = Some(connection_id);

    let params = ConnectionParams {
        schema_version: 1,
        project_id: project_id.clone(),
        project_name: project_name.clone(),
        tools: session.tools.values().cloned().collect(),
        claude_code_project_dir: claude_code_project_dir.clone(),
        write_claude_config,
        permission_mode,
    };
    let _ = write_connection_params(&descriptor_root, &params);
    if write_claude_config {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            let executable = std::env::current_exe()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let args = vec![
                "--external-agent-mcp".to_string(),
                descriptor_path.to_string_lossy().into_owned(),
            ];
            let target_dirs =
                mcp_target_dirs(claude_code_project_dir.as_deref(), &hypit_project_dir);
            if let Err(error) = super::claude_config::write_local_mcp_server(
                &home.join(".claude.json"),
                &target_dirs,
                "storyboard_canvas",
                &executable,
                &args,
            ) {
                warn!("未能写入 Claude Code 配置（不影响画布内使用）：{error}");
            }
        } else {
            warn!("未找到 HOME 目录，跳过写入 Claude Code 配置");
        }
    }
    connection_info(&session)
}

pub(crate) async fn rebuild_managed_connection(
    inner: &Arc<ExternalAgentInner>,
    app: &AppHandle,
) -> Result<(), ExternalAgentCommandError> {
    if !inner.broker_started.load(Ordering::SeqCst) {
        return Ok(()); // broker 未起，静默跳过
    }
    let descriptor_root = inner
        .connection_descriptor_root
        .lock()
        .map_err(|_| ExternalAgentCommandError::process("Descriptor root lock is poisoned."))?
        .clone();
    let Some(params) = read_connection_params(&descriptor_root) else {
        return Ok(()); // 从未创建过，跳过
    };
    establish_connection(
        inner,
        app,
        params.project_id,
        params.project_name,
        params.tools,
        params.claude_code_project_dir,
        params.permission_mode,
        params.write_claude_config,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn inspect_external_agent_connection(
    state: State<'_, ExternalAgentState>,
) -> Result<ExternalAgentConnectionInfo, ExternalAgentCommandError> {
    let Some(connection_id) = state.inner.managed_connection_id.read().await.clone() else {
        return Ok(disconnected_connection());
    };
    let Some(session) = state
        .inner
        .sessions
        .read()
        .await
        .get(&connection_id)
        .cloned()
    else {
        *state.inner.managed_connection_id.write().await = None;
        return Ok(disconnected_connection());
    };
    connection_info(&session)
}

#[tauri::command]
pub async fn set_external_agent_connection_permission(
    state: State<'_, ExternalAgentState>,
    connection_id: String,
    permission_mode: ExternalAgentPermissionMode,
) -> Result<ExternalAgentConnectionInfo, ExternalAgentCommandError> {
    if state.inner.managed_connection_id.read().await.as_deref() != Some(connection_id.as_str()) {
        return Err(ExternalAgentCommandError::not_found(
            "External Agent connection not found.",
        ));
    }
    let session = state
        .inner
        .sessions
        .read()
        .await
        .get(&connection_id)
        .cloned()
        .ok_or_else(|| {
            ExternalAgentCommandError::not_found("External Agent connection not found.")
        })?;
    if !session.user_managed
        || session.cancelled.load(Ordering::SeqCst)
        || now_millis() >= session.capability_expires_at
    {
        return Err(ExternalAgentCommandError::permission_denied(
            "The Canvas connection is no longer active.",
        ));
    }
    let root = state
        .inner
        .connection_descriptor_root
        .lock()
        .map_err(|_| ExternalAgentCommandError::process("Descriptor root lock is poisoned."))?
        .clone();
    if let Some(mut params) = read_connection_params(&root) {
        params.permission_mode = permission_mode;
        write_connection_params(&root, &params)?;
    }
    session
        .permission_mode
        .store(permission_mode.code(), Ordering::SeqCst);
    connection_info(&session)
}

#[tauri::command]
pub async fn revoke_external_agent_connection(
    app: AppHandle,
    state: State<'_, ExternalAgentState>,
    connection_id: String,
) -> Result<ExternalAgentConnectionInfo, ExternalAgentCommandError> {
    let active_id = state.inner.managed_connection_id.read().await.clone();
    if active_id.as_deref() != Some(connection_id.as_str()) {
        return Err(ExternalAgentCommandError::not_found(
            "External Agent connection not found.",
        ));
    }
    terminate_session(&state.inner, &app, &connection_id, None).await;
    *state.inner.managed_connection_id.write().await = None;
    Ok(disconnected_connection())
}

#[tauri::command]
pub async fn replay_external_agent_pending_tool_calls(
    app: AppHandle,
    state: State<'_, ExternalAgentState>,
) -> Result<usize, ExternalAgentCommandError> {
    let Some(connection_id) = state.inner.managed_connection_id.read().await.clone() else {
        return Ok(0);
    };
    let events = state
        .inner
        .pending_tools
        .lock()
        .await
        .values()
        .filter(|pending| pending.session_id == connection_id)
        .map(|pending| pending.event.clone())
        .collect::<Vec<_>>();
    for event in &events {
        super::emit_event(&app, event.clone());
    }
    Ok(events.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_request_parses_optional_claude_dir() {
        let with: CreateExternalAgentConnectionRequest = serde_json::from_str(
            r#"{"projectId":"p","projectName":"n","tools":[],"claudeCodeProjectDir":"/tmp/d"}"#,
        )
        .unwrap();
        assert_eq!(with.claude_code_project_dir.as_deref(), Some("/tmp/d"));
        let without: CreateExternalAgentConnectionRequest =
            serde_json::from_str(r#"{"projectId":"p","projectName":"n","tools":[]}"#).unwrap();
        assert!(without.claude_code_project_dir.is_none());
    }

    #[test]
    fn generated_configs_use_descriptor_path_without_capability_material() {
        let configs = build_provider_configs(
            Path::new(r#"C:\Program Files\Storyboard Canvas\canvas.exe"#),
            Path::new(r#"C:\Users\Alice\AppData\Canvas MCP\descriptor.json"#),
        )
        .unwrap();
        assert!(configs.codex.contents.contains("--external-agent-mcp"));
        assert!(configs.claude.contents.contains("--external-agent-mcp"));
        assert!(configs.codex.contents.contains("descriptor.json"));
        assert!(!configs
            .codex
            .contents
            .contains("STORYBOARD_EXTERNAL_AGENT_TOKEN"));
        assert!(!configs
            .claude
            .contents
            .contains("STORYBOARD_EXTERNAL_AGENT_TOKEN"));
        serde_json::from_str::<serde_json::Value>(&configs.claude.contents).unwrap();
    }

    #[test]
    fn descriptor_file_is_private_and_overwritable() {
        let root = tempfile::tempdir().unwrap();
        let descriptor = ExternalAgentConnectionDescriptor {
            schema_version: 1,
            broker_address: "127.0.0.1:1234".to_string(),
            capability_token: "secret-capability".to_string(),
            session_id: "session-a".to_string(),
            expires_at: u64::MAX,
        };
        let path = write_connection_descriptor(root.path(), &descriptor).unwrap();
        assert_eq!(path.file_name().unwrap(), "canvas-mcp-current.json");
        let second = ExternalAgentConnectionDescriptor {
            capability_token: "rotated-capability".to_string(),
            ..descriptor.clone()
        };
        let path2 = write_connection_descriptor(root.path(), &second).unwrap();
        assert_eq!(path, path2);
        let decoded: ExternalAgentConnectionDescriptor =
            serde_json::from_slice(&std::fs::read(path.clone()).unwrap()).unwrap();
        assert_eq!(decoded.capability_token, "rotated-capability");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o077,
                0
            );
        }
    }

    #[test]
    fn descriptor_uses_fixed_name_and_overwrites() {
        let root = tempfile::tempdir().unwrap();
        let first = ExternalAgentConnectionDescriptor {
            schema_version: 1,
            broker_address: "127.0.0.1:1".into(),
            capability_token: "a".into(),
            session_id: "s1".into(),
            expires_at: 1,
        };
        let path = write_connection_descriptor(root.path(), &first).unwrap();
        assert_eq!(path.file_name().unwrap(), "canvas-mcp-current.json");

        // 第二次写同名文件必须成功（覆盖），内容为第二次的。
        let second = ExternalAgentConnectionDescriptor {
            broker_address: "127.0.0.1:2".into(),
            capability_token: "b".into(),
            session_id: "s2".into(),
            ..first.clone()
        };
        let path2 = write_connection_descriptor(root.path(), &second).unwrap();
        assert_eq!(path, path2);
        let text = std::fs::read_to_string(&path2).unwrap();
        assert!(text.contains("127.0.0.1:2"));
    }

    #[test]
    fn connection_params_round_trip() {
        let root = tempfile::tempdir().unwrap();
        let params = ConnectionParams {
            schema_version: 1,
            project_id: "p1".into(),
            project_name: "画布".into(),
            tools: vec![],
            claude_code_project_dir: Some("/tmp/x".into()),
            write_claude_config: true,
            permission_mode: ExternalAgentPermissionMode::Manual,
        };
        write_connection_params(root.path(), &params).unwrap();
        let back = read_connection_params(root.path()).unwrap();
        assert_eq!(back.project_id, "p1");
        assert_eq!(back.claude_code_project_dir.as_deref(), Some("/tmp/x"));
    }

    #[test]
    fn read_connection_params_missing_or_broken_returns_none() {
        let root = tempfile::tempdir().unwrap();
        assert!(read_connection_params(root.path()).is_none());
        std::fs::write(root.path().join("connection-params.json"), "{not json").unwrap();
        assert!(read_connection_params(root.path()).is_none());
    }

    #[test]
    fn cleanup_removes_legacy_uuid_descriptors_only() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("canvas-mcp-abc.json"), "{}").unwrap();
        std::fs::write(root.path().join("canvas-mcp-current.json"), "{}").unwrap();
        std::fs::write(root.path().join("connection-params.json"), "{}").unwrap();
        cleanup_legacy_descriptors(root.path());
        assert!(!root.path().join("canvas-mcp-abc.json").exists());
        assert!(root.path().join("canvas-mcp-current.json").exists());
        assert!(root.path().join("connection-params.json").exists());
    }

    #[test]
    fn hypit_slug_is_deterministic_and_path_safe() {
        let slug = hypit_project_slug(
            "b9c96f36-e167-4d7d-9bbf-5dce6dd121d1",
            "AI4Animation 移植验收",
        );
        assert_eq!(slug, "AI4Animation-移植验收-b9c96f36");
        assert!(!slug.contains('/') && !slug.contains('\\') && !slug.contains(' '));
        // 同输入必同输出
        assert_eq!(
            slug,
            hypit_project_slug(
                "b9c96f36-e167-4d7d-9bbf-5dce6dd121d1",
                "AI4Animation 移植验收"
            )
        );
    }

    #[test]
    fn hypit_slug_handles_empty_and_symbol_only_names() {
        assert_eq!(
            hypit_project_slug("abcdef0123456789", ""),
            "project-abcdef01"
        );
        assert_eq!(
            hypit_project_slug("abcdef0123456789", "///:::"),
            "project-abcdef01"
        );
        assert_eq!(hypit_project_slug("ABCDEF01-2345", "  x  "), "x-ABCDEF01");
    }

    #[test]
    fn hypit_slug_truncates_long_names_by_chars_not_bytes() {
        let slug = hypit_project_slug("id", &"中".repeat(100));
        assert_eq!(slug.chars().count(), 32 + 1 + 2);
    }

    #[test]
    fn mcp_target_dirs_always_include_the_hypit_project() {
        let hypit = Path::new("/app/hypit-projects/p-abcdef01");
        assert_eq!(
            mcp_target_dirs(Some("/proj"), hypit),
            vec![
                "/proj".to_string(),
                "/app/hypit-projects/p-abcdef01".to_string()
            ],
        );
        // 空或未设置的 claudeCodeProjectDir 不影响视频工程目录
        for empty in [None, Some(""), Some("   ")] {
            assert_eq!(
                mcp_target_dirs(empty, hypit),
                vec!["/app/hypit-projects/p-abcdef01".to_string()],
            );
        }
    }

    #[test]
    fn hypit_project_dir_marks_the_project_and_is_reused() {
        let root = tempfile::tempdir().unwrap();
        let directory =
            prepare_hypit_project_dir(root.path(), "abcdef0123456789", "验收 项目").unwrap();
        assert_eq!(
            directory,
            root.path()
                .join("hypit-projects")
                .join("验收-项目-abcdef01")
        );

        let manifest = directory.join("package.json");
        let parsed: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
        assert_eq!(parsed["hypit"]["project"], true);

        // 重开画布时 hypit 自己写过 package.json 的内容不能被抹掉
        std::fs::write(&manifest, r#"{"name":"hypit-owned"}"#).unwrap();
        let again =
            prepare_hypit_project_dir(root.path(), "abcdef0123456789", "验收 项目").unwrap();
        assert_eq!(again, directory);
        assert_eq!(
            std::fs::read_to_string(&manifest).unwrap(),
            r#"{"name":"hypit-owned"}"#
        );
    }
    #[test]
    fn project_rename_reuses_original_hypit_directory() {
        let root = tempfile::tempdir().unwrap();
        let old = prepare_hypit_project_dir(root.path(), "abcdef01-2345", "旧名字").unwrap();
        std::fs::write(old.join("keep.txt"), "user work").unwrap();
        let renamed = prepare_hypit_project_dir(root.path(), "abcdef01-2345", "新名字").unwrap();
        assert_eq!(old, renamed);
        assert_eq!(
            std::fs::read_to_string(renamed.join("keep.txt")).unwrap(),
            "user work"
        );
    }
}
