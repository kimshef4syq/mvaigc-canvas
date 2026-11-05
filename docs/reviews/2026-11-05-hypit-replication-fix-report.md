# Hypit 复刻视频 502/1147 —— 排查、修复与验证全过程

日期：2026-11-05
关联：`docs/bugfixes/2026-11-05-hypit-h3-billing-unit.md`（结论摘要）
涉及仓库：`mvaigc-canvas` / `resources/hypit-provider-mvaigc`

---

## 1. 问题现象

在画布里选一个视频，点节点工具栏的「用智能体复刻此视频」，让 Codex 走 Hypit 复刻。提交阶段失败，两次都是同一错误：

```
submit failed: mvaigc POST /v1/videos returned HTTP 502:
Provider error: 1147: 找不到此API计费单元信息
```

- 没有返回视频，也没有远端任务 ID → 不存在可续查任务，提交阶段就失败了。
- 因此**不能**据此推断人物审核失败。
- 画布内用同一个 mvaigc 账号生成 MiniMax-H3 视频是成功的。
- 请求设定：7 秒、768P、9:16；1 个原视频 + t01/t02 两张人物参考图。

## 2. 排查过程（时间线）

| 时间 | 动作 | 结果 |
|---|---|---|
| 10:20 | 该工程由画布自动准备（`providerHash=624a108b…`） | 安装的是旧 Provider |
| 10:28 | 第一次 `hypit build`（双人物替换） | submit 502 + 1147，phase `submitting` |
| 10:29 | 第二次重试（双人物替换重试） | 同错误，同阶段 |
| 10:31 / 10:35 | 画布内分别生成 `wan_3`、`minimax_h3` | 均 `succeeded` |
| 11:0x | 读上游实时目录 `GET /v1/models` | 视频模型只有 `minimax_h3`，无 `minimax_h3_768p` |
| 11:0x | 读画布节点 `modelConfig` | `{entryId: custom:mvaigc-video:minimax_h3, resolution: 768P, aspectRatio: 9:16}` |
| 11:0x | 读工程内已装 Provider dist | 768P → `minimax_h3_768p`，body 里**没有** `resolution` |
| 13:15 | 按修正后形状付费提交 | 200 + 任务号；轮询成功；成片 7.29s |

### 关键证据

1. **Hypit 运行日志**（工程内 `.hypit/results/2026-11-05/*/execution.jsonl`）
   - 两次都是 `POST /v1/videos` → `HTTP 502: Provider error: 1147: 找不到此API计费单元信息`
   - `result.json` 里 `outcome: failed`，`progress.phase: submitting`，无外部任务 ID。
2. **上游实时目录**（本地反代 `GET /v1/models`，返回 20 个模型）
   - 视频 id：`maas_seedance_2_5`、`veo_3_1`、`minimax_h3`、`wan_3_prime`、`vidu_q4`、`maas_seedance_2`、`wan_3`、`kling_v3_omni`、`happyhorse_1`、`botsmart_seedance_2_fast`
   - **没有** `minimax_h3_768p`（同批旧档位 id 如 `happyhorse_1_720p` 也都不在）。
3. **画布成功任务**（`projects.db` 的 `ai_generation_jobs`）
   - `provider_id=mvaigc-video`、`model_id=minimax_h3`、`status=succeeded`，时间 10:35。
4. **代码史**：`git log` 显示 11-01 的画布提交把模型目录从「一档一个 id」改成「单模型 + resolution 档位」（`mvaigcProviderAutoConfig.ts` 由 `minimax_h3_768p` 等条目改成 `minimax_h3` + `['2K','768P']`）。Hypit Provider 的映射（10-23 写的）还停留在旧目录。

## 3. 根因

反代 `/v1/videos` 的映射逻辑：请求里的 `model` 被原样写进上游的 `api` 和 `apiName`（`apiName` 缺省时取 `model`），上游按这两个字段查计费单元。

| 字段 | Hypit（失败） | 画布（成功） |
|---|---|---|
| `model` → `api`/`apiName` | `minimax_h3_768p` | `minimax_h3` |
| 分辨率字段 | **缺失**（反代兜底 `720p`） | `resolution: "768P"` |
| 时长 / 比例 / 参考素材 | `seconds: 7`、`9:16`、1 视频 + 2 图 | 同形（`size` 作为档位来源） |

所以是两处不一致，都来自同一个过期假设「档位 = 模型 id」：

1. 模型 id 用了已经不存在的 `minimax_h3_768p` → 上游找不到计费单元 → 1147。
2. 档位没显式发出 → 反代兜底 720p；即使 id 存在，提交的也不是用户要的那一档。

**不是**账号计费配置问题，**不是**人物审核，也**不是** Hypit 接入层权限问题。

## 4. 修改清单

### 4.1 `resources/hypit-provider-mvaigc/src/provider.ts`

| 改动 | 内容 / 原因 |
|---|---|
| 删除 `mvaigcVideoModelForTier()` | 它把档位塞进模型 id（768P→`minimax_h3_768p`），是 1147 的直接来源 |
| 新增 `VIDEO_MODEL = 'minimax_h3'` | H3 唯一模型 id；档位走 `resolution` |
| 新增 `SEEDANCE_VIDEO_MODEL = 'maas_seedance_2_5'` | Seedance 2.5 的 mvaigc id |
| 新增 `seedanceVideoCapability` | `@hypit/seedance@1#seedance-2.5`，第二个真实视频能力 |
| 新增 `MvaigcSeedancePorts` | 在视频端口上补 `generateAudio` / `webSearch` / `usesPersonReference` |
| 新增 `mvaigcVideoTier()` | 只做 H3 档位校验与默认（`768P`/`2K`），不再改模型 |
| 新增 `mvaigcSeedanceTier()` | 小写 `480p/720p/1080p` → `480P/720P/1080P`；默认 `720P`；`4k` 拒绝 |
| 新增 `composeVideoBody()` | 共用请求体：`resolution` 一定显式发出；`audio` 由调用方给；首尾帧仍重写成 `frames=true` + `reference_images=[first,last]` |
| 改写 `buildVideoPayload()` | 模型固定 `minimax_h3`，`audio` 用映射常量 `false` |
| 新增 `buildSeedanceVideoPayload()` | 模型 `maas_seedance_2_5`；`audio` 来自 `generateAudio` 端口；`webSearch=true` / `usesPersonReference=true` **明确拒绝** |
| 新增 `SEEDANCE_VIDEO_PORTS` | 真实端口清单（含 `generateAudio`、`webSearch`） |
| 新增 `seedanceVideoMappingFields` | 四个媒体端口带 `resourceFields: ['personReference']`（与官方 `@hypit/provider-hypihub` 写法一致）；`generateAudio→audio`、`webSearch→web_search` |
| 新增 `seedanceVideoMapping` | `routes: [{ model: 'maas_seedance_2_5' }]` |
| 修正 `videoMapping.routes` | `minimax_h3_768p` → `minimax_h3` |

### 4.2 `resources/hypit-provider-mvaigc/src/lifecycle.ts`

- 新增 `seedancePorts()`：复用视频端口读取，再取 `generateAudio` / `webSearch` 两个开关。
- 新增 `anyPersonReference()` + `PERSON_MEDIA_PORTS`：扫描参考图/视频/首尾帧条目的 `fields.personReference`，任一为 `true` 时上报，交给 builder 拒绝（`false` 是模型默认值，不构成作者意图）。
- 新增 `createMvaigcSeedanceEndpoint()`：同一套 submit → poll → collect 生命周期，走 `/v1/videos`。

### 4.3 `resources/hypit-provider-mvaigc/src/endpoint.ts`

- `createMvaigcEndpoints()` 现在返回 `{ video, seedance, image }`。
- `supportFor()` 增加 Seedance 计划阶段校验：档位只允许 `480p/720p/1080p`（`4k` 拒绝）；`webSearch=true` 拒绝。
- `capabilities` 数组新增第三项（Seedance），与 H3、图片共用同一 `baseUrl` 与同一凭据槽。

### 4.4 `resources/hypit-provider-mvaigc/prepare-project.mjs`

- `mergeRuntime()` 的 `bindings` 增加 `@hypit/seedance@1#seedance-2.5 → canvas.mvaigc`。
  该模块由 `@hypit/video` 传递依赖带入工程，无需额外安装。

### 4.5 `resources/hypit-provider-mvaigc/agent-workflow.md`

新增「复刻提交前必须问用户三件事：模型、分辨率、时长」，并给出范围：

- `MiniMax-H3`（`h3:ReferenceVideo`）：4–15 秒，`768P`/`2K`，不支持生成音频。
- `Seedance-2.5`（`seedance:ReferenceVideo model="2.5"`）：4–30 秒，`480p`/`720p`/`1080p`，可 `generate-audio`。
- 用户没答就等；选好后按对应元素写组合，不混用两个模型名。
- Seedance 的 web-search / person-reference 画布不承载，需要时明确说明不可用。

### 4.6 `src-tauri/src/commands/external_agent/video_launch.rs`

`task.json` 的 `capabilities` 从写死的 `videoResolutions: ["768P","2K"]` 改成 `videoModels` 数组，列出两个模型及其 Hypit 模块、元素名、时长/分辨率/参考上限/是否支持生成音频。智能体据此提问与选择。

### 4.7 测试

| 文件 | 新增覆盖 |
|---|---|
| `test/video-payload.test.mjs` | H3 两档都发 `minimax_h3` 且 `resolution` 不丢；Seedance 模型 id、档位规范化、`generateAudio` 跟随端口、`webSearch`/`personReference` 拒绝、首尾帧重写 |
| `test/endpoint.test.mjs` | 用真实 `seedancePorts['seedance-2.5']` 跑 `assertMappingCoversPorts`；解析 Seedance `start()` 的真实 POST body；`supports()` 拒绝 `4k` 与 `webSearch=true` |

测试总数 **35 → 43**，全部通过。

### 4.8 依赖与文档

- `package.json`：`devDependencies` 增加 `@hypit/seedance: 0.2.0`（精确版本，与仓库其它依赖一致）；lock 文件随之更新。
- 新增 `docs/bugfixes/2026-11-05-hypit-h3-billing-unit.md`。
- `docs/superpowers/specs/2026-10-23-hypit-mvaigc-provider-design.md`：§5.4 加「更正（2026-11-05）」说明旧结论作废；§6.3 加增补，写清两个视频能力与 WAN 缺席原因。
- `README.md`：能力清单与「模型不写死、在对话里问」的说明。

## 5. 验证

### 5.1 单元/集成测试

```bash
cd resources/hypit-provider-mvaigc
npm test        # 43 pass / 0 fail
```

包含真实 Hypit SDK 的端口表校验与真实 `start()` 线上请求体断言（不是手抄端口名）。

### 5.2 真实付费提交（一次）

用原工程同一提示词与素材（1 视频 + t01/t02，7 秒，9:16），按修正形状向本地反代提交：

```http
POST http://127.0.0.1:8787/v1/videos
{ "model": "minimax_h3", "prompt": "…", "seconds": 7,
  "resolution": "768P", "aspect_ratio": "9:16", "frames": false,
  "reference_images": [t01, t02], "reference_videos": [原视频],
  "reference_audios": [], "audio": false }
```

结果：

- 提交 `HTTP 200` → `{"id":"imgToVideo.20261105131501-e00df1721fc045c48f9d9e47b990b022","status":"processing"}`，**1147 未再出现**。
- 轮询 `processing → succeeded`。
- 成品 `verification/hypit-h3-768p-7s.mp4`：768×1344、h264 + aac、7.292 秒、3.1 MB。

> 说明：这次付费验证走的是反代「无 Authorization 时回退到画布已存凭据」的路径，验证的是**上游对 model+resolution 的接受**；Hypit Provider 的请求体由单元测试锁定。

### 5.3 未做的验证

- Seedance 2.5 未做付费实跑（会再消耗一次积分）；其端口表、载荷、拒绝规则由测试覆盖。
- 没有从画布 UI 完整点一遍（需要在新构建的应用里点，见第 6 节）。

## 6. 仍未解决的问题（重要）

### 6.1 当前安装的应用内置的是旧 Provider（**“现在还不能直接用”的直接原因**）

- 运行的是 `/Applications/mvaigc-canvas.app`，构建时间 11-04 07:08。
- 包内 `Contents/Resources/resources/hypit-provider-mvaigc/dist/provider.js` 仍是：
  ```js
  return 'minimax_h3_768p';
  routes: [{ model: 'minimax_h3_768p' }],
  ```
- 因此即使点「升级制作环境」，也只会把**旧版**重新装进工程。
- 该 app 带 `com.apple.quarantine` 且为 ad-hoc/linker-signed；直接改包内 Resources 会破坏签名，有启动被拦风险，**不建议**手工改包。

### 6.2 已有工程锁定 Provider 版本

- 工程 `.canvas-agent/environment.json` 的 `providerHash=624a108b…` 对应旧 dist。
- 新 dist 会算出新 hash，`prepare-project.mjs` 对锁定版本要求显式升级：
  `Use an explicit environment upgrade before switching versions.`
- 所以即使应用更新了，也需要在连接对话框「更多选项」勾一次**升级制作环境**。

### 6.3 WAN3 无法支持

- mvaigc 有 `wan_3` / `wan_3_prime`。
- Hypit 只有 `@hypit/wan`（图片：`wan-2.7-image` / pro），**没有 WAN 视频模块**。
- 结论：WAN3 不作为真实能力出现；不用 H3 外形偷偷顶替——那会让 Hypit 的 plan 与实际模型不一致。
- 若一定要 WAN3，需要随画布自制一个 Hypit 模型模块（ports/surface/producer/manifest），工作量和风险都更大。

### 6.4 其他记录在案的坑

| 问题 | 处理 |
|---|---|
| `git` 报 `missing config key GIT_CONFIG_KEY_0` | 环境里有 `GIT_CONFIG_COUNT=2` 但缺 key；`env -u GIT_CONFIG_COUNT -u … git …` 可用 |
| `npm i` 无法写 `~/.npm`（权限） | 用 `--cache /tmp/npm-cache` 安装成功 |
| `resources/hypit-provider-mvaigc/dist` 被 `.gitignore` 忽略 | 发行物必须构建：`node scripts/build-hypit-provider.mjs` / `npm run build` |
| Seedance 端口要求 `personReference` item field | mapping 用 `resourceFields: ['personReference']` 覆盖；`true` 时 builder 拒绝 |
| Seedance 档位小写 vs mvaigc 大写 | 规范化为 `480P/720P/1080P` |
| Seedance `4k`、`web-search`、`person-reference` 画布不承载 | 计划阶段或 builder 明确拒绝，不静默丢 |
| 沙箱内跑 `hypit doctor` | `RUNTIME_CREDENTIAL_MISSING`（无 `OSC_MVAIGC_TOKEN`）+ `EPERM .hypit/results`，需从画布启动拿短期 grant |
| 无 Authorization 请求反代返回 200 | 反代会回退到画布已存凭据；因此 `/v1/models` 与付费提交可只读/直接调用，但这也意味着它**不是**一个需要独立鉴权的接口 |
| H3 请求 `audio:false` 成片仍有 aac 轨 | 上游行为；`audio` 是“是否按提示生成音频”的开关，不等于没有音轨 |
| 旧代码注释称「768P 与画布 720p 都是 768p 档」 | 与运行时实况不符，已随 §5.4 更正在文档与代码注释中清理 |

## 7. 后续行动（按顺序）

1. **重建应用**（二选一）
   - 开发模式：仓库里 `npm run tauri dev`（`predev` 会重建 Provider dist；首次会从零编译 Rust，耗时较长）。
   - 打包：`npm run tauri build`，用产物替换 `/Applications/mvaigc-canvas.app`。
2. **升级工程**：从画布点复刻 → 「更多选项」勾「升级制作环境」→ 启动。
   此时 `providerHash` 变为新值，工程 `node_modules/mvaigc-provider` 与 `hypit.runtime.json` 里的 Seedance 绑定一起更新。
3. 在 Codex 对话里回答三件事：模型（H3 / Seedance 2.5）、分辨率、时长。答完才会提交付费任务。
4. （可选）Seedance 2.5 付费实跑一次，确认成片与计费。

### 怎么自查是否已生效

```bash
# 应用内置（应为 minimax_h3 + maas_seedance_2_5）
grep -n "maas_seedance_2_5" \
  "/Applications/mvaigc-canvas.app/Contents/Resources/resources/hypit-provider-mvaigc/dist/provider.js"

# 工程已装（应为 minimax_h3 + maas_seedance_2_5，且没有 minimax_h3_768p）
grep -n "minimax_h3_768p\|maas_seedance_2_5" \
  "$HOME/Library/Application Support/com.ganbo-gab.open-storyboard-canvas/hypit-projects/<工程>/node_modules/mvaigc-provider/dist/provider.js"

# 运行时绑定（应包含 seedance-2.5）
python3 -c "import json;print(json.load(open('$HOME/Library/Application Support/com.ganbo-gab.open-storyboard-canvas/hypit-projects/<工程>/hypit.runtime.json'))['bindings'])"
```

## 8. 附：本次修改文件一览

```
resources/hypit-provider-mvaigc/src/provider.ts
resources/hypit-provider-mvaigc/src/lifecycle.ts
resources/hypit-provider-mvaigc/src/endpoint.ts
resources/hypit-provider-mvaigc/prepare-project.mjs
resources/hypit-provider-mvaigc/agent-workflow.md
resources/hypit-provider-mvaigc/README.md
resources/hypit-provider-mvaigc/package.json (+ package-lock.json)
resources/hypit-provider-mvaigc/test/video-payload.test.mjs
resources/hypit-provider-mvaigc/test/endpoint.test.mjs
src-tauri/src/commands/external_agent/video_launch.rs
docs/bugfixes/2026-11-05-hypit-h3-billing-unit.md            （新增）
docs/superpowers/specs/2026-10-23-hypit-mvaigc-provider-design.md （更正/增补）
docs/reviews/2026-11-05-hypit-replication-fix-report.md      （本文）
verification/hypit-h3-768p-7s.mp4                            （付费验证成片，未入库）
```
</content>
