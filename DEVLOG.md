# mvaigc-canvas 开发日志（交接用）

> 新会话 / 新接手的人：读这一份就知道**已经做完什么、在哪、怎么验证、下一步**。
> 不必重新问"我们之前干了哪些活"。
>
> 最后更新：2026-11-03

---

## 0. 一句话现状

`mvaigc-canvas/` 是 Open Storyboard Canvas（OSC）的二次开发版本。
当前分支 **`main`**（原 `feat/mvaigc-proxy`，2026-10-10 改名）。**本地领先 `origin/main` 28 个提交（未推送）**；仅 `model-test/` 未跟踪。
已完成主线：**自建反代（mvaigc-proxy）**、**「生成图片」一体节点**、**「生成视频」一体节点**；以及导演台连线、品牌改写、**外部 Agent 零手动接入**、**视频节点按模型+生成方式决定参数与槽位**、**生成图片节点摄像机控制**等。
（最新工作见第 2 节 I / J / K 三小节。）

工作区约定、开发边界与质量约束见根目录 [AGENTS.md](AGENTS.md) 与 [CONSTRAINTS.md](CONSTRAINTS.md)。

---

## 1. 分支与回退锚点

| 项 | 值 |
|---|---|
| 分支 | `main`（原 `feat/mvaigc-proxy` 已改名；远程 `origin/main` 同步） |
| 提交总数 | 84 |
| 基线提交 | `7a78240` chore: 建立 Git 仓库，导入 mvaigc-canvas 工作副本基线 |
| 最新提交 | `c82602a` Merge branch 'kimshef4syq/guasssplat'（3DGS 分支并入 main） |

**Tag（按时间）**：

| Tag | 日期 | 指向 | 含义 |
|---|---|---|---|
| `milestone-2026-10-07` | 10-07 | `d3b368b` | 里程碑锚点，出问题回退到这里 |
| `图片节点已经对其` | 10-08 | `492b5f1` | 图片节点尺寸对齐阶段 |
| `图片节点OK` | 10-08 | `51e62a7` | 图片节点验收通过 |
| `视频参考-之前` | 10-09 | `259f89f` | 视频参考改造前的存档 |
| `视频参考-接通未测` | 10-09 | `e81fd38` | 视频参考已接通、**尚未端到端验证** |
| `框选节点全部连线` | 11-02 | `9883a0c` | 框选连线方案确认前的锚点 |
| `pre-guasssplat-merge` | 11-03 | `eeb4f59` | 合并 guasssplat（3DGS）之前的安全锚点 |

> 回退示例：`git reset --hard milestone-2026-10-07`

---

## 2. 已完成的工作（按主题，带提交区间）

### A. 自建反代 mvaigc-proxy（Rust 内置，axum）

`6f78b86` → `7a4d5fd`，后续修复到 `601a896`。

- 设计文档：`docs/superpowers/specs/2026-10-07-mvaigc-proxy-design.md`
- 实施计划：`docs/superpowers/plans/2026-10-07-mvaigc-proxy.md`
- 形态：**Rust 原生内置**（非外挂进程），用户只填账号+密码，端口可配
- 能力：客户端登录与模型列表 → 提交与轮询 → axum HTTP 服务与字段映射 → 随应用启动 → 自动注册图片/视频供应商 → 设置面板
- CLI 测试脚本：`mvaigc-proxy/mvaigc-cli.py` + `mvaigc-proxy/README.md`
- 关键修复：
  - `132591b` 终审修复（token 重登 / 视频请求体 / 空结果 / 图片 operType）
  - `9afcd98` 并发重登竞态导致的偶发 502
  - `1001e28` 支持带参考图/视频的大请求体
  - `601a896` / `e5aa1aa` 参考图先上传 OSS 换成短 URL，修复 `oper_info` 超长 500
  - `bf7fb3f` 默认模型改 Nano-Banana-Pro；修 `@@` 重复引用标记
  - `d364d9d` 真实使用暴露的比例与超时问题

### B. 「生成图片」一体节点

`d9e03ce` → `ecad933`。

- 设计：`docs/superpowers/specs/2026-10-07-generate-image-node-design.md`（已评审）
- 计划：`docs/superpowers/plans/2026-10-07-generate-image-node.md`
- 能力：历史数据模型与旧数据迁移 → 生成完成追加历史并设为主图 → 提交复用节点、count>1 串行入队 → 主图 + 历史面板选主图 → 内嵌提示词面板 + 覆盖/新建生成 → 接入菜单与参考图流程
- 大量尺寸/布局修复（`3e0abe7` → `e12381c`）：面板仅选中时显示、张数下拉 1–4、默认尺寸对齐参考节点 `563x337`、面板宽度 460 与节点宽度解耦、容器查询 `cqw`+`em` 等比缩放、半透明放大按钮

### C. 「生成视频」一体节点

`4436f95` → `10b0d73`。

- 设计：`docs/superpowers/specs/2026-10-08-generate-video-node-design.md`
- 计划：`docs/superpowers/plans/2026-10-08-generate-video-node.md`
- 能力：视频历史数据模型 → 生成落法（覆盖/新建）→ 回填按 entry 写入历史 → 截帧支持时间点（首/当前/尾）→ 参考缩略图排 + 提示词放大 → 视频显示框 + 历史面板 + 截帧工具条 → 迁移接线、菜单改名「生成视频」、导出媒体

### D. 视频节点后续修复与增强

`3c086dc` → `60163bc`。

- 布局：显示框与提示词框按比例分高；`@` 弹窗锚点改相对提示词框；外框只包视频、下方面板移到框外；截帧/预览工具条移到右上角避免被播放条遮挡；截帧节点固定落在视频节点右侧
- 行为：截帧改为产出「生成图片」节点（连线 视频 → 帧）；连入参考时**不再**自动往提示词追加 `@图N`
- 预览：`CanvasNodeImage` 支持单击打开放大预览（`a3b48d3`）；参考小图单击改为放大预览、不再插入 `@图N`（`f7a4eda`）
- 模型：火山方舟预设支持视频/音频参考（`cf9fcf3`）；即梦模型合并为一个条目 + 生成方式标签（`c8b40c3`、`9729aff`）
- 连线：生成视频节点可作为连线起点，接通「生成视频 → 生成视频」（`60163bc`）；生成视频产出可作为另一个生成视频的参考（`828372e`）；参考视频用首帧缩略图、点击放大播放（`d2d7f9f`）

### E. 画布菜单

- `55c4677` 双击菜单把「生成图片 / 生成视频」提到最前

### F. JSON 卡片（文本节点）

- `363013c` 文本节点连入即灌入内容，并支持卡片内直接编辑
- `00b0e50` 编辑态无法退出——NodeHeader 常驻，只切换正文
- `05be782` 自动模式下数组生成真实表格列

### G. 其他 UI 改动

- `c0ad5ee` 标题栏右上角新增「电影技法」按钮（打开 `https://melies.co/cinematic-techniques`）
- `11274be` 设置里隐藏「即梦 Dreamina」「图床配置」两个入口（**面板代码保留**，只去掉左侧导航按钮）
- `e8bc5b4` 关于页与 README 改为「mvaigc 桌面画布」；作者/仓库指向本项目，移除 henjicc 原作者与归属说明（**上游 OSC 链接保留**）。注意：`NOTICE` 文件仍保留 henjicc 归属，未改。

### H. 导演台节点接入生成节点

- `edc67c9` 导演台（blueprint）节点可作为「生成图片」「生成视频」的参考输入：
  - `src/features/canvas/domain/nodeRegistry.ts`：`blueprintNode` 补 `manualSource: true`（否则 source handle 画得出但拖不动，`handleConnectStart` 直接拦掉）
  - `src/features/canvas/application/graphReferenceResolver.ts`：`extractReferencesFromNode` 增加导演台分支，把 `data.snapshotUrl`（无则回退 `snapshotHistory` 末张）暴露为 `image` 参考
  - 补 4 条回归测试（可作手动源 / 截图产出图片参考 / 历史回退）
  - ⚠️ **未在界面实测**（见第 5 节待办）；且导演台**需先截过图**才有参考可给

### I. 外部 Agent 零手动接入

`7ee637f` → `3968d28`（7 个提交），让"开 Claude Code 就能连上本画布"不再需要手点创建。

- 设计：`docs/superpowers/specs/2026-10-10-external-agent-zerotouch-design.md`
- 计划：`docs/superpowers/plans/2026-10-10-external-agent-zerotouch.md`
- `7ee637f` 描述符改用**固定文件名** `canvas-mcp-current.json`（覆盖写），并清理目录下遗留的旧 UUID 描述符文件——`connection.rs`
- `a47e27c` 接入参数持久化到 `connection-params.json`（项目 id/名、工具集、Claude Code 目录），供下次启动复用
- `a70e7c2` 抽出 `establish_connection`，一次性完成"写描述符 + 落参数 + 写 Claude 配置"；`01c8a21` 应用启动时调用 `rebuild_connection` **自动重建连接**，无需手点（`lib.rs`）
- `167fa75` / `2187453` 新增 `claude_config.rs`：自动写 `~/.claude.json` 的 local-scope MCP 条目。**坏 JSON 不覆盖、保留其它键（含 projects / mcpServers 相邻项）、临时文件 0600**
- `c958a8a` / `3968d28` 前端新增设置项 `claudeCodeProjectDir`，并在接入面板加"Claude Code 项目目录"输入框，随请求下发（Rust 侧 `claude_code_project_dir`，经 `rename_all = camelCase` 对齐）
- 验证命令：`npm test`（前端全量）、`cd src-tauri && cargo test`（Rust 全量，含本计划新增测试）

### J. 视频节点：按模型能力 + 生成方式决定参数与槽位

`00b0186` → `06378bc`，让视频节点的时长/分辨率/比例与输入槽由**所选模型的能力** × **生成方式**共同决定。

- 设计：`docs/superpowers/specs/2026-10-11-video-node-per-model-params-design.md`
- 计划：`docs/superpowers/plans/2026-10-11-video-node-per-model-params.md`
- 供应商配置新增 `extraParams.perModel`（按模型覆盖 `durations`/`resolutions`/`aspectRatios` + `images`/`videos`/`audios` 上限）；解析顺序 模型 → 供应商 → 默认，未写 `perModel` 行为不变——`videoModelCatalog.ts`
- 模式骨架（`videoModeInputSchema`）× 模型数值合并为 `currentInputSchema`（`mergeModeWithModelCapability`），冲突**以模型为准**：Seedance 2.5 参考模式可放 30 图、Seedance 2 只能 15——`videoModes.ts` / `AiVideoNode.tsx`
- 输入槽按 `roles` **具名渲染**：图生=「首帧」；首尾帧=「首帧」+「尾帧」+**调换顺序**按钮（`framesSwapped`）；参考=「参考图」/「参考视频」/「参考音频」三组——`videoSlotLabelKeys`
- mvaigc 自动配置写入 `perModel`：**Seedance 2.5 = 4–30s、SD2.0 系列 / MiniMax H3 = 4–15s、其余 = 4–10s**（每个整数秒）——`mvaigcProviderAutoConfig.ts`
- **时长控件由一排按钮改为下拉列表**（选项 = 当前模型时长表）
- 验证命令：`npm test`、`npx tsc --noEmit`
- 已知边界（非缺陷，本轮范围外）：①`extraParams.perModel` 目前**只由 mvaigc 自动配置写入**，供应商编辑面板没有 `perModel` 入口，手编其它供应商需直接改持久化 JSON；②节点目前只消费新字段（`supportedImageCount` 等），`VideoCatalogEntry.inputSchema`（`videoInputSchemasByModel`/即梦/ComfyUI 的每模型 schema）**仍未接入节点**；③真机界面自查（切模型看时长/分辨率、切模式看槽区、调换首尾帧）**待人工验证**。

### K. 视频节点后续修复 + 生成图片节点摄像机控制

`0dd317b` → `26c3c82`（视频节点收尾 + 图片节点新功能）。

- `0dd317b` 首尾帧调换时**缩略图行同步反序**（此前只换文字不换图）
- `ab46fb4` 首尾帧调换**只换图**，首帧/尾帧**标签固定不变**（槽1=首帧、槽2=尾帧）
- `2ea6c06` 参考区新增 **「＋」入口**：从本地上传（图/视频/音频 → 建节点+连线）/ 从画布选已有媒体节点；按当前模式 schema 门控——`videoReferenceCandidates.ts`
- `277d619` mvaigc 各模型补 **480p + 21:9/9:21/4:3/3:4/3:2/2:3** 宽高比（`botsmart_seedance_2_hd` 不加 480p）；`mergeUnique` 去重
- `1c882dc` **生成图片节点加入摄像机控制**：复用视频节点的 `CameraControlPanel` + `buildCameraPrompt`（**不改冻结组件**），面板加 Camera 按钮，提交时把摄像机描述拼进生图提示词（与视频节点同款约定）
- `26c3c82` 修**摄像机面板压在工具栏上**：面板从提示词面板内部改挂**节点根容器**（`absolute bottom-full` 的定位基准变成整个节点），按钮通过回调打开
- **已验证**：图片节点摄像机控制实发 prompt 确含摄像机描述（实测 Panavision DXL2 / Zeiss Supreme Prime / 200mm / f/2.8）。⚠️ **注意**：摄像机设置只在**点生成那一刻**生效，改完需**重新生成**；判断"传没传"**不要看历史里的 `sourcePrompt`**（非提交路径所写，会误导）。
- 验证命令：`npm test`（全量 798/798）、`npx tsc --noEmit`

### L. 「电影技法」内嵌视图（首页第三标签）

内容取自 melies.co 的 Cinematic Techniques（424 条 / 13 分类），按**提示词库式卡片**实现（非 webview）。

- 抓取脚本 `scripts/scrape-cinematic-techniques.mjs`（离线一次性，`node scripts/…`；`LIMIT=5` 可试跑）→ 产出 `src/features/cinematicTechniques/bundledCinematicTechniques.json`（349 KB，随包提交）。**运行时零抓取**，视频/缩略图走 `asset.melies.co` 直链（该 CDN 无 Referer 校验、`immutable` 缓存）。
- 组件 `src/features/cinematicTechniques/CinematicTechniques.tsx` + `cinematicTechniquesData.ts`：**按原站 13 分类分节**（镜头移动/取景/机位/灯光/构图/镜头光学/色彩/时间运动/机内特效/剪辑/氛围/类型片/病毒风格），每卡 = 视频（进入视口才播，`IntersectionObserver`）或静图 + 技法名 + 提示词 + 复制按钮；顶部搜索 + 分类筛选。
- 数据：424 条全有提示词；**366 条有视频、58 条（灯光/类型/氛围类）用静图** `still/<slug>/hero.jpg`。
- 入口：`ProjectHome.tsx` 加第三标签「电影技法」（`Clapperboard`，在提示词库旁）；**移除 `TitleBar.tsx` 右上角旧按钮**及其孤儿 import（`Clapperboard`、`openUrl`），删 `TitleBar.test.tsx` 对应用例与 `titleBar.cinematicTechniques` 文案。
- i18n：新增 `mainHome.cinematicTechniques` + 顶层 `cinematicTechniques` 块（zh/en）。
- ⚠️ 版权：提示词文本与视频/图片均取自 melies.co；直链依赖其 CDN，改动路径即失效。
- 验证：`npm test`（全量 810/810，含 `cinematicTechniquesData.test.ts` 7 条）、`npx tsc --noEmit`；真机 `npm run tauri dev` → 首页点「电影技法」看视频/静图与复制。

### M. 框选节点全部连线 + 多文件拖入自动排布

drag-and-drop 从"一次只建一个节点"扩成"一批文件建一批节点"，并让**框选**成为一条连线的起点。

- 多文件拖入：`imageDragDrop.ts` 新增 `resolveDroppedMaterialFiles()` / `resolveDroppedMaterialSources()`（返回数组，原单值函数保留）；`Canvas.tsx` 走 `importMaterialFilesAtFlowPosition` / `importMaterialSourcesAtFlowPosition`，并行 prepare 后**一次 `addNodesBatch` 落盘**（一条撤销记录），并整体选中。
- 网格排布：`application/canvasDropArrangement.ts` 的 `arrangeDropGrid()`——列数 ≈ √N，列宽/行高取该列该行最大值，混合图片/视频/音频尺寸也不重叠。
- 框选连线：`application/selectionConnectRules.ts`
  - `resolveFrameConnectAcceptedKinds()`：目标「生成图片」(`exportImage`) /「AI 图片」(`imageEdit`) 只收图片；「生成视频」(`aiVideo`) 收图片+视频+音频；其它目标不过滤。
  - `resolveFrameConnectSourceIds()`：框选中取有 source handle 且有素材类型的节点；导演台等无素材类型的节点**跳过不连**；已连过的按 `validateCanvasConnection` 判重跳过。
- 交互：选框外框（`selectionBoundsRect`）右侧新增圆圈十字连接点 `.canvas-frame-connect-point`（`Canvas.tsx` 的 `handleFrameConnectPointerDown` → 拖动画预览线 → 松手 `elementFromPoint` 找落点 → 一次 `executeTransaction` 提交全部 `edge.connect`）。**可用素材节点 ≥ 2 才显示**；单节点自带连接点行为不变。
- 清理：删除因本次改动成为孤儿的 `create*FromSourceAtFlowPosition` 四个函数（`Canvas.tsx`）。
- 验证：`npx tsc --noEmit`、`npm test`（1381/1381，新增 10 条用例：`canvasDropArrangement.test.ts`、`selectionConnectRules.test.ts`）、`npm run build`。
- ⚠️ **真机界面未验证**：多选拖入网格、框选连接点连「生成视频」/「生成图片」的类型过滤，均待手动确认。

### N. 3D 高斯（3DGS）节点 + SuperSplat 编辑器（合并自 `kimshef4syq/guasssplat`）

`274eb6c` → `648f477`，2026-11-03 以 merge commit `c82602a` 并入 `main`（无冲突；仅 `zh.json`/`en.json` 两边都加 key，自动合并）。

- 新节点类型 `gaussianNode`（「3D 高斯」）：`nodes/GaussianNode.tsx`（175 行）+ `nodeRegistry.ts` / `canvasNodes.ts` / `nodeDisplay.ts` / `canvasCapabilities.ts` 注册。
  - 默认尺寸 440×680；`sourceHandle: false`、`targetHandle: true`，只能作为终点。
  - 连线约束（`application/canvasConnectionRules.ts`）：**只接收一张**上传素材 / 生成图片 / AI 图片，且**只允许一条入边**。
- 生成链路 `application/gaussianGeneration.ts`：走 **ComfyUI 工作流**（1 图 → 3DGS），`SaveGaussianSplat` 输出节点被 `suggestComfyUIOutputNodes` 识别；结果 PLY 经桌面端 `supersplat_download_ply` 取回，存进 **IndexedDB**（`features/supersplat/assets.ts`，库名 `canvas-gaussian-assets`）。
- ComfyUI 媒体类型扩为 `'image' | 'video' | 'audio' | 'gaussian'`，贯穿 `comfyuiGateway.ts`、`customImageProviderConfig.ts`、`customProvidersStore.ts`、设置面板。
- 编辑器：`vendor/supersplat/`（SuperSplat 3.7.0 MIT 源码，**294 个文件入库**；`node_modules`/`dist` 走 gitignore，约 473MB 本地安装）。构建：`npm ci --prefix vendor/supersplat` → `npm run supersplat:build` → 产出 `public/supersplat/`（27MB，已 gitignore）。
  - ⚠️ **`prebuild` 已改为先跑 `supersplat:build`**，所以新克隆必须先装 vendor 依赖，否则 `npm run build` 会失败。
- 桌面端 `src-tauri/src/commands/supersplat.rs`（129 行）：起 127.0.0.1 随机端口 axum 服务（随机 token、4 小时生命周期、目录穿越防护含单测），然后**用 Google Chrome 新窗口全屏打开**编辑器；另有 `supersplat_import_folder`（导入含单个 `.lcc2` 的完整文件夹，拒绝符号链接）。
- 附带（`648f477`）：用户手册 md/html/pdf（`docs/mvaigc-canvas-user-manual.*`）、`scripts/build_manual_pdf.py`、`model-test/gaussian/toy-cat.sog`。
- 已知限制（来自 `vendor/supersplat/INTEGRATION.md`）：3DGS 资产与可编辑文档只存 IndexedDB，**项目打包portability 未实现**；PLY 经 Tauri 命令以 base64 跨越边界，超大模型吃内存；必须装 Chrome。
- 验证：`npx tsc --noEmit`、`npm test`（1390/1390，183 文件）、`npm run build`、`cargo check`、`cargo test`（175 passed / 1 ignored）。
- ⚠️ **真机未验证**：3DGS 生成端到端、Chrome 编辑器打开/保存、以及合并后框选连线与 3DGS 节点共存（按连线规则 3DGS 不入框选连线）。

---

## 3. 关键文件落点

| 领域 | 位置 |
|---|---|
| 反代 Rust 实现 | `src-tauri/src/commands/`（网络代理、本地能力） |
| 反代 CLI 工具 | `mvaigc-proxy/mvaigc-cli.py`、`mvaigc-proxy/README.md` |
| 电影技法（内容抓取+视图） | `scripts/scrape-cinematic-techniques.mjs`、`src/features/cinematicTechniques/` |
| 画布 / 节点 / 生成流程 | `src/features/canvas/`（`nodes/`、`ui/`、`application/`） |
| 框选连线规则 / 拖入网格排布 | `application/selectionConnectRules.ts`、`application/canvasDropArrangement.ts` |
| 3D 高斯节点 / 生成链路 | `nodes/GaussianNode.tsx`、`application/gaussianGeneration.ts`、`features/supersplat/` |
| SuperSplat 编辑器源码与构建 | `vendor/supersplat/`、`scripts/build-supersplat.mjs`、`src-tauri/src/commands/supersplat.rs` |
| 共享组件与设置页 | `src/components/`（`TitleBar.tsx`、`SettingsDialog.tsx`、`settings/`） |
| i18n | `src/i18n/locales/zh.json`、`en.json` |
| 本项目设计/计划文档 | `docs/superpowers/specs/`、`docs/superpowers/plans/` |

> 查代码走 codebase-memory 索引（项目名见 `../CLAUDE.md`），别整文件 Read。

---

## 4. 怎么验证

```bash
cd mvaigc-canvas

npx tsc --noEmit     # 类型检查
npm test             # 全量测试（当前 1390 通过 / 183 测试文件）
npm run tauri dev    # 桌面应用，手动看界面
```

最近一次全量测试：**前端 1390/1390 通过（183 个测试文件）、Rust 175 passed / 1 ignored**（`npx tsc --noEmit`、`npm run build`、`cargo check` 亦通过）。

> 含 3DGS 后，构建前需先装 SuperSplat 依赖：`npm ci --prefix vendor/supersplat`（一次即可）。

---

## 5. 未完成 / 待办

1. **视频参考链路端到端未验证** —— tag `视频参考-接通未测` 即此意。参考视频/音频已写入 `scriptImgToVideo` 请求（`84b16c2`），但**没有跑通过一次真实生成**。
2. **ComfyUI 自定义工作流需要手填「节点绑定」** —— 内置识别只认 `CLIPTextEncode.text` 和 MiniMaxH3；其它提示词节点（如 `CR Prompt Text`）必须在设置 → ComfyUI → 高级 → 「ComfyUI 节点绑定 JSON」里手动写，例如：
   ```json
   {"prompt": {"nodeId": "456", "input": "prompt"}, "images": []}
   ```
3. **`../CLAUDE.md` 不受 git 管理** —— `/Users/spic007/Downloads/07-项目文件/000OD` 不是 git 仓库，该文件的改动无法提交。
4. **导演台连线修复未实测** —— `edc67c9` 已提交但**未在界面验证**。需在导演台拖右侧圆点连到「生成图片/生成视频」，确认能连上且参考小图出现导演台截图。
5. **导演台人物模型替换未成功** —— 试过用 `model-test/123.glb`（Mixamo 骨骼，结构兼容，但**无贴图**、根节点 `Armature`）覆盖 `public/blueprint-figure.glb`，用户反馈"没有换成"（疑缓存或加载失败，未定位）。**原模型已恢复**，`model-test/123.glb` 保留未删。若再试：需彻底重启 dev 清缓存，且可能要在 `blueprintGltfFactory.ts` 适配朝向。
6. **导演台"模型丑"待处理** —— 人物=Mixamo glb（`public/blueprint-figure.glb`）；道具/场景=代码生成的几何体（`src/features/canvas/ui/blueprintMeshFactory.ts`，1959 行）。换人物=换 glb；改道具=改代码。Camera 相关为冻结区，人物/道具不在冻结名单内。
7. **外部 Agent 零手动接入的真机端到端待人工验证** —— 重启 OSC 后应自动重建连接（不再手点「创建接入」），随后在 `/Users/spic007/Downloads/07-项目文件/000OD` 目录直接 `claude` 即可连上、`/mcp` 无信任弹窗。代码与单测（`npm test`、`cargo test`）已全绿，但**真机流程尚未跑过**。
8. **本地 28 个提交未推送 GitHub** —— 外部 Agent 零手动接入 + 视频节点两个特性都在里面。需要时 `git push origin main`。
9. **视频节点「按模型参数」的真机自查** —— 切模型看时长/分辨率是否随模型变（Seedance 2.5 出现 30s、480p、21:9 等）；切模式看槽区（图生=首帧 / 首尾帧=首帧+尾帧+调换 / 参考=图/视频/音频三组）。⚠️ 这些参数在**「融媒视界 mvaigc」重存账号**时才写入供应商配置，重存后生效。
10. **生成图片节点摄像机控制** —— 已验证实发 prompt 含摄像机描述。⚠️ 摄像机设置只在**点生成那一刻**生效，改完需**重新生成**。
11. **`extraParams.perModel` 无供应商编辑 UI** —— 目前只由 mvaigc 自动配置写入；手编其它供应商需直接改持久化 JSON。
12. **「添加供应商」里手动建同名条目会造成重复** —— 如手动建了叫「mvaigc 视频」的自定义供应商，会与自动生成的 `mvaigc-video`（固定 id）并存、同名不同 id。**正确做法**：mvaigc 的配置一律走「融媒视界 mvaigc」面板，不在「添加供应商」里配。

---

## 6. 硬性规则速查

- `mvaigc-canvas/` 是唯一工作区；`open-storyboard-canvas/` 只读参照。
- **Camera 相关一律不碰**（除非明确说"这次改 Camera"）。
- 最小实现、外科手术式改动；每行改动可追溯到用户需求；不删没让删的既有代码。
- 看界面**必须自己截图**：`screencapture -x /tmp/shot.png` → `sips` 裁剪 → `Read` 读图。
- 提交流署名：`Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 数据与 API Key 默认存本地。
