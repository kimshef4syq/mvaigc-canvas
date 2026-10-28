# 画布 ↔ Hypit 物料桥接

日期：2026-10-23
状态：待实现

## 1. 问题（已核实）

目标是：**外部智能体（终端里的 Claude Code）执行 `hypit` 技能，物料取自画布，结果回到画布。**

现状核实结论：这条链两头都缺。

| 环节 | 核实到的事实 |
|---|---|
| 终端 claude 连画布 | 已通。`~/.claude.json` 的 `projects["…/000OD"].mcpServers.storyboard_canvas` 存在，指向画布 debug 二进制 |
| 画布面板的 agent | 跑的是**内置 agent**（`CanvasAgentDock.tsx:694` → `canvasAgentController.runCanvasAgentTurn`），用设置里选的模型 provider。不是 Claude CLI |
| 画布面板的 claude runtime 通路 | **已退役、无 UI 入口**。`CanvasAgentRuntimePicker.tsx` 只被自己的测试引用；`useExternalAgentRuntime` 无任何调用方；`agentPanelStore.ts:26` 自注 `retired in-panel external runtime hook`。`claude.rs:44-71`（`--tools ""` + `--disable-slash-commands` + `--setting-sources ""`）**无 UI 能触发**。以上均为**上游基线状态**，非二次开发改动。本轮不碰这条通路 |
| 读画布元数据 | `canvas_command{canvas.query}` 可用 |
| 读画布图片 | `asset_read` 走 `externalAgentImageRead.ts`，取 `asset.previewUrl \|\| asset.url` → **优先给预览缩略图**，再压到 ≤1280px / JPEG 0.75 / ≤180KB base64。**不是原图** |
| 读画布视频/音频 | **完全不存在**。`asset_read` 只认 `asset.kind === 'image'` |
| 回写画布 | **完全不存在**。`canvasCommandGraph.ts:177` 的 `createNodeData` 从不写 `imageUrl`/`videoUrl`；31 个 canvas 命令里没有 import/attach |
| `media_postprocess` | 桩实现（probe 返回硬编码 1920×1080 mp4），不是真 ffmpeg |
| hypit 工程 | 不存在。`hypit paths` 在两个目录都报 `No Hypit project was found`（要求 `package.json` 带 `hypit.project: true`） |
| local-scope MCP 继承 | **实测：不继承到子目录**。`000OD` 有 `storyboard_canvas`，`000OD/mvaigc-canvas` 没有 |

**关键推论**：Claude Code 的 MCP local scope 按目录精确生效，父目录不传给子目录。因此 claude 必须在"配置了 MCP 的那个目录"里打开，才能同时拿到 hypit CLI 和画布 MCP。视频工程放应用数据目录，就必须给那个目录也写 MCP 配置。

## 2. 目标

让**用户自己在终端开的** claude 能完整走通：**读画布物料（完整原图 / 视频 / 音频）→ 跑 hypit 出片 → 结果回写画布成节点。**

这里"终端里的 claude"特指用户在 `000OD` 或视频工程目录手动 `claude` 起的那个（完整能力：Bash、技能、文件系统）。画布面板里的内置 agent 与已退役的 claude runtime 通路都不是本次对象（见 §1、§3）。

三个决定（用户已确认）：

1. **A 方案**：给 `000OD` 和视频工程目录**都**写 MCP local scope，各开各的 claude。
2. **三类物料都做**：图片 + 视频 + 音频。
3. **图片必须是完整原图**，不是低分辨率预览。为此读取一律**返回文件路径，不返回字节**。

## 3. 非目标

- **不复活画布面板的 claude runtime 通路。** 它在上游就已退役（无 UI 入口，见 §1）。要让它能跑 hypit，需要恢复 `CanvasAgentRuntimePicker` 的渲染、复活 `useExternalAgentRuntime`、再放开 `--tools ""` 那套限制 —— 那是独立的一个项目，不属本次范围。`claude.rs` 的代码保持原样。
- 不在画布内做导出/编码/合成。
- 不自动拉起终端应用。
- 不替用户把 hypit 接到模型服务（需要 hypit 账号，属另一件事）。
- **不改 application identifier**（`com.ganbo-gab.open-storyboard-canvas`）。改名会导致数据迁移。本轮代码一律走 `app.path().app_data_dir()`，不硬编码目录名，使后续改名成为独立可控的一步。
- 不做 `media_postprocess` 的真 ffmpeg 实现。

## 4. 设计

### 4.1 视频工程位置与生成

**路径**：`<app_data_dir>/hypit-projects/<slug>/`

`<slug>` 由画布 projectId + 项目名派生，**确定性**（同一画布项目重开即复用同一视频工程，无需额外注册表）：

```
slug = sanitize(projectName).slice(0,32) + '-' + projectId 去掉连字符后的前 8 位
sanitize: 保留 ASCII 字母数字与 CJK 字符，其余（空格、/、: 等）替换为 '-'
```

**内容**（首次创建时写入，已存在则不覆盖）：

```json
{
  "name": "<slug>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "hypit": { "project": true }
}
```

这是 `references/creation/project-files.md#establish-the-project-boundary` 规定的工程标记。后续 hypit 自己会在该目录生成 `hypit.runtime.json`、`productions/`、`assets/` 等，这些**不归画布管**。

**创建时机**：建立连接时（`establish_connection`），因为正是那时要写 `~/.claude.json`。

**回传前端**：`ExternalAgentConnectionInfo` 新增字段 `hypitProjectDir: string | null`，由 Rust 算好回传。**slug 逻辑只实现一处（Rust）**，前端不重复实现。

### 4.2 双目录 MCP 配置（A 方案）

`write_local_mcp_server` 现在只写一个目录，并会清掉其它目录里的画布条目。改为：

1. 先清掉 `~/.claude.json` 中**所有其它目录**的 `storyboard_canvas` 条目（保持现语义，防陈旧条目指向已删描述符）。
2. 再写**两个**目录：
   - `claudeCodeProjectDir`（现有设置项，默认 `…/000OD`）—— 若为空则跳过，保持现语义
   - `hypitProjectDir`（新增，总是写）

两处写入内容相同：`command` = 当前可执行文件，`args` = `["--external-agent-mcp", <描述符路径>]`。

写盘纪律不变：读-改-写、保留其它所有键、原子写（临时文件 0600 + rename）、坏 JSON 时**原样保留不覆盖**（`claude_config.rs` 已实现，并有单测覆盖）。

### 4.3 读取：`asset_read` 改为落盘 + 返回路径

**动机**：现有实现给的是压缩预览图，不满足"完整原图"；且视频/音频根本没有通路。改为把资产落到视频工程的 `imports/` 下，返回路径。

```
<app_data_dir>/hypit-projects/<slug>/imports/<assetId>.<ext>
```

- **图片**：`save_image_source_to_path(asset.url, target)` —— 取**原始字节**写出，不缩放、不再编码、不碰 `previewUrl`
- **视频**：`save_video_source_to_path(asset.url, target)`
- **音频**：`save_audio_source_to_path(asset.url, target)`

三个 Rust 命令**已存在**，本就做"解析 source → 原字节 → 写到任意路径"，本轮**不新增 Rust 代码**。

**目标目录从哪来？** bridge 已经在 `checkPermission` 里调 `inspectExternalAgentConnection()`。该返回值新增的 `hypitProjectDir` 就是 TS 需要的目标目录 —— **slug 逻辑仍然只在 Rust 一处**，前端只是读取算好的结果。（`imports/` 目录由 `save_*_source_to_path` 自动 `create_dir_all`，TS 不必预建。）

**返回值**（一律不含字节）：

```json
{ "assetId": "...", "kind": "image|video|audio", "path": "/abs/…/imports/xxx.png" }
```

尺寸、时长、比例**不在这里返回** —— 交给 agent 用 hypit 自带的 `hypit media probe` 读。这既是最小实现，也更贴合 hypit 工作流（它本来就自带媒体探测）。

`imports/` 用 `assetId` 作固定文件名 → 重复读同一资产是幂等覆盖，不堆垃圾文件。用 assetId 而非内容哈希，是为了让 agent 能按 assetId 稳定引用同一路径。

**assetId 是跨会话稳定的吗？** `assetId` 由内容指纹派生（`canvasAssetCatalog.ts` 的 `assetFingerprint`），因此同一张图在同一节点上重开应用后仍是同一 assetId；但节点被删后重建会得到新 id。旧 `imports/` 文件因此可能变成孤儿。本轮**不做** `imports/` 的垃圾回收 —— 它只是中转目录，agent 用完即可；真要清理应作为独立的一步（且需先确认 hypit 不会引用旧路径）。

**被删的代码**：`readExternalCanvasImage`（及其压缩逻辑与 `canvasImage` 返回值通路）因本次改动变为孤儿，随之删除。

### 4.4 回写：新增 `assets_import`

新增一个 MCP 工具，只对终端 agent 暴露（画布面板的内置 agent 走的是另一条通路，不经过 MCP manifest）。

**input**：

```json
{
  "files": [
    { "path": "/abs/path/scene-01.mp4", "kind": "video", "title": "第一场" }
  ],
  "anchor": { "nodeId": "…" }
}
```

- `kind` 可省略，按扩展名推断；`title` 可省略
- `anchor` 可省略；给了就在该节点附近落位，否则落在画布已有内容旁

**校验**（全部通过才动手，避免半途留下文件/节点）：

- `path` 必须是绝对路径、存在、是文件而非目录
- 数量 1–16；单文件大小：图片 ≤64 MiB、视频/音频 ≤512 MiB
- 扩展名与 `kind` 相符（`kind` 省略时按扩展名推断，推断不出则拒绝）

**执行**（在 bridge 里，可 async）：

| kind | 准备节点数据 | 节点类型 |
|---|---|---|
| image | `prepareNodeImage(path)` → 原图落进画布 `images/`，得 `imageUrl` + `previewImageUrl` + `aspectRatio` | `uploadNode` |
| video | `prepareVideoNodeDataFromSource(path, title)` → `videoUrl`/`localVideoUrl`/`thumbnailUrl`/`aspectRatio`/`durationSeconds` | `videoNode` |
| audio | `prepareAudioNodeDataFromSource(path, title)` → `audioUrl`/`localAudioUrl`/`durationSeconds` | `audioNode` |

这三个 prepare 函数**都已存在**（`imageData.ts` 的 `prepareNodeImage`、`videoUpload.ts` 的 `prepareVideoNodeDataFromSource`、`audioUpload.ts` 的 `prepareAudioNodeDataFromSource`），无需新写媒体处理。

**位置解析**：`position` 由 bridge 解析后传给命令，命令本身不接收 `anchor`。
- 给了 `anchor.nodeId`：取该节点 `position` + 固定偏移 `(48, 48)`，第 i 个文件再按 `i * 96` 纵向错开
- 未给 `anchor`：落在画布现有节点包围盒右侧 `(bbox.maxX + 160, bbox.minY)`；画布为空则用 `(0, 0)`

**落图位置与事务**：新增 canvas 命令 `asset.import`（推荐做法，用户已选）：

- 新增命令类型 `asset.import`，走 `canvasCommandRegistry`
- `INPUT_SCHEMAS` 加一条：`asset.import` = `{ nodes: [{ nodeType, position, data }] }`，只允许 `nodeType ∈ {uploadNode, videoNode, audioNode}`
- `EFFECTS` 加 `'asset.import': 'graph'`
- 能力清单 `canvasActionCapabilityManifest` 加一条 `'asset.import': { status: 'supported' }`
- execute 交给 `store.addNodesBatch(inputs)` —— 它自带 revision 递增与 history 快照；revision 守卫由 `executeApproved` 的 `baseRevision` 校验负责（现有机制）；`executeCanvasCommand` 的 `canvasAgentRollbackStore` 回滚对 graph 写自动生效

**为什么不直接在 bridge 改 store**：那要自己重做 revision 守卫、impact 摘要、落盘持久化、回滚，容易漏。走 registry 全部复用。

**审批**：`requiresApproval: true`。这是写操作（创建文件 + 画布节点），必须经现有审批卡片确认。

**音频落盘能力补齐**：`persist_video_source` 存在但**没有**音频对应物 —— 画布现在把音频存成 data URL 内联在节点里。为让音频节点像视频一样有本地文件，补一个 `persist_audio_source`，镜像 `persist_video_source`：
- Rust：`resolve_audio_dir` + `persist_audio_bytes`（md5 内容寻址，写 `<app_data_dir>/audio/`）+ `#[tauri::command] persist_audio_source`
- TS：`src/commands/image.ts` 补 `persistAudioSource`
- `prepareAudioNodeDataFromSource` 改为先 `persistAudioSource` 再拿元数据，与视频同构

这是本次唯一的新 Rust 代码（约 25 行，纯镜像既有视频实现）。

### 4.5 工具清单与连接范围

- `ExternalAgentToolName` 加 `'assets_import'`
- `ExternalAgentSupportedKind` 加 `'media-import'`；`buildExternalCanvasMcpManifest` 对应加入该工具
- `ExternalAgentConnectionInfo.scope` 与已持久化的 `connection-params.json` 的 `tools` 必须包含 `assets_import`，否则启动重建后工具不在 manifest 里
- 连接 UI 的 kind 选择需包含 media-import

`assets_import` 不属于只读工具 → `isExternalAgentReadOnly` 返回 `false` → `collaboration` 模式下走"需确认"，`analysis` 模式下被拒。符合安全预期。

**首次生效需要重建一次连接。** 现有 `connection-params.json` 里的 `tools` 是 `["asset_read","config_patch","canvas_command","diagnostics"]`，不含 `assets_import`；启动重建读的是这份参数，所以**升级后必须重开一次画布、并在面板里重建连接**，新工具与视频工程目录才会出现。这不是 bug，是"连接参数是持久化契约"的必然结果。实现时应在连接面板给一句提示，避免用户以为没生效。

## 5. 改动文件清单

| 文件 | 改动 |
|---|---|
| `src-tauri/src/commands/external_agent/connection.rs` | 建视频工程目录 + 写 `package.json`；slug 派生；`ExternalAgentConnectionInfo` 加 `hypitProjectDir`；调 `write_local_mcp_server` 写两个目录 |
| `src-tauri/src/commands/external_agent/claude_config.rs` | 改为写两个目录（清理语义不变）；补双目录单测 |
| `src-tauri/src/commands/image.rs` | 新增 `resolve_audio_dir` / `persist_audio_bytes` / `persist_audio_source`（镜像视频实现） |
| `src-tauri/src/lib.rs` | 注册 `persist_audio_source` 命令 |
| `src/commands/externalAgent.ts` | `ExternalAgentConnectionInfo` 加 `hypitProjectDir` |
| `src/commands/image.ts` | 补 `persistAudioSource` |
| `src/features/canvas/agent/domain/agentModel.ts` | `ExternalAgentToolName` 加 `assets_import` |
| `src/features/canvas/agent/application/externalAgentToolManifest.ts` | 新增 `media-import` kind + `assets_import` 工具定义与 schema |
| `src/features/canvas/agent/application/externalAgentCanvasBridge.ts` | 新增 `assets_import` 执行分支（校验 + prepare + 调 `asset.import`）；`asset_read` 改为落盘返回路径 |
| `src/features/canvas/agent/application/externalAgentPermissionPolicy.ts` | `asset_read` 仍为只读；`assets_import` 归入需确认 |
| `src/features/canvas/agent/application/externalAgentImageRead.ts` | 删除（被落盘方案取代） |
| `src/features/canvas/domain/canvasCommands.ts` | `CANVAS_COMMAND_TYPES` 加 `asset.import`；input 类型 |
| `src/features/canvas/application/canvasCommandRegistry.ts` | `EFFECTS` / `INPUT_SCHEMAS` / 校验 / execute 各加 `asset.import` |
| `src/features/canvas/domain/canvasCapabilities.ts` | `canvasActionCapabilityManifest` 加 `asset.import` |
| `src/features/canvas/application/audioUpload.ts` | `prepareAudioNodeDataFromSource` 改为走 `persistAudioSource` |
| `src/features/canvas/agent/ui/ExternalAgentConnectionPanel.tsx` | 显示视频工程目录；首次生效需重建连接的提示 |
| i18n（zh/en） | 连接面板：视频工程目录说明、`assets_import` 审批文案、重建提示 |

**实现顺序**（后者依赖前者）：4.1/4.2（Rust 工程目录 + 双目录写配置）→ 4.3（读取落盘）→ 4.4 的 Rust 音频落盘 → 4.4 的 `asset.import` 命令 → 4.4 的 `assets_import` 工具 → 4.5（清单与 UI）。

## 6. 验证

**单测**

1. Rust `connection.rs`：slug 确定性与路径安全（含中文/空格/斜杠的项目名）；重复调用不覆盖已存在的工程；`package.json` 内容含 `hypit.project === true`
2. Rust `claude_config.rs`：双目录写入；清理仍只清其它目录；坏 JSON 原样保留；空 `claudeCodeProjectDir` 时只写视频工程目录
3. TS `canvasCommandRegistry`：`asset.import` 的 schema 校验（非法 nodeType 拒绝、data 非对象拒绝）；revision 冲突时拒绝；成功后 revision 递增且进 history
4. TS `assets_import` 校验矩阵：相对路径 / 不存在 / 是目录 / 扩展名与 kind 不符 / 超数量 / 超大小 → 全部拒绝，且**不产生任何节点与文件**

**端到端**

1. 跑起画布 → 建连接 → 断言 `hypit-projects/<slug>/package.json` 存在且 `hypit.project === true`
2. 在该目录跑 `hypit paths` → **成功**（不再报 No Hypit project）
3. 断言 `~/.claude.json` 的 `projects["…/000OD"]` 与 `projects["…/hypit-projects/<slug>"]` **两条**都在
4. claude 读一张画布图 → 断言 `imports/` 下出现该图，且**尺寸等于原图**（不是 1280 上限）
5. claude 读一个画布视频 → 断言 `imports/` 下出现该视频文件
6. claude 调 `assets_import` 回写一个本地 mp4 → 画布出现 `videoNode`，且其 `localVideoUrl` 指向画布 `videos/` 下的持久副本

**真机**

在视频工程目录开 `claude`：确认 `/hypit` 可用、`storyboard_canvas` 工具可用、无信任弹窗；确认能 `hypit paths` 成功。

## 7. 不做

- 不改 application identifier / 目录名（后续独立一步）
- 不复活画布面板的 claude runtime 通路，也不改其工具限制（§3）
- 不实现真 ffmpeg `media_postprocess`
- 不做运行中滚动刷新令牌
- 不动 Camera 相关代码
- 不删既有死代码（除本次改动产生的孤儿）
