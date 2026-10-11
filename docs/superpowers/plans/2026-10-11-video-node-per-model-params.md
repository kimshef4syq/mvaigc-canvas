# 视频节点按模型能力+生成方式决定参数与槽位 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让视频节点的时长/分辨率/比例与输入槽位由「所选模型的能力」×「生成方式」共同决定——Seedance 2.5 参考模式可放 30 图、时长到 30s；Seedance 2 只能 15 图/15s；图生/首尾帧/参考三种方式的输入槽在 UI 上不同。

**Architecture:** 在供应商配置 `extraParams` 增加按模型覆盖 `perModel`（时长/分辨率/比例 + 图/视频/音频上限）；`videoModelCatalog` 解析出每模型能力并挂在 `VideoCatalogEntry` 上；节点把「模式骨架（`videoModeInputSchema`）」与「所选 entry 的数值」合并成 `currentInputSchema`，并按 `roles` 渲染具名槽区。

**Tech Stack:** React + TypeScript + Zustand；测试 vitest。

**Spec:** `docs/superpowers/specs/2026-10-11-video-node-per-model-params-design.md`

## Global Constraints

- 只改 `mvaigc-canvas/`；`open-storyboard-canvas/` 只读。
- Camera 相关一律不碰。
- 最小实现、外科手术式改动；每行改动可追溯到本 spec；不删没让删的既有代码。
- **不改生成请求体契约**：`imageMode`、`duration`、`resolution`、`ratio`/`aspectRatio` 等下发的字段与取值规则不变；本计划只改"能选什么"与"UI 怎么显示"。
- **兼容**：未写 `perModel` 的供应商行为**完全不变**；`videoInputSchemasByModel`（已存在的每模型输入 schema 覆盖）机制保留不动。
- 冲突规则：槽位/时长等**数值以模型声明为准**，模型未声明才回退供应商级、再回退内置默认。
- 首尾帧：第 1 槽=首帧、第 2 槽=尾帧，外加一个「调换顺序」按钮；**不做**"按连线顺序自动判定"。
- 提交流署名：`Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 关键既有符号（勿重定义）：`VideoCatalogEntry`（`videoModelCatalog.ts:23`）、`resolveVideoModelConfig`（`:225`）、`VideoInputSchema`（`videoInputSchema.ts:22`）、`normalizeVideoInputSchema`、`videoModeInputSchema`（`videoModes.ts:27`）、`VIDEO_NODE_MODES`、`resolveVideoInputSchemaFromExtraParams`（`videoInputSchema.ts:318`）、`MAX_REFERENCE_IMAGES=30`。

## Review Focus

- **`perModel` 存在但某字段缺失** → 该字段回退供应商级，不得整块丢弃或报错。
- **`perModel` 引用了不存在的 modelId** → 不影响其它模型；未列出的模型走供应商级。
- **`perModel` 数值非法**（如 `images: 0` 或负数、`durations: []`）→ 回退默认，不得让 UI 出现"0 图"或空下拉。
- **所选模型无能力声明（内置/即梦/Agnes）** → 行为与改动前一致。
- **切换模型后已选时长/分辨率不在新模型能力内** → 自动回落到新模型的第一个合法值（沿用 `resolveVideoModelConfig` 既有回落）。
- **首尾帧只有一个槽有图** → UI 不报错；调换按钮在 0/1/2 个图时都不崩。
- **时长下拉与已存值不一致** → 切换模型后，若原时长不在新模型 `supportedDurations` 内，`resolveVideoModelConfig` 既有回落会取新模型第一个合法值；下拉的 `value` 必须始终是列表内的值（不得出现空白选中）。

---

### Task 1: `perModel` 解析 —— 每模型能力进 `VideoCatalogEntry`

**Files:**
- Modify: `src/features/canvas/application/videoModelCatalog.ts`
- Test: `src/features/canvas/application/videoModelCatalog.test.ts`（不存在则新建）

**Interfaces:**
- Consumes: 既有 `uniqueStrings`、`DEFAULT_DURATIONS`/`DEFAULT_RESOLUTIONS`/`DEFAULT_ASPECT_RATIOS`、`provider.extraParams`。
- Produces:
  - `VideoCatalogEntry` 增字段：`supportedImageCount?: number`（图上限；缺省=未声明）、`supportedVideoCount?: number`、`supportedAudioCount?: number`。
  - 导出纯函数 `resolvePerModelCapabilities(provider: CustomProviderConfig, modelId: string): { durations?: string[]; resolutions?: string[]; aspectRatios?: string[]; images?: number; videos?: number; audios?: number }`。

- [ ] **Step 1: 写失败测试**

新建/追加 `videoModelCatalog.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildVideoModelCatalog, resolvePerModelCapabilities } from './videoModelCatalog';
import type { CustomProviderConfig } from '@/stores/customProvidersStore';

function videoProvider(extraParams: Record<string, unknown>, models: string[]): CustomProviderConfig {
  return {
    id: 'p1', label: 'P', mediaType: 'video', baseUrl: 'http://x', endpointPath: '/v1/videos',
    modelListEndpointPath: '/v1/models', httpMethod: 'POST', apiKey: 'k', apiStyle: 'generic-json',
    responseFormat: 'generic', models, supportsWebSearch: false, supportedResolutions: ['720p', '1080p'],
    extraParams,
  } as CustomProviderConfig;
}

describe('resolvePerModelCapabilities', () => {
  it('returns per-model overrides when present', () => {
    const p = videoProvider({
      supportedDurations: [5, 10],
      perModel: { 'sd2.5': { durations: [5, 10, 15, 30], images: 30, videos: 3, audios: 3 } },
    }, ['sd2.5', 'sd2']);
    expect(resolvePerModelCapabilities(p, 'sd2.5').durations).toEqual([5, 10, 15, 30]);
    expect(resolvePerModelCapabilities(p, 'sd2.5').images).toBe(30);
    expect(resolvePerModelCapabilities(p, 'sd2')).toEqual({}); // 未声明 → 空，调用方回退
  });
});

describe('buildVideoModelCatalog per-model', () => {
  it('applies per-model durations/resolutions and falls back otherwise', () => {
    const p = videoProvider({
      supportedRatios: ['16:9'],
      supportedDurations: [5, 10],
      perModel: {
        'sd2.5': { durations: [5, 10, 15, 30], resolutions: ['1080p'], aspectRatios: ['16:9', '9:16'], images: 30 },
        'sd2': { durations: [5, 10, 15] },
      },
    }, ['sd2.5', 'sd2']);
    const catalog = buildVideoModelCatalog([p]);
    const e25 = catalog.find((e) => e.modelId === 'sd2.5')!;
    const e2 = catalog.find((e) => e.modelId === 'sd2')!;
    expect(e25.supportedDurations).toEqual(['5', '10', '15', '30']);
    expect(e25.supportedResolutions).toEqual(['1080p']);
    expect(e25.supportedAspectRatios).toEqual(['16:9', '9:16']);
    expect(e25.supportedImageCount).toBe(30);
    expect(e2.supportedDurations).toEqual(['5', '10', '15']);
    expect(e2.supportedResolutions).toEqual(['720p', '1080p']); // 回退供应商级
    expect(e2.supportedImageCount).toBeUndefined();
  });

  it('ignores perModel entirely when absent (behavior unchanged)', () => {
    const p = videoProvider({ supportedDurations: [5, 10], supportedRatios: ['16:9'] }, ['m1']);
    const e = buildVideoModelCatalog([p])[0];
    expect(e.supportedDurations).toEqual(['5', '10']);
    expect(e.supportedImageCount).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- videoModelCatalog`
Expected: FAIL（`resolvePerModelCapabilities` 未定义 / 字段不存在）。

- [ ] **Step 3: 实现**

- `VideoCatalogEntry` 加三个可选数值字段（`supportedImageCount`/`supportedVideoCount`/`supportedAudioCount`）。
- `resolvePerModelCapabilities(provider, modelId)`：读 `provider.extraParams.perModel[modelId]`；用 `uniqueStrings(..., [])` 归一化数组（空→`undefined`），用 `Number.isFinite && >0` 校验数值（非法→`undefined`）；返回只含已声明字段的对象。
- `buildVideoModelCatalog` 内，对每个 `modelId`：先算 `const perModel = resolvePerModelCapabilities(provider, modelId)`；`supportedDurations = perModel.durations ?? uniqueStrings(provider.extraParams?.supportedDurations, DEFAULT_DURATIONS)`；`supportedResolutions`/`supportedAspectRatios` 同理（注意 resolutions 现有来源是 `provider.supportedResolutions ?? extraParams.supportedResolutions`，保留该回退链，`perModel.resolutions` 优先）；把 `perModel.images/videos/audios` 映射到三个新字段（有才写）。
- 即梦/Agnes 分支不加这三个字段（它们本就按 capability 独立声明，行为不变）。

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- videoModelCatalog`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/application/videoModelCatalog.ts src/features/canvas/application/videoModelCatalog.test.ts
git commit -m "feat(video-node): 供应商配置按模型声明能力（perModel）"
```

---

### Task 2: 模式 × 模型 合并成 `currentInputSchema`

**Files:**
- Modify: `src/features/canvas/application/videoModes.ts`（新增合并函数）
- Test: `src/features/canvas/application/videoModes.test.ts`（追加）

**Interfaces:**
- Consumes: `VideoInputSchema`（`videoInputSchema.ts:22`）、`videoModeInputSchema`（`videoModes.ts:27`）、Task 1 的 `VideoCatalogEntry.supportedImageCount/VideoCount/AudioCount`。
- Produces:
  - `export function mergeModeWithModelCapability(mode: VideoInputSchema, capability: { images?: number; videos?: number; audios?: number }): VideoInputSchema`

- [ ] **Step 1: 写失败测试**

追加到 `videoModes.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { videoModeInputSchema, mergeModeWithModelCapability } from './videoModes';

describe('mergeModeWithModelCapability', () => {
  it('model count overrides mode default when declared', () => {
    const reference = videoModeInputSchema('reference'); // 默认 images.max=9
    const merged = mergeModeWithModelCapability(reference, { images: 30, videos: 3, audios: 3 });
    expect(merged.images.max).toBe(30);
    expect(merged.video.max).toBe(3);
    expect(merged.audio.max).toBe(3);
  });
  it('falls back to mode default when capability omits a kind', () => {
    const reference = videoModeInputSchema('reference');
    const merged = mergeModeWithModelCapability(reference, { images: 30 });
    expect(merged.images.max).toBe(30);
    expect(merged.video.max).toBe(reference.video.max); // 未声明 → 模式默认
  });
  it('does not enable a kind the mode disabled', () => {
    const text = videoModeInputSchema('text'); // 全禁用
    const merged = mergeModeWithModelCapability(text, { images: 30 });
    expect(merged.images.enabled).toBe(false);
    expect(merged.images.max).toBe(0);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- videoModes`
Expected: FAIL（`mergeModeWithModelCapability` 未定义）。

- [ ] **Step 3: 实现**

`mergeModeWithModelCapability(mode, capability)`：对 `images`/`video`/`audio` 三类，**仅当 `mode[kind].enabled` 且 `capability` 对应字段是正整数**时，把 `max` 覆盖为该值；否则保留 `mode[kind]`。`min`、`roles`、`enabled`、`field`、`requireImageHost` 全部沿用 mode。返回浅拷贝的新 schema（不 mutate 入参）。

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- videoModes`
Expected: PASS（3 个新用例 + 既有用例）。

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/application/videoModes.ts src/features/canvas/application/videoModes.test.ts
git commit -m "feat(video-node): 模式骨架与模型能力合并为 currentInputSchema"
```

---

### Task 3: 节点用「模式 × 所选模型」取 schema

**Files:**
- Modify: `src/features/canvas/nodes/AiVideoNode.tsx`（`currentInputSchema` 计算处，约 400-403 行；及 735 行的 `latestInputSchema`）
- Test: 无独立单测（节点组件）；由 Task 2 的纯函数测试覆盖逻辑，本任务只接线。

**Interfaces:**
- Consumes: Task 2 的 `mergeModeWithModelCapability`、既有 `selectedEntry`（`AiVideoNode.tsx:394`）、`videoModeInputSchema`。
- Produces: 节点内 `currentInputSchema` 变为「模式 × 所选 entry 能力」的结果；行为对无能力声明的模型不变。

- [ ] **Step 1: 改 `currentInputSchema` 计算**

把（约 400-403 行）：
```ts
const currentInputSchema = useMemo(() => videoModeInputSchema(videoMode), [videoMode]);
```
改为：
```ts
const currentInputSchema = useMemo(
  () => mergeModeWithModelCapability(videoModeInputSchema(videoMode), {
    images: selectedEntry?.supportedImageCount,
    videos: selectedEntry?.supportedVideoCount,
    audios: selectedEntry?.supportedAudioCount,
  }),
  [videoMode, selectedEntry],
);
```
（`selectedEntry` 已在上方 `useMemo` 定义，可直接依赖。）

- [ ] **Step 2: 改 735 行的 `latestInputSchema`**

同样把 `videoModeInputSchema(data.videoMode ?? 'reference')` 换成对当前 `selectedEntry` 的 `mergeModeWithModelCapability(...)`，保证"提交前校验"与"UI 显示"用同一份 schema。

- [ ] **Step 3: 类型检查 + 回归**

Run: `npx tsc --noEmit && npm test -- video`
Expected: 类型通过；video 相关测试全绿（无回归）。

- [ ] **Step 4: 提交**

```bash
git add src/features/canvas/nodes/AiVideoNode.tsx
git commit -m "feat(video-node): 节点按所选模型能力决定输入槽上限"
```

---

### Task 4: 按 `roles` 渲染具名槽区（图生/首尾帧/参考）

**Files:**
- Modify: `src/features/canvas/nodes/AiVideoNode.tsx`（参考选择区渲染，约 1397 行 `schemaReferencePickerItems` 渲染处）
- Modify: `src/i18n/locales/zh.json`、`src/i18n/locales/en.json`（`node.aiVideo` 下加槽位名）
- Test: `src/features/canvas/nodes/AiVideoNode.test.tsx`（存在则追加；不存在则新建一条渲染断言）

**Interfaces:**
- Consumes: `currentInputSchema.images.roles`、`currentInputSchema.images.max`、`currentInputSchema.video/audio`。
- Produces: 输入区按模式渲染分组槽区（文生=无；图生=「首帧」×1；首尾帧=「首帧」「尾帧」+ 调换按钮；参考=图/视频/音频三组）。节点数据里首尾帧两槽的**顺序即 [首帧, 尾帧]**；调换按钮交换这两个引用。

- [ ] **Step 1: 加 i18n 槽位名**

`zh.json` 的 `node.aiVideo` 下加：
```json
"slotFirstFrame": "首帧",
"slotLastFrame": "尾帧",
"slotReferenceImage": "参考图",
"slotReferenceVideo": "参考视频",
"slotReferenceAudio": "参考音频",
"swapFirstLastFrame": "调换顺序"
```
`en.json` 对应：
```json
"slotFirstFrame": "First frame",
"slotLastFrame": "Last frame",
"slotReferenceImage": "Reference image",
"slotReferenceVideo": "Reference video",
"slotReferenceAudio": "Reference audio",
"swapFirstLastFrame": "Swap order"
```

- [ ] **Step 2: 渲染分组槽区**

在参考选择区：按 `currentInputSchema.images.roles` 判定显示哪种：
- 含 `firstFrame` 且含 `lastFrame` → 渲染两个具名槽「首帧」「尾帧」（各自显示对应图或空槽），其后一个「调换顺序」按钮（`data-testid="video-swap-first-last"`），点击交换这两个图引用的顺序；
- 只含 `firstFrame` → 一个「首帧」槽；
- 含 `reference` → 「参考图」组（容量 `images.max`）；
- `video.enabled` → 「参考视频」组（容量 `video.max`）；`audio.enabled` → 「参考音频」组（容量 `audio.max`）。

容量一律取 `currentInputSchema.*.max`（已在 Task 3 按模型算好）。槽位标签用 Step 1 的 i18n 键。

- [ ] **Step 3: 加渲染断言**

在节点测试里断言：`data-testid="video-mode-frames"` 选中后，出现「首帧」「尾帧」两个标签与 `video-swap-first-last` 按钮；`video-mode-reference` 选中后出现「参考图」组。

- [ ] **Step 4: 运行**

Run: `npx tsc --noEmit && npm test -- AiVideoNode`
Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/nodes/AiVideoNode.tsx src/i18n/locales/zh.json src/i18n/locales/en.json src/features/canvas/nodes/AiVideoNode.test.tsx
git commit -m "feat(video-node): 输入槽按生成方式具名渲染（首帧/尾帧/参考组）"
```

---

### Task 5: mvaigc 自动配置写入 `perModel`

**Files:**
- Modify: `src/features/canvas/application/mvaigcProviderAutoConfig.ts`（`video` provider 的 `extraParams`，约 91-107 行）
- Test: `src/features/canvas/application/mvaigcProviderAutoConfig.test.ts`（追加）

**Interfaces:**
- Consumes: `VIDEO_MODEL_HINT`（同文件已定义）。
- Produces: 生成的 `video` 供应商 `extraParams.perModel` 覆盖 `VIDEO_MODEL_HINT` 里的已知模型；未列出的模型走供应商级。

- [ ] **Step 1: 写失败测试**

追加到 `mvaigcProviderAutoConfig.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildMvaigcProviders } from './mvaigcProviderAutoConfig';

describe('mvaigc video perModel', () => {
  const video = () => buildMvaigcProviders(8787, 'u:p').find((p) => p.mediaType === 'video')!;
  const perModel = () => (video().extraParams as any).perModel;

  it('Seedance 2.5 = 4..30s, SD2.0 系列 = 4..15s', () => {
    expect(perModel().botsmart_seedance_2_5.durations).toEqual(
      Array.from({ length: 27 }, (_, i) => String(4 + i)),
    );
    expect(perModel().botsmart_seedance_2_5.durations).toContain('30');
    expect(perModel().botsmart_seedance_2.durations).toContain('15');
    expect(perModel().botsmart_seedance_2.durations).not.toContain('16');
  });
  it('MiniMax H3 = 4..15s, 其余 = 4..10s', () => {
    expect(perModel().minimax_h3.durations[0]).toBe('4');
    expect(perModel().minimax_h3.durations.at(-1)).toBe('15');
    expect(perModel().wan_2_7.durations.at(-1)).toBe('10');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- mvaigcProviderAutoConfig`
Expected: FAIL（`perModel` 为 undefined）。

- [ ] **Step 3: 实现**

在 `video.extraParams` 增加 `perModel`，覆盖 `VIDEO_MODEL_HINT` 各模型的能力。**时长用整数秒区间**（每模型一个升序数组）：

```ts
// 顶部定义（或用局部 helper）：把区间展开成升序整数秒字符串数组
const secondsRange = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
// 4..30、4..15、4..10 三档
const DUR_4_30 = secondsRange(4, 30);
const DUR_4_15 = secondsRange(4, 15);
const DUR_4_10 = secondsRange(4, 10);

// video.extraParams 内：
perModel: {
  botsmart_seedance_2_5:    { durations: DUR_4_30, resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1'], images: 30, videos: 3, audios: 3 },
  botsmart_seedance_2:      { durations: DUR_4_15, resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1'], images: 15 },
  botsmart_seedance_2_hd:   { durations: DUR_4_15, resolutions: ['1080p'], aspectRatios: ['16:9', '9:16'], images: 15 },
  botsmart_seedance_2_fast: { durations: DUR_4_15, resolutions: ['720p'], aspectRatios: ['16:9', '9:16'], images: 15 },
  minimax_h3:               { durations: DUR_4_15 },
  minimax_h3_768p:          { durations: DUR_4_15 },
  // 其余 VIDEO_MODEL_HINT 模型（veo_3_1 / vidu_q3 / happyhorse_1_720p / happyhorse_1_1080p / kling_v3_omni / wan_2_7）：
  //   durations: DUR_4_10
}
```
（保留既有 `supportedDurations: [5,10]`、`supportedResolutions`、`supportedRatios` 作为供应商级兜底。**其余模型**按 spec「其余 = 4..10」逐个补 `durations: DUR_4_10`。）

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -- mvaigcProviderAutoConfig`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/application/mvaigcProviderAutoConfig.ts src/features/canvas/application/mvaigcProviderAutoConfig.test.ts
git commit -m "feat(video-node): mvaigc 自动配置按模型声明 perModel 能力"
```

---

### Task 6: 时长控件改为下拉列表

**Files:**
- Modify: `src/features/canvas/nodes/AiVideoNode.tsx`（时长控件，约 1808-1828 行；Agnes 滑杆分支 1788-1807 不动）
- Test: `src/features/canvas/nodes/AiVideoNode.test.tsx`（追加）

**Interfaces:**
- Consumes: `selectedEntry.supportedDurations`（字符串数组，已由 Task 1/5 按模型产出）、`resolvedModelConfig.duration`、`handleConfigChange`。
- Produces: 非 Agnes 模型的时长由"一排按钮"改为 `<select>`，选项 = `selectedEntry.supportedDurations`。

- [ ] **Step 1: 写失败测试**

追加到节点测试：
```tsx
// 选中参考模式 + 一个声明了多时长的模型后，时长应为 select，且含 30s 选项
expect(screen.getByTestId('video-duration-select')).toBeTruthy();
expect(screen.getByRole('option', { name: '30s' })).toBeTruthy();
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -- AiVideoNode`
Expected: FAIL（无 `video-duration-select`）。

- [ ] **Step 3: 实现**

把非 Agnes 分支（`AiVideoNode.tsx:1808-1828`）的一排按钮换成：
```tsx
<select
  data-testid="video-duration-select"
  className="nodrag w-full rounded-md border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-button-bg)] px-2 py-1 text-[11px] text-[var(--canvas-node-button-text)]"
  value={resolvedModelConfig.duration}
  onChange={(event) => handleConfigChange({ duration: event.target.value })}
  onMouseDown={(event) => event.stopPropagation()}
>
  {selectedEntry.supportedDurations.map((duration) => (
    <option key={duration} value={duration}>
      {duration === 'workflow' ? t('node.aiVideo.workflow') : `${duration}s`}
    </option>
  ))}
</select>
```
Agnes 滑杆分支（`isAgnesVideoModel`）保持不变。

- [ ] **Step 4: 运行**

Run: `npx tsc --noEmit && npm test -- AiVideoNode`
Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/nodes/AiVideoNode.tsx src/features/canvas/nodes/AiVideoNode.test.tsx
git commit -m "feat(video-node): 时长改为下拉列表"
```

---

### Task 7: 全量验证 + DEVLOG

**Files:**
- Modify: `DEVLOG.md`

- [ ] **Step 1: 全量测试**

Run: `npm test && npx tsc --noEmit`
Expected: 全绿、类型通过。

- [ ] **Step 2: 界面自查（真机）**

`npm run tauri dev`：视频节点里①切换模型看时长/分辨率列表是否随模型变（Seedance 2.5 出现 30s）；②切模式看槽区：图生=首帧槽、首尾帧=首帧+尾帧+调换、参考=图/视频/音频三组；③调换按钮能交换首尾帧。

- [ ] **Step 3: 更新 DEVLOG**

在「已完成」区追加一节记录本特性（含 spec/plan 路径、验证命令）；「待办」补"真机界面自查"若有未覆盖项。

- [ ] **Step 4: 提交**

```bash
git add DEVLOG.md
git commit -m "docs(devlog): 记录视频节点按模型+生成方式决定参数与槽位"
```

---

## Self-Review

- **Spec 覆盖**：3.1 数据 `perModel`（含区间时长表）= T1/T5；3.2 模式×模型合并 = T2/T3；3.3 UI 分组槽区 + 首尾帧调换 = T4；**时长下拉列表 = T6**；验证 = T7。✅
- **Step 粒度**：每步一个可检动作；测试给断言、实现给签名与规则。✅
- **类型一致**：`supportedImageCount/VideoCount/AudioCount`（T1 定义）→ T2 `mergeModeWithModelCapability` 入参 `{images,videos,audios}` → T3 用 `selectedEntry?.supportedImageCount` 映射一致；`mergeModeWithModelCapability` 名称在 T2 定义、T3 调用一致。✅
- **Review Focus 测试落点**：字段缺失回退 → T1 第二用例；`perModel` 无 → T1 第三用例；非法数值 → T1 `resolvePerModelCapabilities` 校验（`>0`）；无能力声明不变 → T1 第三用例 + T2 第三用例（模式禁用不被启用）；切模型回落 → 沿用既有 `resolveVideoModelConfig`（T3 不改其逻辑，回归覆盖）；首尾帧 0/1/2 图 → T4 Step 3 断言。✅
- **比例**：计划约为 spec 的 1.5 倍，6 个任务、以签名/规则/断言为主，无整段实现体。✅
