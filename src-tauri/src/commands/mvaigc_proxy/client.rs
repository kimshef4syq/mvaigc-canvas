//! mvaigc API client: login, token cache, model listing.
//!
//! mvaigc.cn is a private REST API (not OpenAI-compatible). Every response
//! uses the envelope `{"code":200,"message":"...","data":...}`; `code != 200`
//! means failure. Authenticated requests carry the header `X-User-Token`
//! (NOT a standard `Authorization: Bearer`).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

use crate::ai::error::AIError;

pub const DEFAULT_BASE_URL: &str = "https://www.mvaigc.cn";

#[derive(Debug, Clone)]
pub struct CachedToken {
    pub token: String,
    pub user_id: String,
}

/// True when an error message means the token is missing/expired
/// (mvaigc codes 401 and 103), i.e. a re-login may fix it. Scans every
/// colon-separated segment so it still matches when the message arrives
/// wrapped (e.g. `AIError::Provider` → `"Provider error: 401: 未授权"`).
pub fn is_auth_error(message: &str) -> bool {
    message
        .split(':')
        .any(|segment| matches!(segment.trim(), "401" | "103"))
}

/// Unwrap the mvaigc response envelope. Returns `data` on success; on
/// `code != 200` returns `"<code>: <message>"`.
pub fn parse_envelope(value: Value) -> Result<Value, String> {
    let code = value
        .get("code")
        .map(|raw| match raw {
            Value::Number(number) => number.to_string(),
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default();
    if code == "200" {
        Ok(value.get("data").cloned().unwrap_or(Value::Null))
    } else {
        let message = value.get("message").and_then(Value::as_str).unwrap_or("");
        Err(format!("{code}: {message}"))
    }
}

pub struct MvaigcClient {
    base: String,
    http: reqwest::Client,
    tokens: Mutex<HashMap<String, CachedToken>>,
}

impl Default for MvaigcClient {
    fn default() -> Self {
        Self::new()
    }
}

impl MvaigcClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .unwrap_or_default();
        Self {
            base: DEFAULT_BASE_URL.to_string(),
            http,
            tokens: Mutex::new(HashMap::new()),
        }
    }

    /// Log in and cache the resulting token, keyed by account.
    pub async fn login(&self, account: &str, password: &str) -> Result<CachedToken, AIError> {
        let response = self
            .http
            .post(format!("{}/ma/v1/user/login", self.base))
            .json(&json!({ "account": account, "password": password }))
            .send()
            .await?;
        let body: Value = response.json().await?;
        let data = parse_envelope(body).map_err(AIError::Provider)?;
        let token = data
            .get("token")
            .and_then(Value::as_str)
            .ok_or_else(|| AIError::Provider("login response missing token".to_string()))?
            .to_string();
        let user_id = data
            .get("userId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let cached = CachedToken { token, user_id };
        self.tokens
            .lock()
            .expect("token cache poisoned")
            .insert(account.to_string(), cached.clone());
        Ok(cached)
    }

    /// Return a cached token for the account, logging in if needed.
    pub async fn ensure_token(&self, account: &str, password: &str) -> Result<String, AIError> {
        {
            let cache = self.tokens.lock().expect("token cache poisoned");
            if let Some(cached) = cache.get(account) {
                return Ok(cached.token.clone());
            }
        }
        Ok(self.login(account, password).await?.token)
    }

    /// Drop a cached token (used after a 401/103 to force a re-login).
    pub fn forget_token(&self, account: &str) {
        self.tokens
            .lock()
            .expect("token cache poisoned")
            .remove(account);
    }

    /// Drop the cached token only if it still equals `token`. Used on a 401
    /// retry so a concurrent request that already re-logged in and cached a
    /// fresh token is not wiped out.
    pub fn forget_token_if(&self, account: &str, token: &str) {
        let mut cache = self.tokens.lock().expect("token cache poisoned");
        if cache.get(account).map(|cached| cached.token.as_str()) == Some(token) {
            cache.remove(account);
        }
    }

    pub async fn list_image_models(&self, token: String) -> Result<Value, AIError> {
        let response = self
            .http
            .get(format!("{}/ma/v1/imgPlatform/getImgModel", self.base))
            .header("X-User-Token", token)
            .send()
            .await?;
        let body: Value = response.json().await?;
        parse_envelope(body).map_err(AIError::Provider)
    }

    pub async fn list_video_models(&self, token: String, scene: &str) -> Result<Value, AIError> {
        let response = self
            .http
            .get(format!("{}/ma/v1/videoPlatform/getVideoApi", self.base))
            .query(&[("type", scene)])
            .header("X-User-Token", token)
            .send()
            .await?;
        let body: Value = response.json().await?;
        parse_envelope(body).map_err(AIError::Provider)
    }
}

#[derive(Debug, Clone)]
pub struct SubmitResult {
    pub oper_type: String,
    pub oper_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TaskState {
    Running,
    Succeeded(Vec<String>),
    Failed(String),
}

/// Coerce a JSON id (number or string) to a string.
fn id_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

/// mvaigc returns `fileUrl` as a JSON-encoded string, e.g.
/// `"[\"https://.../a.png\"]"`. Parse it; fall back to the raw string when
/// it is not JSON (some tasks return a bare URL).
pub fn parse_file_urls(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if let Ok(urls) = serde_json::from_str::<Vec<String>>(trimmed) {
        return urls;
    }
    vec![trimmed.to_string()]
}

/// Decide a single history item's state. `isComplete != true` → Running;
/// `errorMsg` present → Failed (even when `isComplete` is true); a completed
/// item with no usable file URL → Failed (an empty success would make the
/// caller poll to its own timeout); otherwise Succeeded with the parsed URLs.
pub fn judge_item(item: &Value) -> TaskState {
    if item.get("isComplete").and_then(Value::as_bool) != Some(true) {
        return TaskState::Running;
    }
    if let Some(error) = item.get("errorMsg").and_then(Value::as_str) {
        if !error.trim().is_empty() {
            return TaskState::Failed(error.trim().to_string());
        }
    }
    let raw = item
        .get("fileUrl")
        .and_then(Value::as_str)
        .or_else(|| item.get("fileUrlList").and_then(Value::as_str))
        .unwrap_or("");
    let urls = parse_file_urls(raw);
    if urls.is_empty() {
        return TaskState::Failed("任务已完成但没有返回文件".to_string());
    }
    TaskState::Succeeded(urls)
}

/// Prefer the `operType` the submit response carried; fall back to the known
/// image history bucket only when it is absent.
pub fn resolve_image_oper_type(data: &Value) -> String {
    data.get("operType")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| "imageImg".to_string())
}

impl MvaigcClient {
    /// Submit an image generation task. Returns the `operType`/`operId` pair
    /// used to poll for the result.
    pub async fn submit_image(
        &self,
        token: String,
        payload: Value,
    ) -> Result<SubmitResult, AIError> {
        let response = self
            .http
            .post(format!("{}/ma/v1/imgPlatform/imgToImage", self.base))
            .header("X-User-Token", token)
            .json(&payload)
            .send()
            .await?;
        let body: Value = response.json().await?;
        let data = parse_envelope(body).map_err(AIError::Provider)?;
        let oper_id = data
            .get("operId")
            .and_then(id_to_string)
            .or_else(|| {
                data.get("operIds")
                    .and_then(Value::as_array)
                    .and_then(|list| list.first())
                    .and_then(id_to_string)
            })
            .ok_or_else(|| AIError::Provider("imgToImage response missing operId".to_string()))?;
        Ok(SubmitResult {
            oper_type: resolve_image_oper_type(&data),
            oper_id,
        })
    }

    /// Submit a video generation task. `frames == true` uses the start/end
    /// frame endpoint; otherwise the all-reference endpoint.
    pub async fn submit_video(
        &self,
        token: String,
        payload: Value,
        frames: bool,
    ) -> Result<SubmitResult, AIError> {
        let path = if frames {
            "/ma/v1/filmStoryboard/scriptMutiImgToVideo"
        } else {
            "/ma/v1/filmStoryboard/scriptImgToVideo"
        };
        let response = self
            .http
            .post(format!("{}{}", self.base, path))
            .header("X-User-Token", token)
            .json(&payload)
            .send()
            .await?;
        let body: Value = response.json().await?;
        let data = parse_envelope(body).map_err(AIError::Provider)?;
        // The submit response carries the operType; do NOT guess it.
        let oper_type = data
            .get("operType")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                AIError::Provider("video submit response missing operType".to_string())
            })?;
        let oper_id = data
            .get("operId")
            .and_then(id_to_string)
            .ok_or_else(|| AIError::Provider("video submit response missing operId".to_string()))?;
        Ok(SubmitResult { oper_type, oper_id })
    }

    /// Poll one task by `operType`/`operId`. Uses the history list for that
    /// `operType` and matches on `operId`.
    pub async fn poll_task(
        &self,
        token: String,
        oper_type: &str,
        oper_id: &str,
    ) -> Result<TaskState, AIError> {
        let response = self
            .http
            .get(format!(
                "{}/ma/v1/fileTransfer/getHistoryFilesByPage/{}",
                self.base, oper_type
            ))
            .query(&[("pageNum", "1"), ("pageSize", "50")])
            .header("X-User-Token", token)
            .send()
            .await?;
        let body: Value = response.json().await?;
        let data = parse_envelope(body).map_err(AIError::Provider)?;
        let list = data
            .get("list")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for item in &list {
            if item.get("operId").and_then(id_to_string).as_deref() == Some(oper_id) {
                return Ok(judge_item(item));
            }
        }
        Ok(TaskState::Running)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_rejects_non_200_code() {
        let body = serde_json::json!({"code":401,"message":"未授权","data":null});
        let err = parse_envelope(body).unwrap_err();
        assert!(err.contains("401") && err.contains("未授权"));
    }

    #[test]
    fn envelope_returns_data_on_200() {
        let body = serde_json::json!({"code":200,"message":"成功","data":{"token":"T","userId":"U"}});
        assert_eq!(parse_envelope(body).unwrap()["token"], "T");
    }

    #[test]
    fn file_url_json_string_is_parsed() {
        let raw = "[\"https://static.mvaigc.cn/aigc_images/a.png\"]";
        assert_eq!(
            parse_file_urls(raw),
            vec!["https://static.mvaigc.cn/aigc_images/a.png"]
        );
    }

    #[test]
    fn completed_with_error_is_failed() {
        let item = serde_json::json!({"isComplete":true,"errorMsg":"超时","fileUrl":"[]"});
        assert!(matches!(judge_item(&item), TaskState::Failed(_)));
    }

    #[test]
    fn running_item_is_running() {
        let item = serde_json::json!({"isComplete":false,"errorMsg":null,"fileUrl":"[]"});
        assert!(matches!(judge_item(&item), TaskState::Running));
    }

    #[test]
    fn auth_error_is_detected() {
        assert!(is_auth_error("401: 未授权"));
        assert!(is_auth_error("103: 登录失效"));
        assert!(!is_auth_error("1147: 找不到此API计费单元信息"));
    }

    #[test]
    fn auth_error_is_detected_through_ai_error_wrapper() {
        // AIError::Provider prefixes "Provider error: " onto the message, so the
        // 401/103 code is NOT the first colon-separated segment.
        assert!(is_auth_error("Provider error: 401: 未授权"));
        assert!(is_auth_error("Provider error: 103: 登录失效"));
        assert!(!is_auth_error("Provider error: 1147: 找不到此API计费单元信息"));
    }

    #[test]
    fn completed_but_empty_result_is_failed() {
        let empty_array = serde_json::json!({"isComplete":true,"errorMsg":"","fileUrl":"[]"});
        assert!(matches!(judge_item(&empty_array), TaskState::Failed(_)));
        let missing = serde_json::json!({"isComplete":true,"errorMsg":null});
        assert!(matches!(judge_item(&missing), TaskState::Failed(_)));
    }

    #[test]
    fn image_oper_type_comes_from_response_when_present() {
        let with_type = serde_json::json!({"operId":"1","operType":"imgToImage"});
        assert_eq!(resolve_image_oper_type(&with_type), "imgToImage");
        let without = serde_json::json!({"operId":"1"});
        assert_eq!(resolve_image_oper_type(&without), "imageImg");
    }

    #[test]
    fn forget_token_if_only_removes_matching_token() {
        // Two concurrent requests both hit 401. The first re-logs in and caches
        // a fresh token; the second's stale-token removal must NOT wipe it.
        let client = MvaigcClient::new();
        client
            .tokens
            .lock()
            .unwrap()
            .insert("acct".into(), CachedToken { token: "T1".into(), user_id: "u".into() });
        client.forget_token_if("acct", "T2"); // mismatch → no-op
        assert!(client.tokens.lock().unwrap().contains_key("acct"));
        client.forget_token_if("acct", "T1"); // match → removed
        assert!(!client.tokens.lock().unwrap().contains_key("acct"));
    }
}
