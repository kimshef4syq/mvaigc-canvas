# Spec: ai-providers-proxy（AI 供应商适配、任务状态机与内置反代）

> **状态**：Approved（现行基线）  
> **所属模块 ID**：`ai-providers-proxy`（见 [CAPABILITY-MAP.md](CAPABILITY-MAP.md)）  
> **关联 PRD**：[PRD-mvaigc-canvas-v2.md](../prd/PRD-mvaigc-canvas-v2.md)  
> **关联指南**：[provider-and-model-extension.md](../development-guides/provider-and-model-extension.md)  
> **最后更新**：2026-11-12

---

## 1. Objective（目标与职责）

统一抽象前端模型注册、自定义供应商/中转站契约、异步生成任务生命周期状态机（防重复计费与安全恢复）、ComfyUI / MiniMax H3 适配，以及随桌面应用启动的 Rust 原生内置反代 `mvaigc-proxy`。

## 2. Tech Stack & Interfaces（技术栈与边界契约）

- **前端模型定义**（[src/features/canvas/models/types.ts](../../src/features/canvas/models/types.ts)）：
  - `MediaModelType` (`'image' | 'video' | 'audio'`)
  - `ModelProviderDefinition`、`ImageModelDefinition`、`ExtraParamDefinition`（支持 `resolveResolutions` 与 `resolveRequest` 动态决定请求模型与模式标签）
  - 通过 `import.meta.glob` 自动发现模型文件。
- **前端生成任务接口**（[src/commands/ai.ts](../../src/commands/ai.ts)）：
  - `GenerateRequest`（支持 `reference_images`、`reference_videos`、`reference_audios`、`extra_params`）
  - `GenerationJobState`：`queued` | `submitting` | `running` | `recoverable_wait` | `materializing` | `succeeded` | `failed` | `not_found` | `unknown` | `canceled`
  - `GenerationJobStatus`（包含 `external_task_id`、`poll_descriptor`、`config_fingerprint`、`resumable`、`error_category`、`warning`）
- **Rust 后端 Trait**（[src-tauri/src/ai/mod.rs](../../src-tauri/src/ai/mod.rs)）：
  - `AIProvider` trait：`name()`、`supports_model()`、`list_models()`、`set_api_key()`、`supports_task_resume()`、`submit_task()` 等
  - `ProviderTaskSubmission` (`Queued(ProviderTaskHandle)` | `Succeeded(String)`)
  - `ProviderTaskPollResult` (`Running` | `Succeeded(String)` | `Failed(String)`)
- **内置反代 `mvaigc-proxy`**：基于 `axum`（端口默认 `8787`，可通过设置配置），提供独立 CLI 测试工具 [mvaigc-proxy/mvaigc-cli.py](../../mvaigc-proxy/mvaigc-cli.py)。

## 3. Commands（验证命令）

```bash
npx tsc --noEmit
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## 4. Project Structure & Code Style（目录落点）

- `src/features/canvas/models/`：前端模型目录（按媒体类型与供应商分目录）与注册表
- `src/stores/customProvidersStore.ts`：自定义 OpenAI 兼容与中转站契约存储
- `src/commands/ai.ts` & `src-tauri/src/commands/ai.rs`：前后端生成与任务恢复命令桥
- `src-tauri/src/ai/`：各供应商 Rust 实现与 `AIError` 分类
- `mvaigc-proxy/`：独立脱离画布的 Python CLI 验证脚本

## 5. Testing Strategy（测试策略）

- 针对自定义供应商网关、MiniMax H3 网关、任务恢复（`generationRecovery`）、ComfyUI 工作流与音频参数解析建立 Vitest 单元测试；Rust 侧验证各 Provider 请求构造与错误映射。

## 6. Boundaries（三层边界）

- **Always**：
  - 提交阶段网络结果不明确或状态为 `unknown` 时，禁止自动重试计费请求，必须保留 `poll_descriptor` 供安全恢复。
  - 新增模型必须保持前端 `model.id` 与后端 `supports_model()` 一致。
- **Ask first**：修改 `AIProvider` 核心 trait 签名或 `GenerationJobStatus` 持久化字段。
- **Never**：在错误日志或诊断输出中打印供应商 API Key、Authorization 头或用户账号密码。

## 7. Success Criteria（完成标准）

- [x] 前后端模型注册、参数解析与任务状态流转一致。
- [x] 提交异常不触发重复计费，安全任务句柄可从日志/节点恢复拉取结果。
- [x] `tsc --noEmit`、`vitest` 与 `cargo test` 均通过。

