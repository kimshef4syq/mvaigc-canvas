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

/// Reference-image URLs from an OSC request. OSC sends `reference_images`
/// as an array, or as a bare string when there is exactly one; the OpenAI
/// `image` field (string or array) is also accepted.
fn reference_image_urls(openai: &Value) -> Vec<String> {
    let to_urls = |value: &Value| -> Vec<String> {
        match value {
            Value::String(url) if !url.trim().is_empty() => vec![url.clone()],
            Value::Array(list) => list
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect(),
            _ => Vec::new(),
        }
    };
    for key in ["reference_images", "image"] {
        if let Some(value) = openai.get(key) {
            let urls = to_urls(value);
            if !urls.is_empty() {
                return urls;
            }
        }
    }
    Vec::new()
}

/// Reference-media URLs for a video/audio reference list. OSC sends
/// `reference_videos` / `reference_audios` as an array, or as a bare string
/// when there is exactly one; the bare field name (`videos` / `audios`) is
/// also accepted.
fn reference_media_urls(openai: &Value, keys: [&str; 2]) -> Vec<String> {
    let to_urls = |value: &Value| -> Vec<String> {
        match value {
            Value::String(url) if !url.trim().is_empty() => vec![url.clone()],
            Value::Array(list) => list
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect(),
            _ => Vec::new(),
        }
    };
    for key in keys {
        if let Some(value) = openai.get(key) {
            let urls = to_urls(value);
            if !urls.is_empty() {
                return urls;
            }
        }
    }
    Vec::new()
}

/// Map an OpenAI Images request to mvaigc's `imgToImage` body.
///
/// mvaigc binds `images` to the prompt through `@图N` mention tokens in the
/// text: the site's own client sends `text`/`textHtml` that reference each
/// image by its `name` (`图1`, `图2`, ...). Without those tokens mvaigc
/// ignores the images and degrades to text-to-image, so we prepend them
/// whenever reference images are present.
pub fn map_image_request(openai: &Value, model_name: &str) -> Value {
    let (resolution, ratio) = resolve_image_resolution_ratio(openai);
    let count = openai.get("n").and_then(Value::as_i64).unwrap_or(1).max(1);
    let images: Vec<Value> = reference_image_urls(openai)
        .into_iter()
        .enumerate()
        .map(|(index, url)| json!({"url": url, "name": format!("图{}", index + 1)}))
        .collect();
    let prompt = str_field(openai, "prompt").unwrap_or_default();
    // Prefix `@图1 @图2 ...` so mvaigc attaches each image to the prompt.
    let text = if images.is_empty() {
        prompt.clone()
    } else {
        let tokens = (1..=images.len())
            .map(|index| format!("@图{index}"))
            .collect::<Vec<_>>()
            .join(" ");
        if prompt.is_empty() {
            tokens
        } else {
            format!("{tokens} {prompt}")
        }
    };
    json!({
        "model": str_field(openai, "model").unwrap_or_default(),
        "modelName": model_name,
        "text": text,
        "textHtml": text,
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
        .or_else(|| if size.contains(':') { Some(size.clone()) } else { None })
        .unwrap_or_else(|| "16:9".to_string());
    let duration = openai
        .get("seconds")
        .and_then(Value::as_i64)
        .unwrap_or(5)
        .max(1);
    // OSC may provide the selected tier as `resolution` / `resolutionType`,
    // or as `size` in OpenAI-compatible requests. `size` can also contain an
    // aspect ratio, so only use it as a resolution when it is not a ratio.
    let resolution = ["resolution", "resolutionType", "resolution_type"]
        .iter()
        .find_map(|key| str_field(openai, key))
        .or_else(|| (!size.contains(':') && !size.is_empty()).then_some(size))
        .unwrap_or_else(|| "720p".to_string());
    let audio = ["audio", "generate_audio", "generateAudio"]
        .iter()
        .find_map(|key| openai.get(*key).and_then(Value::as_bool))
        .unwrap_or(false);
    let images: Vec<Value> = reference_image_urls(openai)
        .into_iter()
        .enumerate()
        .map(|(index, url)| json!({"imageUrl": url, "name": format!("图{}", index + 1)}))
        .collect();
    let videos: Vec<Value> = reference_media_urls(openai, ["reference_videos", "videos"])
        .into_iter()
        .enumerate()
        .map(|(index, url)| json!({"videoUrl": url, "name": format!("视频{}", index + 1)}))
        .collect();
    let audios: Vec<Value> = reference_media_urls(openai, ["reference_audios", "audios"])
        .into_iter()
        .enumerate()
        .map(|(index, url)| json!({"audioUrl": url, "name": format!("音频{}", index + 1)}))
        .collect();
    json!({
        "api": str_field(openai, "model").unwrap_or_default(),
        "apiName": api_name,
        "text": str_field(openai, "prompt").unwrap_or_default(),
        "images": images,
        "videos": videos,
        "audios": audios,
        "ratio": ratio,
        "duration": duration,
        "resolution": resolution,
        "audio": audio,
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

    #[test]
    fn image_request_maps_reference_images() {
        // OSC sends `reference_images` (an array), not `image`.
        let openai = serde_json::json!({
            "model": "gpt_image2", "prompt": "改成夜景",
            "size": "1024x1024", "reference_images": ["data:image/png;base64,AAA", "data:image/png;base64,BBB"]
        });
        let out = map_image_request(&openai, "GPT-Image-2");
        let images = out["images"].as_array().unwrap();
        assert_eq!(images.len(), 2);
        assert_eq!(images[0]["url"], "data:image/png;base64,AAA");
    }

    #[test]
    fn reference_images_are_mentioned_in_text_and_text_html() {
        // mvaigc binds images to the prompt via `@图N` tokens; without them the
        // request degrades to text-to-image and the reference image is ignored.
        let openai = serde_json::json!({
            "model": "Nano-Banana-Pro", "prompt": "换成仰角拍摄",
            "size": "1024x1024",
            "reference_images": ["data:image/png;base64,AAA", "data:image/png;base64,BBB"]
        });
        let out = map_image_request(&openai, "Nano-Banana-Pro");
        assert_eq!(out["text"], "@图1 @图2 换成仰角拍摄");
        assert_eq!(out["textHtml"], "@图1 @图2 换成仰角拍摄");
    }

    #[test]
    fn text_to_image_without_references_has_no_mention_tokens() {
        let openai = serde_json::json!({"model": "gpt_image2", "prompt": "一只猫", "size": "1024x1024"});
        let out = map_image_request(&openai, "GPT-Image-2");
        assert_eq!(out["text"], "一只猫");
        assert_eq!(out["textHtml"], "一只猫");
    }

    #[test]
    fn video_request_maps_reference_images() {
        let openai = serde_json::json!({
            "model": "minimax_h3", "prompt": "让它动起来", "size": "16:9",
            "seconds": 5, "reference_images": ["data:image/png;base64,AAA"]
        });
        let out = map_video_request(&openai, "MiniMax-H3-2K");
        let images = out["images"].as_array().unwrap();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0]["imageUrl"], "data:image/png;base64,AAA");
    }

    #[test]
    fn video_request_maps_reference_videos() {
        // A video reference must reach mvaigc's `videos` array (it used to be
        // hardcoded empty, so connected reference videos were silently dropped).
        let openai = serde_json::json!({
            "model": "botsmart_seedance_2_fast", "prompt": "参考它", "size": "16:9",
            "seconds": 5, "reference_videos": ["https://cdn.example.com/clip.mp4"]
        });
        let out = map_video_request(&openai, "Seedance-2.0-Fast");
        let videos = out["videos"].as_array().unwrap();
        assert_eq!(videos.len(), 1);
        assert_eq!(videos[0]["videoUrl"], "https://cdn.example.com/clip.mp4");
    }

    #[test]
    fn video_request_without_references_has_empty_video_and_audio_arrays() {
        let openai = serde_json::json!({
            "model": "botsmart_seedance_2_fast", "prompt": "一只猫", "size": "16:9", "seconds": 5
        });
        let out = map_video_request(&openai, "Seedance-2.0-Fast");
        assert_eq!(out["videos"].as_array().unwrap().len(), 0);
        assert_eq!(out["audios"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn single_reference_image_sent_as_string_is_mapped() {
        // OSC sends a lone reference image as a bare string, not an array.
        let image = serde_json::json!({
            "model": "gpt_image2", "prompt": "改", "size": "1024x1024",
            "reference_images": "data:image/png;base64,AAA"
        });
        assert_eq!(map_image_request(&image, "GPT-Image-2")["images"].as_array().unwrap().len(), 1);

        let video = serde_json::json!({
            "model": "minimax_h3", "prompt": "动", "size": "16:9", "seconds": 5,
            "reference_images": "data:image/png;base64,BBB"
        });
        let out = map_video_request(&video, "MiniMax-H3-2K");
        assert_eq!(out["images"].as_array().unwrap()[0]["imageUrl"], "data:image/png;base64,BBB");
    }
}
