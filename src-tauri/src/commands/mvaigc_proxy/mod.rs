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

/// Max accepted request body (base64 reference media can be large).
const MAX_REQUEST_BODY_BYTES: usize = 128 * 1024 * 1024;

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tracing::{info, warn};

use client::{is_auth_error, parse_data_url, MvaigcClient, TaskState};
use mapping::{decode_task_id, encode_task_id, map_image_request, map_video_request};

/// Shared proxy state: the mvaigc client plus the credentials configured via
/// the OSC settings panel (used when a request carries no Authorization).
struct LocalGrant {
    expires_at: u64,
    active: Arc<dyn Fn() -> bool + Send + Sync>,
    account: String,
}

pub struct ProxyState {
    client: MvaigcClient,
    credentials: RwLock<Option<(String, String)>>,
    target_tenant_id: RwLock<Option<i64>>,
    target_tenant_name: RwLock<Option<String>>,
    reserved: std::sync::Mutex<Option<u16>>,
    grants: RwLock<HashMap<String, LocalGrant>>,
    missing_since: std::sync::Mutex<HashMap<String, u64>>,
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
            target_tenant_id: RwLock::new(None),
            target_tenant_name: RwLock::new(None),
            reserved: std::sync::Mutex::new(None),
            grants: RwLock::new(HashMap::new()),
            missing_since: std::sync::Mutex::new(HashMap::new()),
        }
    }

    pub async fn set_credentials(&self, account: String, password: String) {
        *self.credentials.write().await = Some((account, password));
    }

    pub async fn set_credentials_and_tenant(
        &self,
        account: String,
        password: String,
        tenant_id: Option<i64>,
        tenant_name: Option<String>,
    ) {
        *self.credentials.write().await = Some((account, password));
        *self.target_tenant_id.write().await = tenant_id;
        *self.target_tenant_name.write().await = tenant_name;
    }

    pub async fn target_tenant_id(&self) -> Option<i64> {
        *self.target_tenant_id.read().await
    }

    pub fn target_tenant_id_sync(&self) -> Option<i64> {
        self.target_tenant_id
            .try_read()
            .ok()
            .and_then(|guard| *guard)
    }

    pub async fn target_tenant_name(&self) -> Option<String> {
        self.target_tenant_name.read().await.clone()
    }

    pub fn target_tenant_name_sync(&self) -> Option<String> {
        self.target_tenant_name
            .try_read()
            .ok()
            .and_then(|guard| guard.clone())
    }

    pub async fn set_tenant(&self, tenant_id: Option<i64>, tenant_name: Option<String>) {
        *self.target_tenant_id.write().await = tenant_id;
        *self.target_tenant_name.write().await = tenant_name;
    }

    /// A revocable local-only grant; never duplicates the upstream password.
    pub(crate) async fn issue_local_grant(
        &self,
        expires_at: u64,
        active: Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> Result<String, String> {
        let (account, _) = self
            .stored_credentials()
            .await
            .ok_or("请先在画布设置登录 mvaigc")?;
        let token = format!("osc-local.{}", uuid::Uuid::new_v4());
        let mut grants = self.grants.write().await;
        grants.retain(|_, grant| grant.expires_at > local_now() && (grant.active)());
        grants.insert(
            token.clone(),
            LocalGrant {
                expires_at,
                active,
                account,
            },
        );
        Ok(token)
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

fn local_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Pull `account`/`password` and optional `tenant_id` from the
/// `Authorization: Bearer <account>:<password>[:<tenant_id>]` header,
/// falling back to the state's stored credentials and target tenant.
async fn resolve_credentials(
    state: &SharedState,
    headers: &HeaderMap,
) -> Result<(String, String, Option<i64>), Response> {
    let configured_tenant = state.target_tenant_id().await;
    if let Some(raw) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    {
        let token = raw.trim().strip_prefix("Bearer ").unwrap_or(raw.trim());
        if token.starts_with("osc-local.") {
            let grants = state.grants.read().await;
            if let Some(grant) = grants.get(token) {
                if grant.expires_at > local_now() && (grant.active)() {
                    if let Some(pair) = state.stored_credentials().await {
                        if pair.0 == grant.account {
                            return Ok((pair.0, pair.1, configured_tenant));
                        }
                    }
                }
            }
            return Err(error_response(
                StatusCode::UNAUTHORIZED,
                "本地工程授权已失效，请从视频节点重新打开智能体",
            ));
        }
        if let Some((account, rest)) = token.split_once(':') {
            if let Some((password, tenant_part)) = rest.split_once(':') {
                if !account.is_empty() && !password.is_empty() {
                    let tenant_id = tenant_part.trim().parse::<i64>().ok().or(configured_tenant);
                    return Ok((account.to_string(), password.to_string(), tenant_id));
                }
            } else if !account.is_empty() && !rest.is_empty() {
                return Ok((account.to_string(), rest.to_string(), configured_tenant));
            }
        }
    }
    if headers.contains_key(axum::http::header::AUTHORIZATION) {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "无效的本地服务授权",
        ));
    }
    state
        .stored_credentials()
        .await
        .map(|(acc, pwd)| (acc, pwd, configured_tenant))
        .ok_or_else(|| {
            error_response(
                StatusCode::UNAUTHORIZED,
                "缺少账号密码（Authorization: Bearer <账号>:<密码>）",
            )
        })
}

/// Build an error response in the `{"error":{"message":...}}` shape.
fn error_response(status: StatusCode, message: impl Into<String>) -> Response {
    (
        status,
        Json(json!({ "error": { "message": message.into() } })),
    )
        .into_response()
}

/// The field holding an inline media URL: video/audio entries use
/// `imageUrl`/`videoUrl`/`audioUrl`; image entries use `url`.
fn inline_media_url_key(entry: &Value) -> Option<&'static str> {
    ["imageUrl", "videoUrl", "audioUrl", "url"]
        .into_iter()
        .find(|key| entry.get(key).is_some())
}

/// Replace base64 `data:` URLs in `url` fields with a short static URL by
/// uploading them to mvaigc first. mvaigc stores the request's `oper_info` in
/// a DB column, so base64 payloads blow past its length limit.
async fn upload_inline_media(
    state: &SharedState,
    token: &str,
    payload: &mut Value,
) -> Result<(), String> {
    for field in ["images", "videos", "audios"] {
        let Some(list) = payload.get_mut(field).and_then(Value::as_array_mut) else {
            continue;
        };
        for entry in list.iter_mut() {
            let Some(url_key) = inline_media_url_key(entry) else {
                continue;
            };
            let Some(raw) = entry.get(url_key).and_then(Value::as_str) else {
                continue;
            };
            let Some((mime, bytes)) = parse_data_url(raw) else {
                continue;
            };
            let ext = mime.rsplit('/').next().unwrap_or("bin").to_string();
            let url = state
                .client
                .upload_media(token.to_string(), &format!("ref.{ext}"), &mime, bytes)
                .await
                .map_err(|err| err.to_string())?;
            entry[url_key] = Value::String(url);
        }
    }
    Ok(())
}

/// Run `op` with a valid token; on an auth error, re-login once and retry once.
/// The stale-token removal is conditional (`forget_token_if`) so that when two
/// requests hit 401 concurrently, the second one does not wipe the fresh token
/// the first one just cached (mvaigc is single-session per account, so a second
/// login would also invalidate the first — the retry reuses the fresh token
/// instead of logging in again).
async fn with_token<T, F, Fut>(
    state: &SharedState,
    account: &str,
    password: &str,
    tenant_id: Option<i64>,
    op: F,
) -> Result<T, String>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let token = state
        .client
        .ensure_token_with_tenant(account, password, tenant_id)
        .await
        .map_err(|err| err.to_string())?;
    match op(token.clone()).await {
        Ok(value) => Ok(value),
        Err(err) if is_auth_error(&err) => {
            state.client.forget_token_if(account, &token);
            let token = state
                .client
                .ensure_token_with_tenant(account, password, tenant_id)
                .await
                .map_err(|err| err.to_string())?;
            op(token).await
        }
        Err(err) => Err(err),
    }
}

/// Coerce a JSON number or string to i64.
pub fn parse_json_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.trim().parse::<i64>().ok(),
        _ => None,
    }
}

/// Format the raw tenant array from mvaigc's `tenantMenu` into standardized team records.
pub fn format_team_list(raw: &Value) -> Vec<Value> {
    let list = match raw {
        Value::Array(items) => items.as_slice(),
        _ => &[],
    };
    list.iter()
        .filter_map(|item| {
            let tenant_id = item.get("tenantId").and_then(parse_json_i64)?;
            let tenant_name = item
                .get("tenantName")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            let role_type = item
                .get("roleType")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            let role_label = match role_type.as_str() {
                "SUPER_ADMIN" => "团队负责人",
                "ADMIN" => "团队管理员",
                _ => "团队成员",
            };
            let display_name = if tenant_name.is_empty() {
                format!("团队 #{tenant_id}")
            } else if tenant_name.ends_with("的团队") {
                tenant_name.clone()
            } else {
                format!("{tenant_name}的团队")
            };
            Some(json!({
                "id": tenant_id,
                "tenantId": tenant_id,
                "name": display_name,
                "tenantName": tenant_name,
                "roleType": role_type,
                "roleLabel": role_label,
            }))
        })
        .collect()
}

/// `GET /v1/models` — aggregate image and video models into OpenAI's shape.
async fn list_models(State(state): State<SharedState>, headers: HeaderMap) -> Response {
    let (account, password, tenant_id) = match resolve_credentials(&state, &headers).await {
        Ok(triple) => triple,
        Err(response) => return response,
    };
    let result = with_token(&state, &account, &password, tenant_id, |token| {
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
            models.push(
                json!({"id": key, "object": "model", "owned_by": "mvaigc", "media": "image"}),
            );
        }
    }
    if let Some(list) = video.as_array() {
        for entry in list {
            if let Some(name) = entry.get("api_name").and_then(Value::as_str) {
                models.push(
                    json!({"id": name, "object": "model", "owned_by": "mvaigc", "media": "video"}),
                );
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
    let (account, password, tenant_id) = match resolve_credentials(&state, &headers).await {
        Ok(triple) => triple,
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
    let result = with_token(&state, &account, &password, tenant_id, |token| {
        let state = state.clone();
        let mut payload = payload.clone();
        async move {
            upload_inline_media(&state, &token, &mut payload).await?;
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
    let (account, password, tenant_id) = match resolve_credentials(&state, &headers).await {
        Ok(triple) => triple,
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
    let result = with_token(&state, &account, &password, tenant_id, |token| {
        let state = state.clone();
        let mut payload = payload.clone();
        async move {
            upload_inline_media(&state, &token, &mut payload).await?;
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
    let (account, password, tenant_id) = match resolve_credentials(&state, &headers).await {
        Ok(triple) => triple,
        Err(response) => return response,
    };
    let result = with_token(&state, &account, &password, tenant_id, |token| {
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
    // Upstream history can lag immediately after submit, but never wait forever.
    match result {
        Ok(TaskState::Missing) => {
            let mut missing = state.missing_since.lock().expect("missing task lock");
            let now = local_now();
            // Keep this bounded across long-running app sessions.
            missing.retain(|_, first| now.saturating_sub(*first) < 24 * 60 * 60 * 1000);
            let first = *missing.entry(id.clone()).or_insert(now);
            if now.saturating_sub(first) < 60_000 {
                Json(json!({"id": id, "status": "processing", "phase": "awaiting_history"}))
                    .into_response()
            } else {
                Json(json!({"id": id, "status": "not_found", "error": {"code":"TASK_NOT_FOUND", "message":"在有界历史查询中未找到任务；保留任务号，稍后恢复查询，不要重新提交生成。"}})).into_response()
            }
        }
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

/// `GET /v1/teams` — list teams for the authenticated account and report current active team.
async fn get_teams(State(state): State<SharedState>, headers: HeaderMap) -> Response {
    let (account, password, tenant_id) = match resolve_credentials(&state, &headers).await {
        Ok(triple) => triple,
        Err(response) => return response,
    };
    let result = with_token(&state, &account, &password, tenant_id, |token| {
        let state = state.clone();
        async move {
            let tenants = state
                .client
                .list_tenants(token.clone())
                .await
                .map_err(|err| err.to_string())?;
            let user_info = state
                .client
                .get_user_info(token)
                .await
                .unwrap_or(Value::Null);
            Ok((tenants, user_info))
        }
    })
    .await;

    match result {
        Ok((tenants, user_info)) => {
            let current_tenant_id = user_info
                .get("tenantId")
                .and_then(parse_json_i64)
                .or(tenant_id);
            let current_tenant_name = user_info
                .get("tenantName")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| state.target_tenant_name_sync());
            let points = user_info.get("sumIncomePoint").and_then(parse_json_i64);
            let consume_points = user_info.get("sumConsumePoint").and_then(parse_json_i64);

            let teams = format_team_list(&tenants);
            Json(json!({
                "status": "ok",
                "currentTenantId": current_tenant_id,
                "currentTenantName": current_tenant_name,
                "points": points,
                "consumePoints": consume_points,
                "teams": teams,
                "userInfo": user_info,
            }))
            .into_response()
        }
        Err(err) => error_response(StatusCode::BAD_GATEWAY, err),
    }
}

#[derive(serde::Deserialize)]
struct SwitchTeamPayload {
    #[serde(alias = "tenantId", alias = "tenant_id", alias = "id")]
    tenant_id: i64,
    #[serde(alias = "tenantName", alias = "tenant_name", alias = "name")]
    tenant_name: Option<String>,
}

/// `POST /v1/teams/switch` — switch active team for the authenticated account.
async fn switch_team_endpoint(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<SwitchTeamPayload>,
) -> Response {
    let (account, password, _) = match resolve_credentials(&state, &headers).await {
        Ok(triple) => triple,
        Err(response) => return response,
    };
    let target_tenant = body.tenant_id;
    let tenant_name = body.tenant_name.clone();

    let result = with_token(&state, &account, &password, Some(target_tenant), |token| {
        let state = state.clone();
        async move {
            state
                .client
                .switch_tenant(token.clone(), target_tenant)
                .await
                .map_err(|err| err.to_string())?;
            let user_info = state
                .client
                .get_user_info(token)
                .await
                .unwrap_or(Value::Null);
            Ok(user_info)
        }
    })
    .await;

    match result {
        Ok(user_info) => {
            state
                .set_tenant(Some(target_tenant), tenant_name.clone())
                .await;
            state.client.update_cached_tenant(&account, target_tenant);
            let points = user_info.get("sumIncomePoint").and_then(parse_json_i64);
            Json(json!({
                "status": "ok",
                "tenantId": target_tenant,
                "tenantName": tenant_name,
                "points": points,
                "userInfo": user_info,
            }))
            .into_response()
        }
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
        .route("/v1/teams", get(get_teams))
        .route("/v1/teams/switch", post(switch_team_endpoint))
        .route("/v1/tenants", get(get_teams))
        .route("/v1/tenants/switch", post(switch_team_endpoint))
        // Reference images/videos arrive as base64 inside the JSON body and
        // can exceed axum's 2 MB default, which would reject them with 413.
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
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
    tenant_id: Option<i64>,
    tenant_name: Option<String>,
) -> Result<String, String> {
    state
        .state
        .set_credentials_and_tenant(
            account.clone(),
            password.clone(),
            tenant_id,
            tenant_name.clone(),
        )
        .await;

    if let Some(tid) = tenant_id {
        if !account.trim().is_empty() && !password.trim().is_empty() {
            if let Ok(token) = state.state.client.ensure_token(&account, &password).await {
                let _ = state.state.client.switch_tenant(token, tid).await;
                state.state.client.update_cached_tenant(&account, tid);
            }
        }
    }

    match ensure_started(&state.state, port) {
        Ok(_) => Ok(format!("running:{port}")),
        Err(err) => Err(err),
    }
}

/// Tauri command: query available teams and current active team for an account.
#[tauri::command]
pub async fn mvaigc_fetch_teams(
    state: tauri::State<'_, MvaigcProxyState>,
    account: String,
    password: String,
) -> Result<Value, String> {
    let account = account.trim().to_string();
    let password = password.trim().to_string();
    if account.is_empty() || password.is_empty() {
        return Err("请先填写账号和密码".to_string());
    }

    let target_tenant = state.state.target_tenant_id().await;
    let token = state
        .state
        .client
        .ensure_token_with_tenant(&account, &password, target_tenant)
        .await
        .map_err(|err| err.to_string())?;

    let tenants_raw = state
        .state
        .client
        .list_tenants(token.clone())
        .await
        .map_err(|err| err.to_string())?;

    let user_info_raw = state
        .state
        .client
        .get_user_info(token)
        .await
        .unwrap_or(Value::Null);

    let current_tenant_id = user_info_raw
        .get("tenantId")
        .and_then(parse_json_i64)
        .or(target_tenant);
    let current_tenant_name = user_info_raw
        .get("tenantName")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| state.state.target_tenant_name_sync());
    let points = user_info_raw.get("sumIncomePoint").and_then(parse_json_i64);
    let consume_points = user_info_raw
        .get("sumConsumePoint")
        .and_then(parse_json_i64);

    let teams = format_team_list(&tenants_raw);

    Ok(json!({
        "status": "ok",
        "currentTenantId": current_tenant_id,
        "currentTenantName": current_tenant_name,
        "points": points,
        "consumePoints": consume_points,
        "teams": teams,
        "userInfo": user_info_raw,
    }))
}

/// Tauri command: switch active team for an account.
#[tauri::command]
pub async fn mvaigc_switch_team(
    state: tauri::State<'_, MvaigcProxyState>,
    account: String,
    password: String,
    tenant_id: i64,
    tenant_name: Option<String>,
) -> Result<Value, String> {
    let account = account.trim().to_string();
    let password = password.trim().to_string();
    if account.is_empty() || password.is_empty() {
        return Err("请先填写账号和密码".to_string());
    }

    let token = state
        .state
        .client
        .ensure_token_with_tenant(&account, &password, Some(tenant_id))
        .await
        .map_err(|err| err.to_string())?;

    state
        .state
        .client
        .switch_tenant(token.clone(), tenant_id)
        .await
        .map_err(|err| err.to_string())?;

    state
        .state
        .set_tenant(Some(tenant_id), tenant_name.clone())
        .await;
    state.state.client.update_cached_tenant(&account, tenant_id);

    let user_info_raw = state
        .state
        .client
        .get_user_info(token)
        .await
        .unwrap_or(Value::Null);

    let points = user_info_raw.get("sumIncomePoint").and_then(parse_json_i64);

    Ok(json!({
        "status": "ok",
        "tenantId": tenant_id,
        "tenantName": tenant_name,
        "points": points,
        "userInfo": user_info_raw,
    }))
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
    fn format_team_list_maps_mvaigc_tenants() {
        let raw = json!([
            {
                "tenantId": 1001,
                "tenantName": "SYQ-TES",
                "roleType": "SUPER_ADMIN"
            },
            {
                "tenantId": "1002",
                "tenantName": "深度视界团队",
                "roleType": "ADMIN"
            },
            {
                "tenantId": 1003,
                "tenantName": "合作实验室的团队",
                "roleType": "USER"
            }
        ]);
        let formatted = format_team_list(&raw);
        assert_eq!(formatted.len(), 3);
        assert_eq!(formatted[0]["id"], 1001);
        assert_eq!(formatted[0]["name"], "SYQ-TES的团队");
        assert_eq!(formatted[0]["roleLabel"], "团队负责人");

        assert_eq!(formatted[1]["id"], 1002);
        assert_eq!(formatted[1]["name"], "深度视界团队的团队");
        assert_eq!(formatted[1]["roleLabel"], "团队管理员");

        assert_eq!(formatted[2]["id"], 1003);
        assert_eq!(formatted[2]["name"], "合作实验室的团队");
        assert_eq!(formatted[2]["roleLabel"], "团队成员");
    }

    #[test]
    fn parse_json_i64_handles_numbers_and_numeric_strings() {
        assert_eq!(parse_json_i64(&json!(123)), Some(123));
        assert_eq!(parse_json_i64(&json!("456")), Some(456));
        assert_eq!(parse_json_i64(&json!(" 789 ")), Some(789));
        assert_eq!(parse_json_i64(&json!("invalid")), None);
        assert_eq!(parse_json_i64(&json!(null)), None);
    }

    #[test]
    fn inline_media_url_key_covers_image_and_video_shapes() {
        // Image entries use `url`; video/audio entries use `*Url`.
        assert_eq!(
            inline_media_url_key(&json!({"url": "x", "name": "图1"})),
            Some("url")
        );
        assert_eq!(
            inline_media_url_key(&json!({"imageUrl": "x", "name": "图1"})),
            Some("imageUrl")
        );
        assert_eq!(inline_media_url_key(&json!({"name": "x"})), None);
    }

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

    /// Large bodies (reference images/videos as base64) must not be rejected
    /// by axum's default 2 MB limit. An unauthenticated large request should
    /// reach the handler and fail auth (401), never 413.
    #[tokio::test]
    async fn large_request_body_is_accepted() {
        let state = Arc::new(ProxyState::new());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router(state)).await.ok();
        });
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        // ~5 MB JSON body.
        let big = "a".repeat(5 * 1024 * 1024);
        let body = format!("{{\"model\":\"gpt_image2\",\"prompt\":\"{big}\"}}");
        let response = reqwest::Client::new()
            .post(format!("http://{addr}/v1/images/generations"))
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .unwrap();
        assert_ne!(
            response.status().as_u16(),
            413,
            "large body must not be rejected with 413"
        );
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
    #[tokio::test]
    async fn local_grant_is_revocable_expiring_and_account_bound() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let state = Arc::new(ProxyState::new());
        state
            .set_credentials("account".into(), "password".into())
            .await;
        let active = Arc::new(AtomicBool::new(true));
        let flag = active.clone();
        let token = state
            .issue_local_grant(
                local_now() + 60_000,
                Arc::new(move || flag.load(Ordering::SeqCst)),
            )
            .await
            .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {token}").parse().unwrap(),
        );
        assert!(resolve_credentials(&state, &headers).await.is_ok());
        active.store(false, Ordering::SeqCst);
        assert!(resolve_credentials(&state, &headers).await.is_err());
        let expired = state.issue_local_grant(0, Arc::new(|| true)).await.unwrap();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {expired}").parse().unwrap(),
        );
        assert!(resolve_credentials(&state, &headers).await.is_err());
        let other = state
            .issue_local_grant(local_now() + 60_000, Arc::new(|| true))
            .await
            .unwrap();
        state
            .set_credentials("different".into(), "password".into())
            .await;
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {other}").parse().unwrap(),
        );
        assert!(resolve_credentials(&state, &headers).await.is_err());
        headers.insert(
            axum::http::header::AUTHORIZATION,
            "Bearer bad".parse().unwrap(),
        );
        assert!(resolve_credentials(&state, &headers).await.is_err());
    }
}
