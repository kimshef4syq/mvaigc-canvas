# 外部 Agent 零手动接入 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「外部 Agent 接入」的 Claude Code 配置一次写入后永久有效——OSC 每次启动自动重建描述符并刷新 `~/.claude.json`，用户打开 Claude Code 即连上，不再手贴、不再手点。

**Architecture:** 描述符文件名固定为 `canvas-mcp-current.json`（覆盖写），把接入参数持久化到 `connection-params.json`；OSC 启动时读参数、用当前 broker 重建描述符，并把 local-scope MCP 条目写进 `~/.claude.json` 的 `projects["<目录>"].mcpServers`（Claude Code 官方文档核实：local scope 不弹信任确认）。

**Tech Stack:** Rust（Tauri 2 commands、serde_json、tempfile）、React + TypeScript + Zustand。

**Spec:** `docs/superpowers/specs/2026-10-10-external-agent-zerotouch-design.md`

## Global Constraints

- 只改 `mvaigc-canvas/`；`open-storyboard-canvas/` 只读。
- Camera 相关一律不碰。
- 最小实现、外科手术式改动；每行改动可追溯到本 spec。
- 不删没让删的既有代码；沿用既有风格。
- 不改工具审批（`requiresApproval: true`）与画布 MCP 受限工具集。
- 不做运行中滚动刷新令牌；不写 `.mcp.json`（project scope 会弹窗）。
- 提交流署名：`Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 默认项目目录（原样使用，含中文路径）：`/Users/spic007/Downloads/07-项目文件/000OD`
- 固定描述符文件名：`canvas-mcp-current.json`；参数文件名：`connection-params.json`；参数 schema 版本：`1`。
- Claude Code 配置文件：`~/.claude.json`；local-scope 路径：`projects["<目录>"].mcpServers["storyboard_canvas"]`。

## Review Focus

- **`~/.claude.json` 不存在** → 应从 `{}` 建起，只含 `projects` 一条，不得报错。
- **`~/.claude.json` 是坏 JSON** → 必须**原样保留、不覆盖**（宁可跳过也不能毁用户配置）。
- **同目录下已有其它 `mcpServers` 或其它项目条目** → 必须全部保留，只增改 `storyboard_canvas`。
- **项目目录为空字符串** → 跳过写 `~/.claude.json`（关闭自动写入），但描述符照常重建。
- **启动时 `connection-params.json` 不存在**（从未创建过）→ 安静跳过，不报错、不建空连接。
- **描述符覆盖写** → 连续创建/重建不得因文件已存在而失败（原 `create_new(true)` 会失败）。

---

### Task 1: 固定描述符文件名 + 覆盖写 + 清理旧文件

**Files:**
- Modify: `src-tauri/src/commands/external_agent/connection.rs:23-25,104-151`
- Test: `src-tauri/src/commands/external_agent/connection.rs`（文件末尾 `#[cfg(test)] mod tests`）

**Interfaces:**
- Consumes: 无（本任务独立）。
- Produces:
  - `const CONNECTION_DESCRIPTOR_FILE: &str = "canvas-mcp-current.json";`
  - `fn write_connection_descriptor(descriptor_root: &Path, descriptor: &ExternalAgentConnectionDescriptor) -> Result<PathBuf, ExternalAgentCommandError>`（**签名变化**：去掉 `connection_id` 参数）
  - `fn cleanup_legacy_descriptors(descriptor_root: &Path)`（删除非 `canvas-mcp-current.json` 的 `canvas-mcp-*.json`）

- [ ] **Step 1: 写失败测试**

在 `connection.rs` 的 `mod tests` 里加：

```rust
#[test]
fn descriptor_uses_fixed_name_and_overwrites() {
    let root = tempfile::tempdir().unwrap();
    let first = ExternalAgentConnectionDescriptor {
        schema_version: 1,
        broker_address: "127.0.0.1:1".into(),
        capability_token: "a".into(),
        session_id: "s1".into(),
        expires_at: 1,
    };
    let path = write_connection_descriptor(root.path(), &first).unwrap();
    assert_eq!(path.file_name().unwrap(), "canvas-mcp-current.json");

    // 第二次写同名文件必须成功（覆盖），内容为第二次的。
    let second = ExternalAgentConnectionDescriptor {
        broker_address: "127.0.0.1:2".into(),
        capability_token: "b".into(),
        session_id: "s2".into(),
        ..first.clone()
    };
    let path2 = write_connection_descriptor(root.path(), &second).unwrap();
    assert_eq!(path, path2);
    let text = std::fs::read_to_string(&path2).unwrap();
    assert!(text.contains("127.0.0.1:2"));
}

#[test]
fn cleanup_removes_legacy_uuid_descriptors_only() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("canvas-mcp-abc.json"), "{}").unwrap();
    std::fs::write(root.path().join("canvas-mcp-current.json"), "{}").unwrap();
    std::fs::write(root.path().join("connection-params.json"), "{}").unwrap();
    cleanup_legacy_descriptors(root.path());
    assert!(!root.path().join("canvas-mcp-abc.json").exists());
    assert!(root.path().join("canvas-mcp-current.json").exists());
    assert!(root.path().join("connection-params.json").exists());
}
```

（`ExternalAgentConnectionDescriptor` 需 `#[derive(Clone)]`——若已 `Deserialize, Serialize`，加 `Clone`。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd src-tauri && cargo test descriptor_uses_fixed_name_and_overwrites cleanup_removes_legacy_uuid_descriptors_only`
Expected: 编译失败（`write_connection_descriptor` 参数数量不符 / `cleanup_legacy_descriptors` 未定义）。

- [ ] **Step 3: 实现**

- 常量：删 `CONNECTION_DESCRIPTOR_PREFIX`/`SUFFIX`，加
  ```rust
  const CONNECTION_DESCRIPTOR_FILE: &str = "canvas-mcp-current.json";
  const CONNECTION_PARAMS_FILE: &str = "connection-params.json";
  ```
- `write_connection_descriptor(descriptor_root, descriptor)`：文件名用 `CONNECTION_DESCRIPTOR_FILE`；`OpenOptions` 由 `create_new(true)` 改为 `.create(true).truncate(true)`（保留 `write(true)` 与 0600 权限）；其余（建目录、0700、写、sync）不变。
- `cleanup_legacy_descriptors(descriptor_root)`：`read_dir` 遍历，文件名以 `canvas-mcp-` 开头、以 `.json` 结尾、且不等于 `CONNECTION_DESCRIPTOR_FILE` 的，`remove_file`；错误忽略。
- 调用点（`create_external_agent_connection`，约 306 行）改为 `write_connection_descriptor(&descriptor_root, &descriptor)`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd src-tauri && cargo test descriptor_uses_fixed_name_and_overwrites cleanup_removes_legacy_uuid_descriptors_only`
Expected: PASS（2 passed）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/external_agent/connection.rs
git commit -m "feat(external-agent): 描述符固定文件名并覆盖写，清理旧 UUID 文件"
```

---

### Task 2: 持久化接入参数 `connection-params.json`

**Files:**
- Modify: `src-tauri/src/commands/external_agent/connection.rs`（新增结构体与读写函数）
- Test: 同文件 `mod tests`

**Interfaces:**
- Consumes: `CONNECTION_PARAMS_FILE`（Task 1）。
- Produces:
  - `#[derive(Debug, Clone, Deserialize, Serialize)] #[serde(rename_all = "camelCase")] pub(crate) struct ConnectionParams { pub schema_version: u8, pub project_id: String, pub project_name: String, pub tools: Vec<ExternalAgentToolDefinition>, #[serde(default)] pub claude_code_project_dir: Option<String> }`
  - `fn write_connection_params(descriptor_root: &Path, params: &ConnectionParams) -> Result<(), ExternalAgentCommandError>`
  - `fn read_connection_params(descriptor_root: &Path) -> Option<ConnectionParams>`（不存在或坏 JSON → `None`）

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn connection_params_round_trip() {
    let root = tempfile::tempdir().unwrap();
    let params = ConnectionParams {
        schema_version: 1,
        project_id: "p1".into(),
        project_name: "画布".into(),
        tools: vec![],
        claude_code_project_dir: Some("/tmp/x".into()),
    };
    write_connection_params(root.path(), &params).unwrap();
    let back = read_connection_params(root.path()).unwrap();
    assert_eq!(back.project_id, "p1");
    assert_eq!(back.claude_code_project_dir.as_deref(), Some("/tmp/x"));
}

#[test]
fn read_connection_params_missing_or_broken_returns_none() {
    let root = tempfile::tempdir().unwrap();
    assert!(read_connection_params(root.path()).is_none());
    std::fs::write(root.path().join("connection-params.json"), "{not json").unwrap();
    assert!(read_connection_params(root.path()).is_none());
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd src-tauri && cargo test connection_params_round_trip read_connection_params_missing_or_broken_returns_none`
Expected: 编译失败（`ConnectionParams` 未定义）。

- [ ] **Step 3: 实现**

- 加 `ConnectionParams` 结构体（字段同上；`ExternalAgentToolDefinition` 已 `Serialize/Deserialize`）。
- `write_connection_params`：`create_dir_all` + 0600 权限目录 → 序列化 → 覆盖写 `CONNECTION_PARAMS_FILE`（`create(true).truncate(true)`，0600）。
- `read_connection_params`：`fs::read` + `serde_json::from_slice`，任一步失败返回 `None`。

- [ ] **Step 4: 运行，确认通过**

Run: `cd src-tauri && cargo test connection_params`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/external_agent/connection.rs
git commit -m "feat(external-agent): 持久化接入参数到 connection-params.json"
```

---

### Task 3: `claude_config.rs`——写 Claude Code local-scope MCP 条目

**Files:**
- Create: `src-tauri/src/commands/external_agent/claude_config.rs`
- Modify: `src-tauri/src/commands/external_agent/mod.rs`（加 `mod claude_config;`）
- Test: `src-tauri/src/commands/external_agent/claude_config.rs`（`mod tests`）

**Interfaces:**
- Consumes: 无。
- Produces:
  - `pub(crate) fn write_local_mcp_server(claude_json: &Path, project_dir: &str, server_name: &str, command: &str, args: &[String]) -> Result<(), String>`

- [ ] **Step 1: 写失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn entry(dir: &str, cmd: &str) -> (PathBuf, String) {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".claude.json");
        (path, dir.to_string()) // tmpdir 由调用方保活见下
    }

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
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd src-tauri && cargo test claude_config`
Expected: 编译失败（模块/函数未定义）。

- [ ] **Step 3: 实现**

- `mod.rs` 顶部加 `mod claude_config;`。
- `claude_config.rs`：
  ```rust
  use std::path::Path;
  use serde_json::{json, Value};

  pub(crate) fn write_local_mcp_server(
      claude_json: &Path, project_dir: &str, server_name: &str, command: &str, args: &[String],
  ) -> Result<(), String> {
      let mut root: Value = match std::fs::read(claude_json) {
          Ok(bytes) => serde_json::from_slice(&bytes)
              .map_err(|e| format!("~/.claude.json 不是合法 JSON，未改动：{e}"))?,
          Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
          Err(e) => return Err(format!("读取 ~/.claude.json 失败：{e}")),
      };
      if !root.is_object() { root = json!({}); }
      let entry = json!({ "type": "stdio", "command": command, "args": args, "env": {} });
      root["projects"][project_dir]["mcpServers"][server_name] = entry;
      let bytes = serde_json::to_vec_pretty(&root).map_err(|e| e.to_string())?;
      // 原子写：临时文件 + rename
      let tmp = claude_json.with_extension("json.osc-tmp");
      std::fs::write(&tmp, &bytes).map_err(|e| format!("写入临时文件失败：{e}"))?;
      std::fs::rename(&tmp, claude_json).map_err(|e| format!("替换 ~/.claude.json 失败：{e}"))?;
      Ok(())
  }
  ```
  （`root["projects"][dir]` 在 `projects` 非对象时会自动建对象——serde_json 的 IndexMut 对 null 会插入对象，对非对象会 panic 变 null；此处 `projects` 缺失/null 时安全，非对象时 `[]` 赋值会覆盖为对象，可接受。）

- [ ] **Step 4: 运行，确认通过**

Run: `cd src-tauri && cargo test claude_config`
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/external_agent/claude_config.rs src-tauri/src/commands/external_agent/mod.rs
git commit -m "feat(external-agent): 新增 claude_config，写 ~/.claude.json local-scope 条目"
```

---

### Task 4: 抽出 `establish_connection`，接入参数持久化 + 写 Claude 配置

**Files:**
- Modify: `src-tauri/src/commands/external_agent/connection.rs`（`create_external_agent_connection` 主体抽成 `establish_connection`）
- Test: 同文件 `mod tests`（纯逻辑部分）

**Interfaces:**
- Consumes: `write_connection_descriptor`（T1）、`write_connection_params`/`ConnectionParams`（T2）、`claude_config::write_local_mcp_server`（T3）、`cleanup_legacy_descriptors`（T1）。
- Produces:
  - `async fn establish_connection(inner: &Arc<ExternalAgentInner>, app: &AppHandle, project_id: String, project_name: String, tools: Vec<ExternalAgentToolDefinition>, claude_code_project_dir: Option<String>) -> Result<ExternalAgentConnectionInfo, ExternalAgentCommandError>`
  - `CreateExternalAgentConnectionRequest` 增字段 `#[serde(default)] pub claude_code_project_dir: Option<String>`（camelCase → `claudeCodeProjectDir`）。

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn create_request_parses_optional_claude_dir() {
    let with: CreateExternalAgentConnectionRequest =
        serde_json::from_str(r#"{"projectId":"p","projectName":"n","tools":[],"claudeCodeProjectDir":"/tmp/d"}"#).unwrap();
    assert_eq!(with.claude_code_project_dir.as_deref(), Some("/tmp/d"));
    let without: CreateExternalAgentConnectionRequest =
        serde_json::from_str(r#"{"projectId":"p","projectName":"n","tools":[]}"#).unwrap();
    assert!(without.claude_code_project_dir.is_none());
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd src-tauri && cargo test create_request_parses_optional_claude_dir`
Expected: 编译失败（字段不存在）。

- [ ] **Step 3: 实现**

- `CreateExternalAgentConnectionRequest` 加 `#[serde(default)] pub claude_code_project_dir: Option<String>`。
- 把 `create_external_agent_connection` 从 `let project_id = validate_project_text(...)` 到 `connection_info(&session)` 的**全部主体**搬进 `establish_connection`，参数改为上列签名；其中：
  - 校验（`validate_project_text` ×2、`validate_tools`）在 `establish_connection` 内做。
  - 描述符写完后：`let _ = cleanup_legacy_descriptors(&descriptor_root);`
  - 会话插入、`managed_connection_id` 设置之后、返回前：
    ```rust
    let params = ConnectionParams {
        schema_version: 1,
        project_id: project_id.clone(),
        project_name: project_name.clone(),
        tools: session.tools.values().cloned().collect(),
        claude_code_project_dir: claude_code_project_dir.clone(),
    };
    let _ = write_connection_params(&descriptor_root, &params);
    if let Some(dir) = claude_code_project_dir.as_deref().filter(|d| !d.trim().is_empty()) {
        if let Some(home) = home_dir() {
            let executable = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
            let args = vec!["--external-agent-mcp".to_string(), descriptor_path.to_string_lossy().into_owned()];
            if let Err(error) = super::claude_config::write_local_mcp_server(
                &home.join(".claude.json"), dir, "storyboard_canvas", &executable, &args,
            ) {
                warn!("未能写入 Claude Code 配置（不影响画布内使用）：{error}");
            }
        }
    }
    ```
    （`home_dir()` 来自 `super::process`——若其非 `pub(crate)`，在本文件用 `std::env::var_os("HOME")` 兜底。）
- `create_external_agent_connection` 变成薄壳：
  ```rust
  pub async fn create_external_agent_connection(
      app: AppHandle, state: State<'_, ExternalAgentState>, request: CreateExternalAgentConnectionRequest,
  ) -> Result<ExternalAgentConnectionInfo, ExternalAgentCommandError> {
      establish_connection(&state.inner, &app, request.project_id, request.project_name, request.tools, request.claude_code_project_dir).await
  }
  ```

- [ ] **Step 4: 运行，确认通过**

Run: `cd src-tauri && cargo test create_request_parses_optional_claude_dir && cargo build`
Expected: 测试 PASS；`cargo build` 成功（无借用/类型错误）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/external_agent/connection.rs
git commit -m "feat(external-agent): 抽出 establish_connection，落参数并写 Claude 配置"
```

---

### Task 5: 启动自动重建

**Files:**
- Modify: `src-tauri/src/commands/external_agent/connection.rs`（新增 `rebuild_managed_connection`）
- Modify: `src-tauri/src/commands/external_agent/mod.rs`（`ExternalAgentState::rebuild_connection`）
- Modify: `src-tauri/src/lib.rs:97-105`（`setup` 中 `start_broker` 后调用）

**Interfaces:**
- Consumes: `establish_connection`（T4）、`read_connection_params`（T2）。
- Produces:
  - `pub(crate) async fn rebuild_managed_connection(inner: &Arc<ExternalAgentInner>, app: &AppHandle) -> Result<(), ExternalAgentCommandError>`
  - `impl ExternalAgentState { pub fn rebuild_connection(&self, app: AppHandle) -> Result<(), String> }`

- [ ] **Step 1: 实现 `rebuild_managed_connection`**

在 `connection.rs`：

```rust
pub(crate) async fn rebuild_managed_connection(
    inner: &Arc<ExternalAgentInner>,
    app: &AppHandle,
) -> Result<(), ExternalAgentCommandError> {
    if !inner.broker_started.load(Ordering::SeqCst) {
        return Ok(()); // broker 未起，静默跳过
    }
    let descriptor_root = inner
        .connection_descriptor_root
        .lock()
        .map_err(|_| ExternalAgentCommandError::process("Descriptor root lock is poisoned."))?
        .clone();
    let Some(params) = read_connection_params(&descriptor_root) else {
        return Ok(()); // 从未创建过，跳过
    };
    establish_connection(
        inner, app,
        params.project_id, params.project_name, params.tools, params.claude_code_project_dir,
    ).await?;
    Ok(())
}
```

- [ ] **Step 2: `ExternalAgentState::rebuild_connection`**

在 `mod.rs` 的 `impl ExternalAgentState`（`start_broker` 附近）加：

```rust
pub fn rebuild_connection(&self, app: AppHandle) -> Result<(), String> {
    let inner = self.inner.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = connection::rebuild_managed_connection(&inner, &app).await {
            warn!("external Agent 自动重建失败：{error}");
        }
    });
    Ok(())
}
```

（`connection` 模块需在 `mod.rs` 可见：已 `mod connection;`。`warn!` 已 import。）

- [ ] **Step 3: `lib.rs` 挂钩**

`setup` 中 `start_broker` 成功后追加：

```rust
if let Err(error) = app
    .state::<external_agent::ExternalAgentState>()
    .rebuild_connection(app.handle().clone())
{
    warn!("external Agent 启动重建未触发：{error}");
}
```

- [ ] **Step 4: 编译验证**

Run: `cd src-tauri && cargo build`
Expected: 成功，无 warning 级错误。

- [ ] **Step 5: 端到端验证（手动）**

1. 确保 `connection-params.json` 已存在（先在应用里点过一次「创建接入」）。
2. 记下当前 `canvas-mcp-current.json` 的 `brokerAddress` 端口 → 重启 OSC → 再 `cat` 该文件，端口应**已变为新值**。
3. `nc -z 127.0.0.1 <新端口>` 应为 OPEN。
4. `cat ~/.claude.json`，`projects["/Users/spic007/Downloads/07-项目文件/000OD"].mcpServers.storyboard_canvas.args[1]` 应指向 `canvas-mcp-current.json`。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/commands/external_agent/connection.rs src-tauri/src/commands/external_agent/mod.rs src-tauri/src/lib.rs
git commit -m "feat(external-agent): 应用启动自动重建描述符与 Claude 配置"
```

---

### Task 6: 前端设置项 + 请求字段

**Files:**
- Create: `src/features/settings/externalAgentSettings.ts`
- Modify: `src/stores/settingsStore.ts`（字段 + setter + 默认值 + 持久化白名单）
- Modify: `src/commands/externalAgent.ts:75-79`（请求类型加字段）
- Modify: `src/features/canvas/agent/ui/ExternalAgentConnectionPanel.tsx:166`（传值）
- Test: `src/stores/settingsStore.test.ts`（若已有则追加；否则在 `externalAgentSettings` 侧加纯函数测试 `src/features/settings/externalAgentSettings.test.ts`）

**Interfaces:**
- Consumes: 无。
- Produces:
  - `export const DEFAULT_CLAUDE_CODE_PROJECT_DIR = '/Users/spic007/Downloads/07-项目文件/000OD';`
  - `export function normalizeClaudeCodeProjectDir(raw: string): string`（`trim()`；空串原样返回空串 = 关闭）
  - `settingsStore`：字段 `claudeCodeProjectDir: string`、setter `setClaudeCodeProjectDir: (value: string) => void`
  - `CreateExternalAgentConnectionRequest`：`claudeCodeProjectDir?: string`

- [ ] **Step 1: 写失败测试**

`src/features/settings/externalAgentSettings.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_CLAUDE_CODE_PROJECT_DIR, normalizeClaudeCodeProjectDir } from './externalAgentSettings';

describe('externalAgentSettings', () => {
  it('defaults to the 000OD project dir', () => {
    expect(DEFAULT_CLAUDE_CODE_PROJECT_DIR).toBe('/Users/spic007/Downloads/07-项目文件/000OD');
  });
  it('trims and preserves empty as disable', () => {
    expect(normalizeClaudeCodeProjectDir('  /a/b  ')).toBe('/a/b');
    expect(normalizeClaudeCodeProjectDir('   ')).toBe('');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- externalAgentSettings`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

- 新建 `externalAgentSettings.ts`（两处导出，如上）。
- `settingsStore.ts`：在 `mvaigcPort` 附近加 `claudeCodeProjectDir: string;`、`setClaudeCodeProjectDir: (value: string) => void;`；默认值 `claudeCodeProjectDir: DEFAULT_CLAUDE_CODE_PROJECT_DIR`；setter `setClaudeCodeProjectDir: (value) => set({ claudeCodeProjectDir: normalizeClaudeCodeProjectDir(value) })`；在持久化白名单（约 1405 行那处 `Partial<...>`）加 `claudeCodeProjectDir?: string;`；导入常量。
- `src/commands/externalAgent.ts`：`CreateExternalAgentConnectionRequest` 加 `claudeCodeProjectDir?: string;`。
- `ExternalAgentConnectionPanel.tsx`：读 `const claudeCodeProjectDir = useSettingsStore((s) => s.claudeCodeProjectDir);`；`handleCreate` 里 `createExternalAgentConnection({ projectId, projectName, tools, claudeCodeProjectDir })`。

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- externalAgentSettings && npx tsc --noEmit`
Expected: 测试 PASS；类型检查通过。

- [ ] **Step 5: 提交**

```bash
git add src/features/settings/externalAgentSettings.ts src/features/settings/externalAgentSettings.test.ts src/stores/settingsStore.ts src/commands/externalAgent.ts src/features/canvas/agent/ui/ExternalAgentConnectionPanel.tsx
git commit -m "feat(external-agent): 前端新增 Claude Code 项目目录设置项并随请求下发"
```

---

### Task 7: 设置面板输入框 + i18n

**Files:**
- Modify: `src/features/canvas/agent/ui/ExternalAgentConnectionPanel.tsx`（在「创建接入」上方加一行输入）
- Modify: `src/i18n/locales/zh.json`、`src/i18n/locales/en.json`（`canvasAgent.externalMcp` 下加键）
- Test: `src/features/canvas/agent/ui/ExternalAgentConnectionPanel.test.tsx`（若已存在则追加一条渲染断言）

**Interfaces:**
- Consumes: `setClaudeCodeProjectDir`、`claudeCodeProjectDir`（T6）、i18n 键。
- Produces: 无新导出。

- [ ] **Step 1: 加 i18n 键**

`zh.json` 的 `canvasAgent.externalMcp` 下加：
```json
"claudeProjectDirLabel": "Claude Code 项目目录",
"claudeProjectDirHint": "OSC 会把画布 MCP 配置写入该目录，在此目录打开 Claude Code 即可连上。留空则关闭自动写入。"
```
`en.json` 对应：
```json
"claudeProjectDirLabel": "Claude Code project directory",
"claudeProjectDirHint": "OSC writes the Canvas MCP config for this directory. Open Claude Code here to connect. Leave blank to disable auto-write."
```

- [ ] **Step 2: 加输入框**

在 `ExternalAgentConnectionPanel` 的创建/连接区上方插入：
```tsx
<label className="mt-4 flex flex-col gap-1 text-[11px]">
  <span className="text-text-muted">{t('canvasAgent.externalMcp.claudeProjectDirLabel')}</span>
  <input
    aria-label={t('canvasAgent.externalMcp.claudeProjectDirLabel')}
    value={claudeCodeProjectDir}
    onChange={(e) => setClaudeCodeProjectDir(e.target.value)}
    className="rounded-md border border-border-dark bg-surface-dark px-2 py-1 font-mono text-text-dark outline-none focus:border-accent/50"
  />
  <span className="text-text-muted/70">{t('canvasAgent.externalMcp.claudeProjectDirHint')}</span>
</label>
```
读 setter：`const setClaudeCodeProjectDir = useSettingsStore((s) => s.setClaudeCodeProjectDir);`

- [ ] **Step 3: 运行测试与类型检查**

Run: `npm test -- ExternalAgentConnectionPanel && npx tsc --noEmit`
Expected: 通过（若无该测试文件，`npx tsc --noEmit` 通过即可）。

- [ ] **Step 4: 提交**

```bash
git add src/features/canvas/agent/ui/ExternalAgentConnectionPanel.tsx src/i18n/locales/zh.json src/i18n/locales/en.json
git commit -m "feat(external-agent): 接入面板新增 Claude Code 项目目录输入"
```

---

### Task 8: 全量验证 + 真机端到端

**Files:** 无（仅验证与文档）。

- [ ] **Step 1: 全量测试**

Run: `npm test && cd src-tauri && cargo test`
Expected: 前端与 Rust 全绿（Rust 含本计划新增 8 个测试）。

- [ ] **Step 2: 真机流程**

1. `npm run tauri dev` 启动 OSC。
2. 设置 → 外部 Agent 接入 → 确认目录框已预填 `.../000OD` → 点「创建接入」。
3. 关掉 OSC，再启动一次（验证自动重建，不再手点）。
4. 在 `/Users/spic007/Downloads/07-项目文件/000OD` 目录开 `claude`。
5. `/mcp` 应看到 `storyboard_canvas` 已连接、**无信任弹窗**。
6. 让 Claude 读一次画布（如 `asset_read`），确认 OSC 内弹出审批、批准后成功。

- [ ] **Step 3: 更新 DEVLOG**

在 `DEVLOG.md` 的「已完成」与「待办」补记本特性（含本计划/ spec 路径、验证命令）。

- [ ] **Step 4: 提交**

```bash
git add DEVLOG.md
git commit -m "docs(devlog): 记录外部 Agent 零手动接入"
```

---

## Self-Review

- **Spec 覆盖**：A（固定名+覆盖写+启动重建）= T1/T4/T5；B（自动写 Claude local-scope）= T3/T4/T6/T7；参数持久化 = T2；目录可配 = T6/T7；验证 = T5/T8；边界（坏 JSON/空目录/无参数）= T3/T4/T5 的测试与分支。✅
- **Step 粒度**：每步一个可检动作；测试给断言、实现给签名。✅
- **类型一致**：`establish_connection` 签名在 T4 定义、T5 调用一致；`write_connection_descriptor` 去 `connection_id` 在 T1 定义、T4 调用一致；`ConnectionParams.claude_code_project_dir`（Rust）与 `claudeCodeProjectDir`（TS/JSON）经 `rename_all=camelCase` 对齐。✅
- **Review Focus 测试落点**：坏 JSON → T3 `malformed_existing_file_is_left_untouched`；保留它项 → T3 `preserves_other_keys_projects_and_servers`；空目录 → T4 的 `filter(!trim().is_empty())`；无参数 → T2 `read_connection_params_missing_or_broken_returns_none` + T5 跳过分支；覆盖写 → T1 `descriptor_uses_fixed_name_and_overwrites`。✅
- **比例**：计划约为 spec 的 2 倍，含 8 个任务与测试，无整段实现体（仅关键算法/JSON 形状）。✅
