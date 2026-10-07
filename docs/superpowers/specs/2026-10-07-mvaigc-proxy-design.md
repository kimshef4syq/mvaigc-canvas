# mvaigc 反向代理（mvaigc-proxy）设计文档

日期：2026-10-07
状态：待评审
位置：`mvaigc-canvas/mvaigc-proxy/`

## 1. 目标

把 www.mvaigc.cn（"融媒视界" AIGC 站点）的私有 API，封装成本地运行的
反向代理，对外暴露**标准化的模型接口**，让 Open Storyboard Canvas（下称 OSC）
等软件通过「添加供应商」直接接入。

使用者的操作只有一个：在软件里填**本地反代地址** + **`账号:密码`**。
反代用该账号登录 mvaigc、提交生成任务、轮询结果，扣该账号的积分。

**成功标准**：在 OSC 里新增图片 / 视频两个供应商后，能从画布正常发起
生成、拿回图片或视频。

## 2. 背景事实（均已实测确认，2026-10-07）

### 2.1 mvaigc.cn 是自研接口，非 OpenAI 兼容

站点为 Vue3 + Vite SPA，后端为 Spring Boot。**不存在** `/v1/chat/completions`
等 OpenAI 标准端点（实测为 nginx 405 或 SPA 兜底）。所有业务在 `/ma/v1/*` 下，
统一 JSON 信封：`{"code":200,"message":"成功","data":...}`，`code != 200` 为失败。

### 2.2 鉴权

- `POST /ma/v1/user/login`，body `{"account","password"}` → `data.token`(JWT)、`data.userId`
- 之后所有请求带请求头 **`X-User-Token: <token>`**（不是标准 Bearer）
- token 过期后返回 `code` 401 或 103 → 需重新登录
- 无请求签名、无时间戳、无加密 body

### 2.3 能力接口

| 能力 | 接口 | 备注 |
|---|---|---|
| 图像模型列表 | `GET /ma/v1/imgPlatform/getImgModel` | 返回 `data.model{}`，每项含 `name/model_name/resolution/aspectRatio/limits` |
| 生图 | `POST /ma/v1/imgPlatform/imgToImage` | 返回 `data.operId` / `data.operIds`，轮询用 `operType=imageImg` |
| 视频模型列表 | `GET /ma/v1/videoPlatform/getVideoApi?type=reference2video` | `type` 另可取 `start-end2video` |
| 生视频（全能参考） | `POST /ma/v1/filmStoryboard/scriptImgToVideo` | 返回 `data.operId/historyId/operType` |
| 生视频（首尾帧） | `POST /ma/v1/filmStoryboard/scriptMutiImgToVideo` | 用 `timeStamp: 0 / -1` 标记首尾帧 |
| 音乐 | `POST /ma/v1/music/makeMusic` | 返回 `data.operIds[]` |
| 结果轮询 | `GET /ma/v1/fileTransfer/getHistoryFilesByPage/{operType}?pageNum=&pageSize=` | 见下 |
| 上传 | `POST /ma/v1/fileTransfer/getUploadUrl` → `PUT` → `POST /ma/v1/fileTransfer/getDownloadUrl` | 三段式，走 OSS |

### 2.4 结果查询（HTTP 轮询，非 WebSocket）

`GET /ma/v1/fileTransfer/getHistoryFilesByPage/{operType}?pageNum=1&pageSize=N`

返回 `data.list[]`，每项关键字段：
- `operId`：任务号，与提交返回对应
- `operType`：如 `imgToImage`
- `isComplete`：是否完成
- `fileUrl`：**JSON 字符串**，形如 `"[\"https://static.mvaigc.cn/aigc_images/xxx.png\"]"`
- `errorMsg`：失败原因

判定：`isComplete === true` 且 `errorMsg` 为空 → 成功，取 `fileUrl` 数组。
`isComplete === true` 且 `errorMsg` 非空 → 失败。

> 站点另有 WebSocket（`wss://www.mvaigc.cn/ma/v1/socket/{userId}?token=`）推送
> `{func, operId}`，但**本方案不依赖它**——HTTP 轮询足够，且结构更简单。

### 2.5 OSC 侧能力边界（决定方案形态）

OSC 的「自定义供应商」(`src/stores/customProvidersStore.ts`) 支持三类：
`image` / `video` / `chat`（`customProviderMediaType`）。**没有 audio 类**。

OSC 的异步任务契约 `asyncTask`（见 `CUSTOM_PROVIDER_PRESETS` 的
`generic_async_poll` / `grsai_draw_async`）字段为：
`taskIdPath / resultEndpointPath / resultMethod / imagePath / statusPath /
pendingValues / successValues / failedValues / errorPath / intervalMs / timeoutMs`。

关键限制：`resultEndpointPath` 是**单参数模板**（只支持 `{taskId}`），
轮询时**无法携带查询参数**（如 `?pageNum=1`）。因此反代必须提供
**带路径参数即可定位单个任务**的轮询端点。

## 3. 方案

### 3.1 形态

一个**本地 HTTP 反代服务**，Python 标准库实现（`http.server` + `urllib`），
零第三方依赖，与既有 `mvaigc-proxy`（用户此前在别处做过）同技术路线。
默认监听 `127.0.0.1:8787`（可配置）。

### 3.2 对外接口

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/v1/models` | 返回图片+视频模型列表（OpenAI `/models` 形状） |
| `POST` | `/v1/images/generations` | 提交生图，返回 `{id, status, ...}` |
| `POST` | `/v1/videos` | 提交生视频，返回 `{id, status, ...}` |
| `GET` | `/v1/tasks/{id}` | 查任务状态/结果 |

**认证**：请求头 `Authorization: Bearer <account>:<password>`。
反代解析出账号密码 → 登录 mvaigc 拿 token（内存/磁盘缓存，含 `expires_at`）
→ 后续请求带 `X-User-Token`。命中 401/103 自动重登。

**任务号设计**：提交成功后，反代把 mvaigc 的 `operType` 与 `operId` 编码进
`id`，**格式固定为 `<operType>.<operId>`**，例如 `imgToImage.67890`、
`imageImg.12345`。`operType` 不含 `.`，故该分隔安全。
这样：
- `/v1/tasks/{id}` 无需额外查询参数即可定位（绕过 OSC 的单参数限制）
- 反代**无状态**：重启后仍能查历史任务（结果在 mvaigc 侧）

### 3.3 各接口字段映射

**`GET /v1/models`**
→ 聚合 `getImgModel` 与 `getVideoApi`，输出：
```json
{"object":"list","data":[{"id":"gpt_image2","object":"model","owned_by":"mvaigc"}, ...]}
```

**`POST /v1/images/generations`**
入（OpenAI Images 风格）：
```json
{"model":"gpt_image2","prompt":"...","size":"1024x1024","n":1,
 "image":["<url or data-url>"]}
```
→ 映射为 mvaigc `imgToImage`：
```json
{"model":"gpt_image2","modelName":"GPT-Image-2","text":"...",
 "resolution":"2K","imgRatio":"16:9","imgCount":1,
 "images":[{"url":"...","name":"图1"}]}
```
出：`{"id":"imageImg.12345","status":"processing","created":...}`

**`POST /v1/videos`**
入：`{"model":"minimax_h3","prompt":"...","size":"16:9","seconds":5, ...}`
→ 映射为 `scriptImgToVideo`（或首尾帧时 `scriptMutiImgToVideo`）：
```json
{"api":"minimax_h3","apiName":"MiniMax-H3-2K","text":"...",
 "images":[...],"videos":[...],"audios":[...],
 "ratio":"16:9","duration":5,"resolution":"1080p",
 "audio":false,"optimizedPrompt":false}
```
出：`{"id":"imgToVideo.67890","status":"processing",...}`

**`GET /v1/tasks/{id}`**
→ 解出 `operType`/`operId` → `getHistoryFilesByPage/{operType}` → 找到该项：
- 未完成：`{"id":...,"status":"processing"}`
- 成功：`{"id":...,"status":"succeeded","output":[{"url":"..."}]}`
- 失败：`{"id":...,"status":"failed","error":{"message":"<errorMsg>"}}`

### 3.4 OSC 侧配置

用 OSC 自带预设「Generic 异步轮询」改：
- 图片供应商：根地址=`http://127.0.0.1:8787`，路径=`/v1/images/generations`，
  轮询=`/v1/tasks/{taskId}`，成功值=`succeeded`，待定值=`processing`，
  Key=`账号:密码`
- 视频供应商：同上，路径=`/v1/videos`

## 4. 模块划分

```
mvaigc-proxy/
├── mvaigc_api.py       # 核心库：配置/鉴权/token 缓存/模型/上传/生成/轮询/下载
├── proxy_server.py     # HTTP 反代：路由、认证解析、字段映射、任务号编解码
├── mvaigc_cli.py       # 可选 CLI（便于脱离 OSC 测试）
└── config.example.json # 默认端口、超时、轮询间隔、落盘目录
```

每个模块单一职责：`mvaigc_api.py` 只负责"和 mvaigc 说话"，
`proxy_server.py` 只负责"把标准请求翻译成 mvaigc 调用，再把结果翻译回去"。

## 5. 错误处理

- 登录失败 → 返回 `401`，body 带站点 `message`
- mvaigc `code != 200` → 映射为对应 HTTP 状态 + `{"error":{"message":...}}`
- 401/103 → 清除缓存 token，重登一次，仍失败则返回 401
- 轮询超时（默认 180s）→ `{"status":"failed","error":{"message":"timeout"}}`
- 任务 `isComplete` 且 `errorMsg` 非空 → `failed` 并回传 `errorMsg`

## 6. 边界（明确不做 / 做不了）

| 能力 | 结论 | 原因 |
|---|---|---|
| 图片 | ✅ 做 | mvaigc 有接口，OSC 支持 |
| 视频 | ✅ 做 | 同上 |
| 音乐/音效 | ⛔ OSC 内不可用 | OSC 自定义供应商无 audio 类；反代可不做或仅供非 OSC 软件 |
| 文本对话 | ⛔ 不做 | mvaigc 无任何 chat/LLM 接口（全库检索确认） |

## 7. 测试

- 单元：任务号编解码、字段映射、`fileUrl` JSON 字符串解析（含转义）
- 集成（只读，不耗积分）：`/v1/models` 能拉回模型列表
- 端到端（**消耗积分，需用户同意后手动触发**）：
  提交一次生图/生视频 → 轮询 → 拿到直链

## 8. 安全与合规

- 账号密码仅本地内存/文件缓存，不上传第三方
- 反代不改 mvaigc 鉴权、不绕过任何校验，只是把"人手点页面"换成"程序发请求"
- 生成消耗账号积分，成本自负
- `config.json`（含账号）不纳入版本管理，仅提供 `config.example.json`

## 9. 待用户确认的取舍

1. 默认端口 `8787` 是否可接受？
2. 是否需要 CLI（便于测试），还是只要反代服务？
3. 音乐接口：锁定"不做"，还是顺手做进反代（仅非 OSC 软件可用）？
