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

    pub async fn list_image_models(&self, token: &str) -> Result<Value, AIError> {
        let response = self
            .http
            .get(format!("{}/ma/v1/imgPlatform/getImgModel", self.base))
            .header("X-User-Token", token)
            .send()
            .await?;
        let body: Value = response.json().await?;
        parse_envelope(body).map_err(AIError::Provider)
    }

    pub async fn list_video_models(&self, token: &str, scene: &str) -> Result<Value, AIError> {
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
}
