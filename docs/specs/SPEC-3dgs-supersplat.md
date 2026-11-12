# Spec: 3dgs-supersplat（3D 高斯泼溅编辑器集成）

> **状态**：Approved（现行基线）  
> **所属模块 ID**：`3dgs-supersplat`（见 [CAPABILITY-MAP.md](CAPABILITY-MAP.md)）  
> **关联 PRD**：[PRD-mvaigc-canvas-v2.md](../prd/PRD-mvaigc-canvas-v2.md)  
> **相关工作流**：[image-to-gaussian.md](../workflows/image-to-gaussian.md)  
> **最后更新**：2026-11-12

---

## 1. Objective（目标与职责）

将上游 SuperSplat 3D 高斯泼溅（3DGS）编辑器以隔离窗口/本地会话服务的形式安全集成进 `mvaigc-canvas`，支持从画布 `gaussianNode` 打开 3DGS 模型、管理保存视角（`SavedView`）、截图回传画布以及图转 3DGS 工作流。

## 2. Tech Stack & Interfaces（技术栈与边界契约）

- **构建集成**：`scripts/build-supersplat.mjs` 将 `vendor/supersplat/` 构建产物输出至 `public/supersplat/`，由 `package.json` 的 `prebuild` 自动触发并随 Tauri `bundle.resources` 打包。
- **版本化通信协议**（[src/features/supersplat/protocol.ts](../../src/features/supersplat/protocol.ts)）：
  - `SUPER_SPLAT_PROTOCOL_VERSION = 1`
  - 命令类型 `EditorCommand`：`initialize` | `open` | `save` | `getView` | `setView` | `capture` | `close`
  - 严格来源校验：`isEditorResponse(event, source, origin)` 校验 `event.source === source && event.origin === origin`。
- **Rust 本地会话服务**（[src-tauri/src/commands/supersplat.rs](../../src-tauri/src/commands/supersplat.rs)）：
  - 基于 `axum` 提供带随机 `token` 隔离的静态资源与 `session.json` / `model` 读写接口。
  - 安全防护：`canonicalize()` + `starts_with(folder)` 防止目录穿越。

## 3. Commands（验证命令）

```bash
npm run supersplat:build
npx tsc --noEmit
npm test -- src/features/supersplat/assets.test.ts
cargo check --manifest-path src-tauri/Cargo.toml
```

## 4. Project Structure & Code Style（目录落点）

- `src/features/supersplat/`：`protocol.ts`、`client.ts`、`assets.ts`、`assets.test.ts`
- `src-tauri/src/commands/supersplat.rs` & `supersplat-shell.html`：Rust 本地会话服务器与壳页面
- `vendor/supersplat/`：上游 SuperSplat 源码（受保护目录）
- `scripts/build-supersplat.mjs`：预构建脚本

## 5. Testing Strategy（测试策略）

- 对 3DGS 资产元信息解析（`assets.test.ts`）、跨窗口协议校验及 Rust 侧构建进行验证。

## 6. Boundaries（三层边界）

- **Always**：
  - `postMessage` 通信必须通过 `isEditorResponse` 严格验证 `source`、`origin` 与协议版本。
  - 本地会话服务路径读取必须做 `canonicalize()` 边界检查。
- **Ask first**：升级 `SUPER_SPLAT_PROTOCOL_VERSION` 或修改 `vendor/supersplat/` 上游源码。
- **Never**：在未授权情况下修改 `vendor/supersplat/`；绕过 `token` 校验暴露本地磁盘文件。

## 7. Success Criteria（完成标准）

- [x] `npm run supersplat:build` 可成功构建并被桌面端正确加载。
- [x] `gaussianNode` 与隔离编辑器间的打开、视角读取/恢复、截图回传链路闭环。
- [x] 协议隔离与资产单元测试通过。

