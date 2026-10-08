# 「生成视频」节点设计（一体节点：视频显示 + 参考 + 提示词 + 历史 + 截帧）

日期：2026-10-08
状态：待评审

## 1. 目标

把视频生成从**「AI 视频节点（提示词）」→ 旁边新建「视频结果节点」**的两段式，
改成**一个自洽的「生成视频」节点**——和已完成的「生成图片」节点同构：

1. **一体显示**：节点上半是**视频显示框**（生成结果直接显示在这里），下半是提示词 + 参数。
2. **参考资料排**：已连入的**图片 / 视频 / 音频**在面板上方排成缩略图，按类型各显各的缩略图；打 `@` 弹选择框引用。
3. **两种落法**：生成按钮旁给 **覆盖当前节点**（结果写回本节点）/ **新建节点生成**。
4. **历史**：本节点保留每次生成的视频，可回挑主视频。
5. **视频显示框工具条**：预览 / 复制节点 / 下载 / 删除 / 截帧（首帧·当前帧·尾帧）。
6. **提示词框右上角放大按钮**（放大编辑）。

## 2. 现状（已核对）

| 概念 | 类型串 | 组件 | 现在的作用 |
|---|---|---|---|
| 「AI 视频」 | `aiVideo`（`CANVAS_NODE_TYPES.aiVideo`） | `AiVideoNode.tsx`（1846 行） | 提示词 + 模型/时长/分辨率/宽高比 + 生成按钮；结果**新建节点** |
| 视频结果 | `video`（`CANVAS_NODE_TYPES.video`） | `VideoNode.tsx` | 生成完成后新建的独立节点；`<video>` + `poster={thumbnailUrl}` |

- **生成入口**：`AiVideoNode.tsx:855` `handleGenerate`。组装后 **`addNode(CANVAS_NODE_TYPES.video, ...)` + `addEdge(id, resultNodeId)`**（`:892-910`）——每生成一次就多一个节点，**没有覆盖当前节点这条路**。
- **回填**：`useCanvasGenerationPolling.ts:446` `prepareCompletedVideoResult` 把 `videoUrl` / `thumbnailUrl` 写回那个新建的 video 节点（**一节点一张视频**）。
- **缩略图**：`useCanvasGenerationPolling.ts:573` 调 `captureVideoThumbnail(finalLocalVideoUrl)` 生成首帧缩略图（`:575` 写 `thumbnailUrl`）。
- **截帧基础已存在**：`application/videoUpload.ts:109` `captureVideoThumbnail(source)` —— 用 `document.createElement('video')` + `canvas.drawImage` + `persistImageLocally`，截的是**第 0 帧**。扩展一个"时间点"参数即可截任意帧。
- **参考资料**：`AiVideoNode` 已解析 `incomingImages` / `incomingReferences`（`:371-393`），提交时带 `referenceImages`（`:847`）。**缩略图只在打 `@` 时以临时弹窗出现**（`:1289`），**没有常驻缩略图排**。
- **提示词放大按钮**：`AiVideoNode` **没有**。
- **视频显示**：`VideoNode.tsx:303` `<video poster={data.thumbnailUrl ...} className="... bg-black ...">`——无缩略图时**就是黑场**。
- **图片节点已做完的对照物**：`ImageNodePromptPanel.tsx`（缩略图排 + `@` 弹窗 + `+` 加图）、`ImageNode.tsx`（一体显示 + 历史 + 历史面板）。

## 3. 非目标（第二期）

- **参数弹层改造**（分辨率 480/720/1080、宽高比六选、时长 4–30s、生成音频开关）**本期不改**——现有控件原样保留搬入。
- **生成音频开关**：现有 `audio` 字段沿用。
- 不改 mvaigc 请求映射（`mapping.rs`）本期不动。
- **不碰 Camera**（项目约定）。
- 第二期再定：Seedance 2.5 = 30s / 其他 seedance2 = 15s 的时长上限（属参数体系）。

## 4. 设计

### A. 节点一体架构

改造 `AiVideoNode`：**上半保留现有内容区（弹框）作为视频显示框**，把现有的"下方参数行 + 提示词框"重组为**下方面板**：

```
AiVideoNode（改造后）
┌──────────────────────────────────┐
│ 视频显示框（上半，原 content 区） │
│  ├ 生成中：进度 / 占位           │
│  ├ 完成：<video> + poster(首帧)  │
│  ├ 左上角「历史 N」              │
│  └ 悬浮工具条（悬停显示）：      │
│     预览 / 复制节点 / 下载 / 删除 │
│     / 截帧▾（首帧·当前帧·尾帧）  │
└──────────────────────────────────┘
│ [图1][图2][视频1][音频1]  +      │ → 参考缩略图排
│ ┌──────────────────────────┐    │
│ │ 提示词              ⤢    │    │ → 放大按钮
│ └──────────────────────────┘    │
│ [现有 AI 视频控件行]             │ → 原样搬
│                 [生成 ▾]         │ → 覆盖当前 / 新建节点
```

> **待定（实现计划里定）**：是否把下方面板拆成独立文件 `ui/VideoNodePromptPanel.tsx`（对齐 `ImageNodePromptPanel`），以免 `AiVideoNode.tsx` 继续膨胀。建议拆。

### B. 数据模型

`AiVideoNodeData`（`canvasNodes.ts:259`）新增：

```ts
interface GeneratedVideoEntry {
  id: string;                  // 稳定 id，用于回填路由
  videoUrl: string | null;
  localVideoUrl?: string | null;
  thumbnailUrl: string | null;
  aspectRatio: string;
  durationSeconds?: number | null;
  generatedFileName?: string | null;
  sourcePrompt?: string | null;
  createdAt: number;
}

// AiVideoNodeData 新增：
videos?: GeneratedVideoEntry[];   // 历史，按时间追加
mainVideoIndex?: number;          // 当前主视频下标
```

保留 `videoUrl` / `thumbnailUrl`，**始终镜像"主视频"**——下游（连线取视频、导出）不用动。

### C. 生成流程（核心，改动最重）

`handleGenerate` 从"必然 addNode"改为：

- **覆盖当前**（默认）：目标 = **本节点**（`AiVideoNode`）。追加 1 条历史条目，节点置 `isGenerating`，完成后新的成为主视频。**不再新建 video 节点。**
- **新建节点生成**：新建**一个** `video` 节点，结果进它（保持现状语义）。

每个生成任务记录 `{ nodeId, entryId, jobId }`。

**回填**：`prepareCompletedVideoResult` 需要能**按 entryId 定位**——写进 `videos[entryId]`（覆盖模式）或目标 video 节点（新建模式）。

> **风险点（最不确定）**：现在是"一个 job ↔ 一个节点"（video 节点的 `generationJobId`），要变成"AiVideoNode 一节点 ↔ 多 job/条目"。轮询回填的签名与路由是本次最易出错的缝，实现计划里单独拆一步、配单测。

### D. 视频显示框工具条

悬停显示，按钮：

| 按钮 | 行为 |
|---|---|
| **预览** | 放大预览该视频（复用现成 viewer 或新开视频预览） |
| **复制节点** | **复制整个节点**（提示词 + 参数 + 历史视频一起复制一份，粘到画布） |
| **下载** | 下载该视频到本地文件 |
| **删除** | **删除整个节点**（连同其历史） |
| **截帧 ▾** | 首帧 / 当前帧 / 尾帧 |

### E. 参考资料排 + `@` 选择框

- 复用 `AiVideoNode` 已有的 `incomingImages` / `incomingReferences`（图片 / 视频 / 音频）。
- 面板上方按类型渲染缩略图（图片→图片缩略图，视频→视频缩略图，音频→音频图标/波形）。
- 打 `@` → 弹选择框（现有 `schemaReferencePickerItems` 逻辑，`:422-430`），插入 token。
- **`+` 按钮**：沿用图片节点语义（选图 → 新建上传节点 + 连线），或按本期范围决定（见未决）。

### F. 提示词框 + 放大按钮

- 提示词框右上角加半透明「放大」按钮（对齐 `ImageNodePromptPanel` 的 `Maximize2`），点开弹大框编辑。

### G. 截帧

扩展 `application/videoUpload.ts` 的 `captureVideoThumbnail(source)` → `captureVideoThumbnail(source, timeSec?)`：

- `timeSec` 省略 → 现状（第 0 帧）
- `timeSec` 给定 → `video.currentTime = timeSec`，等 `onseeked` 后 `drawImage`
- 首帧 = `0`；尾帧 = `video.duration - ε`；当前帧 = 播放头 `video.currentTime`

截出的帧 → `persistImageLocally` → 新建**上传/图片节点**（与"截图引用"一致）。

> **风险**：跨域视频 `drawImage` 会污染 canvas（`toDataURL` 抛错）。本地生成的视频（`persistImageLocally` 落到本地）应无此问题；远端视频需 fallback（提示不可截）。

### H. 菜单文案

`aiVideo` 的 `menuLabelKey` 从 `node.menu.aiVideoGeneration`（"AI 视频"）→ 新增「**生成视频**」文案。
同步左侧工具栏（`CanvasSideToolbar` 的 `aiVideo` 项，`labelKey: 'node.menu.aiVideoGeneration'`）。
`DEFAULT_NODE_DISPLAY_NAME[aiVideo]`（"AI 视频"）→ 是否改，见未决。

### I. 兼容与持久化

- `videos` 加入 `projectMedia.ts` 的 `MEDIA_LIST_KEYS`（现为 `['snapshotHistory','imagePool']`），导出项目时复制历史视频。
- **旧数据迁移**：节点载入时若 `videos` 缺失、`videoUrl` 存在 → 迁移成 `videos: [{ id, videoUrl, thumbnailUrl, ... }]`，`mainVideoIndex: 0`。
- **旧项目里的独立 `video` 节点**：**保留**（照常加载显示），只是不再新建。

## 5. 影响面

| 文件 | 改动 |
|---|---|
| `nodes/AiVideoNode.tsx` | **大改**：显示框 + 历史 + 工具条 + 缩略图排 + 放大按钮；生成写回本节点 |
| `ui/VideoNodePromptPanel.tsx`（新，待定） | 从 AiVideoNode 拆出的下方面板 |
| `domain/canvasNodes.ts` | `AiVideoNodeData` 加 `videos` / `mainVideoIndex`；`GeneratedVideoEntry` |
| `domain/nodeRegistry.ts` | `aiVideo` 菜单文案；`createDefaultData` 加字段 |
| `hooks/useCanvasGenerationPolling.ts` | 视频回填改为按 `entryId` 路由 |
| `application/videoUpload.ts` | `captureVideoThumbnail` 加 `timeSec` |
| `application/videoNodeGeneration.ts`（新，待定） | 覆盖/新建两种落法（对齐 `imageNodeGeneration.ts`） |
| `features/portability/application/projectMedia.ts` | `videos` 入 `MEDIA_LIST_KEYS` |
| `CanvasSideToolbar.tsx` | 菜单文案 |
| i18n（`zh`/`en`） | 「生成视频」「历史 N」「截取首帧/当前帧/尾帧」「复制节点」「下载」等 |

## 6. 验证

**单测**
- 覆盖生成：追加 1 条历史，主视频更新
- 新建节点生成：只新建一个节点，结果进它
- 设主视频（`mainVideoIndex` 切换）
- 旧数据迁移（单 `videoUrl` → 一条历史）
- 按 `entryId` 回填（并发不串）
- `captureVideoThumbnail(source, timeSec)` 时间点参数

**手动**
- 生成一次 → 结果**落在本节点**、不新建节点；显示框出现视频
- 再生成 → **只多视频（历史），不多节点**；历史面板可切主视频
- 「新建节点生成」→ 只多**一个**节点
- 连入图/视频/音频 → 缩略图排各显各的；打 `@` 能引用
- 截帧三种 → 各生成一张图片，内容正确
- 旧项目打开 → 旧 `video` 节点仍在

## 7. 已定决策

| # | 项 | 决定 |
|---|---|---|
| 1 | 「删除」按钮 | 删除**整个节点**（连同历史） |
| 2 | 「复制节点」按钮 | 复制**整个节点**（提示词 + 参数 + 历史） |
| 3 | 节点标题 / 菜单文案 | 改为「**生成视频**」（`DEFAULT_NODE_DISPLAY_NAME[aiVideo]` + 菜单 `menuLabelKey` + 左侧工具栏）。**仅影响新建节点**；旧节点已存自己的 `displayName`，标题不变 |
| 4 | 下方面板 | **拆成独立文件** `ui/VideoNodePromptPanel.tsx`（对齐 `ImageNodePromptPanel`，避免 `AiVideoNode.tsx` 继续膨胀） |
| 5 | `+` 按钮 | **本期包含**，语义同图片节点（选图 → 新建上传节点 + 连线） |

## 8. 遗留（第二期）

- 参数弹层：分辨率 480/720/1080、宽高比六选、时长 4–30s（含 Seedance 2.5 = 30s / 其他 seedance2 = 15s 的上限规则）、生成音频开关。
- 视频首帧不黑场（`poster` 缺失时的显示优化）。
