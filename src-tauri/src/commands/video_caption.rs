use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use ab_glyph::{FontArc, PxScale};
use image::{Rgba, RgbaImage};
use imageproc::drawing::{draw_text_mut, text_size};

fn load_caption_font() -> Result<FontArc, String> {
    let mut candidates = vec![
        "/System/Library/Fonts/Hiragino Sans GB.ttc".to_string(),
        "/System/Library/Fonts/STHeiti Medium.ttc".to_string(),
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc".to_string(),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf".to_string(),
    ];
    if let Ok(output) = Command::new("fc-match").args(["-f", "%{file}", "sans:lang=zh-cn"]).output() {
        if output.status.success() {
            candidates.insert(0, String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
    }
    for path in candidates {
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(font) = FontArc::try_from_vec(bytes) { return Ok(font); }
        }
    }
    Err("未找到可用的字幕字体。".into())
}

fn video_dimensions(input: &Path) -> Result<(u32, u32), String> {
    let output = Command::new("ffprobe").args(["-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0", input.to_str().ok_or("视频路径无效。")?])
        .output().map_err(|e| format!("无法启动 FFprobe：{e}"))?;
    if !output.status.success() { return Err("无法读取视频尺寸。".into()); }
    let dimensions = String::from_utf8_lossy(&output.stdout);
    let mut parts = dimensions.trim().split(',');
    let width = parts.next().and_then(|value| value.parse::<u32>().ok()).unwrap_or(0);
    let height = parts.next().and_then(|value| value.parse::<u32>().ok()).unwrap_or(0);
    if width < 64 || height < 64 || width > 8192 || height > 8192 { return Err("视频尺寸不受支持。".into()); }
    Ok((width, height))
}

fn caption_image(path: &Path, text: &str, width: u32, height: u32) -> Result<(), String> {
    let font = load_caption_font()?;
    let scale = PxScale::from((height as f32 * 0.055).clamp(20.0, 74.0));
    let max_width = width * 9 / 10;
    let mut lines = Vec::<String>::new();
    for paragraph in text.lines() {
        let mut line = String::new();
        for character in paragraph.chars() {
            let candidate = format!("{line}{character}");
            if !line.is_empty() && text_size(scale, &font, &candidate).0 > max_width {
                lines.push(std::mem::take(&mut line));
            }
            line.push(character);
        }
        lines.push(line);
    }
    if lines.len() > 5 { return Err("字幕过长，请缩短文字或拆成多段。".into()); }
    let mut canvas = RgbaImage::new(width, height);
    let line_height = (scale.y * 1.35).ceil() as i32;
    let total_height = line_height * lines.len() as i32;
    let bottom_margin = (height as f32 * 0.06) as i32;
    for (index, line) in lines.iter().enumerate() {
        let text_width = text_size(scale, &font, line).0 as i32;
        let x = ((width as i32 - text_width) / 2).max(0);
        let y = (height as i32 - bottom_margin - total_height + index as i32 * line_height).max(0);
        for dx in -2..=2 { for dy in -2..=2 {
            draw_text_mut(&mut canvas, Rgba([0, 0, 0, 230]), x + dx, y + dy, scale, &font, line);
        }}
        draw_text_mut(&mut canvas, Rgba([255, 255, 255, 255]), x, y, scale, &font, line);
    }
    canvas.save(path).map_err(|e| format!("无法创建字幕图层：{e}"))
}

#[tauri::command]
pub async fn burn_video_caption(
    input_path: String,
    text: String,
    start_seconds: f64,
    end_seconds: f64,
) -> Result<String, String> {
    let caption = text.trim();
    if caption.is_empty() || caption.chars().count() > 300 {
        return Err("字幕应为 1 至 300 字。".into());
    }
    if !start_seconds.is_finite() || !end_seconds.is_finite()
        || start_seconds < 0.0 || end_seconds <= start_seconds || end_seconds > 3600.0 {
        return Err("字幕时间范围无效。".into());
    }
    let input = Path::new(&input_path);
    if !input.is_file() || !matches!(input.extension().and_then(|v| v.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("mp4" | "mov" | "m4v" | "webm")) {
        return Err("字幕烧录需要本机视频文件。".into());
    }
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let output = input.with_file_name(format!("{}-captioned-{nonce}.mp4",
        input.file_stem().and_then(|v| v.to_str()).unwrap_or("video")));
    let layer = std::env::temp_dir().join(format!("mvaigc-caption-{nonce}.png"));
    let (width, height) = video_dimensions(input)?;
    caption_image(&layer, caption, width, height)?;
    let filter = format!("[0:v][1:v]overlay=0:0:shortest=1:enable='between(t,{start_seconds},{end_seconds})'[v]");
    let input_path_owned = input_path.clone();
    let output_path_owned = output.to_string_lossy().to_string();
    let layer_path_owned = layer.to_string_lossy().to_string();
    let result = tokio::task::spawn_blocking(move || {
        Command::new("ffmpeg").args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i", &input_path_owned,
            "-loop", "1", "-i", &layer_path_owned, "-filter_complex", &filter, "-map", "[v]", "-map", "0:a?",
            "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "copy", "-y", &output_path_owned]).output()
    }).await.map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&layer);
    let output_status = result.map_err(|e| format!("无法启动 FFmpeg：{e}"))?;
    if !output_status.status.success() {
        let _ = std::fs::remove_file(&output);
        return Err(format!("字幕烧录失败：{}", String::from_utf8_lossy(&output_status.stderr)));
    }
    Ok(output.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_exact_chinese_text_to_a_transparent_layer() {
        let path = std::env::temp_dir().join("mvaigc-caption-unit.png");
        caption_image(&path, "你好{世界}\n第二行", 640, 360).unwrap();
        let image = image::open(&path).unwrap().to_rgba8();
        assert!(image.pixels().any(|pixel| pixel.0[3] > 0));
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn burns_caption_to_a_new_video_when_ffmpeg_is_available() {
        if Command::new("ffmpeg").arg("-version").output().is_err() { return; }
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let input = std::env::temp_dir().join(format!("caption-test-{nonce}.mp4"));
        let create = Command::new("ffmpeg").args(["-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "color=c=black:s=320x180:d=1", "-c:v", "libx264", "-y",
            input.to_str().unwrap()]).output().unwrap();
        assert!(create.status.success());
        let output = burn_video_caption(input.to_string_lossy().to_string(), "你好".into(), 0.0, 0.8).await.unwrap();
        assert!(Path::new(&output).is_file());
        assert!(input.is_file());
        let _ = std::fs::remove_file(input);
        let _ = std::fs::remove_file(output);
    }
}
