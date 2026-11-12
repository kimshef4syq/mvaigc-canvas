# ADR-003: SuperSplat 3DGS 编辑器的隔离会话与版本化协议集成

## Status
Accepted

## Date
2026-11-12

## Context
项目需要集成开源的 3D 高斯泼溅（3DGS）编辑器 SuperSplat（位于 `vendor/supersplat/`），以支持在画布中查看/编辑 3DGS 模型、保存多视角并将渲染图回传画布。直接将庞大的 WebGL 编辑器源码深度耦合进 React 主应用会导致构建慢、依赖冲突与样式污染。

## Decision
1. 保持 `vendor/supersplat/` 上游独立构建，通过 `scripts/build-supersplat.mjs` 预构建产物至 `public/supersplat/` 并作为 Tauri 资源打包。
2. Rust 后端（`src-tauri/src/commands/supersplat.rs`）启动带随机 `token` 的本地 `axum` 会话服务向隔离编辑器提供模型与资产读写（强制 `canonicalize()` 路径边界校验）。
3. 宿主画布与隔离编辑器之间通过版本化 `postMessage` 协议（`src/features/supersplat/protocol.ts`，`SUPER_SPLAT_PROTOCOL_VERSION = 1`）通信，并用 `isEditorResponse` 严格校验 `source` 与 `origin`。

## Alternatives Considered

### 方案 A：将 SuperSplat 源码直接改写为 React 组件嵌入主包
- **Pros**：同域直接函数调用，无需 `postMessage`。
- **Cons**：上游更新合并极度困难，Three.js / PlayCanvas 依赖与全局样式易与主画布冲突。
- **Rejected**：维护成本过高。

## Consequences
- **正面影响**：上游 `vendor/supersplat/` 几乎零入侵；主画布与 3DGS 编辑器故障隔离、打包边界清晰。
- **代价与风险**：跨窗口状态同步需通过显式命令（`open` / `save` / `getView` / `setView` / `capture`）完成。
- **后续约束**：禁止在无明确 3DGS 集成任务时修改 `vendor/supersplat/`；所有跨窗口响应必须经过 `isEditorResponse` 校验。

