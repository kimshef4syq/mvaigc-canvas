use std::path::Path;

use serde_json::{json, Value};

pub(crate) fn write_local_mcp_server(
    claude_json: &Path,
    project_dir: &str,
    server_name: &str,
    command: &str,
    args: &[String],
) -> Result<(), String> {
    let mut root: Value = match std::fs::read(claude_json) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("~/.claude.json 不是合法 JSON，未改动：{e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(format!("读取 ~/.claude.json 失败：{e}")),
    };
    if !root.is_object() {
        root = json!({});
    }
    let entry = json!({ "type": "stdio", "command": command, "args": args, "env": {} });
    root["projects"][project_dir]["mcpServers"][server_name] = entry;
    let bytes = serde_json::to_vec_pretty(&root).map_err(|e| e.to_string())?;
    // 原子写：临时文件 + rename
    let tmp = claude_json.with_extension("json.osc-tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("写入临时文件失败：{e}"))?;
    std::fs::rename(&tmp, claude_json).map_err(|e| format!("替换 ~/.claude.json 失败：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_file_with_entry_when_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".claude.json");
        write_local_mcp_server(&path, "/proj", "storyboard_canvas", "/bin/osc", &["a".into()]).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["projects"]["/proj"]["mcpServers"]["storyboard_canvas"]["command"], "/bin/osc");
        assert_eq!(v["projects"]["/proj"]["mcpServers"]["storyboard_canvas"]["args"][0], "a");
    }

    #[test]
    fn preserves_other_keys_projects_and_servers() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".claude.json");
        std::fs::write(&path, r#"{"numStartups":7,"projects":{"/other":{"mcpServers":{"x":{"type":"stdio"}}},"/proj":{"mcpServers":{"keep":{"type":"stdio"}}}}}"#).unwrap();
        write_local_mcp_server(&path, "/proj", "storyboard_canvas", "/bin/osc", &[]).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["numStartups"], 7);
        assert!(v["projects"]["/other"]["mcpServers"]["x"].is_object());
        assert!(v["projects"]["/proj"]["mcpServers"]["keep"].is_object());
        assert!(v["projects"]["/proj"]["mcpServers"]["storyboard_canvas"].is_object());
    }

    #[test]
    fn malformed_existing_file_is_left_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".claude.json");
        std::fs::write(&path, "{ this is not json").unwrap();
        let err = write_local_mcp_server(&path, "/proj", "storyboard_canvas", "/bin/osc", &[]);
        assert!(err.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ this is not json");
    }
}
