# mvaigc-canvas 工程规范与 Agent 协作指南 (AGENTS.md)

> 本文件是 `mvaigc-canvas` 仓库所有人类开发者与 AI 编码 Agent 的**单一真相源（SSOT）**。其他工具入口（如 `CLAUDE.md`、`.github/copilot-instructions.md`）均指向本文件。
>
> **必读索引**：[质量红线 CONSTRAINTS.md](CONSTRAINTS.md) | [文档导航 docs/README.md](docs/README.md) | [基线 PRD](docs/prd/PRD-mvaigc-canvas-v2.md) | [能力与目录地图 CAPABILITY-MAP.md](docs/specs/CAPABILITY-MAP.md)

## 1. 技术栈与核心结构

- **前端**：React 18 + TypeScript (~5.7) + Vite 6 + Zustand 5 + Tailwind CSS 3 + `@xyflow/react` + Konva + Three.js (`@photo-sphere-viewer/core` / SuperSplat)
- **桌面壳与后端**：Tauri 2 + Rust (Edition 2021) + `axum`（内置 `mvaigc-proxy`）+ `rusqlite`（SQLite 本地持久化）+ `rmcp`（MCP 客户端）
- **核心目录**：
  - `src/commands/`：TypeScript → Tauri IPC 命令桥接
  - `src/stores/`：Zustand 状态与持久化协调（不承载重业务逻辑）
  - `src/features/canvas/`：无限画布、节点注册表、AI 模型/供应商、导演台、Agent
  - `src/features/*`：`portability`、`promptLibrary`、`promptCompiler`、`settings`、`supersplat`、`project`、`cinematicTechniques`、`mediaNews`、`theme`、`update`
  - `src/i18n/`：中英文语言包（`zh.json` / `en.json`）
  - `src-tauri/src/commands/` & `src-tauri/src/ai/`：Rust Tauri 命令、网络代理、SQLite 持久化、AI 供应商适配
  - `resources/`：`agent-profiles/` 与 `hypit-provider-mvaigc/`
  - `vendor/supersplat/`：3D 高斯泼溅（3DGS）编辑器集成

## 2. 常用开发与验证命令

```bash
# 安装依赖
npm install

# 开发启动
npm run dev                 # 仅前端开发
npm run tauri dev           # 桌面应用全链路联调

# 质量门禁（提交前必须按需通过）
npm run check:line-endings  # 检查跟踪文件 LF 换行符
npm test                    # Vitest 单元测试 (vitest run)
npx tsc --noEmit            # TypeScript 严格类型检查
npm run build               # 生产构建（含 supersplat 与 hypit-provider 预构建）

# Rust / Tauri 检查（修改 src-tauri/** 时必跑）
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## 3. PRD & Spec 导向开发工作流（强制门禁）

非单行拼写/样式微调的功能开发或架构变更，**必须**遵循以下五阶段门禁：

```text
PRD (为什么做 & 做什么) ─→ SPEC (怎么做 & 验收标准) ─→ PLAN (架构拆解) ─→ TASKS (垂直切片) ─→ IMPLEMENT
        │                           │                        │                  │
     人工确认                    人工确认                  人工确认           按序执行验证
```

1. **Scope Check（多模块需求先画能力地图）**：若需求跨多个独立能力域，先更新或对齐 [docs/specs/CAPABILITY-MAP.md](docs/specs/CAPABILITY-MAP.md)，确定模块 ID 与单向依赖。
2. **PRD（`docs/prd/`）**：使用 [docs/prd/_TEMPLATE.md](docs/prd/_TEMPLATE.md) 明确目标用户、业务价值、In/Out of Scope 与验收指标。
3. **Spec（`docs/specs/`）**：使用 [docs/specs/_TEMPLATE.md](docs/specs/_TEMPLATE.md) 编写或更新 `SPEC-<module-id>.md`（或新特性 Spec），必须先获人工确认，**禁止未过 Spec 直接大范围写代码**。
4. **Plan & Tasks（`tasks/`）**：在 [tasks/plan.md](tasks/plan.md) 与 [tasks/todo.md](tasks/todo.md) 拆解为 S/M 粒度（≤5 文件）的可验证切片。
5. **ADR（`docs/decisions/`）**：涉及架构选型、数据模型/SQLite 结构或跨模块契约变更时，使用 [docs/decisions/_TEMPLATE.md](docs/decisions/_TEMPLATE.md) 沉淀 ADR。

> 注：`docs/superpowers/` 为历史演进阶段的设计与计划归档，保留供查阅；新需求统一使用 `docs/prd/`、`docs/specs/`、`docs/decisions/` 与 `tasks/`。

## 4. 代码与架构边界

- **分层约束**：遵循 `UI → Store → Application Service → Infrastructure → Persistence` 单向数据流，UI 层不直接散落调用底层 Tauri API。
- **Always（始终遵守）**：
  - 修改节点、工具、模型、持久化字段时，同步类型定义、注册表、UI、存储与文档。
  - 新增用户可见文案必须走 `useTranslation()` 并同步 `zh.json` 与 `en.json`。
  - 所有跟踪文本文件保持 **LF** 换行符（提交前跑 `npm run check:line-endings`）。
- **Ask first（变更前先确认）**：
  - 修改 SQLite 表结构或迁移逻辑。
  - 新增 npm / Cargo 外部依赖或修改 `.github/workflows/`。
  - 修改 `src-tauri/tauri.conf.json` 权限、CSP 或打包配置。
- **Never（严禁执行）**：
  - 提交真实 API Key、Token、Cookie、本地 `.db` 或含个人路径的日志/配置。
  - 在未获得明确授权前，通过注释断言、跳过测试、`@ts-ignore` 来“假装通过”检查。
  - 修改 `vendor/supersplat/` 除非明确针对 3DGS 集成任务。

