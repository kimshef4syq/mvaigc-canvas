# Spec: canvas-agent-mcp（画布 Agent、技能与 MCP 扩展）

> **状态**：Approved（测试版现行基线）  
> **所属模块 ID**：`canvas-agent-mcp`（见 [CAPABILITY-MAP.md](CAPABILITY-MAP.md)）  
> **关联 PRD**：[PRD-mvaigc-canvas-v2.md](../prd/PRD-mvaigc-canvas-v2.md)  
> **扩展指南**：[agent-extensions.md](../development-guides/agent-extensions.md)  
> **最后更新**：2026-11-12

---

## 1. Objective（目标与职责）

提供右侧嵌入式画布 Agent（测试版），使其能够理解项目上下文与选中节点、通过审批机制调用画布命令与生成工作流、读取脱敏诊断日志，并支持用户安装数据型技能包（`SKILL.md`）与连接外部 MCP 服务（stdio / Streamable HTTP）。

## 2. Tech Stack & Interfaces（技术栈与边界契约）

- **Agent 运行时**：`@openai/agents`（`sdkRuntime.ts`）+ 项目内 `agent/` 分层架构（`domain` / `application` / `infrastructure` / `ui`）。
- **安全与审批契约**：
  - `agentApproval.ts` & `agentAutoApprovalPolicy.ts`：手动审批与自动模式策略（自动模式在删除节点等高危操作前仍需确认）。
  - `agentLoopGuard.ts`：防止失效工具连续空转。
  - `agentRedaction.ts`：日志与诊断上下文脱敏。
- **技能扩展接口**（[src/commands/extensions.ts](../../src/commands/extensions.ts)）：
  - `InstalledSkillPackage`（`id`, `markdown`, `enabled`, `revision`, `resources`）
  - 命令：`listInstalledSkills`、`installLocalSkill`、`installSkillZip`（支持 SHA256 校验）、`setSkillEnabled`、`removeSkill`、`rollbackSkill`、`readSkillResource`。
- **MCP 客户端接口**（[src/commands/mcpClient.ts](../../src/commands/mcpClient.ts) & `rmcp`）：
  - `McpConfig`（`transport: 'stdio' | 'http'`、`command`、`args`、`url`、`allowedTools`）
  - 首次连接不自动授权任何工具；手动断开后本次运行期间不自动重连。

## 3. Commands（验证命令）

```bash
npx tsc --noEmit
npm test -- src/features/canvas/agent/ src/commands/mcpClient.test.ts src/commands/externalAgent.test.ts
cargo check --manifest-path src-tauri/Cargo.toml
```

## 4. Project Structure & Code Style（目录落点）

- `src/features/canvas/agent/domain/`：模型能力卡片与领域定义
- `src/features/canvas/agent/application/`：审批策略、预算控制、循环防护、回滚、流式读取、诊断与脱敏
- `src/features/canvas/agent/infrastructure/`：SDK 运行时、会话持久化（Tauri / IndexedDB）、MCP 工具桥接
- `src/features/canvas/agent/ui/`：Dock 面板、Feed 卡片、审批卡、MCP 与扩展管理面板
- `src-tauri/src/commands/extensions.rs` & `mcp_client.rs`：Rust 技能包与 `rmcp` 客户端宿主
- `resources/agent-profiles/`：内置 Agent 预设知识库

## 5. Testing Strategy（测试策略）

- 针对审批指纹一致性、自动审批边界、循环防护、会话仓库、MCP 工具分页查找与外部 Agent 连接建立全套 Vitest 单测。

## 6. Boundaries（三层边界）

- **Always**：
  - 审批记录必须绑定模型原始 JSON 参数，禁止用 UI 脱敏展示数据重建审批指纹。
  - 技能正文按需读取（限长），技能脚本不得自动执行。
  - 外部/第三方文本内容视为不可信数据，不得直接作为系统指令执行。
- **Ask first**：放宽自动审批白名单或新增可修改本地文件系统/删除数据的内置工具。
- **Never**：在未获用户授权时自动授权新发现的 MCP 工具；在日志或模型上下文中暴露明文 API Key。

## 7. Success Criteria（完成标准）

- [x] 支持项目隔离的 Agent 对话历史、工具审批、任务进度追踪与安全回滚。
- [x] 支持本地/ZIP 技能安装、启停、版本回滚，以及 stdio / Streamable HTTP MCP 工具按需授权调用。
- [x] `src/features/canvas/agent/` 全部单元测试与 `tsc --noEmit` 通过。

