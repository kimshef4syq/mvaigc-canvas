# Capability Map: mvaigc-canvas

> 按 `spec-driven-development` Phase 0 约定，本文件是全库能力模块、边界职责与单向依赖关系的权威索引。  
> **规则**：模块 ID 一旦确定使用 `kebab-case` 且不随意更名；依赖方向保持无环单向（DAG）。

## 1. 核心能力模块表

| Module ID | 职责边界 | 核心源码位置 | 依赖模块 | Spec 状态 |
|---|---|---|---|---|
| `settings-i18n` | 应用设置、凭据本地存储、主题与中英文 i18n | `src/features/settings/`, `src/features/theme/`, `src/i18n/` | — | [SPEC-settings-i18n.md](SPEC-settings-i18n.md) |
| `persistence-portability` | SQLite 工程持久化、迁移自愈、项目与设置导入导出 | `src/commands/projectState.ts`, `src/features/portability/`, `src/features/project/`, `src-tauri/src/commands/` | `settings-i18n` | [SPEC-persistence-portability.md](SPEC-persistence-portability.md) |
| `ai-providers-proxy` | 多供应商注册、模型定义、中转契约、ComfyUI/MiniMax H3 与内置 `mvaigc-proxy` | `src/features/canvas/models/`, `src-tauri/src/ai/`, `mvaigc-proxy/` | `settings-i18n` | [SPEC-ai-providers-proxy.md](SPEC-ai-providers-proxy.md) |
| `prompt-library` | 提示词库、影视语典、提示词编译与批量导入 | `src/features/promptLibrary/`, `src/features/promptCompiler/`, `src/features/cinematicTechniques/` | `settings-i18n` | [SPEC-prompt-library.md](SPEC-prompt-library.md) |
| `canvas-core` | 无限节点画布、节点注册表、连线、标签组、图文/视频/全景节点与任务恢复 | `src/features/canvas/`, `src/stores/` | `persistence-portability`, `ai-providers-proxy`, `prompt-library` | [SPEC-canvas-core.md](SPEC-canvas-core.md) |
| `director-previs` | 3D 导演台、人物动作、运镜预演时间轴与预演视频录制 | `src/features/canvas/`（导演台子域） | `canvas-core` | [SPEC-director-previs.md](SPEC-director-previs.md) |
| `3dgs-supersplat` | SuperSplat 3D 高斯泼溅编辑器集成、图转 3DGS 工作流与打包脚本 | `src/features/supersplat/`, `vendor/supersplat/`, `scripts/build-supersplat.mjs` | `canvas-core` | [SPEC-3dgs-supersplat.md](SPEC-3dgs-supersplat.md) |
| `canvas-agent-mcp` | 内置画布 Agent、审批流、技能系统（Skill）与 MCP 客户端（stdio/HTTP） | `src/features/canvas/`（Agent 子域）, `resources/agent-profiles/`, `src-tauri/src/commands/` | `canvas-core`, `ai-providers-proxy` | [SPEC-canvas-agent-mcp.md](SPEC-canvas-agent-mcp.md) |

## 2. 建议演进与 Spec 补全顺序（Build Order）

```text
settings-i18n
  ├──→ persistence-portability ──┐
  ├──→ ai-providers-proxy ───────┼──→ canvas-core ──┬──→ director-previs
  └──→ prompt-library ───────────┘                  ├──→ 3dgs-supersplat
                                                    └──→ canvas-agent-mcp
```

## 3. 项目根目录结构与用途地图（Directory Map）

根目录目录统一采用小写 `kebab-case` 命名，按工程职责分为三类（当前历史测试与演示目录暂保留在根目录，不参与主应用构建）：

| 根目录 | 分类 | 职责说明 | 是否参与主构建 |
|---|---|---|---|
| `src/` | 核心源码 | React + TypeScript 前端应用（`commands/`、`stores/`、`features/`、`i18n/`、`components/`） | 是 |
| `src-tauri/` | 核心源码 | Tauri 2 + Rust 桌面壳、SQLite 持久化、`axum` 内置反代与系统命令 | 是 |
| `public/` | 静态资源 | 公共静态资源及构建期生成的 `supersplat/` 分发产物（`.gitignore` 忽略生成部分） | 是 |
| `resources/` | 运行时资源 | 随包分发的 `agent-profiles/` 知识库与 `hypit-provider-mvaigc/` 桥接包 | 是 |
| `scripts/` | 工程脚本 | 构建预处理（`build-supersplat.mjs`、`build-hypit-provider.mjs`）、版本同步与 `check-line-endings.mjs` | 是（构建/CI） |
| `vendor/` | 第三方集成 | 上游 SuperSplat 3DGS 编辑器源码（受保护，非 3DGS 任务禁止修改） | 是（预构建） |
| `mvaigc-proxy/` | 配套工具 | 脱离画布手工验证内置 `mvaigc-proxy` 的 Python CLI 工具与说明 | 否 |
| `.github/` | CI 与协作 | GitHub Actions 工作流（`build.yml`、`cross-platform-quality.yml`）与 Issue/PR 模板 | 否（CI） |
| `docs/` | 项目文档 | PRD（`prd/`）、模块 Spec（`specs/`）、ADR（`decisions/`）、开发指南、用户手册与归档 | 否 |
| `tasks/` | 研发规划 | 当前迭代实施计划（`plan.md`）与任务清单（`todo.md`） | 否 |
| `model-test/` | 历史测试资产 | 调试用 3D/3DGS 模型夹具（`123.glb`、`gaussian/toy-cat.sog`），暂保留 | 否 |
| `previews/` | 历史预览稿 | 静态页面排版预览（`launch-typography.html`），暂保留 | 否 |
| `verification/` | 历史验证产物 | 功能验收视频记录（`hypit-h3-768p-7s.mp4`），暂保留 | 否 |
| `rongmei-shijie/` | 独立演示子项目 | 融媒视界宣传动画 Demo 与配套分镜/帧素材，暂保留（与主应用构建解耦） | 否 |

## 4. 新增模块规范

1. 任何跨模块的新特性，须先在本表确认所属 `Module ID` 或评审新增 `Module ID`。
2. 为模块创建 `docs/specs/SPEC-<module-id>.md`（基于 [docs/specs/_TEMPLATE.md](_TEMPLATE.md)）。
3. 接口契约归属于**提供方（Provider）模块**的 Spec 中，调用方仅引用契约而不重复定义。

