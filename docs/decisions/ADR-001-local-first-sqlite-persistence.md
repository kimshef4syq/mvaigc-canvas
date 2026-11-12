# ADR-001: 本地优先 SQLite 持久化与双端存储网关

## Status
Accepted

## Date
2026-11-12

## Context
`mvaigc-canvas` 作为面向影视分镜与 AI 创作的桌面应用，需要承载大量节点拓扑、历史记录、媒体引用与视口状态。同时项目需兼顾：
- 创作资产与商业提示词的本地隐私安全；
- 节点拖拽与视口漫游的高频交互性能；
- 纯浏览器前端开发模式（`npm run dev`）与桌面端（`npm run tauri dev`）的双态联调。

## Decision
1. 桌面端采用随 Tauri 2 进程内嵌的 `rusqlite`（SQLite `projects.db`），在 `src-tauri/src/commands/project_state.rs` 维护 `projects`、`project_histories`、`project_image_refs` 与 `assets` 表，并内置建表与自愈迁移逻辑。
2. 前端通过 `src/commands/projectState.ts` 统一网关屏蔽运行态差异：Tauri 环境调用原生 SQLite 命令，`!isTauri()` 时自动降级到 `webProjectState.ts`。
3. 视口平移/缩放与节点全量保存解耦：视口变化仅调用轻量命令 `update_project_viewport_record`，避免整项目 JSON 频繁落盘。

## Alternatives Considered

### 方案 A：仅使用浏览器 IndexedDB / localStorage
- **Pros**：前后端无需额外持久化代码。
- **Cons**：大容量媒体引用与多工程管理易受浏览器配额限制，无法直接与 Rust 侧打包导出（`portability.rs`）和本地文件管理协同。
- **Rejected**：不满足桌面端工程可靠性与大数据量导出需求。

### 方案 B：云端数据库 + 本地缓存
- **Pros**：天然支持多设备同步。
- **Cons**：引入账号体系、服务器运维成本与用户资产隐私合规风险。
- **Rejected**：违背项目本地优先的产品定位。

## Consequences
- **正面影响**：工程数据完全归属用户本机，离线可用；大画布交互与持久化解耦；支持完整的 ZIP 工程包迁移。
- **代价与风险**：修改 `projects.db` 表结构时必须同步编写向后兼容的自愈迁移逻辑，防止旧工程加载失败。
- **后续约束**：UI 与 Store 层禁止绕过 `src/commands/projectState.ts` 直接调用底层数据库命令。

