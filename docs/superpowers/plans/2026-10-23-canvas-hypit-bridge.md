# 画布 ↔ Hypit 物料桥接 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在终端里开的 claude 能读画布物料（完整原图/视频/音频）、跑 hypit 出片、把结果回写成画布节点。

**Architecture:** 画布侧新建一个 hypit 视频工程目录（`app_data_dir/hypit-projects/<slug>/`）并给它和 `claudeCodeProjectDir` 各写一条 MCP local-scope 配置；`asset_read` 改为把资产原字节落盘到该工程的 `imports/` 并返回路径（不再返回压缩预览字节）；新增 `assets_import` MCP 工具 + `asset.import` 画布命令，把生成的成品媒体导回画布成节点。

**Tech Stack:** Rust（Tauri 2 commands、serde_json、tempfile）、React + TypeScript + Zustand、Vitest、cargo test。

**Spec:** `docs/superpowers/specs/2026-10-23-canvas-hypit-bridge-design.md`

## Global Constraints

- 只改 `mvaigc-canvas`；`open-storyboard-canvas/` 只读参照。
- Camera 相关一律不碰。
- 最小实现、外科手术式改动；每行改动可追溯到本 spec。
- 不删没让删的既有代码；沿用既有风格。
- 不复活画布面板的 claude runtime 通路（`CanvasAgentRuntimePicker` / `useExternalAgentRuntime` / `claude.rs` 一律不动）。
- 不改 application identifier（`com.ganbo-gab.open-storyboard-canvas`）。所有新代码走 `app.path().app_data_dir()`，**不得硬编码目录名**。
- 不做真 ffmpeg `media_postprocess`。
- 读取一律**返回文件路径，不返回字节**；图片必须取**完整原图**（绝不碰 `previewUrl`）。
- 落盘路径：`<app_data_dir>/hypit-projects/<slug>/`；导入中转目录 `imports/`；音频持久目录 `audio/`。
- slug 规则：`sanitize(projectName)` 截断 32 字符 + `-` + `projectId` 去掉连字符后前 8 位；`sanitize` 保留 ASCII 字母数字与 CJK，其余替换为 `-`。
- 单文件上限：图片 64 MiB、视频/音频 512 MiB；单批 1–16 个文件。
- 提交流署名：`Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

- **`hypitProjectDir` 为 null 时调用 `asset_read`** —— 例如连接是在升级前建的、或 `connection-params.json` 缺失。用户期望得到的是一句能看懂的说明，而不是崩溃或一个写着 `null/imports/...` 的路径。任务 5 覆盖。
- **`assets_import` 收到符号链接、FIFO 或指向目录的路径** —— spec 只说"是文件而非目录"。用户期望这类路径被拒绝，且**不产生任何节点与文件**。任务 6 覆盖。
- **`assets_import` 执行中途画布项目被切换** —— bridge 里 prepare 是 async 的（视频还要抽帧），窗口真实存在。用户期望是拒绝导入，而不是把外来的节点落进另一个项目。任务 6 覆盖。
- **同一 assetId 并发 `asset_read`** —— 两个调用同时写 `imports/<assetId>.<ext>`。`save_*_source_to_path` 用的是非原子的 `std::fs::write`（`image.rs:3445`），而 `executeOnce` 的幂等守卫只按 `(runId, toolName, callId)` 去重（`agentApproval.ts:1021`），同一 assetId 的不同 callId 不会被去重。**本计划不覆盖此项，也不修** —— 修它要改 `save_*_source_to_path` 这个被多处共用的既有命令（写成临时文件再 rename），超出本 spec 的授权范围。实际风险窄：同一 assetId 两次调用写出的是**逐字节相同**的内容，坏情况是恰好撞上写入窗口的读者看到半个文件。hypit 自己的 `media probe` 对损坏文件会直接报错，不会静默产出错误视频。**这一条留给你决定是否单开一轮修。**
- **项目名为空或全特殊字符时派生 slug** —— 用户期望得到一个合法、可复用的目录名，而不是 `-abc12345` 或空串。任务 2 覆盖（`hypit_slug_handles_empty_and_symbol_only_names`）。

---

## 文件结构

按职责落位，沿用既有分层。

**Rust（`src-tauri/src/`）**

| 文件 | 职责 | 本次改动 |
|---|---|---|
| `commands/image.rs` | 媒体解析与落盘 | 新增音频落盘三件套（T1）；新增导入路径分类（T6） |
| `commands/external_agent/connection.rs` | 连接建立、描述符、连接信息 | slug 派生 + 视频工程目录（T2）；会话字段与连接信息（T2）；双目录写配置的调用点（T3） |
| `commands/external_agent/claude_config.rs` | `~/.claude.json` local-scope 读改写 | 单目录 → 多目录（T3） |
| `commands/external_agent/mod.rs` | 会话结构 | `ExternalAgentSession` 加 `hypit_project_dir`（T2） |
| `lib.rs` | Tauri 命令注册 | 注册两个新命令（T1、T6） |

**TypeScript — 后端桥接（`src/commands/`）**

| 文件 | 职责 | 本次改动 |
|---|---|---|
| `image.ts` | 媒体命令的 IPC 桥 | `persistAudioSource`（T1）、`inspectImportMediaPaths`（T6） |
| `externalAgent.ts` | 外部 Agent 命令的 IPC 桥与类型 | `ExternalAgentConnectionInfo.hypitProjectDir`（T2） |

**TypeScript — 画布命令域（`src/features/canvas/`）**

| 文件 | 职责 | 本次改动 |
|---|---|---|
| `domain/canvasCommands.ts` | 命令类型与 union | `asset.import` 类型（T4） |
| `application/canvasCommandGraph.ts` | 图事务的原子应用 | `applyImportAssets`（T4） |
| `application/canvasCommandRegistry.ts` | schema、校验、摘要、分派 | `asset.import` 四件套（T4) |
| `domain/canvasCapabilities.ts` | 能力清单 | `asset.import` 声明（T4） |

**TypeScript — Agent 桥（`src/features/canvas/agent/`）**

| 文件 | 职责 | 本次改动 |
|---|---|---|
| `domain/agentModel.ts` | 工具名与事件类型 | `assets_import`（T7） |
| `application/externalAgentToolManifest.ts` | MCP 工具清单与 schema | `media-import` kind（T7） |
| `application/externalAgentPermissionPolicy.ts` | 只读判定与权限决策 | `assets_import` 分类（T7） |
| `application/canvasAgentController.ts` | 审批效果的推导 | `assets_import` → `canvas-write`（T7） |
| `application/externalAgentCanvasBridge.ts` | 工具执行入口 | `asset_read` 改落盘（T5）；`assets_import` 分支（T7） |
| `application/externalAgentAssetExport.ts` | **新建**：画布资产 → 原字节落盘 | T5 |
| `application/externalAgentImageRead.ts` | ~~JPEG 预览读取~~ | **删除**（T5，被取代） |
| `application/audioUpload.ts` | 音频节点数据准备 | 走 `persistAudioSource`（T7） |
| `ui/CanvasAgentDock.tsx`、`ui/ExternalAgentConnectionPanel.tsx`、`components/SettingsDialog.tsx` | 连接 UI | kind 列表 + 工程目录展示（T8） |
| `i18n/locales/{zh,en}.json` | 文案 | 四个新键（T8） |

**边界说明**：`externalAgentAssetExport.ts` 独立成文件，因为"读画布资产并落盘"与"执行 MCP 工具"是两件事，前者可单测（T5 的测试正是直接调它）。`asset.import` 走 `canvasCommandGraph.ts` 而非新建模块，因为它是既有的图事务模式之一，落在这里才能复用 `impact`/`success`/`reject` 与事务协调器。

---

### Task 1: 音频落盘能力（`persist_audio_source`）

**Files:**
- Modify: `src-tauri/src/commands/image.rs`（在 `persist_video_source` 之后，约 3200 行处）
- Modify: `src-tauri/src/lib.rs:261`（`persist_video_source` 注册行之后）
- Modify: `src/commands/image.ts`（`persistVideoSource` 之后）

**Interfaces:**
- Consumes: 既有的 `resolve_audio_source_bytes`（`image.rs:2572`，已支持 data URL / http / file:// / 本地绝对路径）、`normalize_audio_extension`（`image.rs:2019`）。
- Produces:
  - `fn resolve_audio_dir(app: &AppHandle) -> Result<PathBuf, String>`（镜像 `resolve_videos_dir`，`image.rs:1998`）
  - `fn persist_audio_bytes(app: &AppHandle, bytes: &[u8], extension: &str) -> Result<String, String>`（md5 内容寻址，镜像 `persist_video_bytes`，`image.rs:2115`）
  - `#[tauri::command] pub async fn persist_audio_source(app: AppHandle, source: String) -> Result<String, String>`
  - TS：`export async function persistAudioSource(source: string): Promise<string>`

- [ ] **Step 1: 写失败测试**

在 `image.rs` 末尾追加测试模块（与既有 `external_video_tests` 同风格）：

```rust
#[cfg(test)]
mod persist_audio_tests {
    use super::*;

    #[test]
    fn audio_bytes_are_content_addressed_and_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"RIFF\x00\x00\x00\x00WAVEfmt ";
        let first = persist_audio_bytes_in(dir.path(), bytes, "wav").unwrap();
        assert!(first.ends_with(".wav"));
        assert_eq!(std::fs::read(dir.path().join(&first)).unwrap(), bytes);
        assert_eq!(persist_audio_bytes_in(dir.path(), bytes, "wav").unwrap(), first);
    }

    #[test]
    fn unknown_audio_extension_falls_back_to_wav() {
        let dir = tempfile::tempdir().unwrap();
        let path = persist_audio_bytes_in(dir.path(), b"abc", "totally-unknown").unwrap();
        assert!(path.ends_with(".wav"));
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test --lib persist_audio_tests`
Expected: 编译失败，`persist_audio_bytes_in` not found

- [ ] **Step 3: 实现**

在 `persist_video_bytes` 之后加入。**照 `resolve_videos_dir` / `persist_video_bytes` / `persist_video_source` 三件套逐行镜像**，只把 `video`→`audio`、`videos`→`audio`、`normalize_video_extension`→`normalize_audio_extension`、`resolve_video_source_bytes_with_headers(..)`→`resolve_audio_source_bytes(..)`（后者只收一个 `&str` 参数，无 headers/network）。

唯一的结构差异：把内容寻址那步抽成 `persist_audio_bytes_in(directory: &Path, bytes: &[u8], extension: &str) -> Result<String, String>`，`persist_audio_bytes(app, ..)` 解析目录后转发。这样 Step 1 的两个测试可以脱离 Tauri `AppHandle` 直接跑。md5 内容寻址、`if !output_path.exists()` 的幂等写法与视频版一致。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src-tauri && cargo test --lib persist_audio_tests`
Expected: 2 passed

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/image.rs src-tauri/src/lib.rs src/commands/image.ts
git commit -m "feat(canvas): add persist_audio_source mirroring video persistence"
```

---

### Task 2: hypit 视频工程目录 + slug 派生

**Files:**
- Modify: `src-tauri/src/commands/external_agent/connection.rs`（`connection_info` 325-365、`establish_connection` 386-537、`ExternalAgentConnectionInfo` 99-113、tests 654+）
- Modify: `src-tauri/src/commands/external_agent/mod.rs`（`ExternalAgentSession` 字段区 412-431、会话构造 664-700、`start_external_agent_session` 的构造处，以及 `connection.rs` 里 `establish_connection` 的会话构造）
- Modify: `src/commands/externalAgent.ts`（`ExternalAgentConnectionInfo` 接口）

**Interfaces:**
- Consumes: 无（本任务独立）。
- Produces:
  - `fn hypit_project_slug(project_id: &str, project_name: &str) -> String`
  - `fn ensure_hypit_project_dir(app: &AppHandle, project_id: &str, project_name: &str) -> Result<PathBuf, ExternalAgentCommandError>`
  - `ExternalAgentSession.hypit_project_dir: Option<PathBuf>`（新字段；既有构造点须补 `None`）
  - `ExternalAgentConnectionInfo.hypit_project_dir: Option<String>`（serde camelCase → 前端 `hypitProjectDir`）
  - 前端 `ExternalAgentConnectionInfo.hypitProjectDir: string | null`

- [ ] **Step 1: 写失败测试**

在 `connection.rs` 的 `mod tests` 里加：

```rust
#[test]
fn hypit_slug_is_deterministic_and_path_safe() {
    let slug = hypit_project_slug("b9c96f36-e167-4d7d-9bbf-5dce6dd121d1", "AI4Animation 移植验收");
    assert_eq!(slug, "AI4Animation-移植验收-b9c96f36");
    assert!(!slug.contains('/') && !slug.contains('\\') && !slug.contains(' '));
    // 同输入必同输出
    assert_eq!(slug, hypit_project_slug("b9c96f36-e167-4d7d-9bbf-5dce6dd121d1", "AI4Animation 移植验收"));
}

#[test]
fn hypit_slug_handles_empty_and_symbol_only_names() {
    assert_eq!(hypit_project_slug("abcdef0123456789", ""), "project-abcdef01");
    assert_eq!(hypit_project_slug("abcdef0123456789", "///:::"), "project-abcdef01");
    assert_eq!(hypit_project_slug("ABCDEF01-2345", "  x  "), "x-ABCDEF01");
}

#[test]
fn hypit_slug_truncates_long_names_by_chars_not_bytes() {
    let slug = hypit_project_slug("id", &"中".repeat(100));
    assert_eq!(slug.chars().count(), 32 + 1 + 2);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test --lib external_agent::connection`
Expected: 编译失败，`hypit_project_slug` not found

- [ ] **Step 3: 实现 slug 与目录**

在 `connection.rs` 的 `CONNECTION_DESCRIPTOR_FILE` 常量附近加入：

```rust
const HYPIT_PROJECTS_DIR_NAME: &str = "hypit-projects";
const HYPIT_PROJECT_NAME_MAX_CHARS: usize = 32;

fn is_slug_safe_char(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || matches!(character as u32, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF)
}

/// 目录名派生：同一画布项目永远得到同一个视频工程目录，无需额外注册表。
pub(crate) fn hypit_project_slug(project_id: &str, project_name: &str) -> String {
    let sanitized: String = project_name
        .trim()
        .chars()
        .map(|character| if is_slug_safe_char(character) { character } else { '-' })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    let name: String = if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed.chars().take(HYPIT_PROJECT_NAME_MAX_CHARS).collect()
    };
    let id_fragment: String = project_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(8)
        .collect();
    format!("{name}-{id_fragment}")
}

/// 创建（首次）或复用视频工程目录。已存在时不覆盖 `package.json`，
/// 以免抹掉 hypit 自己写进该文件的内容。
pub(crate) fn ensure_hypit_project_dir(
    app: &AppHandle,
    project_id: &str,
    project_name: &str,
) -> Result<PathBuf, ExternalAgentCommandError> {
    let slug = hypit_project_slug(project_id, project_name);
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| {
            ExternalAgentCommandError::process(format!(
                "Failed to resolve the app data directory for the Hypit project: {error}"
            ))
        })?
        .join(HYPIT_PROJECTS_DIR_NAME)
        .join(&slug);
    std::fs::create_dir_all(&directory).map_err(|error| {
        ExternalAgentCommandError::process(format!(
            "Failed to prepare the Hypit project directory: {error}"
        ))
    })?;
    let manifest = directory.join("package.json");
    if !manifest.exists() {
        let contents = serde_json::to_vec_pretty(&serde_json::json!({
            "name": slug,
            "version": "0.0.0",
            "private": true,
            "type": "module",
            "hypit": { "project": true },
        }))
        .map_err(|error| {
            ExternalAgentCommandError::process(format!(
                "Failed to encode the Hypit project manifest: {error}"
            ))
        })?;
        std::fs::write(&manifest, contents).map_err(|error| {
            ExternalAgentCommandError::process(format!(
                "Failed to write the Hypit project manifest: {error}"
            ))
        })?;
    }
    Ok(directory)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src-tauri && cargo test --lib external_agent::connection`
Expected: 3 passed（slug 相关）

- [ ] **Step 5: 接到会话与连接信息上**

在 `ExternalAgentSession`（`mod.rs:412-431`）字段区加入：

```rust
    hypit_project_dir: Option<PathBuf>,
```

补齐**所有**既有构造点的该字段。用 `grep -rn "project_name: Some\|project_name: None" src-tauri/src/commands/external_agent/` 找出全部构造处（`mod.rs` 的 `start_external_agent_session`、`connection.rs` 的 `establish_connection`），各加 `hypit_project_dir: None,`（`establish_connection` 处见下）。

在 `ExternalAgentConnectionInfo`（`connection.rs:99-113`）加入：

```rust
    pub hypit_project_dir: Option<String>,
```

`disconnected_connection()` 里补 `hypit_project_dir: None,`。

`connection_info()`（325-365）的返回值里加：

```rust
        hypit_project_dir: session
            .hypit_project_dir
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
```

在 `establish_connection` 里、构造 `session` **之前**派生目录（`project_name` 已通过 `validate_project_text` 校验）：

```rust
    let hypit_project_dir = ensure_hypit_project_dir(app, &project_id, &project_name)?;
```

会话构造处加：

```rust
        hypit_project_dir: Some(hypit_project_dir.clone()),
```

最后在 `write_connection_params` 调用之后、写 `~/.claude.json` 之前，把目录用于 MCP 配置写入（任务 3 会改这个函数的签名；本任务先只把变量传递到位，本任务的验证不含此项）。

前端 `src/commands/externalAgent.ts` 的 `ExternalAgentConnectionInfo` 接口加：

```ts
  hypitProjectDir: string | null;
```

- [ ] **Step 6: 类型检查**

Run: `cd src-tauri && cargo check --lib` 与 `npx tsc --noEmit`
Expected: 均无错误

- [ ] **Step 7: 提交**

```bash
git add src-tauri/src/commands/external_agent/connection.rs src-tauri/src/commands/external_agent/mod.rs src/commands/externalAgent.ts
git commit -m "feat(agent): create a Hypit video project per canvas project"
```

---

### Task 3: MCP 配置写两个目录

**Files:**
- Modify: `src-tauri/src/commands/external_agent/claude_config.rs`（`write_local_mcp_server` 与 tests）
- Modify: `src-tauri/src/commands/external_agent/connection.rs`（`establish_connection` 里的调用点，约 514-535）

**Interfaces:**
- Consumes: 任务 2 的 `hypit_project_dir: PathBuf`。
- Produces: `pub(crate) fn write_local_mcp_server(claude_json: &Path, project_dirs: &[String], server_name: &str, command: &str, args: &[String]) -> Result<(), String>`（**签名变化**：`project_dir: &str` → `project_dirs: &[String]`）

- [ ] **Step 1: 改测试为多目录语义（失败）**

把 `claude_config.rs` 的 `mod tests` 中现有 5 个用例的调用改为传 `&["/proj".to_string()]` 形式，并新增：

```rust
    #[test]
    fn writes_every_requested_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".claude.json");
        write_local_mcp_server(
            &path,
            &["/proj".to_string(), "/hypit/工程 名".to_string()],
            "storyboard_canvas",
            "/bin/osc",
            &["a".into()],
        )
        .unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["projects"]["/proj"]["mcpServers"]["storyboard_canvas"]["command"], "/bin/osc");
        assert_eq!(v["projects"]["/hypit/工程 名"]["mcpServers"]["storyboard_canvas"]["command"], "/bin/osc");
    }

    #[test]
    fn empty_directory_list_writes_nothing_and_still_cleans() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".claude.json");
        std::fs::write(
            &path,
            r#"{"projects":{"/other":{"mcpServers":{"storyboard_canvas":{"type":"stdio","command":"x","args":["--external-agent-mcp","/old.json"]}}}}}"#,
        )
        .unwrap();
        write_local_mcp_server(&path, &[], "storyboard_canvas", "/bin/osc", &[]).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(v["projects"]["/other"]["mcpServers"].get("storyboard_canvas").is_none());
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test --lib external_agent::claude_config`
Expected: 编译失败，签名不匹配

- [ ] **Step 3: 实现**

把 `write_local_mcp_server` 的 `project_dir: &str` 参数换成 `project_dirs: &[String]`：

- 下钻到 `projects` 对象后，**先**做原有的"清理其它目录"循环，把跳过条件从 `dir.as_str() == project_dir` 改为 `project_dirs.iter().any(|target| target == dir.as_str())`。
- **再**遍历 `project_dirs`，对每个目录执行原有的 entry 写入（`projects.entry(dir).or_insert_with(json!({}))` → `mcpServers` → `insert`）。
- 其余不变：`projects` 非对象时返回 `Err` 且不写；坏 JSON 原样保留；原子写 + 0600。

`connection.rs` 的调用点改为收集两个目录（跳过空的 `claudeCodeProjectDir`，保持现语义）：

```rust
            let mut target_dirs = Vec::new();
            if let Some(dir) = claude_code_project_dir.as_deref().filter(|dir| !dir.trim().is_empty()) {
                target_dirs.push(dir.to_string());
            }
            target_dirs.push(hypit_project_dir.to_string_lossy().into_owned());
            if let Err(error) = super::claude_config::write_local_mcp_server(
                &home.join(".claude.json"),
                &target_dirs,
                "storyboard_canvas",
                &executable,
                &args,
            ) {
                warn!("未能写入 Claude Code 配置（不影响画布内使用）：{error}");
            }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src-tauri && cargo test --lib external_agent::claude_config`
Expected: 7 passed

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/external_agent/claude_config.rs src-tauri/src/commands/external_agent/connection.rs
git commit -m "feat(agent): write the canvas MCP entry into every configured Claude Code directory"
```

---

### Task 4: `asset.import` 画布命令

**Files:**
- Modify: `src/features/canvas/domain/canvasCommands.ts`（`CANVAS_COMMAND_TYPES`、新增 `ImportAssetsCommand`、`CanvasCommand` union）
- Modify: `src/features/canvas/application/canvasCommandGraph.ts`（`CANVAS_GRAPH_COMMAND_TYPES`、`applyImportAssets`、分派）
- Modify: `src/features/canvas/application/canvasCommandRegistry.ts`（`EFFECTS`、`INPUT_SCHEMAS`、`summarizeCommand`、`validate`）
- Modify: `src/features/canvas/domain/canvasCapabilities.ts`（`canvasActionCapabilityManifest`）
- Test: `src/features/canvas/application/canvasCommandRegistry.test.ts`

**Interfaces:**
- Consumes: `NodeFactory.createNode`（`ports.ts:22-28`）、`AddNodesBatchInput` 形状（`canvasStore.ts:87-92`）、`CanvasGraphDraft`（`canvasTransactionCoordinator.ts:15-19`）。
- Produces:
  - `type CanvasCommandType` 新增 `'asset.import'`；`ExportImageNodeData` 无关
  - `ImportAssetsCommand = CanvasCommandBase<'asset.import', { nodes: Array<{ nodeType: CanvasNodeType; position: XYPosition; data: Record<string, unknown> }> }>`
  - `function applyImportAssets(command: Extract<CanvasCommand, { type: 'asset.import' }>, draft: CanvasGraphDraft, nodeFactory: NodeFactory): CanvasGraphCommandPreparation`

- [ ] **Step 1: 写失败测试**

在 `canvasCommandRegistry.test.ts` 加：

```ts
describe('asset.import', () => {
  const node = (type: string) => ({
    nodeType: type,
    position: { x: 10, y: 20 },
    data: { imageUrl: '/abs/imports/a.png', aspectRatio: '16:9' },
  });

  it('adds imported nodes and advances the revision', async () => {
    const before = canvasCommandRegistry.getRevision();
    const result = await canvasCommandRegistry.executeApproved(
      { type: 'asset.import', version: CANVAS_COMMAND_VERSION, input: { nodes: [node(CANVAS_NODE_TYPES.upload)] } },
      before,
      'agent',
    );
    expect(result.ok).toBe(true);
    expect(useCanvasStore.getState().revision).toBe(before + 1);
    expect(useCanvasStore.getState().nodes.some((n) => n.data.imageUrl === '/abs/imports/a.png')).toBe(true);
  });

  it('rejects node types outside the import allowlist', async () => {
    const before = canvasCommandRegistry.getRevision();
    const result = await canvasCommandRegistry.executeApproved(
      { type: 'asset.import', version: CANVAS_COMMAND_VERSION, input: { nodes: [node(CANVAS_NODE_TYPES.blueprint)] } },
      before,
      'agent',
    );
    expect(result.ok).toBe(false);
    expect(useCanvasStore.getState().revision).toBe(before);
  });

  it('rejects a revision conflict without touching the graph', async () => {
    const before = canvasCommandRegistry.getRevision();
    const result = await canvasCommandRegistry.executeApproved(
      { type: 'asset.import', version: CANVAS_COMMAND_VERSION, input: { nodes: [node(CANVAS_NODE_TYPES.upload)] } },
      before - 1,
      'agent',
    );
    expect(result.ok).toBe(false);
    expect(useCanvasStore.getState().revision).toBe(before);
  });
});
```

（`canvasCommandRegistry`、`CANVAS_COMMAND_VERSION`、`CANVAS_NODE_TYPES`、`useCanvasStore` 该测试文件已全部导入；`asset.import` 的测试放在既有顶层 `describe` 内，复用其 `beforeEach(resetCanvas)`。）

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/features/canvas/application/canvasCommandRegistry.test.ts`
Expected: FAIL，`asset.import` 不在 `CANVAS_COMMAND_TYPES`

- [ ] **Step 3: 定义命令类型**

`canvasCommands.ts`：在 `CANVAS_COMMAND_TYPES` 数组的 `'asset.list'` 之前加入 `'asset.import',`。

在 `ListAssetsCommand` 附近加入：

```ts
export type ImportAssetsCommand = CanvasCommandBase<'asset.import', {
  nodes: Array<{
    nodeType: CanvasNodeType;
    position: XYPosition;
    data: Record<string, unknown>;
  }>;
}>;
```

并把 `ImportAssetsCommand` 加进 `CanvasCommand` union。

- [ ] **Step 4: 实现图事务**

`canvasCommandGraph.ts`：

1. `CANVAS_GRAPH_COMMAND_TYPES` 加入 `'asset.import'`。
2. 在 `applyCreateGroup` 附近加入。导入的节点类型不在 `canCreateCanvasNodeDirectly` 的白名单内（`videoNode`/`audioNode` 的 `directCreate` 是 `false`），因此这里**不**查该能力表，改用显式白名单：

```ts
const IMPORTABLE_NODE_TYPES: readonly CanvasNodeType[] = [
  CANVAS_NODE_TYPES.upload,
  CANVAS_NODE_TYPES.video,
  CANVAS_NODE_TYPES.audio,
];

function applyImportAssets(
  command: Extract<CanvasCommand, { type: 'asset.import' }>,
  draft: CanvasGraphDraft,
  nodeFactory: NodeFactory,
): CanvasGraphCommandPreparation {
  const inputs = command.input.nodes;
  const unsupported = inputs.find((input) => !IMPORTABLE_NODE_TYPES.includes(input.nodeType));
  if (unsupported) {
    return reject(
      `Node type ${unsupported.nodeType} cannot receive imported media.`,
      'unsupported_command',
    );
  }
  const created = inputs.map((input) => nodeFactory.createNode(
    input.nodeType,
    { ...input.position },
    input.data as Partial<CanvasNodeData>,
  ));
  return success(
    { ...draft, nodes: [...draft.nodes, ...created] },
    impact(`Import ${created.length} generated media node(s) into the canvas.`, {
      affectedNodeIds: created.map((node) => node.id),
      creates: { nodes: created.length, edges: 0, groups: 0 },
    }),
    { references: { nodeIds: created.map((node) => node.id) } },
  );
}
```

3. 在 `applyGraphCommand` 的分派 switch 里、`case 'group.ungroup'` 之前加入：

```ts
    case 'asset.import':
      return applyImportAssets(command, draft, nodeFactory);
```

- [ ] **Step 5: 接入 registry**

`canvasCommandRegistry.ts`：

- `EFFECTS` 加 `'asset.import': 'graph',`
- `summarizeCommand` 加分支（在 `case 'node.create'` 附近）：

```ts
    case 'asset.import':
      return `Import ${command.input.nodes.length} generated media node(s).`;
```

- `INPUT_SCHEMAS` 加条目：

```ts
  'asset.import': objectSchema(['nodes'], {
    nodes: arrayField(
      'Imported media nodes. Each entry supplies a finished node type, a canvas position, and its node data.',
      objectField('One imported node.', {
        nodeType: stringField(
          'Finished node type that receives imported media.',
          [CANVAS_NODE_TYPES.upload, CANVAS_NODE_TYPES.video, CANVAS_NODE_TYPES.audio],
        ),
        position: finitePositionField,
        data: objectField('Node data written verbatim by the preparing caller.', undefined, undefined, true),
      }, ['nodeType', 'position', 'data'], false),
    ),
  }),
```

- `validate` 的 switch 加分支（在 `case 'node.create'` 之后）：

```ts
    case 'asset.import':
      if (!Array.isArray(command.input.nodes) || command.input.nodes.length === 0) {
        errors.push('asset.import requires a non-empty nodes array.');
        break;
      }
      for (const input of command.input.nodes) {
        if (!isPlainRecord(input)) {
          errors.push('asset.import node entries must be objects.');
          continue;
        }
        if (![CANVAS_NODE_TYPES.upload, CANVAS_NODE_TYPES.video, CANVAS_NODE_TYPES.audio]
          .includes(input.nodeType as CanvasNodeType)) {
          errors.push(`asset.import cannot create node type ${String(input.nodeType)}.`);
        }
        validateFinitePosition(input.position, 'position', errors);
        if (!isPlainRecord(input.data)) {
          errors.push('asset.import node data must be an object.');
        } else {
          validateJsonConfiguration(input.data, 'data', errors);
        }
      }
      break;
```

`canvasCapabilities.ts`：`canvasActionCapabilityManifest` 加：

```ts
  'asset.import': { status: 'supported' },
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run src/features/canvas/application/canvasCommandRegistry.test.ts` 与 `npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add src/features/canvas/domain/canvasCommands.ts src/features/canvas/application/canvasCommandGraph.ts src/features/canvas/application/canvasCommandRegistry.ts src/features/canvas/domain/canvasCapabilities.ts src/features/canvas/application/canvasCommandRegistry.test.ts
git commit -m "feat(canvas): add the asset.import command for finished media nodes"
```

---

### Task 5: `asset_read` 改为落盘返回路径

**Files:**
- Create: `src/features/canvas/agent/application/externalAgentAssetExport.ts`
- Delete: `src/features/canvas/agent/application/externalAgentImageRead.ts`（被取代，成为孤儿）
- Modify: `src/features/canvas/agent/application/externalAgentCanvasBridge.ts`（`asset_read` 分支 242-247、以及 `canvasImage` 返回值通路约 440-445）
- Test: `src/features/canvas/agent/application/externalAgentAssetExport.test.ts`（新建）

**Interfaces:**
- Consumes: `buildCanvasAssetCatalog`（`canvasAssetCatalog.ts`）、`saveImageSourceToPath` / `saveVideoSourceToPath` / `saveAudioSourceToPath`（`src/commands/image.ts`，均已存在）、任务 2 的 `ExternalAgentConnectionInfo.hypitProjectDir`。
- Produces:
  - `type ExportedCanvasAsset = { assetId: string; kind: 'image' | 'video' | 'audio'; path: string }`
  - `export async function exportCanvasAsset(assetId: string, hypitProjectDir: string | null): Promise<ExportedCanvasAsset>`

- [ ] **Step 1: 写失败测试**

新建 `externalAgentAssetExport.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveImageSourceToPath = vi.fn();
const saveVideoSourceToPath = vi.fn();
const saveAudioSourceToPath = vi.fn();

vi.mock('@/commands/image', () => ({
  saveImageSourceToPath: (...args: unknown[]) => saveImageSourceToPath(...args),
  saveVideoSourceToPath: (...args: unknown[]) => saveVideoSourceToPath(...args),
  saveAudioSourceToPath: (...args: unknown[]) => saveAudioSourceToPath(...args),
}));

vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: () => ({ nodes: [] }) } }));
vi.mock('@/features/canvas/application/canvasAssetCatalog', () => ({
  buildCanvasAssetCatalog: () => [{
    id: 'asset-1', nodeId: 'n1', kind: 'video', title: 't', sourceLabel: 's', order: 0,
    url: '/abs/originals/clip.mp4',
  }],
}));

import { exportCanvasAsset } from './externalAgentAssetExport';

beforeEach(() => {
  saveImageSourceToPath.mockReset().mockResolvedValue('/hypit/imports/asset-1.png');
  saveVideoSourceToPath.mockReset().mockResolvedValue('/hypit/imports/asset-1.mp4');
  saveAudioSourceToPath.mockReset().mockResolvedValue('/hypit/imports/asset-1.wav');
});

describe('exportCanvasAsset', () => {
  it('copies the original bytes and never touches the preview url', async () => {
    const result = await exportCanvasAsset('asset-1', '/hypit');
    expect(result).toEqual({ assetId: 'asset-1', kind: 'video', path: '/hypit/imports/asset-1.mp4' });
    expect(saveVideoSourceToPath).toHaveBeenCalledWith('/abs/originals/clip.mp4', '/hypit/imports/asset-1.mp4');
  });

  it('explains a missing Hypit project directory instead of building a null path', async () => {
    await expect(exportCanvasAsset('asset-1', null)).rejects.toThrow(/Hypit project/i);
    expect(saveVideoSourceToPath).not.toHaveBeenCalled();
  });

  it('rejects an unknown asset id', async () => {
    await expect(exportCanvasAsset('missing', '/hypit')).rejects.toThrow(/no longer exists/i);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/features/canvas/agent/application/externalAgentAssetExport.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`externalAgentAssetExport.ts`：

```ts
import { saveAudioSourceToPath, saveImageSourceToPath, saveVideoSourceToPath } from '@/commands/image';
import { buildCanvasAssetCatalog } from '@/features/canvas/application/canvasAssetCatalog';
import { useCanvasStore } from '@/stores/canvasStore';

export interface ExportedCanvasAsset {
  assetId: string;
  kind: 'image' | 'video' | 'audio';
  path: string;
}

/**
 * Copies one canvas asset's original bytes into the Hypit project's `imports/`
 * directory and returns the resulting path. Full-resolution originals only:
 * `asset.url` is the persisted original, `asset.previewUrl` is a downscaled
 * thumbnail and is never used here.
 */
export async function exportCanvasAsset(
  assetId: string,
  hypitProjectDir: string | null,
): Promise<ExportedCanvasAsset> {
  if (!hypitProjectDir || !hypitProjectDir.trim()) {
    throw new Error('The Hypit project directory is unavailable. Recreate the Canvas connection from the External Agent panel.');
  }
  const asset = buildCanvasAssetCatalog(useCanvasStore.getState().nodes)
    .find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error('The requested canvas asset no longer exists.');
  const target = `${hypitProjectDir.replace(/[\\/]+$/, '')}/imports/${asset.id}.${defaultExtension(asset.kind, asset.url)}`;
  const saved = asset.kind === 'image'
    ? await saveImageSourceToPath(asset.url, target)
    : asset.kind === 'video'
      ? await saveVideoSourceToPath(asset.url, target)
      : await saveAudioSourceToPath(asset.url, target);
  return { assetId: asset.id, kind: asset.kind, path: saved };
}

function defaultExtension(kind: ExportedCanvasAsset['kind'], url: string): string {
  const fromUrl = url.split('?')[0].split('#')[0].match(/\.([A-Za-z0-9]{1,5})$/)?.[1];
  if (fromUrl) return fromUrl.toLowerCase();
  return kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav';
}
```

`externalAgentCanvasBridge.ts`：

- 把 `import { readExternalCanvasImage } from './externalAgentImageRead';` 换成 `import { exportCanvasAsset } from './externalAgentAssetExport';`
- `asset_read` 分支改为（注意 `checkPermission` 已取过 connection；此处重新取一次目标目录）：

```ts
    case 'asset_read': {
      if (!isRecord(request.arguments) || typeof request.arguments.assetId !== 'string') {
        throw new Error('A canvas asset read requires an assetId.');
      }
      const connection = await inspectExternalAgentConnection();
      return exportCanvasAsset(request.arguments.assetId, connection.hypitProjectDir);
    }
```

- 删除约 440-445 行把 `result.canvasImage` 提升为 vision 载荷的分支：`asset_read` 现在返回普通 JSON，不再带 `canvasImage`。该分支变成死代码，随之删除（它是本次改动造成的孤儿）。

- 删除 `externalAgentImageRead.ts`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/features/canvas/agent/application/externalAgentAssetExport.test.ts` 与 `npx tsc --noEmit`
Expected: 全绿；`tsc` 不报任何对 `externalAgentImageRead` 的残留引用

- [ ] **Step 5: 提交**

```bash
git add -A src/features/canvas/agent/application/
git commit -m "feat(agent): export canvas originals to disk and return paths instead of preview bytes"
```

---

### Task 6: 导入路径校验命令

**Files:**
- Modify: `src-tauri/src/commands/image.rs`（`prepare_external_video_source` 附近，约 3130 行）
- Modify: `src-tauri/src/lib.rs:261` 区（命令注册）
- Modify: `src/commands/image.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `#[tauri::command] pub fn inspect_import_media_paths(paths: Vec<String>) -> Result<Vec<ImportMediaPathCheck>, String>`
  - `pub struct ImportMediaPathCheck { pub path: String, pub exists: bool, pub is_file: bool, pub bytes: u64 }`（serde camelCase）
  - TS：`export async function inspectImportMediaPaths(paths: string[]): Promise<ImportMediaPathCheck[]>`

**为什么需要它**：TS 侧没有文件系统访问，无法满足 spec 的"存在、是文件而非目录"校验。更重要的是 `std::fs::read` 对 FIFO 会**永久阻塞** —— 若直接把 agent 给的路径交给 `prepare_node_image_source`，一个 FIFO 就能卡死画布。用 `symlink_metadata` 判定文件类型，可以同时拒绝目录、符号链接和特殊文件，且不打开任何内容。

- [ ] **Step 1: 写失败测试**

在 `image.rs` 末尾加：

```rust
#[cfg(test)]
mod import_media_path_tests {
    use super::*;

    #[test]
    fn classifies_files_directories_and_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("clip.mp4");
        std::fs::write(&file, b"\x00\x00\x00\x18ftypisom").unwrap();

        let checks = inspect_import_media_paths(vec![
            file.to_string_lossy().into_owned(),
            dir.path().to_string_lossy().into_owned(),
            dir.path().join("nope.mp4").to_string_lossy().into_owned(),
        ])
        .unwrap();

        assert!(checks[0].exists && checks[0].is_file && checks[0].bytes == 12);
        assert!(checks[1].exists && !checks[1].is_file);
        assert!(!checks[2].exists && !checks[2].is_file);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_and_fifos_without_opening_them() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.mp4");
        std::fs::write(&real, b"data").unwrap();
        let link = dir.path().join("link.mp4");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let fifo = dir.path().join("pipe.mp4");
        let fifo_c = std::ffi::CString::new(fifo.to_string_lossy().as_bytes()).unwrap();
        unsafe { libc::mkfifo(fifo_c.as_ptr(), 0o600) };

        let checks = inspect_import_media_paths(vec![
            link.to_string_lossy().into_owned(),
            fifo.to_string_lossy().into_owned(),
        ])
        .unwrap();

        assert!(!checks[0].is_file, "symlinks must not be importable");
        assert!(!checks[1].is_file, "FIFOs must not be importable");
    }
}
```

（`libc` 已在 `src-tauri/Cargo.toml` 的 `[target.'cfg(unix)'.dependencies]` 中；若没有，用 `std::process::Command::new("mkfifo")` 代替。）

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test --lib import_media_path_tests`
Expected: 编译失败，`inspect_import_media_paths` not found

- [ ] **Step 3: 实现**

在 `image.rs` 加入：

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMediaPathCheck {
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub bytes: u64,
}

/// Classifies candidate import paths without opening them. `symlink_metadata`
/// keeps directories, symlinks and special files (FIFOs, devices) out of the
/// import path, where reading a FIFO would block the canvas indefinitely.
#[tauri::command]
pub fn inspect_import_media_paths(paths: Vec<String>) -> Result<Vec<ImportMediaPathCheck>, String> { /* 1–16 项；逐项 symlink_metadata */ }
```

要点：数量校验 1–16；每项 `trim()` 后调 `std::fs::symlink_metadata`（**不是** `metadata`，否则会跟随符号链接）；`Ok` 时 `is_file = metadata.file_type().is_file()`（对目录/符号链接/FIFO 均为 `false`）；`Err` 时全 `false`/`0`。**绝不读取文件内容** —— 这正是拒绝 FIFO 而不阻塞的关键。

在 `src-tauri/src/lib.rs` 的 `image::persist_audio_source,` 之后加：

```rust
            image::inspect_import_media_paths,
```

在 `src/commands/image.ts` 加：

```ts
export interface ImportMediaPathCheck {
  path: string;
  exists: boolean;
  isFile: boolean;
  bytes: number;
}

export async function inspectImportMediaPaths(paths: string[]): Promise<ImportMediaPathCheck[]> {
  return await invoke('inspect_import_media_paths', { paths });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src-tauri && cargo test --lib import_media_path_tests`
Expected: 2 passed（unix 上）

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/image.rs src-tauri/src/lib.rs src/commands/image.ts
git commit -m "feat(canvas): classify import paths without opening them"
```

---

### Task 7: `assets_import` 工具

**Files:**
- Modify: `src/features/canvas/agent/domain/agentModel.ts`（`ExternalAgentToolName`）
- Modify: `src/features/canvas/agent/application/externalAgentToolManifest.ts`（`ExternalAgentSupportedKind`、工具定义、`buildExternalCanvasMcpManifest`）
- Modify: `src/features/canvas/agent/application/externalAgentCanvasBridge.ts`（dispatch + `executeAssetsImport`）
- Modify: `src/features/canvas/agent/application/externalAgentPermissionPolicy.ts`（分类）
- Modify: `src/features/canvas/agent/application/canvasAgentController.ts`（`approvalEffect`、`buildApprovalImpact`）
- Modify: `src/features/canvas/agent/application/audioUpload.ts`（`prepareAudioNodeDataFromSource` 走 `persistAudioSource`）
- Test: `src/features/canvas/agent/application/externalAgentToolManifest.test.ts`、`externalAgentPermissionPolicy.test.ts`（新建）

**Interfaces:**
- Consumes: 任务 1 的 `persistAudioSource`；任务 4 的 `asset.import` 命令；任务 6 的 `inspectImportMediaPaths`；任务 2 的 `hypitProjectDir`；既有的 `prepareNodeImage`（`imageData.ts:477`）、`prepareVideoNodeDataFromSource`（`videoUpload.ts:294`）、`prepareAudioNodeDataFromSource`（`audioUpload.ts:117`）。
- Produces:
  - `ExternalAgentToolName` 新增 `'assets_import'`
  - `ExternalAgentSupportedKind` 新增 `'media-import'`
  - `async function executeAssetsImport(request: ExternalAgentToolRequest, approval: AgentApprovalRecord): Promise<unknown>`

**必须同时改 `approvalEffect`**：`approvalEffect(toolName, command)` 只对 `toolName === 'canvas_command'` 计算命令效果，其它工具一律返回 `'read'`。而 `executeCanvasCommand` 靠 `approval.impact.effect === 'canvas-write'` 决定是否开回滚令牌、是否 `persistCanvas`。若不改，`assets_import` 建的节点**不会持久化、也无法回滚**。

- [ ] **Step 1: 写失败测试**

`externalAgentPermissionPolicy.test.ts`（新建）：

```ts
import { describe, expect, it } from 'vitest';
import { externalAgentPermissionDecision, isExternalAgentReadOnly } from './externalAgentPermissionPolicy';

const request = (toolName: any, args: unknown) => ({
  version: 1, runtime: 'claude', sessionId: 's', turnId: 't', callId: 'c', toolName, arguments: args,
});

describe('assets_import permission', () => {
  it('is never treated as a read-only tool', () => {
    expect(isExternalAgentReadOnly(request('assets_import', { files: [{ path: '/a.mp4' }] }))).toBe(false);
  });

  it('needs confirmation in collaboration mode', () => {
    expect(externalAgentPermissionDecision('collaboration', request('assets_import', { files: [] }))).toBe('confirm');
  });

  it('is denied in analysis mode', () => {
    expect(externalAgentPermissionDecision('analysis', request('assets_import', { files: [] }))).toBe('deny');
  });
});
```

在 `externalAgentToolManifest.test.ts` 加：

```ts
  it('exposes assets_import only when the media-import kind is requested', () => {
    const withImport = buildExternalCanvasMcpManifest(['canvas', 'media-import']);
    const importTool = withImport.tools.find((tool) => tool.name === 'assets_import');
    expect(importTool).toBeDefined();
    expect(importTool?.annotations.readOnlyHint).toBe(false);
    expect(importTool?.annotations.openWorldHint).toBe(false);

    const withoutImport = buildExternalCanvasMcpManifest(['canvas']);
    expect(withoutImport.tools.map((tool) => tool.name)).not.toContain('assets_import');
  });
```

新建 `src/features/canvas/agent/application/assetsImportValidation.test.ts`，钉住 Review Focus 里的两个输入类（校验必须先于任何文件与节点产生）：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const inspectImportMediaPaths = vi.fn();
const prepareNodeImage = vi.fn();
vi.mock('@/commands/image', () => ({
  inspectImportMediaPaths: (...a: unknown[]) => inspectImportMediaPaths(...a),
}));
vi.mock('@/features/canvas/application/imageData', () => ({
  prepareNodeImage: (...a: unknown[]) => prepareNodeImage(...a),
}));
vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: () => ({ nodes: [] }) } }));
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ currentProjectId: 'p1' }) },
}));

import { validateImportFilesForTest } from './externalAgentCanvasBridge';

beforeEach(() => {
  inspectImportMediaPaths.mockReset().mockResolvedValue([
    { path: '/a.mp4', exists: true, isFile: true, bytes: 1024 },
  ]);
  prepareNodeImage.mockReset();
});

describe('assets_import validation precedes side effects', () => {
  it('refuses a symlink or directory before preparing any media', async () => {
    inspectImportMediaPaths.mockResolvedValue([{ path: '/dir', exists: true, isFile: false, bytes: 0 }]);
    await expect(validateImportFilesForTest([{ path: '/dir', kind: 'video' }])).rejects.toThrow(/symlink|regular file/i);
    expect(prepareNodeImage).not.toHaveBeenCalled();
  });

  it('refuses a path that does not exist', async () => {
    inspectImportMediaPaths.mockResolvedValue([{ path: '/gone.mp4', exists: false, isFile: false, bytes: 0 }]);
    await expect(validateImportFilesForTest([{ path: '/gone.mp4', kind: 'video' }])).rejects.toThrow(/does not exist/i);
  });

  it('refuses a file over the kind size limit', async () => {
    inspectImportMediaPaths.mockResolvedValue([
      { path: '/big.png', exists: true, isFile: true, bytes: 65 * 1024 * 1024 },
    ]);
    await expect(validateImportFilesForTest([{ path: '/big.png', kind: 'image' }])).rejects.toThrow(/size limit/i);
  });
});
```

（把校验循环抽成导出的 `validateImportFilesForTest`，供测试与 `executeAssetsImport` 共用；命名对生产代码无害，且避免为测试复制一套逻辑。）

项目切换的守卫由 `executeAssetsImport` 里 prepare 之后的 `useProjectStore.getState().currentProjectId !== projectId` 检查承担，属现有模式（`externalAgentCanvasBridge.ts:407` 同款），不另写单测。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/features/canvas/agent/application/externalAgentPermissionPolicy.test.ts src/features/canvas/agent/application/externalAgentToolManifest.test.ts`
Expected: FAIL，`assets_import` 不存在

- [ ] **Step 3: 工具定义与权限**

`agentModel.ts`：`ExternalAgentToolName` 加 `| 'assets_import'`。

`canvasAgentController.ts` 的 `approvalEffect`：在 `if (toolName !== 'canvas_command' || !command) return 'read';` **之前**插入：

```ts
  if (toolName === 'assets_import') return 'canvas-write';
```

`buildApprovalImpact`：在 `const command = toolName === 'canvas_command' ? ... : undefined;` 之后、`if (command)` 之前插入 `assets_import` 的预览分支，使其带上 baseRevision 与可读摘要：

```ts
  if (toolName === 'assets_import') {
    const files = args && typeof args === 'object' && !Array.isArray(args)
      && Array.isArray((args as Record<string, unknown>).files)
      ? (args as Record<string, unknown>).files as unknown[]
      : [];
    return {
      baseRevision: canvasCommandRegistry.getRevision(),
      impact: {
        effect: 'canvas-write',
        title: 'assets_import',
        summary: `把 ${files.length} 个本机成品媒体导入画布成为节点。文件会先校验，再落成画布节点。`,
        affectedNodeCount: files.length,
        affectedEdgeCount: 0,
        externalSideEffect: false,
      },
    };
  }
```

`externalAgentToolManifest.ts`：`ExternalAgentSupportedKind` 加 `| 'media-import'`；在 `mediaPostprocessTools` 之前加：

```ts
const mediaImportSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['files'],
  properties: {
    files: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Absolute path of a finished media file on this machine.' },
          kind: { type: 'string', enum: ['image', 'video', 'audio'] },
          title: { type: 'string', maxLength: 200 },
        },
      },
    },
    anchor: {
      type: 'object',
      additionalProperties: false,
      properties: { nodeId: { type: 'string' } },
    },
  },
};

const mediaImportTools: ExternalCanvasMcpTool[] = [
  {
    name: 'assets_import',
    title: 'Import finished media into the canvas',
    description: 'Import 1-16 finished media files from this machine into the canvas as nodes, so produced work returns to the board. Each file path must be absolute. Files are validated before any node is created.',
    inputSchema: mediaImportSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];
```

在 `buildExternalCanvasMcpManifest` 的工具数组里加：

```ts
    ...(kinds.has('media-import') ? mediaImportTools : []),
```

`externalAgentPermissionPolicy.ts`：`isExternalAgentReadOnly` 的 `case 'asset_read':` 保持只读；`assets_import` 不加入任何只读分支（`default: return false` 已覆盖），无需新增 case。

`audioUpload.ts`：`prepareAudioNodeDataFromSource` 改为先落盘再取元数据（与视频同构）：

```ts
export async function prepareAudioNodeDataFromSource(
  source: string,
  sourceFileName?: string | null
): Promise<Partial<AudioNodeData>> {
  const localAudioUrl = await persistAudioSource(source);
  const metadata = await readAudioSourceMetadata(localAudioUrl);
  return buildUploadedAudioNodeData(
    localAudioUrl,
    metadata,
    sourceFileName?.trim() || fileNameFromSource(source)
  );
}
```

并在 `audioUpload.ts` 顶部把 `import { loadAudioSourceDataUrl } from '@/commands/image';` 换成 `import { persistAudioSource } from '@/commands/image';`（`loadAudioSourceDataUrl` 在本文件失去调用方，随之从该 import 移除；`src/commands/image.ts` 里该函数本身仍被别处使用，**不删**）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/features/canvas/agent/application/externalAgentPermissionPolicy.test.ts src/features/canvas/agent/application/externalAgentToolManifest.test.ts`
Expected: 全绿

- [ ] **Step 5: 实现 `executeAssetsImport`**

`externalAgentCanvasBridge.ts`：dispatch switch 加 `case 'assets_import': return executeAssetsImport(request, approval);`

分四段：校验 → 落盘建节点数据 → 解析位置 → 提交 `asset.import`。**校验全部通过后才动文件**；prepare 之后再查一次项目未切换。

常量与解析器（`parseImportFiles` 把 `files` 规范成 `{ path, kind, title? }[]`：绝对路径检查、1–16 数量、`kind` 省略时按扩展名推断、推断不出则拒绝）：

```ts
const IMPORTABLE_KINDS = ['image', 'video', 'audio'] as const;
const IMPORT_MAX_BYTES = { image: 64 * 1024 * 1024, video: 512 * 1024 * 1024, audio: 512 * 1024 * 1024 } as const;
type ImportKind = (typeof IMPORTABLE_KINDS)[number];
interface ImportRequestFile { path: string; kind: ImportKind; title?: string }

function inferKindFromPath(path: string): ImportKind | null { /* 扩展名 → kind，未识别返回 null */ }
function parseImportFiles(argumentsValue: unknown): ImportRequestFile[] { /* 见上 */ }

/** 校验通过则返回，否则抛出首个失败项。先于任何文件与节点产生。 */
export async function validateImportFilesForTest(files: ImportRequestFile[]): Promise<void> {
  const checks = await inspectImportMediaPaths(files.map((file) => file.path));
  for (const [index, check] of checks.entries()) {
    const kind = files[index].kind;
    if (!check.exists) throw new Error(`Cannot import ${check.path}: it does not exist.`);
    if (!check.isFile) throw new Error(`Cannot import ${check.path}: directories, symlinks and special files are refused.`);
    if (check.bytes === 0) throw new Error(`Cannot import ${check.path}: it is empty.`);
    if (check.bytes > IMPORT_MAX_BYTES[kind]) {
      throw new Error(`Cannot import ${check.path}: it exceeds the ${kind} size limit.`);
    }
  }
}
```

`executeAssetsImport`：

```ts
async function executeAssetsImport(
  request: ExternalAgentToolRequest,
  approval: AgentApprovalRecord,
): Promise<unknown> {
  const files = parseImportFiles(request.arguments);
  const anchorId = isRecord(request.arguments) && isRecord(request.arguments.anchor)
    && typeof request.arguments.anchor.nodeId === 'string'
    ? request.arguments.anchor.nodeId
    : null;
  await validateImportFilesForTest(files);

  // Media preparation is asynchronous (video posters are captured in the
  // browser), so re-check the project before committing nodes.
  const projectId = approval.projectId;
  const prepared: Array<{ nodeType: CanvasNodeType; data: Record<string, unknown> }> = [];
  for (const file of files) {
    const data = file.kind === 'image'
      ? { ...await prepareNodeImage(file.path), sourceFileName: file.title ?? null }
      : file.kind === 'video'
        ? await prepareVideoNodeDataFromSource(file.path, file.title ?? null)
        : await prepareAudioNodeDataFromSource(file.path, file.title ?? null);
    const nodeType = file.kind === 'image'
      ? CANVAS_NODE_TYPES.upload
      : file.kind === 'video' ? CANVAS_NODE_TYPES.video : CANVAS_NODE_TYPES.audio;
    prepared.push({ nodeType, data: data as Record<string, unknown> });
  }
  if (useProjectStore.getState().currentProjectId !== projectId) {
    throw new Error('The active project changed before imported media could be added.');
  }

  const nodes = prepared.map((entry, index) => ({
    nodeType: entry.nodeType,
    position: resolveImportPosition(anchorId, index),
    data: entry.data,
  }));
  const command: CanvasCommand = { type: 'asset.import', version: CANVAS_COMMAND_VERSION, input: { nodes } };
  return executeCanvasCommand({ ...request, arguments: command }, approval);
}
```

`executeCanvasCommand` 里的 `graphWrite` 会因 `approval.impact.effect === 'canvas-write'` 成立而开启回滚令牌并 `persistCanvas`，导入的节点随之持久化。

锚点落位（spec §4.4）：

```ts
function resolveImportPosition(anchorId: string | null, index: number): { x: number; y: number } {
  const nodes = useCanvasStore.getState().nodes;
  if (anchorId) {
    const anchor = nodes.find((node) => node.id === anchorId);
    if (!anchor) throw new Error(`Anchor node ${anchorId} does not exist.`);
    return { x: anchor.position.x + 48, y: anchor.position.y + 48 + index * 96 };
  }
  if (nodes.length === 0) return { x: 0, y: 0 };
  const rightEdge = Math.max(...nodes.map((node) => node.position.x + (node.measured?.width ?? node.width ?? 220)));
  const top = Math.min(...nodes.map((node) => node.position.y));
  return { x: rightEdge + 160, y: top + index * 96 };
}
```

`executeCanvasCommand` 接收的是 `{ arguments: command }`，其内部 `commandFromArguments` 会取出该命令；这与现有 `canvas_command` 走法一致。

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run src/features/canvas/agent/application/` 与 `npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add -A src/features/canvas/agent/
git commit -m "feat(agent): add the assets_import tool to return finished media to the canvas"
```

---

### Task 8: 连接范围、面板与文案

**Files:**
- Modify: `src/features/canvas/agent/ui/CanvasAgentDock.tsx:286-293`（`externalConnectionTools` 的 kind 列表）
- Modify: `src/components/SettingsDialog.tsx:300-302`（同上）
- Modify: `src/features/canvas/agent/ui/ExternalAgentConnectionPanel.tsx`（显示视频工程目录 + 重建提示）
- Modify: `src/i18n/locales/zh.json`、`src/i18n/locales/en.json`（`canvasAgent` 段）

**Interfaces:**
- Consumes: 任务 2 的 `connection.hypitProjectDir`、任务 6 的 `media-import` kind。
- Produces: 无对外接口。

- [ ] **Step 1: 加入 kind**

`CanvasAgentDock.tsx` 与 `SettingsDialog.tsx` 的 kind 数组都改为：

```ts
  'canvas', 'diagnostics', 'config', 'asset-read', 'media-import',
```

- [ ] **Step 2: 面板显示工程目录与重建提示**

`ExternalAgentConnectionPanel.tsx`：在现有 `scope` 展示附近（约 120 行）读出：

```ts
  const hypitProjectDir = connection?.hypitProjectDir ?? null;
```

在状态区渲染一节：工程目录为 `null` 时显示 `t('canvasAgent.hypitProjectMissing')`，否则显示路径（`font-mono` 截断），并在 `!connection?.scope.includes('assets_import')` 时显示 `t('canvasAgent.assetsImportNeedsReconnect')`。

- [ ] **Step 3: 补文案**

`zh.json` 的 `canvasAgent` 段加：

```json
    "hypitProjectDirLabel": "Hypit 视频工程",
    "hypitProjectMissing": "未创建（重建连接后生成）",
    "hypitProjectDirHint": "在终端里打开此目录再运行 claude，即可同时使用 hypit 与画布。",
    "assetsImportNeedsReconnect": "当前连接建立于本次升级之前，需重建连接后才能使用 assets_import。",
```

`en.json` 的 `canvasAgent` 段加：

```json
    "hypitProjectDirLabel": "Hypit video project",
    "hypitProjectMissing": "Not created yet (recreate the connection).",
    "hypitProjectDirHint": "Open claude in this directory to use Hypit and the canvas together.",
    "assetsImportNeedsReconnect": "This connection predates the upgrade. Recreate it to enable assets_import.",
```

- [ ] **Step 4: 验证**

Run: `npx tsc --noEmit` 与 `npx vitest run`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add -A src/features/canvas/agent/ui/ src/components/SettingsDialog.tsx src/i18n/locales/
git commit -m "feat(agent): expose the Hypit project directory and the media-import scope"
```

---

## 端到端验收

全部任务完成后，在 `src-tauri` 下 `cargo test` 与仓库根 `npx vitest run`、`npx tsc --noEmit` 全绿的前提下：

1. `npm run tauri dev` 起画布 → 「外部 Agent 接入」→ 重建连接。
2. 断言 `<app_data_dir>/hypit-projects/<slug>/package.json` 存在且 `hypit.project === true`。
3. 在该目录跑 `hypit paths` → 成功（不再是 `No Hypit project was found`）。
4. 断言 `~/.claude.json` 的 `projects["<claudeCodeProjectDir>"]` 与 `projects["<hypitProjectDir>"]` **两条** `storyboard_canvas` 都在。
5. 在该目录开 `claude`：`/hypit` 可用、`storyboard_canvas` 工具可用、无信任弹窗。
6. 读一张画布图 → `imports/` 下出现该图，尺寸等于原图（不是 1280 上限）。
7. 读一个画布视频 → `imports/` 下出现该视频文件。
8. 用 `assets_import` 回写一个本地 mp4 → 画布出现 `videoNode`，其 `localVideoUrl` 指向画布 `videos/` 下的持久副本。
