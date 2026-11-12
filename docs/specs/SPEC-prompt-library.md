# Spec: prompt-library（提示词库、影视语典与提示词编译）

> **状态**：Approved（现行基线）  
> **所属模块 ID**：`prompt-library`（见 [CAPABILITY-MAP.md](CAPABILITY-MAP.md)）  
> **关联 PRD**：[PRD-mvaigc-canvas-v2.md](../prd/PRD-mvaigc-canvas-v2.md)  
> **最后更新**：2026-11-12

---

## 1. Objective（目标与职责）

为创作者提供可浏览、收藏与复用的内置提示词库、影视运镜/光影语典（Cinematic Techniques）、结构化提示词编译器（`PromptCompiler`）与质量校验器（`PromptLinter`），以及表格批量导入生成任务的能力。

## 2. Tech Stack & Interfaces（技术栈与边界契约）

- **状态存储**：`src/stores/promptLibraryStore.ts`（持久化用户自定义与收藏提示词）。
- **提示词编译契约**（[src/features/promptCompiler/PromptCompiler.ts](../../src/features/promptCompiler/PromptCompiler.ts)）：
  - `TimedAction`（`startSeconds`, `endSeconds`, `action`）
  - `MinimaxH3PromptInput`（`durationSeconds` 限定 4–15 秒、`space`、`lighting`、`shots?: MinimaxH3Shot[]`）
  - `validateTimeline()`：强制动作序列有序、无重叠且在总时长区间内。
- **内置资产**：
  - `src/features/promptLibrary/bundledCommunityPrompts.json`
  - `src/features/cinematicTechniques/bundledCinematicTechniques.json`
- **内置功能提示词模板覆盖**：支持通过 `settingsStore` 管理多语言功能提示词模板与恢复默认。

## 3. Commands（验证命令）

```bash
npx tsc --noEmit
npm test -- src/features/promptLibrary/PromptLibrary.test.ts src/features/promptCompiler/PromptCompiler.test.ts src/features/cinematicTechniques/cinematicTechniquesData.test.ts
```

## 4. Project Structure & Code Style（目录落点）

- `src/features/promptLibrary/`：提示词库 UI、内置数据与单测
- `src/features/promptCompiler/`：结构化提示词编译器、Linter 与组装弹窗
- `src/features/cinematicTechniques/`：影视语典数据与浏览组件
- `src/features/canvas/application/promptImport/`：表格批量导入解析与测试夹具

## 5. Testing Strategy（测试策略）

- 对提示词库过滤、影视语典数据校验、MiniMax H3 时间轴编译与异常边界（超时长、动作重叠、空字段）进行 Vitest 单元测试。

## 6. Boundaries（三层边界）

- **Always**：
  - 结构化编译失败必须抛出明确字段级错误提示，不静默截断时间轴。
  - 新增内置提示词分类或 UI 标签需同步中英文 i18n。
- **Ask first**：修改已发布的 `PromptLayerRecordV1` / `ReferenceSlotBindingV1` 数据结构版本。
- **Never**：在提示词模板或测试夹具中写入真实个人 API Key 或未脱敏商业客户提示词。

## 7. Success Criteria（完成标准）

- [x] 提示词库与影视语典支持检索、收藏并一键填入画布节点。
- [x] `PromptCompiler` 严格校验时间轴范围与动作顺序。
- [x] 提示词相关单元测试与 `tsc --noEmit` 全部通过。

