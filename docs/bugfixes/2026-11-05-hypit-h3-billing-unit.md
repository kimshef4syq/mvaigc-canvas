# Hypit 复刻视频提交被 1147 计费单元拒绝

> 完整排查过程、逐文件修改、验证数据与遗留问题见
> `docs/reviews/2026-11-05-hypit-replication-fix-report.md`。

## 用户可见行为

画布内用 `mvaigc 视频` 的 MiniMax-H3 能正常生成；同一台机器、同一个账号，通过 Hypit 复刻视频提交 7 秒 / 768P / 9:16（1 个参考视频 + 2 张人物参考图）时，两次都在提交阶段失败：

```
submit failed: mvaigc POST /v1/videos returned HTTP 502:
Provider error: 1147: 找不到此API计费单元信息
```

没有返回视频，也没有远端任务 ID，因此不存在可续查的任务，也没有产生审核结论。修复后，Hypit 提交的请求与画布直发同形，计费单元由上游正常识别。

## 现场证据

| 证据 | 内容 |
|---|---|
| Hypit 运行日志 | `hypit-projects/256-导入-9a64cb66/.hypit/results/2026-11-05/*/execution.jsonl` 两次均为 `POST /v1/videos` → 502 + 1147，phase 停在 submitting |
| Hypit 端口 | `swap.svml` 为 `resolution="768P" duration="7" aspect-ratio="9:16"`，1 个 `h3:Reference video` + 2 个 `h3:Reference image` |
| 已安装的 Provider | 项目内 `node_modules/mvaigc-provider/dist/provider.js`：`resolution==='768P'` → 模型 `minimax_h3_768p`，请求体里**没有** `resolution` |
| 上游实时目录 | 本地反代 `GET /v1/models` 的视频列表只有 `minimax_h3`（该账号、`reference2video` 场景）；没有 `minimax_h3_768p` |
| 画布成功任务 | `projects.db` 的 `ai_generation_jobs`：2026-11-05 10:35，`provider_id=mvaigc-video`、`model_id=minimax_h3`、`status=succeeded`，对应节点 `modelConfig` 为 `{entryId: custom:mvaigc-video:minimax_h3, resolution: 768P, aspectRatio: 9:16}` |

## 根因

反代的 `/v1/videos` 把请求里的 `model` 原样写进上游的 `api` 与 `apiName`（`apiName` 缺省时取 `model`），上游按这两个字段查计费单元。Hypit 发的是**按档位拆开的旧模型 id**：

| | Hypit（失败） | 画布（成功） |
|---|---|---|
| `model` → `api`/`apiName` | `minimax_h3_768p` | `minimax_h3` |
| 分辨率字段 | 无（反代兜底 720p） | `resolution: "768P"` |
| 时长 / 比例 / 参考素材 | `seconds: 7` / `aspect_ratio: "9:16"` / `reference_videos`、`reference_images` | 同形（`size` 作为档位来源） |

`minimax_h3_768p` 是 mvaigc 目录早先按档位拆分的 id（同批还有 `happyhorse_1_720p` 等）。画布在 2026-11-01 把模型目录改成「单模型 + 分辨率档位」，Hypit Provider 仍按旧目录写死，于是：模型 id 查不到计费单元 → 1147；即使 id 侥幸存在，缺 `resolution` 也会被反代兜底成 720p，提交的不是用户要的那一档。

## 实现

- `resources/hypit-provider-mvaigc/src/provider.ts`：`VIDEO_MODEL = 'minimax_h3'`；新增 `mvaigcVideoTier()` 只做档位校验（`768P` 缺省 / `2K`，其他值拒绝）；`buildVideoPayload` 把档位写进 `body.resolution`；`videoMapping.routes` 同步为 `minimax_h3`。
- 测试：`video-payload.test.mjs` 断言两个档位都发 `minimax_h3` 且 `resolution` 不丢；`endpoint.test.mjs` 在 `start()` 后解析真实 POST body，锁定 `model=minimax_h3` + `resolution=768P`。
- 修正 `docs/superpowers/specs/2026-10-23-hypit-mvaigc-provider-design.md` §5.4 的旧结论，避免后续按「档位=模型 id」重新实现。

## 模型与分辨率由用户选择

「H3 + 768P」不是唯一正确答案，也不是默认值：复刻时由智能体在对话里问用户，再按选择提交。

- **两个真实能力**：`@hypit/minimax-h3@1#minimax-h3`（4–15s、`768P`/`2K`、不支持生成音频）与 `@hypit/seedance@1#seedance-2.5`（4–30s、`480p`/`720p`/`1080p`、可 `generateAudio`）。两者共用同一 mvaigc 账号与反代。
- **不写死模型**：`buildVideoPayload` 发 `minimax_h3`，`buildSeedanceVideoPayload` 发 `maas_seedance_2_5`；档位一律显式写进 `resolution`（Seedance 的小写档位规范化为 `480P`/`720P`/`1080P`）。
- **问在对话里**：`agent-workflow.md` 要求提交前问模型、分辨率、时长；`task.json.capabilities.videoModels` 列出可选范围，超出范围的请求会被 `supports` 在计划阶段拒绝（例如 Seedance `4k`、web-search、person-reference）。
- **不提供假装的能力**：mvaigc 有 `wan_3`，但 Hypit 只有 `@hypit/wan` 图片模块，没有 WAN 视频能力，因此 WAN 不出现在选项里，也不会偷偷用 H3 的外形代替。

## 生效方式

Provider 包按 `dist` 内容哈希缓存（`<app_data>/hypit-provider-cache/mvaigc-<hash>`），已有工程不会静默升级。需要：

1. 重新构建应用资源（`node scripts/build-hypit-provider.mjs`，或直接 `cd resources/hypit-provider-mvaigc && npm run build`）；
2. 在画布打开连接对话框的「更多选项」里显式**升级制作环境**（或新建工程），让工程重新链接新的 Provider 版本。

旧工程里已成功的任务、已导出的素材不受影响；失败的两次没有远端任务号，升级后重试即可。

## 验证范围

`resources/hypit-provider-mvaigc`：`npm test` 43 项全过（含真实 Hypit SDK 端口表 `assertMappingCoversPorts`、`start()` 线上请求体断言、Seedance 档位规范化与不支持项拒绝）。

**真实付费验证（一次）**：用原工程的提示词与素材（1 个参考视频 + t01/t02、7 秒、9:16），按修正后的形状向本地反代提交 `model=minimax_h3` + `resolution=768P`：

- 提交：`HTTP 200`，`{"id":"imgToVideo.20261105131501-e00df1721fc045c48f9d9e47b990b022","status":"processing"}` —— **1147 未再出现，提交阶段拿到了远端任务号**；
- 轮询：`processing` → `succeeded`；
- 成品：`verification/hypit-h3-768p-7s.mp4`，768×1344、h264 + aac、7.29 秒、3.1 MB。

同一形状换成 Seedance 时走 `model=maas_seedance_2_5` + 小写档位规范化为 `720P`，未单独付费实跑；其端口表、载荷与拒绝规则由单元测试覆盖。
</content>
