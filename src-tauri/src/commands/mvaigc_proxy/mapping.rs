//! Pure translation between the standardized proxy API and mvaigc's shapes.
//! No I/O here — everything is testable in isolation.

use serde_json::{json, Value};

/// Encode a mvaigc task into a single opaque id: `<operType>.<operId>`.
/// `operType` never contains `.`, so the separator is unambiguous.
pub fn encode_task_id(oper_type: &str, oper_id: &str) -> String {
    format!("{oper_type}.{oper_id}")
}

/// Split an encoded id back into `(operType, operId)`.
pub fn decode_task_id(id: &str) -> Option<(String, String)> {
    let (oper_type, oper_id) = id.split_once('.')?;
    if oper_type.is_empty() || oper_id.is_empty() {
        return None;
    }
    Some((oper_type.to_string(), oper_id.to_string()))
}

/// Extract a non-empty string field, else None.
fn str_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// Resolve `(resolution, aspect_ratio)` from an OSC image request. OSC sends
/// `size` (pixels) plus `aspect_ratio` (the user's pick); the explicit ratio
/// wins. mvaigc's `resolution` field expects a tier like `2K`, not a pixel
/// size, so we always send `2K`.
fn resolve_image_resolution_ratio(openai: &Value) -> (String, String) {
    let size = str_field(openai, "size").unwrap_or_default();
    let ratio = str_field(openai, "aspect_ratio")
        .filter(|value| value.contains(':'))
        .or_else(|| if size.contains(':') { Some(size) } else { None })
        .unwrap_or_else(|| "1:1".to_string());
    ("2K".to_string(), ratio)
}

/// Map an OpenAI Images request to mvaigc's `imgToImage` body.
pub fn map_image_request(openai: &Value, model_name: &str) -> Value {
    let (resolution, ratio) = resolve_image_resolution_ratio(openai);
    let count = openai.get("n").and_then(Value::as_i64).unwrap_or(1).max(1);
    let images: Vec<Value> = openai
        .get("image")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .enumerate()
                .map(|(index, url)| json!({"url": url, "name": format!("图{}", index + 1)}))
                .collect()
        })
        .unwrap_or_default();
    json!({
        "model": str_field(openai, "model").unwrap_or_default(),
        "modelName": model_name,
        "text": str_field(openai, "prompt").unwrap_or_default(),
        "resolution": resolution,
        "imgRatio": ratio,
        "imgCount": count,
        "images": images,
    })
}

/// Map an OpenAI Videos request to mvaigc's `scriptImgToVideo` body.
pub fn map_video_request(openai: &Value, api_name: &str) -> Value {
    let size = str_field(openai, "size").unwrap_or_default();
    // Prefer OSC's explicit aspect_ratio over the pixel size.
    let ratio = str_field(openai, "aspect_ratio")
        .filter(|value| value.contains(':'))
        .or_else(|| if size.contains(':') { Some(size) } else { None })
        .unwrap_or_else(|| "16:9".to_string());
    let duration = openai
        .get("seconds")
        .and_then(Value::as_i64)
        .unwrap_or(5)
        .max(1);
    let images: Vec<Value> = openai
        .get("image")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .enumerate()
                .map(|(index, url)| json!({"imageUrl": url, "name": format!("图{}", index + 1)}))
                .collect()
        })
        .unwrap_or_default();
    json!({
        "api": str_field(openai, "model").unwrap_or_default(),
        "apiName": api_name,
        "text": str_field(openai, "prompt").unwrap_or_default(),
        "images": images,
        "videos": [],
        "audios": [],
        "ratio": ratio,
        "duration": duration,
        "resolution": "1080p",
        "audio": false,
        "optimizedPrompt": false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_id_roundtrip() {
        let id = encode_task_id("imgToImage", "67890");
        assert_eq!(id, "imgToImage.67890");
        assert_eq!(
            decode_task_id(&id),
            Some(("imgToImage".into(), "67890".into()))
        );
    }

    #[test]
    fn image_request_maps_openai_shape() {
        let openai = serde_json::json!({"model":"gpt_image2","prompt":"猫","size":"16:9","n":2});
        let out = map_image_request(&openai, "GPT-Image-2");
        assert_eq!(out["model"], "gpt_image2");
        assert_eq!(out["modelName"], "GPT-Image-2");
        assert_eq!(out["text"], "猫");
        assert_eq!(out["imgRatio"], "16:9");
        assert_eq!(out["imgCount"], 2);
    }

    #[test]
    fn image_request_prefers_explicit_aspect_ratio_over_pixel_size() {
        // OSC sends `size` (pixels) plus `aspect_ratio` (the user's pick).
        let openai = serde_json::json!({
            "model": "gpt_image2", "prompt": "猫",
            "size": "1024x1024", "aspect_ratio": "16:9", "n": 1
        });
        let out = map_image_request(&openai, "GPT-Image-2");
        assert_eq!(out["imgRatio"], "16:9");
        assert_eq!(out["resolution"], "2K");
    }

    #[test]
    fn video_request_uses_aspect_ratio_field() {
        let openai = serde_json::json!({
            "model": "minimax_h3", "prompt": "跑", "size": "1280x720",
            "aspect_ratio": "9:16", "seconds": 5
        });
        let out = map_video_request(&openai, "MiniMax-H3-2K");
        assert_eq!(out["ratio"], "9:16");
        assert_eq!(out["duration"], 5);
    }
}
