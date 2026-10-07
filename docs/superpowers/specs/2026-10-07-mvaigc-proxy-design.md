# mvaigc 接入 OSC 设计文档（原生内置反代）

日期：2026-10-07
状态：待评审
形态：**Rust 原生内置**（随 OSC 启动自动运行），不做独立 App

## 1. 目标

让 OSC（Open Storyboard Canvas）能够直接使用 www.mvaigc.cn 的**图片**与**视频**
生成能力，方式为：

- 反代以 **Rust 模块内置于 OSC**，OSC 启动时自动在本地端口运行，**无需单独启动任何程序**；
- 用户在 OSC 的「自定义供应商 → 添加」里新增**图片 / 视频**两个配置，地址填本地端口，
  API Key 填 **`账号:密码`**；
- 反代用该账号登录 mvaigc、提交任务、轮询结果，**扣该账号积分**；
- 附带一个 **CLI**，用于脱离画布手工测试。

**成功标准**：OSC 内新增图片 / 视频两个自定义供应商后，能从画布正常发起生成并取回结果。

## 2. 背景事实（均已实测确认，2026-10-07）

### 2.1 mvaigc.cn 是自研接口，非 OpenAI 兼容

站点为 Vue3 + Vite SPA，后端 Spring Boot。**不存在** `/v1/chat/completions`
等 OpenAI 标准端点。业务在 `/ma/v1/*` 下，统一信封
`{"code":200,"message":"成功","data":...}`，`code != 200` 为失败。

### 2.2 鉴权

- `POST /ma/v1/user/login`，body `{"account","password"}` → `data.token`(JWT)、`data.userId`
- 后续请求带请求头 **`X-User-Token: <token>`**（非标准 Bearer）
- token 失效返回 `code` 401 或 103 → 需重新登录
- 无请求签名 / 时间戳 / 加密 body

### 2.3 能力接口

| 能力 | 接口 | 返回/备注 |
|---|---|---|
| 图像模型列表 | `GET /ma/v1/imgPlatform/getImgModel` | `data.model{}`，含 `name/model_name/resolution/aspectRatio/limits` |
| 生图 | `POST /ma/v1/imgPlatform/imgToImage` | `data.operId` / `data.operIds`；轮询 `operType=imageImg` |
| 视频模型列表 | `GET /ma/v1/videoPlatform/getVideoApi?type=reference2video` | `type` 另可取 `start-end2video` |
| 生视频（全能参考） | `POST /ma/v1/filmStoryboard/scriptImgToVideo` | `data.operId/historyId/operType` |
| 生视频（首尾帧） | `POST /ma/v1/filmStoryboard/scriptMutiImgToVideo` | 用 `timeStamp:0/-1` 标记首尾帧 |
| 结果轮询 | `GET /ma/v1/fileTransfer/getHistoryFilesByPage/{operType}?pageNum=&pageSize=` | 见 2.4 |
| 上传（三段式） | `POST getUploadUrl` → `PUT` → `POST getDownloadUrl` | 走 OSS |

### 2.4 结果查询（HTTP 轮询，非 WebSocket）

`GET .../getHistoryFilesByPage/{operType}?pageNum=1&pageSize=N` → `data.list[]`，每项：
- `operId`：任务号（与提交返回对应）
- `isComplete`：是否完成
- `fileUrl`：**JSON 字符串**，形如 `"[\"https://static.mvaigc.cn/aigc_images/xxx.png\"]"`
- `errorMsg`：失败原因

判定：`isComplete===true` 且 `errorMsg` 空 → 成功，取 `fileUrl` 数组；
`isComplete===true` 且 `errorMsg` 非空 → 失败。
（站点另有 WebSocket 推送，但**本方案不依赖**。）

### 2.5 OSC 侧关键机制（决定接入方式）

- 图片生成：Rust 原生供应商（`src-tauri/src/ai/providers/*`，`AIProvider` trait）。
- 视频生成：TS 侧（`src/features/canvas/infrastructure/customProviderGateway.ts`）。
- **两者都支持「自定义供应商」**（声明式 HTTP + `asyncTask` 轮询），
  见 `src/stores/customProvidersStore.ts` 的 `CUSTOM_PROVIDER_PRESETS`。
- `asyncTask.resultEndpointPath` 只支持 **`{taskId}` 单参数**、**不能带查询串**
  → 反代必须提供「路径即定位单任务」的轮询端点。
- OSC 启动钩子 `src-tauri/src/lib.rs` 的 `.setup(...)` **已有自动拉起本地服务先例**
  （`external_agent` broker，监听 `127.0.0.1`）。这是反代自动启动的挂载点。
- OSC 自定义供应商类型只有 `image / video / chat`，**无 audio 类**。

## 3. 方案

### 3.1 形态

在 OSC 的 Rust 后端新增一个 **mvaigc 反代模块**，OSC 启动时在
`127.0.0.1:8787`（可改）上启动一个本地 HTTP 服务，对外暴露标准化接口。
OSC 通过**既有自定义供应商机制**消费它；不改动 OSC 现有的生成主流程。

反代**无状态**：不持久化账号或任务；账号来自每个请求的头，任务状态在 mvaigc 侧。

### 3.2 对外接口

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/v1/models` | 返回图片+视频模型列表（OpenAI `/models` 形状） |
| `POST` | `/v1/images/generations` | 提交生图 → `{id,status}` |
| `POST` | `/v1/videos` | 提交生视频 → `{id,status}` |
| `GET` | `/v1/tasks/{id}` | 查任务状态/结果 |

**认证**：请求头 `Authorization: Bearer <account>:<password>`。
反代解析出账号密码 → 登录 mvaigc（token 内存缓存 + 过期时间）→ 带 `X-User-Token`。
命中 401/103 自动重登一次。

**任务号**：提交成功后把 mvaigc 的 `operType`/`operId` 编码为
**`<operType>.<operId>`**（如 `imgToImage.67890`）。`operType` 不含 `.`，分隔安全。
`/v1/tasks/{id}` 据此定位，规避 OSC 单参数限制，且反代重启后仍可查历史任务。

### 3.3 字段映射

**`GET /v1/models`** ← 聚合 `getImgModel` + `getVideoApi`：
```json
{"object":"list","data":[{"id":"gpt_image2","object":"model","owned_by":"mvaigc"}]}
```

**`POST /v1/images/generations`**（入，OpenAI Images 风格）
```json
{"model":"gpt_image2","prompt":"...","size":"1024x1024","n":1,"image":["<url|data-url>"]}
```
→ mvaigc `imgToImage`：`{model, modelName, text, resolution, imgRatio, imgCount, images:[{url,name}]}`
出：`{"id":"imageImg.12345","status":"processing","created":...}`

**`POST /v1/videos`**（入）`{"model":"minimax_h3","prompt":"...","size":"16:9","seconds":5,...}`
→ `scriptImgToVideo`（首尾帧时 `scriptMutiImgToVideo`）：
`{api, apiName, text, images:[], videos:[], audios:[], ratio, duration, resolution, audio, optimizedPrompt}`
出：`{"id":"imgToVideo.67890","status":"processing"}`

**`GET /v1/tasks/{id}`** → 解出 `operType/operId` → `getHistoryFilesByPage/{operType}` → 匹配：
- 未完成：`{"id":...,"status":"processing"}`
- 成功：`{"id":...,"status":"succeeded","output":[{"url":"..."}]}`
- 失败：`{"id":...,"status":"failed","error":{"message":"<errorMsg>"}}`

### 3.4 随 OSC 自动启动

在 `src-tauri/src/lib.rs` 的 `.setup(...)` 中，与 `external_agent` broker 并列，
启动 mvaigc 反代服务。绑定 `127.0.0.1:<port>`（默认 8787，见 3.6）。
端口被占则记 warning 并跳过（不阻塞 OSC 启动）。

### 3.5 用户只填「账号 + 密码」（一键自动配置）

新增一个 **OSC 设置面板「mvaigc」**（与「音频模型」「供应商」并列的分类）。
面板只有两项必填：

- **账号**
- **密码**

保存后，OSC **自动完成**其余全部配置，用户无需接触「添加供应商」表单：

1. 反代服务按当前端口启动/重载；
2. 自动注册（或更新）**图片**与**视频**两个自定义供应商：
   - 图片：根地址 `http://127.0.0.1:<port>`，路径 `/v1/images/generations`，
     轮询 `/v1/tasks/{taskId}`，成功值 `succeeded`、待定值 `processing`、失败值 `failed`
   - 视频：同上，路径换 `/v1/videos`
   - 两个供应商的 Key 自动填 `账号:密码`

账号与密码持久化于设置（与既有 `apiKeys` 同级），仅存本地。

### 3.6 端口

默认 `8787`，在 mvaigc 面板中以**可选输入框**暴露，用户想改就改（如遇占用）。
改动后 OSC 自动更新上述两个供应商配置。地址/路径/Key 均由 OSC 自动填，
用户平时无需关心端口。

> 反代从 OSC 应用状态读取账号密码（进程内），故自定义供应商的 Key 头可留空；
> 保留 `账号:密码` 头是为了让 CLI（独立进程）与「连通性测试」也能工作。

## 4. 模块划分

```
src-tauri/src/commands/mvaigc_proxy/
├── mod.rs        # 反代 HTTP 服务：路由、认证解析、字段映射、任务号编解码
├── client.rs     # mvaigc 客户端：登录 / token 缓存 / 模型 / 提交 / 轮询 / 上传
└── types.rs      # 请求/响应 DTO

src/components/settings/MvaigcSection.tsx   # 设置面板：账号 + 密码 (+ 端口)
src/stores/settingsStore.ts                 # 新增 mvaigc 账号/密码/端口 持久化
src/components/SettingsDialog.tsx           # 挂载新的 mvaigc 分类
```

CLI（脱离画布测试，零依赖 Python 脚本）：
```
mvaigc-canvas/mvaigc-proxy/mvaigc-cli.py   # 打本地端口：models / image / video / status
```

单一职责：`client.rs` 只负责"和 mvaigc 说话"；`mod.rs` 只负责"翻译"；
`MvaigcSection.tsx` 只负责收集账号密码并触发自动配置。

**HTTP 服务实现**：OSC 现有依赖无 HTTP server（无 axum/hyper）。新增 `axum`
（与 tokio 同源）。

## 5. 错误处理

- 登录失败 → `401` + `{"error":{"message":...}}`
- mvaigc `code != 200` → 映射 HTTP 状态 + `error.message`
- 401/103 → 清缓存 token 重登一次，仍失败返回 401
- 轮询超时（默认 180s）→ `{"status":"failed","error":{"message":"timeout"}}`
- 任务 `isComplete` 且 `errorMsg` 非空 → `failed` 并回传 `errorMsg`

## 6. 边界（明确不做）

| 能力 | 结论 | 原因 |
|---|---|---|
| 图片 | ✅ 做 | mvaigc 有接口，OSC 支持 |
| 视频 | ✅ 做 | 同上 |
| 音乐/音效 | ⛔ 不做 | OSC 自定义供应商无 audio 类，接了也用不上（用户确认不做） |
| 文本对话 | ⛔ 不做 | mvaigc 无任何 chat/LLM 接口 |

## 7. 测试

- 单元（Rust）：任务号编解码、字段映射、`fileUrl` JSON 字符串解析（含转义）
- 集成（只读，不耗积分）：`GET /v1/models` 能拉回模型列表
- CLI：`mvaigc-cli.py models` 同上；`image` / `video` 需用户同意后手动触发（**耗积分**）

## 8. 安全与合规

- 账号密码只随请求头进入，仅内存缓存 token，不落盘、不上传第三方
- 反代不改 mvaigc 鉴权、不绕过校验，只是把"人手点页面"换成"程序发请求"
- 生成消耗账号积分，成本自负
- 内置服务仅监听 `127.0.0.1`，不对外网开放

## 9. 已定决策

1. **HTTP 服务依赖**：采用 `axum`。理由：与 OSC 现有 `tokio`（full）同源、
   样板最少、生态成熟；`tiny_http` 虽更小但需手工线程管理。
2. **端口**：默认 `8787`，可在 mvaigc 面板修改。若被占用则记 warning 跳过，
   不阻塞 OSC 启动。
3. **用户输入面**：仅「账号 + 密码」（端口可选）。地址/路径/轮询规则/Key
   由 OSC 自动配置，用户不接触「添加供应商」表单。
