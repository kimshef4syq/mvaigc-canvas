use std::env;
use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::io::{AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use uuid::Uuid;

use super::connection::ExternalAgentConnectionDescriptor;
use super::protocol::{
    mcp_tool_result, read_bounded_jsonl_line, read_bounded_jsonl_line_with_limit, sanitize_json,
};
use super::{
    emit_event, ExternalAgentCommandError, ExternalAgentEvent, ExternalAgentEventKind,
    ExternalAgentInner, ExternalAgentSession, ExternalAgentToolCall, ExternalAgentToolDefinition,
    PendingToolCall,
};

const MCP_MODE_ARGUMENT: &str = "--external-agent-mcp";
// MCP text fallback and structuredContent can contain two copies of a bounded tool result.
// Keep request/Agent stdout limits unchanged; only the local broker response uses this bound.
const MAX_BROKER_RESPONSE_BYTES: usize = 1024 * 1024;
const TOOL_RESOLUTION_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub(crate) fn bind_broker_listener() -> Result<(StdTcpListener, SocketAddr), String> {
    let listener = StdTcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("failed to bind loopback broker: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("failed to configure loopback broker: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("failed to read loopback broker address: {error}"))?;
    if !address.ip().is_loopback() {
        return Err("external Agent broker must bind to loopback".to_string());
    }
    Ok((listener, address))
}

fn into_async_listener(listener: StdTcpListener) -> Result<TcpListener, String> {
    // `setup` is synchronous and macOS runs it on the AppKit thread. Enter the
    // application runtime while Tokio registers the listener, without nesting
    // a second executor through `block_on` on platforms that already entered it.
    let runtime = tauri::async_runtime::handle();
    let _runtime_guard = runtime.inner().enter();
    TcpListener::from_std(listener)
        .map_err(|error| format!("failed to start loopback broker: {error}"))
}

pub(crate) fn start_broker_listener(
    inner: Arc<ExternalAgentInner>,
    app: AppHandle,
) -> Result<(), String> {
    let listener = inner
        .broker_listener
        .lock()
        .map_err(|_| "external Agent broker lock is poisoned".to_string())?
        .take()
        .ok_or_else(|| {
            if inner
                .broker_started
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                "external Agent broker is already running".to_string()
            } else {
                inner
                    .broker_initialization_error
                    .clone()
                    .unwrap_or_else(|| "external Agent broker is unavailable".to_string())
            }
        })?;
    let listener = into_async_listener(listener)?;
    inner
        .broker_started
        .store(true, std::sync::atomic::Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, peer)) = listener.accept().await else {
                break;
            };
            if !peer.ip().is_loopback() {
                continue;
            }
            let inner = inner.clone();
            let app = app.clone();
            tokio::spawn(async move {
                if let Err(error) = handle_broker_connection(stream, inner, app).await {
                    tracing::warn!(code = %error.code, "Canvas MCP broker connection failed");
                }
            });
        }
    });
    Ok(())
}

fn constant_time_equal(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.as_bytes()
        .iter()
        .zip(right.as_bytes())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn capability_request_is_valid(
    expected_session_id: &str,
    requested_session_id: &str,
    expected_token: &str,
    requested_token: &str,
    cancelled: bool,
    expires_at: u64,
    now: u64,
) -> bool {
    !cancelled
        && now < expires_at
        && constant_time_equal(expected_session_id, requested_session_id)
        && constant_time_equal(expected_token, requested_token)
}

fn pending_tool_event(
    session: &ExternalAgentSession,
    turn_id: Option<String>,
    call_id: String,
    tool: ExternalAgentToolDefinition,
    input: Value,
) -> ExternalAgentEvent {
    ExternalAgentEvent::new(session, ExternalAgentEventKind::ToolRequested, turn_id).with_tool_call(
        ExternalAgentToolCall {
            call_id,
            name: tool.name,
            input,
            // The host resolves calls according to its connection policy, never client hints.
            requires_approval: true,
        },
    )
}

async fn authorized_session(
    inner: &Arc<ExternalAgentInner>,
    session_id: &str,
    token: &str,
) -> Option<Arc<ExternalAgentSession>> {
    let sessions = inner.sessions.read().await;
    let session = sessions.get(session_id)?.clone();
    if !capability_request_is_valid(
        &session.id,
        session_id,
        &session.capability_token,
        token,
        session.cancelled.load(std::sync::atomic::Ordering::SeqCst),
        session.capability_expires_at,
        super::now_millis(),
    ) {
        return None;
    }
    Some(session)
}

fn normalize_tool_input(name: &str, mut input: Value) -> Value {
    if name == "canvas_command" && input.get("type").and_then(Value::as_str) == Some("canvas.query")
    {
        if let Some(args) = input.get_mut("input").and_then(Value::as_object_mut) {
            args.entry("scope").or_insert_with(|| json!("graph"));
            let detail = if args.contains_key("fields") {
                "full"
            } else {
                "summary"
            };
            args.entry("detail").or_insert_with(|| json!(detail));
            args.entry("limit").or_insert_with(|| json!(20));
        }
    }
    input
}

/// `assets_import`'s whole job is to hand a finished local file to the canvas, so
/// its `files[].path` values must survive input redaction — which rewrites every
/// absolute path to `[local path omitted]`. The paths are captured from the RAW
/// input, the whole input is redacted, then only the paths are put back. Every
/// other field stays redacted. The paths are validated on the canvas side
/// (absolute, exists, regular file, size limit) before any file or node is produced.
fn sanitize_tool_input(name: &str, raw: &Value) -> Result<Value, ExternalAgentCommandError> {
    let paths = if name == "assets_import" {
        raw.get("files")
            .and_then(Value::as_array)
            .map(|files| {
                files
                    .iter()
                    .map(|file| file.get("path").cloned().unwrap_or(Value::Null))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let mut input = normalize_tool_input(name, sanitize_json(raw)?);
    if let Some(files) = input.get_mut("files").and_then(Value::as_array_mut) {
        for (file, path) in files.iter_mut().zip(paths) {
            if let Some(target) = file.get_mut("path") {
                *target = path;
            }
        }
    }
    Ok(input)
}

async fn write_broker_response<W: AsyncWrite + Unpin>(
    writer: &mut W,
    response: Value,
) -> Result<(), ExternalAgentCommandError> {
    let mut encoded = serde_json::to_vec(&response)
        .map_err(|_| ExternalAgentCommandError::protocol("Failed to encode broker response."))?;
    if encoded.len() + 1 > MAX_BROKER_RESPONSE_BYTES {
        encoded = serde_json::to_vec(&json!({"ok": false, "error": {
            "code": "result_too_large",
            "message": "Canvas result exceeds the broker response limit. Query detail=summary with limit=20, follow output.page.nextInput, or narrow nodeIds/fields. The broker connection is healthy."
        }})).map_err(|_| ExternalAgentCommandError::protocol("Failed to encode broker error."))?;
    }
    writer
        .write_all(&encoded)
        .await
        .map_err(|error| ExternalAgentCommandError::protocol(error.to_string()))?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|error| ExternalAgentCommandError::protocol(error.to_string()))?;
    writer
        .flush()
        .await
        .map_err(|error| ExternalAgentCommandError::protocol(error.to_string()))
}

pub(crate) async fn handle_broker_connection(
    stream: TcpStream,
    inner: Arc<ExternalAgentInner>,
    app: AppHandle,
) -> Result<(), ExternalAgentCommandError> {
    let mut reader = BufReader::new(stream);
    let line = match read_bounded_jsonl_line(&mut reader).await {
        Ok(Some(line)) => line,
        Ok(None) => return Ok(()),
        Err(_) => return write_broker_response(reader.get_mut(), json!({"ok": false,
            "error": {"code": "invalid_request", "message": "Malformed or oversized Canvas broker request."}})).await,
    };
    let request: Value = match serde_json::from_slice(&line) {
        Ok(value) => value,
        Err(_) => {
            return write_broker_response(
                reader.get_mut(),
                json!({"ok": false,
            "error": {"code": "invalid_request", "message": "Malformed Canvas broker JSON."}}),
            )
            .await
        }
    };
    let session_id = request
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let token = request
        .get("token")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(session) = authorized_session(&inner, session_id, token).await else {
        let response = json!({"ok": false, "error": {"code": "invalid_capability", "message": "The Canvas capability is invalid or expired."}});
        reader
            .get_mut()
            .write_all(format!("{response}\n").as_bytes())
            .await
            .map_err(|error| ExternalAgentCommandError::protocol(error.to_string()))?;
        return Ok(());
    };
    let activity_at = super::now_millis();
    session
        .connected_at
        .compare_exchange(
            0,
            activity_at,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .ok();
    session
        .last_activity_at
        .store(activity_at, std::sync::atomic::Ordering::SeqCst);

    let action = request
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let response = match action {
        "ping" => {
            json!({"ok": true, "result": {"projectId": session.project_id, "expiresAt": session.capability_expires_at}})
        }
        "listTools" => {
            let mut tools = session.tools.values().cloned().collect::<Vec<_>>();
            tools.sort_by(|left, right| left.name.cmp(&right.name));
            json!({"ok": true, "result": {"tools": tools}})
        }
        "callTool" => {
            let name = request
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if let Some(tool) = session.tools.get(name).cloned() {
                session
                    .call_count
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let input = match sanitize_tool_input(name, request.get("input").unwrap_or(&Value::Null)) {
                    Ok(input) => input,
                    Err(_) => return write_broker_response(reader.get_mut(), json!({"ok": false,
                        "error": {"code": "invalid_arguments", "message": "Canvas tool arguments exceed the supported depth or collection size."}})).await,
                };
                let call_id = Uuid::new_v4().to_string();
                let (sender, receiver) = oneshot::channel();
                let event = pending_tool_event(
                    &session,
                    session.active_turn_id.read().await.clone(),
                    call_id.clone(),
                    tool,
                    input,
                );
                inner.pending_tools.lock().await.insert(
                    call_id.clone(),
                    PendingToolCall {
                        session_id: session.id.clone(),
                        sender,
                        event: event.clone(),
                    },
                );
                emit_event(&app, event);
                match tokio::time::timeout(TOOL_RESOLUTION_TIMEOUT, receiver).await {
                    Ok(Ok(resolution)) => {
                        json!({"ok": true, "result": mcp_tool_result(resolution)})
                    }
                    Ok(Err(_)) => {
                        json!({"ok": false, "error": {"code": "session_closed", "message": "The Canvas session closed before the tool call was resolved."}})
                    }
                    Err(_) => {
                        inner.pending_tools.lock().await.remove(&call_id);
                        json!({"ok": false, "error": {"code": "approval_timeout", "message": "The Canvas approval timed out."}})
                    }
                }
            } else {
                json!({"ok": false, "error": {"code": "tool_not_allowed", "message": "The requested tool is not in this session's Canvas manifest."}})
            }
        }
        _ => {
            json!({"ok": false, "error": {"code": "unsupported_action", "message": "Unsupported Canvas broker action."}})
        }
    };
    write_broker_response(reader.get_mut(), response).await
}

async fn broker_request(
    credentials: &ChildBrokerCredentials,
    action: Value,
) -> Result<Value, String> {
    let address: SocketAddr = credentials
        .address
        .parse()
        .map_err(|_| "invalid broker address".to_string())?;
    if !address.ip().is_loopback() {
        return Err("broker address is not loopback".to_string());
    }
    let mut stream = TcpStream::connect(address)
        .await
        .map_err(|error| format!("broker connection failed: {error}"))?;
    let mut request = action;
    request["token"] = Value::String(credentials.token.clone());
    request["sessionId"] = Value::String(credentials.session_id.clone());
    let encoded = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    stream
        .write_all(&encoded)
        .await
        .map_err(|error| error.to_string())?;
    stream
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(stream);
    let line = read_bounded_jsonl_line_with_limit(&mut reader, MAX_BROKER_RESPONSE_BYTES)
        .await
        .map_err(|error| error.message)?
        .ok_or_else(|| "Canvas broker disconnected before returning a result. Reconnect the canvas MCP; do not automatically retry write or generation operations.".to_string())?;
    let response: Value = serde_json::from_slice(&line).map_err(|error| error.to_string())?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        let message = response
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("Canvas broker rejected the request.");
        let code = response
            .pointer("/error/code")
            .and_then(Value::as_str)
            .unwrap_or("broker_error");
        return Err(format!("{code}: {message}"));
    }
    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

#[derive(Clone)]
struct ChildBrokerCredentials {
    address: String,
    token: String,
    session_id: String,
}

impl ChildBrokerCredentials {
    fn from_env() -> Result<Self, String> {
        let value = |name: &str| {
            env::var(name)
                .ok()
                .filter(|item| !item.trim().is_empty())
                .ok_or_else(|| format!("missing required {name} environment value"))
        };
        Ok(Self {
            address: value("STORYBOARD_EXTERNAL_AGENT_BROKER")?,
            token: value("STORYBOARD_EXTERNAL_AGENT_TOKEN")?,
            session_id: value("STORYBOARD_EXTERNAL_AGENT_SESSION")?,
        })
    }

    fn from_descriptor(path: &std::path::Path) -> Result<Self, String> {
        let metadata = std::fs::symlink_metadata(path)
            .map_err(|_| "Canvas MCP connection descriptor is unavailable".to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("Canvas MCP connection descriptor must be a regular file".to_string());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(
                    "Canvas MCP connection descriptor permissions are too broad".to_string()
                );
            }
        }
        if metadata.len() > 16 * 1024 {
            return Err("Canvas MCP connection descriptor is too large".to_string());
        }
        let bytes = std::fs::read(path)
            .map_err(|_| "Canvas MCP connection descriptor cannot be read".to_string())?;
        let descriptor: ExternalAgentConnectionDescriptor = serde_json::from_slice(&bytes)
            .map_err(|_| "Canvas MCP connection descriptor is malformed".to_string())?;
        if descriptor.schema_version != 1 {
            return Err("Canvas MCP connection descriptor version is unsupported".to_string());
        }
        if super::now_millis() >= descriptor.expires_at {
            return Err("Canvas MCP connection descriptor has expired".to_string());
        }
        let address: SocketAddr = descriptor
            .broker_address
            .parse()
            .map_err(|_| "Canvas MCP connection descriptor address is invalid".to_string())?;
        if !address.ip().is_loopback() {
            return Err("Canvas MCP connection descriptor address is not loopback".to_string());
        }
        Ok(Self {
            address: descriptor.broker_address,
            token: descriptor.capability_token,
            session_id: descriptor.session_id,
        })
    }
}

fn jsonrpc_response(id: Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn jsonrpc_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message.into()}})
}

async fn run_mcp_stdio(credentials: ChildBrokerCredentials) -> Result<(), String> {
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut stdout = tokio::io::stdout();
    while let Some(line) = read_bounded_jsonl_line(&mut reader)
        .await
        .map_err(|error| error.message)?
    {
        if line.is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_slice(&line) {
            Ok(value) => value,
            Err(_) => {
                let response = jsonrpc_error(Value::Null, -32700, "Parse error");
                stdout
                    .write_all(format!("{response}\n").as_bytes())
                    .await
                    .map_err(|error| error.to_string())?;
                continue;
            }
        };
        let id = request.get("id").cloned();
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let response = match method {
            "initialize" => id.map(|id| {
                let protocol_version = request
                    .pointer("/params/protocolVersion")
                    .and_then(Value::as_str)
                    .unwrap_or("2025-06-18");
                jsonrpc_response(
                    id,
                    json!({
                        "protocolVersion": protocol_version,
                        "capabilities": {"tools": {"listChanged": false}},
                        "serverInfo": {"name": "storyboard-canvas", "version": "1.0.0"}
                    }),
                )
            }),
            "notifications/initialized" | "notifications/cancelled" => None,
            "ping" => match broker_request(&credentials, json!({"action": "ping"})).await {
                Ok(_) => id.map(|id| jsonrpc_response(id, json!({}))),
                Err(error) => id.map(|id| jsonrpc_error(id, -32001, error)),
            },
            "tools/list" => {
                match broker_request(&credentials, json!({"action": "listTools"})).await {
                    Ok(result) => id.map(|id| jsonrpc_response(id, result)),
                    Err(error) => id.map(|id| jsonrpc_error(id, -32001, error)),
                }
            }
            "tools/call" => {
                let name = request
                    .pointer("/params/name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let arguments = request
                    .pointer("/params/arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                match broker_request(
                    &credentials,
                    json!({"action": "callTool", "name": name, "input": arguments}),
                )
                .await
                {
                    Ok(result) => id.map(|id| jsonrpc_response(id, result)),
                    Err(error) => id.map(|id| jsonrpc_error(id, -32002, error)),
                }
            }
            _ => id.map(|id| jsonrpc_error(id, -32601, "Method not found")),
        };
        if let Some(response) = response {
            stdout
                .write_all(format!("{response}\n").as_bytes())
                .await
                .map_err(|error| error.to_string())?;
            stdout.flush().await.map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub fn is_external_agent_mcp_mode() -> bool {
    env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new(MCP_MODE_ARGUMENT))
}

pub fn run_external_agent_mcp_mode() -> Result<(), String> {
    let credentials = match env::args_os().nth(2) {
        Some(path) => ChildBrokerCredentials::from_descriptor(std::path::Path::new(&path))?,
        None => ChildBrokerCredentials::from_env()?,
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("failed to initialize MCP runtime: {error}"))?;
    runtime.block_on(run_mcp_stdio(credentials))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn managed_test_session() -> ExternalAgentSession {
        let workspace = tempfile::tempdir().unwrap();
        ExternalAgentSession {
            id: "connection-a".to_string(),
            runtime: super::super::ExternalAgentRuntime::Codex,
            capability_token: "token".to_string(),
            capability_expires_at: u64::MAX,
            broker: super::super::BrokerCredentials {
                address: "127.0.0.1:1234".to_string(),
                token: "token".to_string(),
                session_id: "connection-a".to_string(),
            },
            target: super::super::process::LaunchTarget::from_direct_for_test(
                std::path::PathBuf::from("canvas"),
                super::super::ExternalAgentRuntime::Codex,
            ),
            workspace: std::sync::Mutex::new(Some(super::super::SessionWorkspace::Temporary(
                workspace,
            ))),
            tools: std::collections::HashMap::new(),
            provider_session_id: tokio::sync::RwLock::new(None),
            model: None,
            created_at: 1,
            cancelled: std::sync::atomic::AtomicBool::new(false),
            active_turn_id: tokio::sync::RwLock::new(Some("managed-connection-a".to_string())),
            active_process: tokio::sync::Mutex::new(None),
            codex_stdin: tokio::sync::Mutex::new(None),
            next_rpc_id: std::sync::atomic::AtomicU64::new(1),
            pending_rpc: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            claude_has_history: std::sync::atomic::AtomicBool::new(false),
            turn_gate: tokio::sync::Mutex::new(()),
            turn_workspaces: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            user_managed: true,
            permission_mode: std::sync::atomic::AtomicU8::new(0),
            project_id: Some("project-a".to_string()),
            project_name: Some("Project A".to_string()),
            hypit_project_dir: None,
            descriptor_path: None,
            connected_at: std::sync::atomic::AtomicU64::new(0),
            last_activity_at: std::sync::atomic::AtomicU64::new(0),
            call_count: std::sync::atomic::AtomicU64::new(0),
        }
    }

    #[test]
    fn capability_comparison_is_exact() {
        assert!(constant_time_equal("abcdef", "abcdef"));
        assert!(!constant_time_equal("abcdef", "abcdeg"));
        assert!(!constant_time_equal("abcdef", "abc"));
    }

    #[test]
    fn descriptor_credentials_reject_broad_permissions_and_expiry() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("connection.json");
        let write = |expires_at| {
            std::fs::write(
                &path,
                serde_json::to_vec(&ExternalAgentConnectionDescriptor {
                    schema_version: 1,
                    broker_address: "127.0.0.1:1234".to_string(),
                    capability_token: "secret".to_string(),
                    session_id: "session-a".to_string(),
                    expires_at,
                })
                .unwrap(),
            )
            .unwrap();
        };
        write(super::super::now_millis().saturating_add(60_000));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert!(ChildBrokerCredentials::from_descriptor(&path).is_err());
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        assert_eq!(
            ChildBrokerCredentials::from_descriptor(&path)
                .unwrap()
                .session_id,
            "session-a"
        );
        write(super::super::now_millis().saturating_sub(1));
        assert!(ChildBrokerCredentials::from_descriptor(&path).is_err());
    }

    #[test]
    fn managed_tool_request_has_stable_turn_and_forces_manual_approval() {
        let session = managed_test_session();
        let event = pending_tool_event(
            &session,
            Some("managed-connection-a".to_string()),
            "call-a".to_string(),
            ExternalAgentToolDefinition {
                name: "canvas_command".to_string(),
                description: "Canvas only".to_string(),
                input_schema: json!({"type": "object"}),
                requires_approval: false,
            },
            json!({"type": "canvas.query", "input": {}}),
        );
        assert_eq!(event.turn_id.as_deref(), Some("managed-connection-a"));
        let tool_call = event.tool_call.unwrap();
        assert_eq!(tool_call.call_id, "call-a");
        assert!(tool_call.requires_approval);
    }

    #[test]
    fn capability_requires_exact_session_token_and_unexpired_active_state() {
        assert!(capability_request_is_valid(
            "session-a",
            "session-a",
            "token-a",
            "token-a",
            false,
            101,
            100,
        ));
        assert!(!capability_request_is_valid(
            "session-a",
            "session-b",
            "token-a",
            "token-a",
            false,
            101,
            100,
        ));
        assert!(!capability_request_is_valid(
            "session-a",
            "session-a",
            "token-a",
            "token-b",
            false,
            101,
            100,
        ));
        assert!(!capability_request_is_valid(
            "session-a",
            "session-a",
            "token-a",
            "token-a",
            false,
            100,
            100,
        ));
        assert!(!capability_request_is_valid(
            "session-a",
            "session-a",
            "token-a",
            "token-a",
            true,
            101,
            100,
        ));
    }

    #[test]
    fn loopback_ephemeral_binding_avoids_occupied_ports() {
        let occupied = StdTcpListener::bind("127.0.0.1:0").unwrap();
        let occupied_address = occupied.local_addr().unwrap();
        let (first, first_address) = bind_broker_listener().unwrap();
        let (second, second_address) = bind_broker_listener().unwrap();

        assert_eq!(first_address.ip(), std::net::Ipv4Addr::LOCALHOST);
        assert_eq!(second_address.ip(), std::net::Ipv4Addr::LOCALHOST);
        assert_ne!(first_address.port(), 0);
        assert_ne!(second_address.port(), 0);
        assert_ne!(first_address, occupied_address);
        assert_ne!(second_address, occupied_address);
        assert_ne!(first_address, second_address);

        drop((occupied, first, second));
    }

    #[test]
    fn std_listener_conversion_is_safe_without_a_caller_runtime() {
        let (listener, address) = bind_broker_listener().expect("bind broker");
        let converted = into_async_listener(listener).expect("convert broker listener");
        assert_eq!(converted.local_addr().expect("listener address"), address);
    }
    #[test]
    fn assets_import_file_paths_survive_input_sanitising() {
        let input = json!({
            "files": [
                {"path": "/Users/me/renders/scene-01.mp4", "kind": "video"},
                {"path": "/Users/me/renders/still.png", "kind": "image", "title": "第一场"},
            ],
            "anchor": {"nodeId": "node-1"},
        });
        let sanitized = sanitize_tool_input("assets_import", &input).unwrap();
        assert_eq!(
            sanitized["files"][0]["path"], "/Users/me/renders/scene-01.mp4",
            "assets_import must receive the real path, not a redacted placeholder"
        );
        assert_eq!(sanitized["files"][1]["path"], "/Users/me/renders/still.png");
        assert_eq!(sanitized["files"][1]["title"], "第一场");
    }

    #[test]
    fn other_tools_still_have_paths_redacted() {
        let input = json!({"operation": "health", "note": "/Users/me/secret/report.json"});
        let sanitized = sanitize_tool_input("diagnostics", &input).unwrap();
        assert_eq!(sanitized["note"], "[local path omitted]");
    }
}
