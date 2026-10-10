# 外部 Agent 接入：零手动（固定描述符 + 自动写 Claude Code 配置）

日期：2026-10-10
状态：待实现

## 1. 问题（已核实）

「外部 Agent 接入」面板把 Claude Code 的 MCP 配置生成成：

```json
{ "mcpServers": { "storyboard_canvas": {
  "type": "stdio",
  "command": "<OSC 可执行文件>",
  "args": ["--external-agent-mcp", ".../external-agent-connections/canvas-mcp-<随机UUID>.json"]
}}}
```

三处设计导致**必然失效**：

1. **描述符文件名带随机 UUID**（`connection.rs:127`）——每次「创建接入」生成新文件名，外部配置里的路径随之变化。
2. **应用每次重启起新 broker**（`mcp.rs:27` `bind("127.0.0.1:0")` 随机端口）——旧描述符指向的端口死掉。
3. **重启不自动重建**（`managed_connection_id` 是内存 `RwLock`，`mod.rs:508` 启动为 `None`）——必须手点一次。
4. 令牌 12 小时寿命（`CAPABILITY_LIFETIME_MS = 12h`）。

实测确认：应用 11:28 重启后，旧描述符端口 `56071` 已 CLOSED。且 `connection.rs` / `mcp.rs` 与上游 `open-storyboard-canvas/` **逐字节相同**——这是上游设计，非二次开发引入。

**本质**：外部 CLI 是 OSC 不负责拉起的独立进程，注入不了环境变量，只能靠"双方都能读的文件"传 地址+令牌。方向没错；错在文件名不稳定 + 重启不刷新 + 配置要人手贴。

## 2. 目标

**打开 Claude Code（在 `/Users/spic007/Downloads/07-项目文件/000OD`）即可作为外部 Agent 连上 OSC，用户不改任何配置、不点任何按钮。**

约束（用户明确）：不弹信任确认；只在该目录生效；应用启动时重建（不做运行中滚动刷新）。

## 3. 方案

分两段：A 让描述符路径**永不过期**；B 让 OSC **自动写好并维护** Claude Code 配置。

### A. 固定描述符文件名 + 启动自动重建（Rust）

- 描述符文件名由 `canvas-mcp-<UUID>.json` 改为固定名 **`canvas-mcp-current.json`**。
  - `connection.rs:126-128` 改为固定名。
  - `write_connection_descriptor` 的 `OpenOptions::create_new(true)`（`connection.rs:133`）改为**覆盖写**（`create(true).truncate(true)`），权限仍 0600。
- 「创建接入」成功时，把接入参数持久化到同目录的 **`connection-params.json`**（0600）：
  ```json
  { "schemaVersion": 1, "projectId": "...", "projectName": "...", "tools": [ ... ] }
  ```
- 应用 `setup()` 中 `start_broker` 之后（`lib.rs:97-105`）调用 **启动重建**：
  - 读 `connection-params.json`；不存在则跳过（首次尚未创建）。
  - 存在则用**当前** broker + 新会话重建（等价于内部执行一次 create，但不走 UI），覆盖写 `canvas-mcp-current.json`，并刷新 `~/.claude.json`（见 B）。
- 清理：删除遗留的 `canvas-mcp-<UUID>.json`（一次性、已无引用）。

**为什么必须重建**：broker 每次重启都是新端口、且内存 `sessions` 表为空（`mcp.rs:146` `sessions.get(session_id)`），旧描述符里的 session 在新 broker 中**不存在**。仅改文件名不够——必须用新 broker 重写同一文件。

### B. OSC 自动写 Claude Code 本地作用域配置（Rust）

- 目标：`~/.claude.json` 的 **local scope** —— `projects["<目标目录>"].mcpServers`。
  - 官方文档核实：local scope **不弹信任确认**；`.mcp.json`（project scope）**会弹**；user scope（顶层 `mcpServers`）不弹但全局生效。选 local scope = 只在该目录生效 + 无弹窗。
- 写入内容：
  ```json
  { "projects": { "/Users/spic007/Downloads/07-项目文件/000OD": { "mcpServers": {
    "storyboard_canvas": {
      "type": "stdio",
      "command": "<std::env::current_exe()>",
      "args": ["--external-agent-mcp", "<app_data_dir>/external-agent-connections/canvas-mcp-current.json"],
      "env": {}
    }
  }}}}
  ```
- **目标目录**：新增 OSC 设置项 `claudeCodeProjectDir`，默认值预填 `/Users/spic007/Downloads/07-项目文件/000OD`（用户无需改动；如需换目录可在设置里改）。空值 = 关闭自动写入。
- **写文件纪律**：
  - 读-改-写：读取现有 `~/.claude.json` → 只改 `projects[dir].mcpServers.storyboard_canvas` → 原子写（临时文件 + rename）。
  - 保留文件内其它所有内容（其它项目、其它键）。
  - 失败不致命：记录警告，面板仍显示可手动复制的配置作为兜底。
- 触发时机：与 A 一致——「创建接入」时、以及启动重建时。

### C. 行为边界（明确写出）

- **首次**：在 OSC 里点一次「创建接入」（告诉 OSC 暴露哪个项目 + 哪些工具）。此后**永不再需要**。
- 之后每次：启动 OSC → 自动重建描述符 + 自动刷新 Claude Code 配置；打开 Claude Code（在目标目录）→ 直接连上。
- **OSC 重启时 Claude Code 正开着**：运行中的 MCP 子进程持有的是旧描述符（启动时读入内存）。需重开 Claude Code（或 `/mcp` 重连）才能拿到新 broker。属可接受限制。
- **并发写 `~/.claude.json`**：Claude Code 退出时也会写该文件。若两边同时写，后写者覆盖前者。缓解：OSC 只在「创建接入」与启动时写（低频），且写前重读-合并，把窗口降到最小；如遇条目被清掉，重启 OSC 会重写。
- 令牌 12h：只做启动重建；应用连续开超 12h 需重启 OSC 刷新。
- 工具调用仍需在 OSC 内手动批准（`requiresApproval: true`，上游安全设计，**不改**）。

## 4. 改动文件

| 文件 | 改动 |
|---|---|
| `src-tauri/src/commands/external_agent/connection.rs` | 固定描述符名；覆盖写；参数持久化；重建函数；清理旧 UUID 文件 |
| `src-tauri/src/commands/external_agent/mod.rs` | 暴露启动重建入口；`connection-params.json` 路径 |
| `src-tauri/src/lib.rs` | `setup()` 里 `start_broker` 后调用启动重建 |
| `src-tauri/src/commands/external_agent/claude_config.rs`（新） | 读写 `~/.claude.json` local scope 的纯逻辑（可单测） |
| `src/stores/settingsStore.ts` | 新增 `claudeCodeProjectDir` 设置项 + 默认值 |
| `src/components/SettingsDialog.tsx` + i18n | 设置项 UI（一行说明） |

## 5. 验证

1. **Rust 单测**：描述符固定名与覆盖写；`~/.claude.json` 读-改-写保留其它键；目标目录为空时不写。
2. **端到端**：
   - 删掉 `~/.claude.json` 里旧条目 → 在 OSC 点一次「创建接入」→ 断言 `~/.claude.json` 出现 local-scope 条目、`canvas-mcp-current.json` 存在且指向活端口。
   - 重启 OSC → 断言 `canvas-mcp-current.json` 被重写为新端口、`~/.claude.json` 条目仍在。
   - 手动 MCP 握手（`initialize` + `tools/list`）对**重写后**的描述符成功。
3. **真机**：在 `/Users/spic007/Downloads/07-项目文件/000OD` 开 `claude`，确认 `storyboard_canvas` 工具可用、无信任弹窗。

## 6. 不做

- 不做运行中滚动刷新令牌。
- 不做 `.mcp.json`（project scope，会弹窗）。
- 不改工具审批（`requiresApproval`）与画布 MCP 的受限工具集。
- 不碰 Camera / 其它既有功能。
