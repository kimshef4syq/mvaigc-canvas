//! External interactive terminals. Separate from the restricted in-canvas agents.
use super::connection::ExternalAgentConnectionDescriptor;
use super::*;
use crate::commands::mvaigc_proxy::MvaigcProxyState;
use std::fs;
use std::process::Stdio;
use tokio::process::Command;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAgentLaunchRequest {
    pub connection_id: String,
    pub project_id: String,
    pub runtime: ExternalAgentRuntime,
    pub node_id: Option<String>,
    pub asset_id: Option<String>,
    pub reference_path: Option<String>,
    #[serde(default)]
    pub full_production: bool,
    #[serde(default)]
    pub upgrade_environment: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAgentLaunchInfo {
    pub launch_id: String,
    pub project_dir: String,
    pub manifest_path: String,
}

fn process_error(message: impl Into<String>) -> ExternalAgentCommandError {
    ExternalAgentCommandError::process(message)
}

fn private_write(
    path: &Path,
    content: &[u8],
    executable: bool,
) -> Result<(), ExternalAgentCommandError> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(if executable { 0o700 } else { 0o600 });
    }
    let mut file = options
        .open(path)
        .map_err(|_| process_error("Cannot create launch file"))?;
    file.write_all(content)
        .map_err(|_| process_error("Cannot write launch file"))
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn executable(name: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut dirs: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(home) = home {
        for rel in [".local/bin", ".npm-global/bin", ".bun/bin"] {
            dirs.push(home.join(rel));
        }
    }
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);
    dirs.into_iter()
        .map(|dir| dir.join(name))
        .find(|path| path.is_file())
}

fn skill_source() -> Result<PathBuf, ExternalAgentCommandError> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| process_error("HOME is unavailable"))?;
    [
        ".claude/skills/hypit",
        ".agents/skills/hypit",
        ".codex/skills/hypit",
    ]
    .iter()
    .map(|rel| home.join(rel))
    .find(|path| path.join("SKILL.md").is_file())
    .ok_or_else(|| {
        process_error("请先安装一次 Hypit 官方技能；检测了 Claude Code 与 Codex 的技能目录。")
    })
}

fn provider_resources(app: &AppHandle) -> Result<PathBuf, ExternalAgentCommandError> {
    #[cfg(debug_assertions)]
    {
        let dev =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/hypit-provider-mvaigc");
        if dev.join("dist/activation.js").is_file() {
            return Ok(dev);
        }
    }
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|_| process_error("Resource directory is unavailable"))?
        .join("resources/hypit-provider-mvaigc");
    if bundled.join("prepare-project.mjs").is_file() {
        return Ok(bundled);
    }
    Err(process_error(
        "Provider resources are missing; rebuild the application resources.",
    ))
}

fn validate_reference(
    project: &Path,
    reference: Option<&str>,
) -> Result<Option<PathBuf>, ExternalAgentCommandError> {
    let Some(reference) = reference else {
        return Ok(None);
    };
    let path = PathBuf::from(reference);
    let info =
        fs::symlink_metadata(&path).map_err(|_| process_error("参考视频已丢失，请重新上传"))?;
    if !info.file_type().is_file() || info.len() == 0 || info.len() > 512 * 1024 * 1024 {
        return Err(process_error(
            "参考视频必须是非空普通文件，且不超过 512 MiB",
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| process_error("Cannot resolve reference video"))?;
    let imports = project
        .join("imports")
        .canonicalize()
        .map_err(|_| process_error("Video imports are unavailable"))?;
    if !canonical.starts_with(imports) {
        return Err(ExternalAgentCommandError::permission_denied(
            "Reference is outside this project's imports",
        ));
    }
    Ok(Some(canonical))
}

fn launch_arguments(
    runtime: ExternalAgentRuntime,
    project: &Path,
    mcp: &Path,
    host: &Path,
    descriptor: &Path,
    prompt: &str,
) -> Vec<String> {
    match runtime {
        ExternalAgentRuntime::Claude => vec!["--mcp-config".into(), mcp.to_string_lossy().into(), prompt.into()],
        ExternalAgentRuntime::Codex => vec!["--no-daemon".into(), "-C".into(), project.to_string_lossy().into(), "-c".into(),
            format!("mcp_servers.storyboard_canvas={{command={},args=[\"--external-agent-mcp\",{}],startup_timeout_sec=10,tool_timeout_sec=3600}}", codex::toml_string(&host.to_string_lossy()), codex::toml_string(&descriptor.to_string_lossy())), prompt.into()],
    }
}

#[tauri::command]
pub async fn launch_video_agent(
    app: AppHandle,
    state: State<'_, ExternalAgentState>,
    proxy: State<'_, MvaigcProxyState>,
    request: VideoAgentLaunchRequest,
) -> Result<VideoAgentLaunchInfo, ExternalAgentCommandError> {
    if !cfg!(target_os = "macos") {
        return Err(process_error(
            "当前一键外部终端入口仅支持 macOS；其他平台仍可使用已有连接配置。",
        ));
    }
    // Serialize preparation (npm and mutable runtime files) across double-clicks/agents.
    let _guard = state.inner.video_launch_lock.lock().await;
    let session = state
        .inner
        .sessions
        .read()
        .await
        .get(&request.connection_id)
        .cloned()
        .ok_or_else(|| process_error("画布连接已失效，请重试"))?;
    if !session.user_managed
        || session.cancelled.load(Ordering::SeqCst)
        || session.capability_expires_at <= now_millis()
        || session.project_id.as_deref() != Some(&request.project_id)
    {
        return Err(ExternalAgentCommandError::permission_denied(
            "The connection belongs to another project or has expired",
        ));
    }
    let project = session
        .hypit_project_dir
        .clone()
        .ok_or_else(|| process_error("Hypit project is unavailable"))?;
    let reference = validate_reference(&project, request.reference_path.as_deref())?;
    if reference.is_some() != request.asset_id.is_some() {
        return Err(process_error("Reference asset identity is missing"));
    }
    let target = discover_runtime(request.runtime)
        .ok_or_else(|| process_error("未找到所选智能体 CLI，请先安装或检查 PATH"))?;
    let mut help_command = target.command();
    help_command.arg("--help").kill_on_drop(true);
    let help = tokio::time::timeout(Duration::from_secs(8), help_command.output())
        .await
        .map_err(|_| process_error("智能体 CLI 检查超时，请在终端确认它能正常启动"))?
        .map_err(|_| process_error("无法执行所选智能体 CLI"))?;
    let help_text = String::from_utf8_lossy(&help.stdout);
    let required = match request.runtime {
        ExternalAgentRuntime::Codex => vec!["--no-daemon", "--config", "--cd"],
        ExternalAgentRuntime::Claude => vec!["--mcp-config"],
    };
    if !help.status.success() || required.iter().any(|flag| !help_text.contains(flag)) {
        return Err(process_error(
            "当前 CLI 版本不支持所需的会话配置，请先更新所选 CLI；画布不会自动更改你的全局安装。",
        ));
    }
    let target_command = target.command();
    let target_program = PathBuf::from(target_command.as_std().get_program());
    let node =
        executable("node").ok_or_else(|| process_error("请先安装 Node.js（含 npm），然后重试"))?;
    executable("npm").ok_or_else(|| process_error("未找到 npm，请修复 Node.js 安装"))?;
    let skill = skill_source()?;
    let resources = provider_resources(&app)?;
    let port = proxy
        .state
        .port()
        .ok_or_else(|| process_error("请先在画布设置登录并启用 mvaigc 服务"))?;
    let launch_id = Uuid::new_v4().to_string();
    let launch_dir = project.join(".canvas-agent/sessions").join(&launch_id);
    fs::create_dir_all(&launch_dir).map_err(|_| process_error("Cannot create launch directory"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&launch_dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| process_error("Cannot protect launch directory"))?;
    }
    let descriptor = launch_dir.join("canvas-mcp.json");
    private_write(
        &descriptor,
        &serde_json::to_vec(&ExternalAgentConnectionDescriptor {
            schema_version: 1,
            broker_address: session.broker.address.clone(),
            capability_token: session.broker.token.clone(),
            session_id: request.connection_id.clone(),
            expires_at: session.capability_expires_at,
        })
        .map_err(|_| process_error("Cannot encode descriptor"))?,
        false,
    )?;
    let weak = Arc::downgrade(&session);
    let grant = proxy
        .state
        .issue_local_grant(
            session.capability_expires_at,
            Arc::new(move || {
                weak.upgrade()
                    .map(|session| !session.cancelled.load(Ordering::SeqCst))
                    .unwrap_or(false)
            }),
        )
        .await
        .map_err(process_error)?;
    // Renew the project's grant atomically. A persistent Hypit worker reads
    // this file for each request instead of retaining its old environment token.
    let grant_file = project.join(".canvas-agent/service-grant");
    {
        use std::io::Write;
        let mut temporary = tempfile::NamedTempFile::new_in(grant_file.parent().unwrap())
            .map_err(|_| process_error("Cannot prepare local service grant"))?;
        temporary
            .write_all(grant.as_bytes())
            .map_err(|_| process_error("Cannot write local service grant"))?;
        temporary
            .persist(&grant_file)
            .map_err(|_| process_error("Cannot renew local service grant"))?;
    }
    let credential = format!("osc-grant-file:{}", grant_file.display());
    let cache = app
        .path()
        .app_data_dir()
        .map_err(|_| process_error("App data directory unavailable"))?
        .join("hypit-provider-cache");
    let setup = launch_dir.join("setup.json");
    private_write(&setup, &serde_json::to_vec(&json!({ "projectDir": project, "cacheDir": cache,
        "baseUrl": format!("http://127.0.0.1:{port}"), "skillSource": skill, "upgradeEnvironment": request.upgrade_environment })).unwrap(), false)?;
    let path_prefix = format!(
        "{}:{}:/opt/homebrew/bin:/usr/local/bin",
        project.join("node_modules/.bin").display(),
        node.parent().unwrap_or(Path::new("/usr/bin")).display()
    );
    let path_env = format!(
        "{}:{}",
        path_prefix,
        std::env::var("PATH").unwrap_or_default()
    );
    let output = Command::new(&node)
        .arg(resources.join("prepare-project.mjs"))
        .arg(&setup)
        .env("PATH", &path_env)
        .env("OSC_MVAIGC_TOKEN", &credential)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|_| process_error("Cannot start environment preparation"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        return Err(process_error(format!(
            "环境准备失败：{}",
            truncate_chars(&redact_text(&message), 1000)
        )));
    }
    // Never launch into another canvas if the active connection changed during install.
    if session.cancelled.load(Ordering::SeqCst) {
        return Err(process_error("准备期间画布连接已切换，请从当前画布重试"));
    }
    let manifest = launch_dir.join("task.json");
    private_write(&manifest, &serde_json::to_vec_pretty(&json!({
        "schemaVersion": 1, "taskId": launch_id, "projectId": request.project_id,
        "nodeId": request.node_id, "assetId": request.asset_id, "referencePath": reference,
        "mode": if request.full_production { "full" } else { "quick" },
        "instructions": include_str!("../../../../resources/hypit-provider-mvaigc/agent-workflow.md"),
        "capabilities": { "imageResolution": "2K", "imageFormat": "provider-determined", "videoResolutions": ["768P", "2K"] },
    })).unwrap(), false)?;
    let mcp = launch_dir.join("mcp.json");
    let host =
        std::env::current_exe().map_err(|_| process_error("Application executable unavailable"))?;
    private_write(
        &mcp,
        &serde_json::to_vec(&json!({ "mcpServers": { "storyboard_canvas": {
            "command": host, "args": ["--external-agent-mcp", descriptor]
        }}}))
        .unwrap(),
        false,
    )?;
    let prompt = format!("使用 Hypit 处理当前画布工程。先读取任务清单 {} 并遵循其中 instructions。参考已准备好，不要重新查找其他画布。先确认参考与任务范围；未收到生成指令前不要提交付费任务。", manifest.display());
    let args = launch_arguments(request.runtime, &project, &mcp, &host, &descriptor, &prompt);
    let mut command_args = target_command
        .as_std()
        .get_args()
        .map(|v| quote(&v.to_string_lossy()))
        .collect::<Vec<_>>();
    command_args.extend(args.iter().map(|v| quote(v)));
    let script = format!("#!/bin/zsh -l\n# Private local grant; do not share this file.\ncd -- {} || exit 1\nunset CLAUDECODE\nexport PATH={}:\"$PATH\"\nexport OSC_MVAIGC_TOKEN={}\nexec {} {}\n", quote(&project.to_string_lossy()), quote(&path_prefix), quote(&credential), quote(&target_program.to_string_lossy()), command_args.join(" "));
    let script_path = launch_dir.join("open-agent.command");
    private_write(&script_path, script.as_bytes(), true)?;
    let result = Command::new("/usr/bin/open")
        .args(["-a", "Terminal"])
        .arg(&script_path)
        .status()
        .await
        .map_err(|_| process_error("无法打开 macOS Terminal"))?;
    if !result.success() {
        return Err(process_error("终端启动失败，请确认 macOS Terminal 可用"));
    }
    Ok(VideoAgentLaunchInfo {
        launch_id,
        project_dir: project.to_string_lossy().into(),
        manifest_path: manifest.to_string_lossy().into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shell_literals_cannot_expand_user_input() {
        assert_eq!(quote("a'b $(touch /tmp/no)"), "'a'\\''b $(touch /tmp/no)'");
    }
    #[test]
    fn cli_arguments_preserve_user_model_and_permissions() {
        let args = launch_arguments(
            ExternalAgentRuntime::Codex,
            Path::new("/工程 a"),
            Path::new("/mcp"),
            Path::new("/host"),
            Path::new("/session/a.json"),
            "task",
        );
        assert!(args.contains(&"/工程 a".into()));
        assert!(!args
            .iter()
            .any(|arg| arg.contains("bypass") || arg == "--model"));
        assert!(args.iter().any(|arg| arg.contains("/session/a.json")));
    }
    #[test]
    fn reference_validation_rejects_outside_files_and_symlinks() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("imports")).unwrap();
        let outside = root.path().join("outside.mp4");
        fs::write(&outside, b"video").unwrap();
        assert!(validate_reference(root.path(), outside.to_str()).is_err());
        let valid = root.path().join("imports/video.mp4");
        fs::write(&valid, b"video").unwrap();
        assert!(validate_reference(root.path(), valid.to_str()).is_ok());
        #[cfg(unix)]
        {
            let link = root.path().join("imports/link.mp4");
            std::os::unix::fs::symlink(&valid, &link).unwrap();
            assert!(validate_reference(root.path(), link.to_str()).is_err());
        }
    }
}
