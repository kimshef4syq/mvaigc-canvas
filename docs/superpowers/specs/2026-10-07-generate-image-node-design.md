# 「生成图片」节点设计（生成图片 + 历史 + 内嵌提示词）

日期：2026-10-07
状态：已评审（2026-10-07 通过）

## 1. 目标

把"生成图片"从**两个节点串成一条线**，改成**一个节点自洽**：

1. **重复生成收进一个节点** —— 同一个提示词多次生成，不再各自冒一个节点，而是全部进这个节点的历史。节点上能保留一个"图集"，随时挑一张设为主图。
2. **图片节点自带提示词** —— 在图片节点下方直接改提示词就能再生成，不必再手动拖一个「AI 图片」节点出来。
3. **生成后两种落法** —— 发送按钮旁给两个模式：**覆盖生成**（默认，新图进当前节点）、**新建节点生成**（另起一个节点）。

这三条合起来，把现在"AI 图片节点 → 结果图片节点"的两段式，收敛成一个节点。

## 2. 现状（已核对）

| 概念 | 类型串 | 组件 | 现在的作用 |
|---|---|---|---|
| 「AI 图片」 | `imageNode`（`CANVAS_NODE_TYPES.imageEdit`） | `ImageEditNode.tsx` | 提示词 + 生成按钮；多角度/打光/宫格/全景 工具面板挂在它身上 |
| 结果图片 | `exportImageNode`（`CANVAS_NODE_TYPES.exportImage`） | `ImageNode.tsx` | 生成完成后新建的图片节点 |

- 生成入口：`ImageEditNode.tsx:784` `handleGenerate`。组装请求后，**按张数循环**：`ImageEditNode.tsx:841-866`
  ```
  for i in 0..effectiveCount:
    addNode(CANVAS_NODE_TYPES.exportImage, ...)   // ← 每张一个新节点
    addEdge(id, newNodeId)
  ```
  这是"扇形铺开"的根源。
- 提交后：`canvasAiGateway.submitGenerateImageJob(...)`（`ImageEditNode.tsx:870`），把 `generationJobId` 写回结果节点。
- 完成回填：`prepareCompletedImageResult`（`useCanvasGenerationPolling.ts:253-416`）调 `updateNodeData(nodeId, { imageUrl, previewImageUrl, ... })`，**一个节点一张图**。
- 已有的"多张"表示：`batchId`（`ImageEditNode.tsx:696`，`count>1` 时 `<batchId>`）—— 但它是把 **N 个节点**归一组，不是收进一个节点。
- 已有的"历史数组"写法：`snapshotHistory` + `normalizeSnapshotHistory` / `appendSnapshotHistory`（`DirectorStudioShell.tsx:573-795`）—— 可复用的先例。
- 结果节点与来源的关系：靠**边**（`sourceNodeId` 是边字段，不是节点数据字段）。
- `exportImageNode` 当前 `visibleInMenu: false`（`nodeRegistry.ts:225-260`），即现在**不在新建菜单里**。

## 3. 非目标

- **不碰 Camera**（项目约定，见 `000OD/CLAUDE.md`）。
- **暂不删除** `imageNode`（「AI 图片」）：隐藏新建入口，但保留定义与渲染，保证旧项目能加载。真正的删除另开一轮。
- 不改 mvaigc 请求映射（那是另一个已修的 bug）。
- 不引入"按提示词文本自动归组"——历史属于**节点**，不跨节点合并。

## 4. 设计

### A. 节点数据模型

改造 `ExportImageNodeData`（`canvasNodes.ts` / `nodeRegistry.ts`）：

新增：

```ts
interface GeneratedImageEntry {
  id: string;              // 稳定 id，用于回填路由
  imageUrl: string | null;
  previewImageUrl: string | null;
  aspectRatio: string;
  generatedFileName?: string | null;
  sourcePrompt?: string | null;
  createdAt: number;
}

// ExportImageNodeData 新增：
images?: GeneratedImageEntry[];   // 历史，按时间追加
mainImageIndex?: number;          // 当前主图下标
prompt?: string;                  // 内嵌提示词面板的值
```

保留 `imageUrl` / `previewImageUrl`，**始终镜像"主图"**。这样连线取图、引用解析、导出等下游逻辑**不用动**。

### B. 生成流程改造（核心，改动最重）

`handleGenerate` 从 `ImageEditNode` 迁到新节点的内嵌面板。提交时：

- **覆盖生成**（默认）：目标 = 当前节点。追加 `count` 条新历史条目，节点置 `isGenerating`，完成后新的成为主图。
- **新建节点生成**：只新建**一个** `exportImageNode`，`count` 张图全进它的历史。

**不再按张 addNode。** 每个生成任务记录 `{ nodeId, entryId, jobId }`。

完成回填：`prepareCompletedImageResult` 需要能**按 `entryId` 定位**，写成"把 URL 填进 `images[entryId]`"。

**主图规则（明确）**：一次生成完成后，把本次的**第一张**设为新的主图（`mainImageIndex` 指向它）—— 这就是"覆盖生成"的字面含义：新图替换当前显示。用户随后在历史面板手动设的主图，在**下一次生成前**保持不变。

> **风险点（最不确定）**：现在是"一个 job ↔ 一个节点"，要变成"一个节点 ↔ 多个 job/条目"。轮询回填的签名与路由是这次改动里最容易出错的缝，实现计划里要单独拆一步、配单测。

### C. 节点 UI

- **上半：图片区**
  - 主图显示；其余**堆叠/重叠在主图后面**
  - 左上角「历史 N」按钮 → 点开「全部图片 N 张」面板
    - 选一张设为主图
    - `<` `>` 翻页（`1/N`）
    - 「导出为单一图片节点」
  - 空态：显示「请在下方描述需求」
- **下半：内嵌提示词面板**
  - **复用** `ImageEditNode` 现有控件：附件 `+`、提示词框、模型 / 尺寸 / 张数 / 画质 / 格式、优化提示词、常用提示词
  - 发送按钮 + 下拉：**覆盖生成**（默认）/ **新建节点生成**

### D. 工具面板迁移

多角度 / 打光 / 宫格 / 全景 的挂载点从 `imageNode` 改到 `exportImageNode`。

> **待确认**：`SelectedNodeOverlay.tsx` 里这些面板的挂载判据（现在按 `generationSourceType: 'imageEdit'` 等分支渲染），迁移时需先读准判据再改。实现计划里第一步就做这个核对。

### E.「AI 图片」节点退休

- 从新建菜单隐藏（`getMenuNodeDefinitions`，`nodeRegistry.ts:704`）
- 保留 `imageNodeDefinition` 与 `ImageEditNode` 渲染，旧项目照常加载

### F. 兼容与持久化

- `images` 加入 `projectMedia.ts` 的 `MEDIA_LIST_KEYS`，导出项目时复制历史图
- **旧数据迁移**：节点载入时若 `images` 缺失、`imageUrl` 存在 → 迁移成 `images: [{ id, imageUrl, previewImageUrl, aspectRatio, createdAt }]`，`mainImageIndex: 0`

### G. 验证

**单测**
- 历史追加（覆盖生成：N 张 → N 条，主图更新）
- 新建节点生成（只新建一个节点，N 张进它）
- 设主图（`mainImageIndex` 切换）
- 旧数据迁移（单图 → 一条历史）
- 按 `entryId` 回填（并发多张不串）

**手动**
- 同一提示词跑两次 → 确认**只多图片、不多节点**；历史面板能切主图
- 「新建节点生成」→ 确认只多**一个**节点
- 旧项目打开 → 图仍在、历史面板正常

## 5. 影响面

| 文件 | 改动 |
|---|---|
| `nodes/ImageNode.tsx` | 重写：图片区 + 历史 + 内嵌面板 |
| `nodes/ImageEditNode.tsx` | 提交逻辑迁出；保留兼容渲染 |
| `domain/canvasNodes.ts` / `nodeRegistry.ts` | `ExportImageNodeData` 加字段；`imageNode` 菜单隐藏 |
| `hooks/useCanvasGenerationPolling.ts` | 回填改为按 `entryId` 路由 |
| `ui/SelectedNodeOverlay.tsx` | 工具面板挂载点迁移 |
| `features/portability/application/projectMedia.ts` | `images` 入 `MEDIA_LIST_KEYS` |
| i18n（`zh` / `en`） | 「生成图片」「历史 N」「覆盖生成」「新建节点生成」等 |

## 6. 未决

1. 「历史 N」面板里是否需要删除单条历史？（本轮可不做）
2. `imageNode`（AI 图片）彻底删除是否排进下一轮？
