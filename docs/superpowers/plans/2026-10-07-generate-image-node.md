# 「生成图片」节点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「生成图片」节点（`exportImageNode` / 组件 `ImageNode`）自带提示词面板，并把同一提示词的多次生成收进该节点的历史，可挑选主图；生成后可选「覆盖生成」或「新建节点生成」。

**Architecture:** 节点新增 `images[]` 历史 + `mainImageIndex`；`imageUrl`/`previewImageUrl` 始终镜像主图，下游不改。生成时**同一节点串行提交**（一张完成再提交下一张），**复用现有"一节点一 job"轮询**，不动轮询核心。完成回调由"覆盖 imageUrl"改为"append 一条历史 + 设为主图"。

**Tech Stack:** React + TypeScript + Zustand；测试用 Vitest；Tauri 2（本轮只改前端 TS）。

**Spec:** `docs/superpowers/specs/2026-10-07-generate-image-node-design.md`

## Global Constraints

- **工作区**：所有改动只落 `mvaigc-canvas/`。`open-storyboard-canvas/` 只读，不碰。
- **Camera 冻结**：不碰 `CameraControlPanel.tsx` / `CameraSphereControl.tsx` / `DirectorCameraPilotHud.tsx` / `CameraPresetsPanel.tsx` / `cameraPromptLibrary.ts` / `cameraPresetStore.ts`。
- **命名**：类型串 `exportImageNode`（`CANVAS_NODE_TYPES.exportImage`），组件 `ImageNode`，显示名「生成图片」。**不要**新增 `imageNode` 类型串（已被 `imageEdit` 占用）。
- **不改** `imageNode`（「AI 图片」）的渲染与定义；本轮只把它从新建菜单隐藏。
- **不重构** `ImageEditNode`；新面板独立实现。
- 提交信息用 `type(scope): 中文描述`，结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 每条命令在 `mvaigc-canvas/` 下执行。

## Review Focus

这些是 spec 隐含、但任务测试未必覆盖、最可能伤到用户的输入/情形：

1. **旧项目只有 `imageUrl`、无 `images[]`** —— 打开后必须照常显示那张图，不能空白、不能报错。
2. **节点同时是提示词宿主又是下游参考源** —— 上游 `@图N` 引用仍要能解析到它的主图。
3. **连点发送 / 双击** —— 不得创建重复节点或产生孤儿 job。
4. **`mainImageIndex` 越界**（数据损坏或部分写入）—— 不得崩溃，回退到最后一条有效图。
5. **重命名节点/文件**（`renameLocalMediaFiles` 路径）—— 主图与历史 URL 保持一致，不丢历史。

---

### Task 1: 数据模型与历史纯函数

**Files:**
- Modify: `src/features/canvas/domain/canvasNodes.ts`（`ExportImageNodeData` 加字段，新增 `GeneratedImageEntry`）
- Create: `src/features/canvas/application/generatedImageHistory.ts`
- Test: `src/features/canvas/application/generatedImageHistory.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GeneratedImageEntry {
    id: string;
    imageUrl: string | null;
    previewImageUrl: string | null;
    aspectRatio: string;
    generatedFileName?: string | null;
    sourcePrompt?: string | null;
    createdAt: number;
  }
  export function createGeneratedImageEntry(input: {
    imageUrl: string | null; previewImageUrl: string | null; aspectRatio: string;
    generatedFileName?: string | null; sourcePrompt?: string | null; now?: number;
  }): GeneratedImageEntry;
  export function appendGeneratedImageEntry(
    entries: GeneratedImageEntry[] | undefined, entry: GeneratedImageEntry
  ): GeneratedImageEntry[];
  export function resolveMainImageEntry(
    entries: GeneratedImageEntry[] | undefined, mainImageIndex: number | undefined
  ): GeneratedImageEntry | null;   // 越界回退到最后一个非空 imageUrl 的条目
  export function migrateLegacyExportImageData(data: {
    imageUrl?: string | null; previewImageUrl?: string | null; aspectRatio?: string;
    generatedFileName?: string | null; sourcePrompt?: string; images?: GeneratedImageEntry[];
    mainImageIndex?: number;
  }): { images: GeneratedImageEntry[]; mainImageIndex: number };
  ```
- `ExportImageNodeData` 新增：`images?: GeneratedImageEntry[]; mainImageIndex?: number; prompt?: string;`

- [ ] **Step 1: 写失败测试** `generatedImageHistory.test.ts`

覆盖：append 保持顺序；`resolveMainImageEntry` 越界回退到最后一条有 `imageUrl` 的条目；空数组返回 `null`；`migrateLegacyExportImageData` 对"有 imageUrl、无 images"返回 `{images:[一条], mainImageIndex:0}`，对"已有 images"原样返回。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/features/canvas/application/generatedImageHistory.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `generatedImageHistory.ts`**，并在 `canvasNodes.ts` 加 `GeneratedImageEntry` 与三个字段。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/features/canvas/application/generatedImageHistory.test.ts` → PASS

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit` → 无错

- [ ] **Step 6: Commit**

```bash
git add src/features/canvas/domain/canvasNodes.ts src/features/canvas/application/generatedImageHistory.ts src/features/canvas/application/generatedImageHistory.test.ts
git commit -m "feat(image-node): 历史数据模型与纯函数（追加/取主图/旧数据迁移）"
```

---

### Task 2: 节点默认数据 + 载入迁移

**Files:**
- Modify: `src/features/canvas/domain/nodeRegistry.ts:225-260`（`exportImageNodeDefinition.createDefaultData`）
- Modify: 载入迁移点（`src/stores/projectStore.ts` 的 `mapNodeImageReferences` 附近，或 `canvasGraphSelectors.ts:177` 附近）——实现时先定位 `exportImage` 载入路径
- Test: 对应 `*.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `migrateLegacyExportImageData`
- Produces: 载入后的 `exportImage` 节点必含 `images` 与 `mainImageIndex`

- [ ] **Step 1: 写失败测试** —— 载入一个只有 `imageUrl` 的 `exportImage` 节点，断言得到 `images.length===1` 且 `mainImageIndex===0`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run <对应测试文件>` → FAIL

- [ ] **Step 3: 实现** —— `createDefaultData` 加 `images: []`, `mainImageIndex: -1`, `prompt: ''`；在 `exportImage` 载入路径调用 `migrateLegacyExportImageData`。**同时**：`ImageNode` 里标题重命名走 `renameLocalMediaFiles` 时，要同步更新 `images[mainImageIndex]` 的 `imageUrl`/`previewImageUrl`（覆盖 Review Focus #5，不丢历史）。

- [ ] **Step 4: 运行确认通过** + `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(image-node): 默认数据含历史；旧节点载入迁移为单条历史"
```

---

### Task 3: 完成回调改为「追加历史 + 设主图」

**Files:**
- Modify: `src/features/canvas/hooks/useCanvasGenerationPolling.ts:390-416`（`prepareCompletedImageResult` 的 `updateNodeData`）
- Test: `src/features/canvas/hooks/useCanvasGenerationPolling.test.ts`（若不存在则新建）

**Interfaces:**
- Consumes: Task 1 的 `createGeneratedImageEntry` / `appendGeneratedImageEntry`
- Produces: 完成时 `images` 追加一条、`mainImageIndex` 指向它，`imageUrl`/`previewImageUrl` 镜像该条

- [ ] **Step 1: 写失败测试** —— 给一个已有 1 条历史的 `exportImage` 节点跑完成回调，断言 `images.length===2`、`mainImageIndex===1`、`imageUrl===新图`（**并显式断言 `imageUrl` 仍镜像主图** —— 保证下游 `@图N`/引用解析读 `imageUrl` 时拿到主图，覆盖 Review Focus #2）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/features/canvas/hooks/useCanvasGenerationPolling.test.ts` → FAIL

- [ ] **Step 3: 实现** —— 把 `updateNodeData` 里直接写 `imageUrl/previewImageUrl` 改为：`const entry = createGeneratedImageEntry({...}); const images = appendGeneratedImageEntry(currentData.images, entry); updateNodeData(nodeId, { images, mainImageIndex: images.length-1, imageUrl: entry.imageUrl, previewImageUrl: entry.previewImageUrl, ... })`。

- [ ] **Step 4: 运行确认通过** + 全量 `npx vitest run`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(image-node): 生成完成追加进历史并设为主图"
```

---

### Task 4: 提交核心 —— 复用节点 + 串行队列

**Files:**
- Create: `src/features/canvas/application/imageNodeGeneration.ts`
- Test: `src/features/canvas/application/imageNodeGeneration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ImageGenerationMode = 'overwrite' | 'newNode';
  export function submitImageNodeGeneration(params: {
    nodeId: string;                 // 'overwrite' 时复用；'newNode' 时为新节点 id
    mode: ImageGenerationMode;
    payload: { prompt: string; model: string; size: string; aspectRatio: string;
               referenceImages: string[]; extraParams: Record<string, unknown>; };
    count: number;                  // >=1
    deps: { addNode: (...); updateNodeData: (...); submitJob: (payload) => Promise<string>; };
  }): Promise<void>;
  ```
  行为：在目标节点上提交**第 1 个** job（写 `generationJobId`/`isGenerating`）；若 `count>1`，把剩余 `count-1` 次请求放进**模块级内存队列** `Map<nodeId, payload[]>`；`mode==='newNode'` 时先 `addNode(exportImage)` 再按上述提交。

- [ ] **Step 1: 写失败测试** —— 断言：`count=1` 只提交 1 次、目标节点 `isGenerating===true`；`count=3` 提交第 1 次、队列里剩 2；`mode='newNode'` 会调用 `addNode` 一次。

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现 `imageNodeGeneration.ts`**（含内存队列与 `takeNextQueuedGeneration(nodeId)` 供完成回调取用）。

- [ ] **Step 4: 运行确认通过** + `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(image-node): 提交复用节点，count>1 串行入内存队列"
```

---

### Task 5: 完成回调驱动队列续传

**Files:**
- Modify: `src/features/canvas/hooks/useCanvasGenerationPolling.ts`（Task 3 的完成分支之后）
- Test: 同 Task 3 测试文件

**Interfaces:**
- Consumes: Task 4 的 `takeNextQueuedGeneration(nodeId)`
- Produces: 完成一张后，若队列非空则提交下一张并保持 `isGenerating===true`；队列空则置 `isGenerating===false`。

- [ ] **Step 1: 写失败测试** —— 队列里有 1 条待续，跑完成回调后断言：又提交了 1 次、`isGenerating` 仍为 `true`；队列空时 `isGenerating===false`。

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现** —— 在 Task 3 的 `updateNodeData` 之后：`const next = takeNextQueuedGeneration(nodeId); if (next) { 提交并写 generationJobId、保持 isGenerating:true } else { isGenerating:false }`。

- [ ] **Step 4: 运行确认通过** + 全量 `npx vitest run`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(image-node): 完成回调续传队列中的下一张"
```

---

### Task 6: 节点 UI —— 图片区 + 历史面板

**Files:**
- Modify: `src/features/canvas/nodes/ImageNode.tsx`
- Test: 纯逻辑抽到 `application/`（如主图取用已有 Task 1），组件层做手动验证

**Interfaces:**
- Consumes: Task 1 的 `resolveMainImageEntry`
- Produces: 主图显示 + 其余堆叠；左上角「历史 N」按钮 → 面板（选主图 / `<` `>` / 导出为单一图片节点）

- [ ] **Step 1: 实现图片区** —— `imageSource` 改为取自 `resolveMainImageEntry(data.images, data.mainImageIndex)`；主图后叠最多 N 张缩略（视觉提示）。
- [ ] **Step 2: 实现「历史 N」按钮 + 面板** —— 列表显示 `images`，点选 → `updateNodeData(id, { mainImageIndex, imageUrl, previewImageUrl })`；`<` `>` 翻页。
- [ ] **Step 3: 空态** —— 无图时显示「请在下方描述需求」。
- [ ] **Step 4: `npx tsc --noEmit` + 手动**（见 Task 8）
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(image-node): 图片区显示主图 + 历史面板选主图"
```

---

### Task 7: 内嵌提示词面板 + 覆盖/新建

**Files:**
- Create: `src/features/canvas/ui/ImageNodePromptPanel.tsx`
- Modify: `src/features/canvas/nodes/ImageNode.tsx`（挂载面板）
- Test: 组件逻辑抽纯函数测试（模式解析、count 解析）

**Interfaces:**
- Consumes: Task 4 的 `submitImageNodeGeneration`
- Produces: 面板含 附件/提示词框/模型/尺寸/张数/画质/格式/优化提示词/常用提示词/发送 + 下拉（覆盖生成 / 新建节点生成）

- [ ] **Step 1: 实现面板骨架** —— 复用已独立的 `ModelConfigPicker`（`ui/ModelConfigPicker.tsx`）等；提示词框沿用 `data.prompt`。
- [ ] **Step 2: 发送 + 下拉** —— 发送按钮调 `submitImageNodeGeneration({nodeId:id, mode, payload, count, deps})`；下拉两项。
- [ ] **Step 3: 连点保护** —— 发送中禁用（复用 `generationSubmitLock`）。
- [ ] **Step 4: `npx tsc --noEmit` + 手动**（见 Task 8）
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(image-node): 内嵌提示词面板 + 覆盖/新建生成"
```

---

### Task 8: 工具面板改走节点、隐藏 imageNode、i18n、端到端

**Files:**
- Modify: `src/features/canvas/ui/SelectedNodeOverlay.tsx`（`handleSubmitPrompt` / `handleSubmitPromptPreset` / `handleSubmitPanorama` 的目标节点改为所选 `exportImage` 节点，走 Task 4 提交）
- Modify: `src/features/canvas/domain/nodeRegistry.ts:704`（`getMenuNodeDefinitions` 过滤掉 `imageNode`）
- Modify: `src/i18n/locales/zh.json` / `en.json`（「生成图片」「历史 N」「覆盖生成」「新建节点生成」「请在下方描述需求」）
- Test: 手动 + `npx vitest run`

- [ ] **Step 1: 工具面板提交改走节点** —— 多角度/打光/宫格/全景 的 `handleSubmit*` 目标节点从"新建"改为"追加进所选 exportImage 节点"。
- [ ] **Step 2: 隐藏 `imageNode`** —— 新建菜单不再出现；渲染保留。
- [ ] **Step 3: i18n** —— 补齐中英文案。
- [ ] **Step 4: 全量验证**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 无错、全过

- [ ] **Step 5: 手动端到端**（`npm run tauri dev`）

1. 同一提示词连点两次「覆盖生成」→ **只多图片、不多节点**；历史面板能切主图。
2. 「新建节点生成」→ 只多**一个**节点。
3. 打开旧项目（只有 `imageUrl`）→ 图仍在、历史面板正常。
4. 多角度/打光 从工具栏发起 → 结果进**当前节点**，不新建。
5. 双击发送 → 不产生重复节点。

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(image-node): 工具面板结果进节点；隐藏 AI 图片节点入口；i18n"
```

---

## 完成标准

- `npx tsc --noEmit` 无错；`npx vitest run` 全过。
- 手动 5 项全通过。
- 通过后打新里程碑 tag（`milestone-2026-10-08`），基线前移。
