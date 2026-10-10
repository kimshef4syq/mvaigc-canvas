use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, State};
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
const CONNECTION_DESCRIPTOR_FILE: &str = "canvas-mcp-current.json";
const CONNECTION_PARAMS_FILE: &str = "connection-params.json";
const LEGACY_DESCRIPTOR_PREFIX: &str = "canvas-mcp-";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateExternalAgentConnectionRequest {
    pub project_id: String,
    pub project_name: String,
    #[serde(default)]
    pub tools: Vec<ExternalAgentToolDefinition>,
    #[serde(default)]
    pub claude_code_project_dir: Option<String>,
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
    pub permission_mode: &'static str,
    pub created_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub connected_at: Option<u64>,
    pub last_activity_at: Option<u64>,
    pub call_count: u64,
    pub descriptor_path: Option<String>,
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
        permission_mode: "manual",
        created_at: None,
        expires_at: None,
        connected_at: None,
        last_activity_at: None,
        call_count: 0,
        descriptor_path: None,
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
        permission_mode: "manual",
        created_at: Some(session.created_at),
        expires_at: Some(session.capability_expires_at),
        connected_at: (connected_at > 0).then_some(connected_at),
        last_activity_at: (last_activity_at > 0).then_some(last_activity_at),
        call_count: session.call_count.load(Ordering::SeqCst),
        descriptor_path: Some(descriptor_path.to_string_lossy().into_owned()),
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
        project_id: Some(project_id.clone()),
        project_name: Some(project_name.clone()),
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
    };
    let _ = write_connection_params(&descriptor_root, &params);
    if let Some(dir) = claude_code_project_dir.as_deref().filter(|d| !d.trim().is_empty()) {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            let executable = std::env::current_exe()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let args = vec![
                "--external-agent-mcp".to_string(),
                descriptor_path.to_string_lossy().into_owned(),
            ];
            if let Err(error) = super::claude_config::write_local_mcp_server(
                &home.join(".claude.json"),
                dir,
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
}
