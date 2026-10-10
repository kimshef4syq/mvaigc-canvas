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
    // 逐层安全下钻：任一中间层存在但不是对象 → 返回 Err 且不写。
    // 不用 `[]` 索引赋值——它对非对象中间层会 panic（serde_json 只对 Null 自动建对象）。
    let root_obj = root
        .as_object_mut()
        .ok_or_else(|| "~/.claude.json 顶层不是对象，未改动".to_string())?;
    let projects = root_obj
        .entry("projects")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "~/.claude.json 的 projects 不是对象，未改动".to_string())?;
    {
        let project = projects
            .entry(project_dir.to_string())
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or_else(|| format!("projects[{project_dir}] 不是对象，未改动"))?;
        let servers = project
            .entry("mcpServers")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or_else(|| "mcpServers 不是对象，未改动".to_string())?;
        let entry = json!({ "type": "stdio", "command": command, "args": args, "env": {} });
        servers.insert(server_name.to_string(), entry);
    }
    // 清理其它目录下的同名画布条目：旧版本会为每个目录写一条指向已删除的
    // canvas-mcp-<UUID>.json 的条目，留着会在那些目录启动 Claude Code 时报错。
    // 仅当条目确实是画布 MCP（args 含 --external-agent-mcp）才删，避免误删用户其它用途的同名 server。
    for (dir, project) in projects.iter_mut() {
        if dir.as_str() == project_dir {
            continue;
        }
        let Some(servers) = project
            .as_object_mut()
            .and_then(|p| p.get_mut("mcpServers"))
            .and_then(|m| m.as_object_mut())
        else {
            continue;
        };
        let is_canvas = servers
            .get(server_name)
            .and_then(|s| s.get("args"))
            .and_then(|a| a.as_array())
            .map(|a| a.iter().any(|v| v.as_str() == Some("--external-agent-mcp")))
            .unwrap_or(false);
        if is_canvas {
            servers.remove(server_name);
        }
    }
    let bytes = serde_json::to_vec_pretty(&root).map_err(|e| e.to_string())?;
    // 原子写：临时文件（0600）+ rename
    let tmp = claude_json.with_extension("json.osc-tmp");
    write_private(&tmp, &bytes).map_err(|e| format!("写入临时文件失败：{e}"))?;
    std::fs::rename(&tmp, claude_json).map_err(|e| format!("替换 ~/.claude.json 失败：{e}"))?;
    Ok(())
}

/// 写临时文件时限定权限，避免 rename 后把 0600 的 `~/.claude.json` 变成世界可读。
#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)
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
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn preserves_other_keys_projects_and_servers() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".claude.json");
        std::fs::write(&path, r#"{"numStartups":7,"projects":{"/other":{"mcpServers":{"x":{"type":"stdio"}}},"/proj":{"mcpServers":{"keep":{"type":"stdio"}}}}}"#).unwrap();
        write_local_mcp_server(&path, "/proj", "storyboard_canvas", "/bin/osc", &[]).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["numStartups"], 7);
        assert_eq!(v["projects"]["/other"]["mcpServers"]["x"]["type"], "stdio");
        assert_eq!(v["projects"]["/proj"]["mcpServers"]["keep"]["type"], "stdio");
        assert_eq!(v["projects"]["/proj"]["mcpServers"]["storyboard_canvas"]["command"], "/bin/osc");
    }

    #[test]
    fn removes_canvas_entry_from_other_project_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".claude.json");
        std::fs::write(
            &path,
            r#"{"projects":{"/other":{"mcpServers":{"storyboard_canvas":{"type":"stdio","command":"x","args":["--external-agent-mcp","/old.json"]},"keep":{"type":"stdio","args":["nope"]}}}}}"#,
        )
        .unwrap();
        write_local_mcp_server(&path, "/target", "storyboard_canvas", "/bin/osc", &["a".into()]).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(v["projects"]["/other"]["mcpServers"].get("storyboard_canvas").is_none());
        assert_eq!(v["projects"]["/other"]["mcpServers"]["keep"]["type"], "stdio");
        assert_eq!(v["projects"]["/target"]["mcpServers"]["storyboard_canvas"]["command"], "/bin/osc");
    }

    #[test]
    fn keeps_non_canvas_same_name_server_in_other_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".claude.json");
        std::fs::write(
            &path,
            r#"{"projects":{"/other":{"mcpServers":{"storyboard_canvas":{"type":"stdio","command":"x","args":["nope"]}}}}}"#,
        )
        .unwrap();
        write_local_mcp_server(&path, "/target", "storyboard_canvas", "/bin/osc", &[]).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["projects"]["/other"]["mcpServers"]["storyboard_canvas"]["command"], "x");
        assert_eq!(v["projects"]["/target"]["mcpServers"]["storyboard_canvas"]["command"], "/bin/osc");
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

    #[test]
    fn projects_is_not_object_returns_err_without_panic() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".claude.json");
        let original = r#"{"projects":"oops"}"#;
        std::fs::write(&path, original).unwrap();
        let err = write_local_mcp_server(&path, "/proj", "storyboard_canvas", "/bin/osc", &[]);
        assert!(err.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    }
}
