# Spec: persistence-portability（工程持久化与导入导出）

> **状态**：Approved（现行基线）  
> **所属模块 ID**：`persistence-portability`（见 [CAPABILITY-MAP.md](CAPABILITY-MAP.md)）  
> **关联 PRD**：[PRD-mvaigc-canvas-v2.md](../prd/PRD-mvaigc-canvas-v2.md)  
> **最后更新**：2026-11-12

---

## 1. Objective（目标与职责）

负责画布工程的本地 SQLite 持久化、纯浏览器开发模式下的 Web 存储降级、视口增量保存、资产索引，以及整工程包（含媒体资产）与应用设置的导入/导出。

## 2. Tech Stack & Interfaces（技术栈与边界契约）

- **桌面持久化**：Tauri 2 + `rusqlite`（数据库位于应用数据目录 `projects.db`）。
- **核心 SQLite 表结构**（[src-tauri/src/commands/project_state.rs](../../src-tauri/src/commands/project_state.rs)）：
  - `projects`（`id`, `name`, `created_at`, `updated_at`, `node_count`, `nodes_json`, `edges_json`, `viewport_json`, `history_json`, `image_pool_json`）
  - `project_histories`（`project_id`, `history_json`）
  - `project_image_refs`（`project_id`, `path`）
  - `assets`（`project_id`, `asset_id`, `node_id`, `media_type`, `uri`, `metadata_json`）
- **前端 IPC 网关**：
  - 工程命令（[src/commands/projectState.ts](../../src/commands/projectState.ts)）：`listProjectSummaries`、`getProjectRecord`、`upsertProjectRecord`、`updateProjectViewportRecord`、`renameProjectRecord`、`deleteProjectRecord`（在 `!isTauri()` 时自动路由到 `webProjectState.ts`）。
  - 迁移命令（[src/commands/portability.ts](../../src/commands/portability.ts)）：`exportTauriProjectBundle`、`inspectTauriProjectBundle`、`importTauriProjectBundle`（通过 `portability-progress` 事件上报进度并支持 `AbortSignal` 取消 `cancel_portability_operation`）。

## 3. Commands（验证命令）

```bash
npx tsc --noEmit
npm test -- src/commands/projectState.test.ts src/commands/webProjectState.test.ts src/commands/portability.test.ts src/stores/projectStore.persistenceFailure.test.ts src/stores/projectStore.portability.test.ts src/stores/persistStorage.test.ts
cargo test --manifest-path src-tauri/Cargo.toml
```

## 4. Project Structure & Code Style（目录落点）

- `src/commands/projectState.ts` & `src/commands/webProjectState.ts`：双运行态工程持久化网关
- `src/commands/portability.ts`：原生工程包导入导出桥接
- `src/stores/projectStore.ts` & `src/stores/persistStorage.ts`：工程状态协调与容错存储
- `src/features/portability/` & `src/features/project/`：工程管理主页、重命名弹窗与迁移向导
- `src-tauri/src/commands/project_state.rs` & `portability.rs`：SQLite 读写与 ZIP 打包解包

## 5. Testing Strategy（测试策略）

- 前端使用 `fake-indexeddb` 与 Tauri `invoke` mock 验证持久化失败回滚、Web 降级与迁移进度/取消逻辑。
- Rust 侧使用 `portability_tests.rs` 及内联单元测试验证 SQLite 建表、迁移自愈与 Bundle 校验。

## 6. Boundaries（三层边界）

- **Always**：
  - 视口平移/缩放只调用轻量命令 `updateProjectViewportRecord`，不触发整项目重写。
  - 持久化失败时保留安全恢复信息，不得静默丢弃用户画布状态。
  - 导出设置备份默认剥离敏感凭据。
- **Ask first**：修改 `projects.db` 表结构、索引或 Bundle 文件格式版本。
- **Never**：在 UI 组件中直接调用底层 `invoke('upsert_project_record')` 绕过 Store/Command 网关；提交任何本地 `.db` 文件。

## 7. Success Criteria（完成标准）

- [x] Tauri 与 Web 开发模式均能正常创建、加载、重命名、删除工程。
- [x] 大型工程导入/导出支持进度反馈与中途取消，且不破坏现有工程数据。
- [x] 前后端持久化与迁移测试全部通过。

