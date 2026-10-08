# 「生成视频」一体节点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把视频生成从「AI 视频节点 + 旁边新建视频结果节点」的两段式，改成一个自洽的「生成视频」一体节点（视频显示 + 参考缩略图排 + 提示词 + 历史 + 截帧工具条），与已完成的「生成图片」节点同构。

**Architecture:** 照搬「生成图片」节点已验证的结构：节点数据加 `videos[]` 历史数组（`videoUrl`/`thumbnailUrl` 始终镜像主视频），生成走「覆盖本节点 / 新建节点」两种落法，轮询回填按 entry 路由；UI 拆成「显示框（在 `AiVideoNode`）+ 下方面板（新 `VideoNodePromptPanel`）」。截帧复用已有的 `captureVideoThumbnail`，加时间点参数。

**Tech Stack:** React + TypeScript + Zustand；Tauri 2；Vitest（单测）；Tailwind + CSS 变量。

**Spec:** `docs/superpowers/specs/2026-10-08-generate-video-node-design.md`

## Global Constraints

- **不碰 Camera**（项目约定，见 `000OD/CLAUDE.md`）。
- **最小实现、外科手术式改动**：不顺手重构相邻代码，不删没让删的既有代码；沿用既有风格。
- **读代码先走 codebase-memory 索引**，字面量（i18n 文案等）才用 grep。
- 节点类型串：`aiVideo`（`CANVAS_NODE_TYPES.aiVideo`，面板所在节点）、`video`（`CANVAS_NODE_TYPES.video`，旧的结果节点，**保留**）。
- **旧项目兼容**：已存在的独立 `video` 节点照常加载显示，只是不再新建。
- 面板文案 key 前缀 `node.aiVideo.*`；新 key 中英都要加。
- 提交信息结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

以下输入/情形 spec 未明说、但真人使用时会遇到，各自归属到下面的任务里加测试或处理：

1. **空历史节点渲染**：`videos` 为空且无 `videoUrl` 时，显示框必须是空态占位（不是崩溃/黑框）——Task 6。
2. **旧数据迁移**：只有 `videoUrl` 没有 `videos` 的老节点，载入后历史面板要能正常显示 1 条——Task 1 + Task 6。
3. **并发回填不串**：同一节点连发两次生成，两条结果各自落对 entry，不能互相覆盖——Task 3（`buildVideoResultPatch` 顺序追加测试）。
4. **跨域视频截帧失败**：远端视频 `drawImage` 污染 canvas 时 `toDataURL` 抛错，必须被吞掉并给出可理解的结果（返回 null → 提示），不能抛到 UI——Task 4 + Task 7。
5. **尾帧时间点**：`duration` 未知/为 0 时，尾帧时间点退化为 0，不能卡在 `seeked` 上——Task 4。

---

### Task 1: 视频历史数据模型与纯函数

**Files:**
- Create: `src/features/canvas/application/generatedVideoHistory.ts`
- Create: `src/features/canvas/application/generatedVideoHistory.test.ts`
- Modify: `src/features/canvas/domain/canvasNodes.ts`（`AiVideoNodeData` 加字段；新增 `GeneratedVideoEntry`）

**Interfaces:**
- Consumes: 无（本任务自足）。
- Produces:
  - `interface GeneratedVideoEntry { id: string; videoUrl: string | null; localVideoUrl?: string | null; thumbnailUrl: string | null; aspectRatio: string; durationSeconds?: number | null; generatedFileName?: string | null; sourcePrompt?: string | null; createdAt: number }`
  - `createGeneratedVideoEntry(input: Omit<GeneratedVideoEntry,'id'|'createdAt'> & { now?: number }): GeneratedVideoEntry`
  - `appendGeneratedVideoEntry(current: GeneratedVideoEntry[] | undefined, entry: GeneratedVideoEntry): GeneratedVideoEntry[]`
  - `normalizeVideoHistory(data: Record<string, unknown>): { videos: GeneratedVideoEntry[]; mainVideoIndex: number } | null`（无 `videos` 且有 `videoUrl` → 迁移成 1 条；已有 `videos` → 原样返回）
  - `buildCompletedVideoPatch(input: { currentVideos: GeneratedVideoEntry[] | undefined; videoUrl: string; thumbnailUrl: string | null; aspectRatio: string; durationSeconds?: number | null; generatedFileName?: string | null; sourcePrompt?: string | null; now?: number }): { videos: GeneratedVideoEntry[]; mainVideoIndex: number; videoUrl: string; thumbnailUrl: string | null }`
  - `resolveMainVideoEntry(videos: GeneratedVideoEntry[] | undefined, mainVideoIndex: number | undefined): GeneratedVideoEntry | null`
  - `AiVideoNodeData` 新增 `videos?: GeneratedVideoEntry[]`、`mainVideoIndex?: number`

- [ ] **Step 1: 写失败测试**

`generatedVideoHistory.test.ts`（断言用 spec 的确切值）：

```ts
import { describe, expect, it } from 'vitest';
import {
  appendGeneratedVideoEntry,
  buildCompletedVideoPatch,
  createGeneratedVideoEntry,
  normalizeVideoHistory,
  resolveMainVideoEntry,
} from './generatedVideoHistory';

describe('generatedVideoHistory', () => {
  it('createGeneratedVideoEntry assigns id and createdAt', () => {
    const e = createGeneratedVideoEntry({ videoUrl: '/a.mp4', thumbnailUrl: '/a.jpg', aspectRatio: '16:9', now: 1000 });
    expect(e.id).toBeTruthy();
    expect(e.createdAt).toBe(1000);
    expect(e.videoUrl).toBe('/a.mp4');
  });

  it('appendGeneratedVideoEntry appends without mutating', () => {
    const a = createGeneratedVideoEntry({ videoUrl: '/a.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 1 });
    const b = createGeneratedVideoEntry({ videoUrl: '/b.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 2 });
    const out = appendGeneratedVideoEntry([a], b);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });

  it('buildCompletedVideoPatch appends and points main at the new entry', () => {
    const patch = buildCompletedVideoPatch({
      currentVideos: undefined, videoUrl: '/new.mp4', thumbnailUrl: '/new.jpg',
      aspectRatio: '16:9', now: 5,
    });
    expect(patch.videos).toHaveLength(1);
    expect(patch.mainVideoIndex).toBe(0);
    expect(patch.videoUrl).toBe('/new.mp4');
    expect(patch.thumbnailUrl).toBe('/new.jpg');
  });

  it('normalizeVideoHistory migrates a legacy single-videoUrl node', () => {
    const out = normalizeVideoHistory({ videoUrl: '/old.mp4', thumbnailUrl: '/old.jpg', aspectRatio: '9:16' });
    expect(out?.videos).toHaveLength(1);
    expect(out?.mainVideoIndex).toBe(0);
    expect(out?.videos[0].videoUrl).toBe('/old.mp4');
  });

  it('normalizeVideoHistory returns null when there is nothing to migrate', () => {
    expect(normalizeVideoHistory({})).toBeNull();
    expect(normalizeVideoHistory({ videoUrl: null })).toBeNull();
  });

  it('resolveMainVideoEntry follows the index and falls back safely', () => {
    const a = createGeneratedVideoEntry({ videoUrl: '/a.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 1 });
    const b = createGeneratedVideoEntry({ videoUrl: '/b.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 2 });
    expect(resolveMainVideoEntry([a, b], 1)).toBe(b);
    expect(resolveMainVideoEntry([a, b], 99)).toBe(a);
    expect(resolveMainVideoEntry(undefined, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/features/canvas/application/generatedVideoHistory.test.ts`
Expected: FAIL —— `Failed to resolve import "./generatedVideoHistory"`

- [ ] **Step 3: 实现**

`generatedVideoHistory.ts`：结构逐条照搬 `generatedImageHistory.ts`（同目录），把 `imageUrl`→`videoUrl`、`previewImageUrl`→`thumbnailUrl`、`images`→`videos`、`mainImageIndex`→`mainVideoIndex`；`createGeneratedVideoEntry` 的 id 生成方式与 `createGeneratedImageEntry` 保持一致（照抄它的实现）。`resolveMainVideoEntry`：越界回退到 `videos[0]`。

`canvasNodes.ts`：在 `GeneratedImageEntry` 附近新增 `GeneratedVideoEntry`；`AiVideoNodeData`（约 `:259`）加 `videos?: GeneratedVideoEntry[];` 与 `mainVideoIndex?: number;`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/features/canvas/application/generatedVideoHistory.test.ts`
Expected: PASS（6 passed）

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/application/generatedVideoHistory.ts src/features/canvas/application/generatedVideoHistory.test.ts src/features/canvas/domain/canvasNodes.ts
git commit -m "feat(video-node): 视频历史数据模型与纯函数"
```

---

### Task 2: 生成落法（覆盖 / 新建）

**Files:**
- Create: `src/features/canvas/application/videoNodeGeneration.ts`
- Create: `src/features/canvas/application/videoNodeGeneration.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `type VideoGenerationMode = 'overwrite' | 'newNode'`
  - `interface VideoGenerationPayload { prompt: string; model: string; size: string; aspectRatio: string; seconds?: number; referenceImages: string[]; referenceVideos?: string[]; referenceAudios?: string[]; extraParams: Record<string, unknown> }`
  - `interface VideoGenerationDeps { addNode: (type: typeof CANVAS_NODE_TYPES.video, position: { x: number; y: number }, data?: Record<string, unknown>) => string; updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void; submitJob: (payload: VideoGenerationPayload) => Promise<string> }`
  - `submitVideoNodeGeneration(params: { nodeId: string; mode: VideoGenerationMode; payload: VideoGenerationPayload; deps: VideoGenerationDeps; position?: { x: number; y: number }; resultNodeData?: Record<string, unknown> }): Promise<{ targetNodeId: string }>`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import { submitVideoNodeGeneration, type VideoGenerationPayload } from './videoNodeGeneration';

const payload: VideoGenerationPayload = {
  prompt: 'p', model: 'm', size: '1280x720', aspectRatio: '16:9',
  referenceImages: [], extraParams: {},
};

describe('submitVideoNodeGeneration', () => {
  it('overwrite marks the given node generating and submits into it', async () => {
    const submitJob = vi.fn().mockResolvedValue('job-1');
    const updateNodeData = vi.fn();
    const addNode = vi.fn();
    const { targetNodeId } = await submitVideoNodeGeneration({
      nodeId: 'n1', mode: 'overwrite', payload, deps: { addNode, updateNodeData, submitJob },
    });
    expect(targetNodeId).toBe('n1');
    expect(addNode).not.toHaveBeenCalled();
    expect(updateNodeData).toHaveBeenCalledWith('n1', expect.objectContaining({ isGenerating: true }));
    expect(updateNodeData).toHaveBeenCalledWith('n1', { generationJobId: 'job-1' });
  });

  it('newNode creates exactly one video node and submits into it', async () => {
    const submitJob = vi.fn().mockResolvedValue('job-2');
    const addNode = vi.fn().mockReturnValue('created');
    const updateNodeData = vi.fn();
    const { targetNodeId } = await submitVideoNodeGeneration({
      nodeId: 'src', mode: 'newNode', payload, position: { x: 10, y: 20 },
      deps: { addNode, updateNodeData, submitJob },
    });
    expect(addNode).toHaveBeenCalledTimes(1);
    expect(targetNodeId).toBe('created');
    expect(updateNodeData).toHaveBeenCalledWith('created', expect.objectContaining({ isGenerating: true }));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/features/canvas/application/videoNodeGeneration.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

`videoNodeGeneration.ts`：照 `imageNodeGeneration.ts` 的 `submitImageNodeGeneration`（`:91`）写，去掉 `count`/队列部分（视频一次一条）。`overwrite` → `targetNodeId = nodeId`；`newNode` → `deps.addNode(CANVAS_NODE_TYPES.video, position ?? {x:0,y:0}, { isGenerating: true, ...(resultNodeData ?? {}) })`。然后 `updateNodeData(targetNodeId, { isGenerating:true, generationStartedAt:Date.now(), generationError:null, generationErrorDetails:null })`，`const jobId = await deps.submitJob(payload)`，`updateNodeData(targetNodeId, { generationJobId: jobId })`，返回 `{ targetNodeId }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/features/canvas/application/videoNodeGeneration.test.ts`
Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/application/videoNodeGeneration.ts src/features/canvas/application/videoNodeGeneration.test.ts
git commit -m "feat(video-node): 生成落法（覆盖/新建）"
```

---

### Task 3: 回填路由（按 entry 写入历史）

**Files:**
- Modify: `src/features/canvas/application/generatedVideoHistory.ts`（加 `buildVideoResultPatch`）
- Modify: `src/features/canvas/application/generatedVideoHistory.test.ts`（Task 1 已创建）
- Modify: `src/features/canvas/hooks/useCanvasGenerationPolling.ts:446`（`prepareCompletedVideoResult`）

**Interfaces:**
- Consumes: Task 1 的 `buildCompletedVideoPatch`、`GeneratedVideoEntry`。
- Produces: `prepareCompletedVideoResult` 在目标节点是 `aiVideo` 时，把结果写进 `videos[]` 并把新条目设为主视频；目标节点是 `video` 时维持现状（单视频字段）。

- [ ] **Step 1: 写失败测试**

新增一个纯函数 `buildVideoResultPatch(nodeType, currentData, completed)`（放在 `generatedVideoHistory.ts` 里，便于测试）并在测试里断言：

```ts
it('buildVideoResultPatch writes history for aiVideo nodes', () => {
  const patch = buildVideoResultPatch('aiVideo', { videos: undefined }, {
    videoUrl: '/a.mp4', thumbnailUrl: '/a.jpg', aspectRatio: '16:9', now: 1,
  });
  expect(patch.videos).toHaveLength(1);
  expect(patch.mainVideoIndex).toBe(0);
});

it('buildVideoResultPatch keeps single fields for legacy video nodes', () => {
  const patch = buildVideoResultPatch('video', {}, {
    videoUrl: '/a.mp4', thumbnailUrl: '/a.jpg', aspectRatio: '16:9', now: 1,
  });
  expect(patch.videos).toBeUndefined();
  expect(patch.videoUrl).toBe('/a.mp4');
});

it('two sequential completions land as two entries in order', () => {
  const first = buildVideoResultPatch('aiVideo', {}, { videoUrl: '/1.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 1 });
  const second = buildVideoResultPatch('aiVideo', { videos: first.videos }, { videoUrl: '/2.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 2 });
  expect(second.videos?.map((v) => v.videoUrl)).toEqual(['/1.mp4', '/2.mp4']);
  expect(second.mainVideoIndex).toBe(1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/features/canvas/application/generatedVideoHistory.test.ts`
Expected: FAIL —— `buildVideoResultPatch is not a function`

- [ ] **Step 3: 实现**

在 `generatedVideoHistory.ts` 加 `buildVideoResultPatch(nodeType: CanvasNodeType, currentData: Record<string, unknown>, completed: {...}): Record<string, unknown>`：`nodeType === CANVAS_NODE_TYPES.aiVideo` → 返回 `buildCompletedVideoPatch(...)` 的字段（含 `videos`/`mainVideoIndex`/`videoUrl`/`thumbnailUrl`）；否则 → `{ videoUrl, thumbnailUrl }`。

在 `useCanvasGenerationPolling.ts` 的 `prepareCompletedVideoResult`（`:446`，末尾 `:548` 附近有 `videoUrl:` 的 patch）里，把那段固定 patch 换成 `...buildVideoResultPatch(node.type, currentData, {...})`（`node` 从 `useCanvasStore.getState().nodes.find(n => n.id === nodeId)` 取）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/features/canvas/application/generatedVideoHistory.test.ts`
Expected: PASS（含新增 3 条）

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/application/generatedVideoHistory.ts src/features/canvas/application/generatedVideoHistory.test.ts src/features/canvas/hooks/useCanvasGenerationPolling.ts
git commit -m "feat(video-node): 回填按 entry 写入历史"
```

---

### Task 4: 截帧（时间点参数）

**Files:**
- Modify: `src/features/canvas/application/videoUpload.ts:109`（`captureVideoThumbnail`）
- Modify: `src/features/canvas/application/videoUpload.test.ts`（若无则 Create）

**Interfaces:**
- Consumes: 无。
- Produces: `captureVideoThumbnail(source: string, timeSec?: number): Promise<string | null>`（省略 `timeSec` → 现状第 0 帧；给定 → seek 到该秒数后截）。
- Produces: `resolveFrameCaptureTime(mode: 'first' | 'current' | 'last', durationSec: number, currentTimeSec: number): number`（纯函数，便于测试）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { resolveFrameCaptureTime } from './videoUpload';

describe('resolveFrameCaptureTime', () => {
  it('first is 0', () => {
    expect(resolveFrameCaptureTime('first', 10, 4)).toBe(0);
  });
  it('current is the playhead', () => {
    expect(resolveFrameCaptureTime('current', 10, 4)).toBe(4);
  });
  it('last is just before the end', () => {
    expect(resolveFrameCaptureTime('last', 10, 4)).toBeCloseTo(9.95, 2);
  });
  it('last degrades to 0 when duration is unknown', () => {
    expect(resolveFrameCaptureTime('last', 0, 4)).toBe(0);
    expect(resolveFrameCaptureTime('last', Number.NaN, 4)).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/features/canvas/application/videoUpload.test.ts`
Expected: FAIL —— `resolveFrameCaptureTime is not a function`

- [ ] **Step 3: 实现**

`resolveFrameCaptureTime`：`first`→`0`；`current`→`currentTimeSec`；`last`→ `durationSec>0 && isFinite(durationSec) ? Math.max(0, durationSec - 0.05) : 0`。

`captureVideoThumbnail(source, timeSec?)`：在 `video.onloadeddata` 之后，若 `timeSec` 给定且 > 0，`video.currentTime = timeSec` 并等 `onseeked`（加超时，复用 `VIDEO_THUMBNAIL_TIMEOUT_MS`）再 `drawImage`；否则维持现状（第 0 帧）。`toDataURL` 抛错必须被现有 `try/catch` 吞掉并 `return null`（**Review Focus #4**）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/features/canvas/application/videoUpload.test.ts`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/application/videoUpload.ts src/features/canvas/application/videoUpload.test.ts
git commit -m "feat(video-node): 截帧支持时间点（首/当前/尾）"
```

---

### Task 5: 下方面板（缩略图排 + @ 弹窗 + 放大按钮）

**Files:**
- Create: `src/features/canvas/ui/VideoNodePromptPanel.tsx`
- Create: `src/features/canvas/ui/VideoNodePromptPanel.test.tsx`
- Modify: `src/i18n/locales/zh.json`、`src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `AiVideoNode` 现有的 `incomingImages`/`incomingReferences` 解析（`canvasGraphSelectors`）、`insertReferenceToken`、`CanvasNodeImage`、`prepareNodeImageFromFile`；图片节点面板 `ImageNodePromptPanel.tsx` 为模板。
- Produces: `VideoNodePromptPanel({ nodeId, data }: { nodeId: string; data: AiVideoNodeData })` —— 渲染：① 参考缩略图排（图/视频/音频各按类型，末尾 `+`）；② 提示词框 + 右上角半透明放大按钮（`Maximize2`）；③ 现有 AI 视频控件（模型/时长/分辨率/宽高比/优化/常用提示词，**从 AiVideoNode 原样搬入**）；④ 生成按钮 + 覆盖/新建下拉。

- [ ] **Step 1: 写静态渲染测试**

项目组件测试用 `renderToStaticMarkup`（见 `src/features/canvas/agent/ui/CanvasAgentComposer.test.tsx`）。测试：面板在无参考资料时也渲染不抛错；缩略图排容器存在。

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
// 断言：renderToStaticMarkup(<VideoNodePromptPanel .../>) 不抛错且包含提示词 placeholder 文案
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/features/canvas/ui/VideoNodePromptPanel.test.tsx`
Expected: FAIL —— 文件不存在

- [ ] **Step 3: 实现**

从 `AiVideoNode.tsx` **原样搬出**：提示词框（`:1270` textarea）、参考选择器（`:1289`）、功能选择器（`:1333`）、底部控件行（`:1421` 起，含模型/参数/生成按钮）。**照抄** `ImageNodePromptPanel.tsx` 的：缩略图排（`referenceItems.map(... CanvasNodeImage ...)` + `+` 按钮 + 隐藏 file input）、`@` keydown 弹窗、放大按钮（`Maximize2` → `UiModal`）。i18n 复用 `node.imageNode.addReference`；新加 `node.aiVideo.expandPrompt`、`node.aiVideo.modeOverwrite`/`modeNewNode`（若已有同类则复用）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/features/canvas/ui/VideoNodePromptPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/ui/VideoNodePromptPanel.tsx src/features/canvas/ui/VideoNodePromptPanel.test.tsx src/i18n/locales/zh.json src/i18n/locales/en.json
git commit -m "feat(video-node): 下方面板（缩略图排 + @ 弹窗 + 放大按钮）"
```

---

### Task 6: 显示框 + 历史 + 工具条

**Files:**
- Modify: `src/features/canvas/nodes/AiVideoNode.tsx`（显示框、历史、工具条、挂载 Task 5 的面板）
- Create: `src/features/canvas/ui/VideoNodeToolbar.tsx`（工具条，便于独立测试）
- Modify: `src/i18n/locales/zh.json`、`src/i18n/locales/en.json`

**Interfaces:**
- Consumes: Task 1 的 `resolveMainVideoEntry`、`GeneratedVideoEntry`；`VideoNode.tsx:303` 的 `<video poster>` 渲染为模板；图片节点历史面板（`ImageNode.tsx:414` 起）为模板。**下载/删除复用现有 `NodeActionToolbar`**（`handleDownloadVideoSaveAs` `:1095`、`deleteNode` `:1076`）——`aiVideo` 节点已由它渲染悬停工具条，**不要重复实现**；本任务只加「截帧▾」入口。
- Produces: `VideoNodeToolbar({ videoUrl, onPreview, onCaptureFrame })` —— 悬停显示的按钮组：预览 / 截帧▾（首帧·当前帧·尾帧）。下载 / 删除由 `NodeActionToolbar` 提供，不在此重复。

- [ ] **Step 1: 写测试**

`VideoNodeToolbar.test.tsx`：静态渲染断言「预览」「截帧」按钮存在（`renderToStaticMarkup`）。另在 `generatedVideoHistory.test.ts` 加：空历史 + 无 `videoUrl` → `resolveMainVideoEntry` 返回 null（**Review Focus #1**）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/features/canvas/ui/VideoNodeToolbar.test.tsx`
Expected: FAIL —— 文件不存在

- [ ] **Step 3: 实现**

- `AiVideoNode` 显示框：主视频 = `resolveMainVideoEntry(videos, mainVideoIndex)` ?? `{ videoUrl: data.videoUrl, thumbnailUrl: data.thumbnailUrl }`；`<video poster={thumbnailUrl}>`；无视频 → 空态占位（**Review Focus #1/#2**）。
- 左上角「历史 N」（`videos.length > 1` 时显示）→ 点开历史面板（照搬 `ImageNode` 的 `historyOpen` 结构）：选一条设主视频（`mainVideoIndex`）、`<`/`>` 翻页。
- `VideoNodeToolbar`：**预览**（打开视频预览）+ **截帧▾**（三选项 → Task 7）。下载/删除沿用 `NodeActionToolbar` 现有按钮，本任务不改它。
- 挂载 `<VideoNodePromptPanel nodeId={id} data={data} />` 替换现有内联面板。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/features/canvas/ui/VideoNodeToolbar.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/nodes/AiVideoNode.tsx src/features/canvas/ui/VideoNodeToolbar.tsx src/features/canvas/ui/VideoNodeToolbar.test.tsx src/i18n/locales/zh.json src/i18n/locales/en.json
git commit -m "feat(video-node): 显示框 + 历史面板 + 截帧工具条"
```

---

### Task 7: 截帧 → 新图片节点

**Files:**
- Modify: `src/features/canvas/nodes/AiVideoNode.tsx`（把工具条的 `onCaptureFrame` 接到实现）
- Modify: `src/features/canvas/application/videoUpload.ts`（复用 Task 4）

**Interfaces:**
- Consumes: Task 4 的 `captureVideoThumbnail(source, timeSec?)`、`resolveFrameCaptureTime(mode, durationSec, currentTimeSec)`。
- Produces: `AiVideoNode` 内 `handleCaptureFrame(mode: 'first' | 'current' | 'last')` —— 用 `<video>` 的 `duration`/`currentTime` 算时间点 → `captureVideoThumbnail(videoUrl, t)` → 非 null 则新建**上传节点**（`prepareNodeImage` 已在截帧内落本地，直接 `addNode(CANVAS_NODE_TYPES.upload, pos, { imageUrl, previewImageUrl, aspectRatio })`）并放在本节点旁。

- [ ] **Step 1: 写测试**

`resolveFrameCaptureTime` 已由 Task 4 覆盖。本任务加一个纯函数 `buildCapturedFrameNodeData(dataUrl: string, aspectRatio: string): Record<string, unknown>` 的测试（断言字段）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/features/canvas/application/videoUpload.test.ts`
Expected: FAIL —— `buildCapturedFrameNodeData is not a function`

- [ ] **Step 3: 实现**

在 `videoUpload.ts` 加 `buildCapturedFrameNodeData`；在 `AiVideoNode` 接上 `onCaptureFrame`。截帧失败（返回 null）→ `showErrorDialog(t('node.aiVideo.captureFrameFailed'))`（**Review Focus #4**）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/features/canvas/application/videoUpload.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/application/videoUpload.ts src/features/canvas/application/videoUpload.test.ts src/features/canvas/nodes/AiVideoNode.tsx
git commit -m "feat(video-node): 截帧生成图片节点"
```

---

### Task 8: 迁移接线 + 菜单改名 + 导出媒体

**Files:**
- Modify: `src/features/canvas/domain/nodeDisplay.ts:11`（`aiVideo` → 「生成视频」）
- Modify: `src/features/canvas/domain/nodeRegistry.ts`（`aiVideoNodeDefinition` 的 `menuLabelKey`；`createDefaultData` 加 `videos: []`、`mainVideoIndex: -1`）
- Modify: `src/features/canvas/CanvasSideToolbar.tsx:48`（`aiVideo` 项 labelKey）
- Modify: `src/features/portability/application/projectMedia.ts:19`（`MEDIA_LIST_KEYS` 加 `'videos'`）
- Modify: `src/i18n/locales/zh.json`、`en.json`（新增 `node.menu.generateVideo` = 「生成视频」）
- Modify: `src/features/canvas/nodes/AiVideoNode.tsx`（载入时调 `normalizeVideoHistory` 迁移旧节点）

**Interfaces:**
- Consumes: Task 1 的 `normalizeVideoHistory`。
- Produces: 新节点标题/菜单显示「生成视频」；旧节点（已存 `displayName`）标题不变；导出项目时复制 `videos` 里的媒体。

- [ ] **Step 1: 写测试**

`projectMedia.test.ts` 加：含 `videos` 的节点导出时媒体被收集。`nodeRegistry` 相关：`getNodeDefinition(CANVAS_NODE_TYPES.aiVideo).createDefaultData()` 含 `videos: []`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/features/portability/application/projectMedia.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

按上面文件逐条改。`AiVideoNode` 的迁移：在节点渲染/载入处，若 `data.videos === undefined` 且 `normalizeVideoHistory(data)` 非 null → `updateNodeData(id, normalizeVideoHistory(data))`（一次性，照 `ImageNode` 的迁移写法）。

- [ ] **Step 4: 跑测试 + 全量**

Run: `npm test`
Expected: PASS（全量）

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(video-node): 迁移接线、菜单改名「生成视频」、导出媒体"
```

---

### Task 9: 端到端核对 + 收尾

**Files:** 无（验证任务）

- [ ] **Step 1: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出（exit 0）

- [ ] **Step 2: 全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 3: 手动验证（`npm run tauri dev`）**

逐条走 spec 第 6 节「手动」清单：生成落本节点、历史可切、新建模式只多一个节点、缩略图排三类、`@` 引用、截帧三种、旧项目旧节点仍在。

- [ ] **Step 4: 报告结果**

如实报告：哪几条过、哪几条没过、哪几条没测。
