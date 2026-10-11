# 视频节点：按模型能力 + 生成方式决定参数与槽位

日期：2026-10-11
状态：待实现

## 1. 问题

视频节点当前的参数与槽位有两个缺陷：

**① 参数按"供应商"声明，不是按"模型"。**
`videoModelCatalog.ts` 里，自定义供应商（含 mvaigc）的时长/分辨率/比例取自**供应商级** `extraParams.supportedDurations/supportedResolutions/supportedRatios`（`videoModelCatalog.ts:95-106`），名下所有模型共用一套。于是 Seedance 2.5（支持 30s）和 Seedance 2（只到 15s）显示**同一套时长**。
（即梦走的是每 capability 独立声明，不受此影响；问题在 mvaigc 这类"一个供应商多个模型"。）

**② 槽位数量写死在"模式"里，不看模型。**
节点取输入 schema 用的是 `videoModeInputSchema(videoMode)`（`AiVideoNode.tsx:402`）——**只看模式，完全不看所选模型**。参考模式写死 `images.max = 9`（`videoModes.ts:50`），与 Seedance 2.5 的 30 张无关。`VideoCatalogEntry.inputSchema`（每模型能力，`videoModelCatalog.ts:126` 已算好）**存在但节点没用**。

**③ UI 不按生成方式命名槽位。**
`VideoNodeModeKind` 的 4 种方式（文生/图生/首尾帧/参考，`videoModes.ts:8`）已定义，模式的 `roles`（`firstFrame`/`lastFrame`，`videoInputSchema.ts:3`）也已存在，但 UI 只按 `min/max` 渲染一条通用"图 N-M"参考行，**没有按 role 具名**（首帧/尾帧）。

## 2. 目标

视频节点的参数与输入槽，由**所选模型的能力**与**生成方式**共同决定：

- 选 Seedance 2.5 → 参考模式可放 30 图、时长可选到 30s；
- 选 Seedance 2 → 参考模式最多 15 图、时长只到 15s；
- 图生 / 首尾帧 / 参考 三种方式的**输入槽在 UI 上不同**。

## 3. 设计

### 3.1 数据：供应商配置里按模型声明能力（`extraParams.perModel`）

在供应商配置的 `extraParams` 增加可选的按模型覆盖：

```jsonc
extraParams: {
  supportedDurations: [5, 10, 15],          // 供应商级兜底（保留）
  perModel: {
    "botsmart_seedance_2_5": {
      images: 30, videos: 3, audios: 3,
      durations: [5, 10, 15, 30],
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16", "1:1"]
    },
    "botsmart_seedance_2": {
      images: 15, videos: 1, audios: 0,
      durations: [5, 10, 15],
      resolutions: ["720p"],
      aspectRatios: ["16:9", "9:16"]
    }
  }
}
```

- **字段**：`images`/`videos`/`audios`（各类型槽位上限）、`durations`、`resolutions`、`aspectRatios`。全部可选，缺哪项就回退。
- **解析顺序**：`perModel[modelId]` → 供应商级（`supportedDurations` 等）→ 内置默认（`DEFAULT_*`）。
- **兼容**：未写 `perModel` 的供应商**行为完全不变**。
- **写入方**：`mvaigcProviderAutoConfig.ts` 生成 mvaigc 供应商配置时，按 `VIDEO_MODEL_HINT` 已知模型清单逐个写入 `perModel`。

### 3.2 节点取参：模式骨架 × 模型数值，冲突以模型为准

- **模式**提供**语义骨架**：启用哪些类型、图的 `roles`（图生=`[firstFrame]`、首尾帧=`[firstFrame,lastFrame]`、参考=`[reference]`）、视频/音频是否允许。
- **模型**提供**数值上限**：图的 max、视频/音频 max、时长/分辨率/比例列表。
- **合并规则**：`max` 以**模型声明为准**；模型没声明该字段时回退到模式默认。即参考模式下 Seedance 2.5 → `图 0-30`，Seedance 2 → `图 0-15`。
- 时长/分辨率/比例下拉 = 当前**所选模型**解析出的能力列表（不再是供应商一套）。

落点：`videoModelCatalog.ts` 增加"按模型解析能力"，`AiVideoNode.tsx` 的 `currentInputSchema` 从"仅模式"改为"模式 × 所选 entry"。

### 3.3 UI：按模式渲染分组槽区

| 模式 | 槽区 |
|---|---|
| 文生 | 无图/视频/音频槽 |
| 图生 | 图 ·「首帧」× 1 |
| 首尾帧 | 图 ·「首帧」× 1 +「尾帧」× 1（两个具名槽，第 1 槽=首帧、第 2 槽=尾帧），并提供一个**调换顺序**按钮 |
| 全能参考 | 图 × 0-N ＋ 视频 × 0-N ＋ 音频 × 0-N（三组，N 来自模型能力，各自可放多个） |

- 槽位数量上限一律取合并后的 schema（模型优先），不写死。
- 非参考模式下视频/音频槽禁用（与现有 schema 一致）。

## 4. 改动文件

| 文件 | 改动 |
|---|---|
| `src/features/canvas/application/videoModelCatalog.ts` | 解析 `extraParams.perModel`，按模型产出能力（含 `images/videos/audios` 上限） |
| `src/features/canvas/application/videoModes.ts` | 模式骨架（已有）；补齐/明确与模型数值的合并入口 |
| `src/features/canvas/nodes/AiVideoNode.tsx` | `currentInputSchema` 改为"模式 × 所选模型"；按 `roles` 渲染具名槽区；首尾帧加"调换顺序"按钮 |
| `src/features/canvas/application/mvaigcProviderAutoConfig.ts` | 生成配置时写入 `perModel`（按 `VIDEO_MODEL_HINT` 清单） |
| `src/i18n/locales/zh.json` / `en.json` | 槽位名（首帧/尾帧/参考图/参考视频/参考音频）、调换按钮文案 |

## 5. 边界与不做

- 不改生成请求体字段契约（`imageMode`、`duration`、`resolution` 等仍按现值下发）；本 spec 只改"**能选什么**"与"**UI 怎么显示**"。
- 不动即梦/Agnes/内置的既有能力声明（它们本就按能力独立声明）；`perModel` 是**新增的可选层**。
- 不改工具审批、不改画布 MCP。
- 首尾帧只做"两槽 + 调换"，不做"按连线顺序自动判定"。

## 6. 验证

1. **单测**：
   - `videoModelCatalog` 解析 `perModel` 的优先级（模型 → 供应商 → 默认），未写 `perModel` 时行为不变。
   - 模式 × 模型合并：参考模式下 Seedance 2.5 → max 30、Seedance 2 → max 15。
   - 时长/分辨率列表随模型切换而变化。
2. **界面**（真机）：切模型看时长/分辨率列表变化；切模式看图生（1 首帧槽）/首尾帧（首帧+尾帧+调换）/参考（图×N+视频×N+音频×N）槽区变化。
3. **回归**：`npm test`、`npx tsc --noEmit`。
