//! mvaigc reverse proxy: exposes mvaigc.cn's private API as a local
//! standardized HTTP service consumed by OSC's custom-provider mechanism.
//!
//! Endpoints (all bound to 127.0.0.1):
//!   GET  /v1/models               → OpenAI-shaped model list (image + video)
//!   POST /v1/images/generations   → submit image task  → {id,status}
//!   POST /v1/videos               → submit video task  → {id,status}
//!   GET  /v1/tasks/{id}           → poll a task        → {id,status,output}
//!
//! Auth: `Authorization: Bearer <account>:<password>`. Falls back to the
//! account/password held in `ProxyState` when the header is absent, so OSC's
//! own requests (which read credentials from settings) work either way.

pub mod client;
pub mod mapping;

/// Default local port the proxy listens on.
pub const DEFAULT_PORT: u16 = 8787;

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tracing::{info, warn};

use client::{is_auth_error, MvaigcClient, TaskState};
use mapping::{decode_task_id, encode_task_id, map_image_request, map_video_request};

/// Shared proxy state: the mvaigc client plus the credentials configured via
/// the OSC settings panel (used when a request carries no Authorization).
pub struct ProxyState {
    client: MvaigcClient,
    credentials: RwLock<Option<(String, String)>>,
    reserved: std::sync::Mutex<Option<u16>>,
}

impl Default for ProxyState {
    fn default() -> Self {
        Self::new()
    }
}

impl ProxyState {
    pub fn new() -> Self {
        Self {
            client: MvaigcClient::new(),
            credentials: RwLock::new(None),
            reserved: std::sync::Mutex::new(None),
        }
    }

    pub async fn set_credentials(&self, account: String, password: String) {
        *self.credentials.write().await = Some((account, password));
    }

    async fn stored_credentials(&self) -> Option<(String, String)> {
        self.credentials.read().await.clone()
    }

    /// Reserve a port for the proxy. Returns `Ok(true)` if this call took the
    /// port (startup should follow), `Ok(false)` if that port is already
    /// reserved by us, and `Err` if the port is busy or otherwise unusable.
    pub fn try_reserve(&self, port: u16) -> Result<bool, String> {
        let mut reserved = self.reserved.lock().expect("reserve lock poisoned");
        if *reserved == Some(port) {
            return Ok(false);
        }
        bind_check(port)?;
        *reserved = Some(port);
        Ok(true)
    }

    pub fn is_running(&self) -> bool {
        self.reserved
            .lock()
            .expect("reserve lock poisoned")
            .is_some()
    }

    pub fn port(&self) -> Option<u16> {
        *self.reserved.lock().expect("reserve lock poisoned")
    }
}

/// The Tauri-managed proxy handle.
pub struct MvaigcProxyState {
    pub state: SharedState,
}

impl Default for MvaigcProxyState {
    fn default() -> Self {
        Self {
            state: Arc::new(ProxyState::new()),
        }
    }
}

/// Start the proxy on `port` if not already running. Returns `Ok(true)` when a
/// server was spawned, `Ok(false)` when that port is already running. Errors
/// are reported to the caller; startup callers should log and continue.
pub fn ensure_started(state: &SharedState, port: u16) -> Result<bool, String> {
    if state.try_reserve(port)? {
        let state = state.clone();
        tauri::async_runtime::spawn(async move {
            run_proxy(port, state).await;
        });
        return Ok(true);
    }
    Ok(false)
}

type SharedState = Arc<ProxyState>;

/// Pull `account`/`password` from the `Authorization: Bearer account:password`
/// header, falling back to the state's stored credentials.
async fn resolve_credentials(
    state: &SharedState,
    headers: &HeaderMap,
) -> Result<(String, String), Response> {
    if let Some(raw) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    {
        let token = raw.trim().strip_prefix("Bearer ").unwrap_or(raw.trim());
        if let Some((account, password)) = token.split_once(':') {
            if !account.is_empty() && !password.is_empty() {
                return Ok((account.to_string(), password.to_string()));
            }
        }
    }
    state.stored_credentials().await.ok_or_else(|| {
        error_response(
            StatusCode::UNAUTHORIZED,
            "缺少账号密码（Authorization: Bearer <账号>:<密码>）",
        )
    })
}

/// Build an error response in the `{"error":{"message":...}}` shape.
fn error_response(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": { "message": message.into() } }))).into_response()
}

/// Run `op` with a valid token; on an auth error, drop the cached token,
/// re-login once, and retry once.
async fn with_token<T, F, Fut>(
    state: &SharedState,
    account: &str,
    password: &str,
    op: F,
) -> Result<T, String>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let token = state
        .client
        .ensure_token(account, password)
        .await
        .map_err(|err| err.to_string())?;
    match op(token).await {
        Ok(value) => Ok(value),
        Err(err) if is_auth_error(&err) => {
            state.client.forget_token(account);
            let token = state
                .client
                .ensure_token(account, password)
                .await
                .map_err(|err| err.to_string())?;
            op(token).await
        }
        Err(err) => Err(err),
    }
}

/// `GET /v1/models` — aggregate image and video models into OpenAI's shape.
async fn list_models(State(state): State<SharedState>, headers: HeaderMap) -> Response {
    let (account, password) = match resolve_credentials(&state, &headers).await {
        Ok(pair) => pair,
        Err(response) => return response,
    };
    let result = with_token(&state, &account, &password, |token| {
        let state = state.clone();
        async move {
            let image = state
                .client
                .list_image_models(token.clone())
                .await
                .map_err(|err| err.to_string())?;
            let video = state
                .client
                .list_video_models(token, "reference2video")
                .await
                .map_err(|err| err.to_string())?;
            Ok((image, video))
        }
    })
    .await;
    let (image, video) = match result {
        Ok(pair) => pair,
        Err(err) => return error_response(StatusCode::BAD_GATEWAY, err),
    };
    let mut models = Vec::new();
    if let Some(map) = image.get("model").and_then(Value::as_object) {
        for key in map.keys() {
            models.push(json!({"id": key, "object": "model", "owned_by": "mvaigc", "media": "image"}));
        }
    }
    if let Some(list) = video.as_array() {
        for entry in list {
            if let Some(name) = entry.get("api_name").and_then(Value::as_str) {
                models.push(json!({"id": name, "object": "model", "owned_by": "mvaigc", "media": "video"}));
            }
        }
    }
    Json(json!({"object": "list", "data": models})).into_response()
}

/// `POST /v1/images/generations` — submit an image task.
async fn image_generations(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let (account, password) = match resolve_credentials(&state, &headers).await {
        Ok(pair) => pair,
        Err(response) => return response,
    };
    let model = body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let model_name = body
        .get("modelName")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| model.clone());
    let payload = map_image_request(&body, &model_name);
    let result = with_token(&state, &account, &password, |token| {
        let state = state.clone();
        let payload = payload.clone();
        async move {
            state
                .client
                .submit_image(token, payload)
                .await
                .map_err(|err| err.to_string())
        }
    })
    .await;
    match result {
        Ok(submit) => Json(json!({
            "id": encode_task_id(&submit.oper_type, &submit.oper_id),
            "status": "processing",
        }))
        .into_response(),
        Err(err) => error_response(StatusCode::BAD_GATEWAY, err),
    }
}

/// `POST /v1/videos` — submit a video task.
async fn video_generations(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let (account, password) = match resolve_credentials(&state, &headers).await {
        Ok(pair) => pair,
        Err(response) => return response,
    };
    let model = body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let api_name = body
        .get("apiName")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| model.clone());
    // Start/end-frame mode is requested via `frames: true`.
    let frames = body.get("frames").and_then(Value::as_bool).unwrap_or(false);
    let payload = map_video_request(&body, &api_name);
    let result = with_token(&state, &account, &password, |token| {
        let state = state.clone();
        let payload = payload.clone();
        async move {
            state
                .client
                .submit_video(token, payload, frames)
                .await
                .map_err(|err| err.to_string())
        }
    })
    .await;
    match result {
        Ok(submit) => Json(json!({
            "id": encode_task_id(&submit.oper_type, &submit.oper_id),
            "status": "processing",
        }))
        .into_response(),
        Err(err) => error_response(StatusCode::BAD_GATEWAY, err),
    }
}

/// `GET /v1/tasks/{id}` — poll one task.
async fn task_status(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let (oper_type, oper_id) = match decode_task_id(&id) {
        Some(pair) => pair,
        None => return error_response(StatusCode::BAD_REQUEST, format!("无效的任务号: {id}")),
    };
    let (account, password) = match resolve_credentials(&state, &headers).await {
        Ok(pair) => pair,
        Err(response) => return response,
    };
    let result = with_token(&state, &account, &password, |token| {
        let state = state.clone();
        let oper_type = oper_type.clone();
        let oper_id = oper_id.clone();
        async move {
            state
                .client
                .poll_task(token, &oper_type, &oper_id)
                .await
                .map_err(|err| err.to_string())
        }
    })
    .await;
    match result {
        Ok(TaskState::Running) => Json(json!({"id": id, "status": "processing"})).into_response(),
        Ok(TaskState::Succeeded(urls)) => {
            let output: Vec<Value> = urls.iter().map(|url| json!({"url": url})).collect();
            Json(json!({"id": id, "status": "succeeded", "output": output})).into_response()
        }
        Ok(TaskState::Failed(message)) => Json(json!({
            "id": id,
            "status": "failed",
            "error": {"message": message},
        }))
        .into_response(),
        Err(err) => error_response(StatusCode::BAD_GATEWAY, err),
    }
}

/// Build the proxy router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/v1/models", get(list_models))
        .route("/v1/images/generations", post(image_generations))
        .route("/v1/videos", post(video_generations))
        .route("/v1/tasks/{id}", get(task_status))
        .with_state(state)
}

/// Probe whether `127.0.0.1:port` can be bound. Releases the probe
/// immediately; used to skip startup without blocking OSC when the port
/// is already taken.
pub fn bind_check(port: u16) -> Result<(), String> {
    std::net::TcpListener::bind(("127.0.0.1", port))
        .map(|_| ())
        .map_err(|err| format!("端口 {port} 不可用: {err}"))
}

/// Run the proxy until the process exits. Logs a warning and returns if the
/// port is already in use, so OSC startup is never blocked.
pub async fn run_proxy(port: u16, state: SharedState) {
    let listener = match TcpListener::bind(("127.0.0.1", port)).await {
        Ok(listener) => listener,
        Err(err) => {
            warn!("mvaigc 反代无法监听 127.0.0.1:{port}: {err}（已跳过）");
            return;
        }
    };
    info!("mvaigc 反代已监听 127.0.0.1:{port}");
    if let Err(err) = axum::serve(listener, router(state)).await {
        warn!("mvaigc 反代服务退出: {err}");
    }
}

/// Tauri command: store credentials and ensure the proxy is listening.
/// Called by the OSC settings panel when the user saves account/password.
#[tauri::command]
pub async fn mvaigc_set_credentials(
    state: tauri::State<'_, MvaigcProxyState>,
    account: String,
    password: String,
    port: u16,
) -> Result<String, String> {
    state
        .state
        .set_credentials(account, password)
        .await;
    match ensure_started(&state.state, port) {
        Ok(_) => Ok(format!("running:{port}")),
        Err(err) => Err(err),
    }
}

/// Tauri command: report the proxy status.
#[tauri::command]
pub fn mvaigc_proxy_status(state: tauri::State<'_, MvaigcProxyState>) -> String {
    match state.state.port() {
        Some(port) => format!("running:{port}"),
        None => "stopped".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn occupied_port_does_not_panic() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // The probe port is held by `listener`, so bind_check must report Err.
        assert!(bind_check(port).is_err());
    }

    #[test]
    fn free_port_binds() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert!(bind_check(port).is_ok());
    }

    #[test]
    fn reserve_reports_busy_and_is_idempotent() {
        let state = ProxyState::new();
        let held = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let busy = held.local_addr().unwrap().port();
        assert!(state.try_reserve(busy).is_err());
        assert!(!state.is_running());
        let free = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        assert!(state.try_reserve(free).unwrap());
        assert!(state.is_running());
        assert_eq!(state.port(), Some(free));
        assert!(!state.try_reserve(free).unwrap());
    }

    /// Live smoke test (ignored by default). Exercises the full chain:
    /// axum route → login → mvaigc getImgModel → JSON back. Read-only on the
    /// proxy side, but it DOES log in to mvaigc with the account below.
    /// Run: MVAIGC_SMOKE_AUTH='account:password' cargo test smoke_models -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn smoke_models() {
        let auth = std::env::var("MVAIGC_SMOKE_AUTH").expect("set MVAIGC_SMOKE_AUTH");
        let (account, password) = auth.split_once(':').expect("account:password");
        let state = Arc::new(ProxyState::new());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router(state)).await.ok();
        });
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let response = reqwest::Client::new()
            .get(format!("http://{addr}/v1/models"))
            .header("Authorization", format!("Bearer {account}:{password}"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let body: Value = response.json().await.unwrap();
        let count = body["data"].as_array().map(|list| list.len()).unwrap_or(0);
        println!("smoke_models → {count} models");
        assert!(count > 0, "expected at least one model");
    }
}
