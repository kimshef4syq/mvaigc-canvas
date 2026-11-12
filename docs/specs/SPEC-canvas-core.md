# Spec: canvas-core（无限节点画布与核心工作流）

> **状态**：Approved（现行基线）  
> **所属模块 ID**：`canvas-core`（见 [CAPABILITY-MAP.md](CAPABILITY-MAP.md)）  
> **关联 PRD**：[PRD-mvaigc-canvas-v2.md](../prd/PRD-mvaigc-canvas-v2.md)  
> **最后更新**：2026-11-12

---

## 1. Objective（目标与职责）

提供基于 `@xyflow/react` 的高性能无限节点画布，承载 18 类核心节点、连接拓扑规则、标签组引用收纳、几何索引与窄订阅渲染优化、撤销/重做历史，以及图文/音视频/分镜/全景节点的生成与编辑工作流。

## 2. Tech Stack & Interfaces（技术栈与边界契约）

- **画布引擎**：`@xyflow/react` + `zustand`（[src/stores/canvasStore.ts](../../src/stores/canvasStore.ts)、[src/stores/canvasDefaultsStore.ts](../../src/stores/canvasDefaultsStore.ts)）。
- **节点类型注册表**（[src/features/canvas/domain/canvasNodes.ts](../../src/features/canvas/domain/canvasNodes.ts) & [nodeRegistry.ts](../../src/features/canvas/domain/nodeRegistry.ts)）：
  - 媒体与生成节点：`uploadNode`、`imageNode`、`aiVideoNode`、`aiTextNode`、`aiAudioNode`、`exportImageNode`、`videoNode`、`audioNode`
  - 编排与注释节点：`storyboardNode`（分镜切分）、`storyboardGenNode`（分镜生成）、`panoramaNode`（全景）、`gaussianNode`（3DGS）、`blueprintNode`（蓝图/导演台）、`textAnnotationNode`、`jsonCardNode`、`groupNode`、`tagNode`、`tagGroupNode`
- **注册中心契约**（`CanvasNodeDefinition<TData>`）：
  - 统一声明 `type`、`menuLabelKey`、`menuIcon`、`visibleInMenu`、`defaultSize`、`capabilities`（`toolbar` / `selectionToolbar` / `promptInput`）、`connectivity`（手柄与连接菜单）及 `createDefaultData()`。
- **画布命令服务**（`src/features/canvas/application/canvasCommandService.ts` & `canvasCommandRegistry.ts`）：
  - 统一向 UI 与 Canvas Agent 暴露节点创建、连线、更新、定位（`viewport.focus`）与生成触发能力。

## 3. Commands（验证命令）

```bash
npx tsc --noEmit
npm test -- src/stores/canvasStore.test.ts src/features/canvas/
npm run build
```

## 4. Project Structure & Code Style（目录落点）

```text
src/features/canvas/
├── domain/         # 节点类型定义、nodeRegistry、显示名称等纯领域模型
├── application/    # 画布命令服务、连接规则、提示词模板、音频/视频编排逻辑
├── infrastructure/ # 对接 Tauri 命令、代理与外部资源
├── models/         # AI 模型与供应商注册
├── nodes/          # 各节点 React 组件实现
├── edges/          # 自定义连线渲染
├── tools/          # 节点工具处理器（多角度、打光、裁剪、宫格切分等）
├── hooks/          # 窄订阅与交互 hooks
└── ui/             # 节点工具栏、弹窗、进度遮罩与导演台 UI
```

## 5. Testing Strategy（测试策略）

- 对 `canvasStore`、连接规则（`canvasConnectionRules.test.ts`）、命令注册表（`canvasCommandRegistry.test.ts`）、工具栏与进度遮罩组件建立 Vitest 单元测试与集成测试。

## 6. Boundaries（三层边界）

- **Always**：
  - 新增节点类型必须先注册到 `nodeRegistry.ts` 与 `canvasNodes.ts`，禁止在多处散落硬编码分支。
  - 遵循 `UI → Store → Application Service → Infrastructure → Persistence` 单向数据流。
  - 节点拖拽过程中禁止触发全量工程序列化或阻塞主线程的重计算。
- **Ask first**：变更核心节点持久化字段结构或修改 `CanvasNodeType` 枚举值（需评估旧工程兼容性）。
- **Never**：在标签组成员被 `@` 引用时向用户生成提示词注入额外冗余描述；在 UI 组件直接调用底层 SQLite 持久化。

## 7. Success Criteria（完成标准）

- [x] 所有已注册节点均可通过菜单或命令创建、连线、持久化与撤销/重做。
- [x] 大画布下拖拽与视口漫游保持流畅，视口变更走轻量持久化。
- [x] `tsc --noEmit` 与 `src/features/canvas/` 相关测试全量通过。

