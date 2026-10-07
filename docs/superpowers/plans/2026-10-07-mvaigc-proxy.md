# mvaigc 接入 OSC（原生内置反代）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 OSC 用户在设置里只填 mvaigc 的账号+密码，即可在画布内使用 mvaigc 的图片与视频生成。

**Architecture:** 在 OSC 的 Rust 后端内置一个 axum HTTP 服务（`127.0.0.1:8787`），随应用启动；它把标准化的 `/v1/*` 请求翻译成 mvaigc 私有 API（登录 → 提交 → 轮询）。前端新增一个设置面板收集账号密码，保存后自动注册「图片」「视频」两个 OSC 自定义供应商指向该本地服务。

**Tech Stack:** Rust（axum, tokio, reqwest, serde）；React + TypeScript + Zustand；零依赖 Python（CLI）。

**Spec:** `docs/superpowers/specs/2026-10-07-mvaigc-proxy-design.md`

## Global Constraints

- 反代仅监听 `127.0.0.1`，端口默认 `8787`（可配）。
- 认证头：`Authorization: Bearer <account>:<password>`。
- mvaigc 请求头：`X-User-Token: <token>`（**非** Bearer）。
- 任务号格式固定：`<operType>.<operId>`（`operType` 不含 `.`）。
- 账号密码仅内存/本地设置持久化，不落第三方。
- 音乐、文本对话**不做**。
- 不改动 OSC 现有生成主流程；仅新增模块与设置面板。
- Rust 新增依赖仅 `axum`（含 `tokio` 已有）。

## Review Focus

- **mvaigc 返回 `code != 200` 但 HTTP 200**：反代必须按 `code` 判失败并回传 `message`，否则 OSC 会把错误当成功。
- **`fileUrl` 是 JSON 字符串（含转义）**：必须解析字符串再取数组首项，不能当普通 URL 直接用。
- **`operType` 用错**：轮询必须用提交接口返回的 `operType`，不能猜。
- **token 过期（code 401/103）**：必须自动重登一次，否则长任务中途失败。
- **端口被占用**：反代启动失败不得阻塞 OSC 启动。
- **`isComplete` 为真但 `errorMsg` 非空**：必须判失败，不能返回空结果。

---

### Task 1: mvaigc 客户端 — 登录与模型列表

**Files:**
- Create: `src-tauri/src/commands/mvaigc_proxy/mod.rs`
- Create: `src-tauri/src/commands/mvaigc_proxy/types.rs`
- Create: `src-tauri/src/commands/mvaigc_proxy/client.rs`
- Modify: `src-tauri/src/commands/mod.rs`（注册 `pub mod mvaigc_proxy;`）
- Test: 同文件 `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: 无
- Produces:
  - `pub struct MvaigcClient { base: String, http: reqwest::Client, tokens: Mutex<HashMap<String, CachedToken>> }`
  - `pub struct CachedToken { pub token: String, pub user_id: String }`
  - `impl MvaigcClient { pub fn new() -> Self; pub async fn login(&self, account: &str, password: &str) -> Result<CachedToken, AIError>; pub async fn ensure_token(&self, account: &str, password: &str) -> Result<String, AIError>; pub async fn list_image_models(&self, token: &str) -> Result<serde_json::Value, AIError>; pub async fn list_video_models(&self, token: &str, scene: &str) -> Result<serde_json::Value, AIError>; }`

- [ ] **Step 1: 写失败测试（信封解析 + token 缓存）**

在 `client.rs` 末尾：
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn envelope_rejects_non_200_code() {
        let body = serde_json::json!({"code":401,"message":"未授权","data":null});
        let err = parse_envelope(body).unwrap_err();
        assert!(err.contains("401") && err.contains("未授权"));
    }
    #[test]
    fn envelope_returns_data_on_200() {
        let body = serde_json::json!({"code":200,"message":"成功","data":{"token":"T","userId":"U"}});
        assert_eq!(parse_envelope(body).unwrap()["token"], "T");
    }
}
```
说明：`parse_envelope(v: serde_json::Value) -> Result<serde_json::Value, String>` 是自由函数，返回 `data`，`code!=200` 时返回 `"<code>: <message>"`。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test mvaigc_proxy::client::tests -- --nocapture`
Expected: 编译失败（`parse_envelope` 未定义）

- [ ] **Step 3: 实现 client.rs**

实现要点（签名见 Interfaces）：
- `parse_envelope`：读 `code`（number 或 string），非 200 则 `Err(format!("{code}: {message}"))`，否则 `Ok(data)`。
- `login`：`POST {base}/ma/v1/user/login`，JSON body `{"account","password"}`；解析 envelope → `CachedToken{token, user_id}`；写入 `tokens`。
- `ensure_token`：命中缓存则返回；否则 `login`。
- `list_image_models`：`GET /ma/v1/imgPlatform/getImgModel`，头 `X-User-Token`。
- `list_video_models`：`GET /ma/v1/videoPlatform/getVideoApi?type={scene}`。
- `base` 默认 `https://www.mvaigc.cn`。
- 复用 OSC 既有 `crate::ai::error::AIError`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src-tauri && cargo test mvaigc_proxy::client::tests`
Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/mvaigc_proxy src-tauri/src/commands/mod.rs
git commit -m "feat(mvaigc-proxy): 客户端登录与模型列表"
```

---

### Task 2: mvaigc 客户端 — 提交与轮询

**Files:**
- Modify: `src-tauri/src/commands/mvaigc_proxy/client.rs`
- Test: 同文件 `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: `MvaigcClient`, `ensure_token`（Task 1）
- Produces:
  - `pub async fn submit_image(&self, token: &str, payload: serde_json::Value) -> Result<SubmitResult, AIError>`
  - `pub async fn submit_video(&self, token: &str, payload: serde_json::Value, frames: bool) -> Result<SubmitResult, AIError>`
  - `pub async fn poll_task(&self, token: &str, oper_type: &str, oper_id: &str) -> Result<TaskState, AIError>`
  - `pub struct SubmitResult { pub oper_type: String, pub oper_id: String }`
  - `pub enum TaskState { Running, Succeeded(Vec<String>), Failed(String) }`

- [ ] **Step 1: 写失败测试（fileUrl JSON 字符串解析 + 任务状态判定）**

```rust
#[test]
fn file_url_json_string_is_parsed() {
    let raw = "[\"https://static.mvaigc.cn/aigc_images/a.png\"]";
    assert_eq!(parse_file_urls(raw), vec!["https://static.mvaigc.cn/aigc_images/a.png"]);
}
#[test]
fn completed_with_error_is_failed() {
    let item = serde_json::json!({"isComplete":true,"errorMsg":"超时","fileUrl":"[]"});
    assert!(matches!(judge_item(&item), TaskState::Failed(_)));
}
#[test]
fn running_item_is_running() {
    let item = serde_json::json!({"isComplete":false,"errorMsg":null,"fileUrl":"[]"});
    assert!(matches!(judge_item(&item), TaskState::Running));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test mvaigc_proxy::client::tests`
Expected: 编译失败（`parse_file_urls` / `judge_item` 未定义）

- [ ] **Step 3: 实现**

- `parse_file_urls(raw: &str) -> Vec<String>`：`serde_json::from_str::<Vec<String>>(raw)`；失败则返回 `vec![raw]`（容错非 JSON）。
- `judge_item(item: &Value) -> TaskState`：`isComplete != true` → `Running`；`errorMsg` 非空 → `Failed(errorMsg)`；否则取 `fileUrl`（或 `fileUrlList`）→ `parse_file_urls` → `Succeeded(urls)`。
- `submit_image`：`POST /ma/v1/imgPlatform/imgToImage`；从 `data.operId`（或 `operIds[0]`）取 id；`oper_type = "imageImg"`。
- `submit_video`：`frames==false` → `POST /ma/v1/filmStoryboard/scriptImgToVideo`；`frames==true` → `POST /ma/v1/filmStoryboard/scriptMutiImgToVideo`；从 `data.operType`/`data.operId` 取（缺 `operType` 时报错，**不猜**）。
- `poll_task`：`GET /ma/v1/fileTransfer/getHistoryFilesByPage/{oper_type}?pageNum=1&pageSize=50`；在 `data.list[]` 找 `operId == oper_id` 的项；找到即 `judge_item`；未找到 → `Running`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src-tauri && cargo test mvaigc_proxy::client::tests`
Expected: PASS（5 passed）

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/mvaigc_proxy/client.rs
git commit -m "feat(mvaigc-proxy): 提交与轮询"
```

---

### Task 3: 反代 HTTP 服务 — 路由与字段映射

**Files:**
- Modify: `src-tauri/src/commands/mvaigc_proxy/mod.rs`
- Create: `src-tauri/src/commands/mvaigc_proxy/mapping.rs`
- Test: `mapping.rs` 内 `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: `MvaigcClient`（Task 1/2）
- Produces:
  - `pub fn encode_task_id(oper_type: &str, oper_id: &str) -> String` → `"{oper_type}.{oper_id}"`
  - `pub fn decode_task_id(id: &str) -> Option<(String, String)>`
  - `pub fn map_image_request(openai: &Value, model_name: &str) -> Value`
  - `pub fn map_video_request(openai: &Value, api_name: &str) -> Value`
  - `pub async fn run_proxy(port: u16, state: ProxyState)`
  - `pub struct ProxyState { client: MvaigcClient, credentials: RwLock<Option<(String,String)>> }`

- [ ] **Step 1: 写失败测试（任务号编解码 + 图片映射）**

```rust
#[test]
fn task_id_roundtrip() {
    let id = encode_task_id("imgToImage", "67890");
    assert_eq!(id, "imgToImage.67890");
    assert_eq!(decode_task_id(&id), Some(("imgToImage".into(), "67890".into())));
}
#[test]
fn image_request_maps_openai_shape() {
    let openai = serde_json::json!({"model":"gpt_image2","prompt":"猫","size":"16:9","n":2});
    let out = map_image_request(&openai, "GPT-Image-2");
    assert_eq!(out["model"], "gpt_image2");
    assert_eq!(out["modelName"], "GPT-Image-2");
    assert_eq!(out["text"], "猫");
    assert_eq!(out["imgRatio"], "16:9");
    assert_eq!(out["imgCount"], 2);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test mvaigc_proxy::mapping::tests`
Expected: 编译失败

- [ ] **Step 3: 实现 mapping.rs 与 mod.rs 路由**

- 编解码：`split_once('.')`；`operType` 不含 `.`。
- `map_image_request`：`{model, modelName, text: prompt, resolution: size 或 "2K", imgRatio: size 或 "1:1", imgCount: n 或 1, images: 来自 image 字段}`。
- `map_video_request`：`{api: model, apiName, text: prompt, ratio: size 或 "16:9", duration: seconds 或 5, resolution: "1080p", audio:false, optimizedPrompt:false, images/videos/audios: []}`。
- 路由（axum）：
  - `GET /v1/models` → 聚合 `list_image_models` + `list_video_models("reference2video")` → `{"object":"list","data":[{"id","object":"model","owned_by":"mvaigc"}]}`
  - `POST /v1/images/generations` → 提交 → `{"id": encode_task_id("imageImg", oper_id), "status":"processing"}`
  - `POST /v1/videos` → 提交 → `{"id": encode_task_id(oper_type, oper_id), "status":"processing"}`
  - `GET /v1/tasks/{id}` → decode → `poll_task` → `{"id","status":"processing|succeeded|failed","output":[{"url"}],"error":{"message"}}`
- 认证中间件：解析 `Authorization: Bearer <acct>:<pwd>`；缺失则用 `ProxyState.credentials`。
- token 失效（`code` 401/103）→ 清缓存 → 重登一次 → 重试一次。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src-tauri && cargo test mvaigc_proxy::mapping::tests`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/mvaigc_proxy
git commit -m "feat(mvaigc-proxy): HTTP 服务与字段映射"
```

---

### Task 4: 随 OSC 启动 + 凭证命令

**Files:**
- Modify: `src-tauri/src/commands/mvaigc_proxy/mod.rs`
- Modify: `src-tauri/src/lib.rs`（setup 钩子内启动；`invoke_handler` 注册命令）
- Modify: `src-tauri/Cargo.toml`（加 `axum`）

**Interfaces:**
- Consumes: `run_proxy`, `ProxyState`（Task 3）
- Produces:
  - Tauri 命令 `mvaigc_set_credentials(account: String, password: String, port: u16) -> Result<String, String>`
  - Tauri 命令 `mvaigc_proxy_status() -> Result<String, String>`（返回 `"running:<port>"` 或 `"stopped"`）

- [ ] **Step 1: 写失败测试（端口占用不 panic）**

```rust
#[test]
fn occupied_port_does_not_panic() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    // 第二次绑定同端口应返回 Err 而不是 panic
    assert!(bind_check(port).is_err());
}
```
说明：`bind_check(port) -> Result<(), String>` 是自由函数，内部 `TcpListener::bind` 并立即释放。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test mvaigc_proxy::tests::occupied_port`
Expected: 编译失败

- [ ] **Step 3: 实现启动与命令**

- `bind_check`：`std::net::TcpListener::bind(("127.0.0.1", port)).map(|_| ())`，Err 转 String。
- `lib.rs` setup：读设置里的端口（默认 8787）；`bind_check` 失败则 `warn!` 并跳过（**不返回 Err**）；成功则 `tokio::spawn(run_proxy(port, state))`。
- 命令 `mvaigc_set_credentials`：写 `ProxyState.credentials`；若端口变化则重启服务；返回 `"ok"`。
- 命令 `mvaigc_proxy_status`：返回当前状态字符串。
- `Cargo.toml` 加 `axum = "0.7"`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src-tauri && cargo test mvaigc_proxy`
Expected: PASS（全部）

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/mvaigc_proxy src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(mvaigc-proxy): 随应用启动与凭证命令"
```

---

### Task 5: 设置面板 — 账号/密码/端口

**Files:**
- Create: `src/components/settings/MvaigcSection.tsx`
- Modify: `src/stores/settingsStore.ts`（新增 `mvaigcAccount/mvaigcPassword/mvaigcPort` + setter）
- Modify: `src/features/settings/settingsEvents.ts`（`SettingsCategory` 加 `'mvaigc'`）
- Modify: `src/components/SettingsDialog.tsx`（侧栏加分类 + 渲染 `<MvaigcSection />`）
- Test: `src/components/settings/MvaigcSection.test.tsx`

**Interfaces:**
- Consumes: Tauri 命令 `mvaigc_set_credentials`（Task 4）
- Produces: 组件 `MvaigcSection`；store 字段 `mvaigcAccount: string`、`mvaigcPassword: string`、`mvaigcPort: number`、`setMvaigcCredentials(account, password, port)`

- [ ] **Step 1: 写失败测试（保存触发命令 + 校验）**

```tsx
it('保存时调用 mvaigc_set_credentials 并带账号密码端口', async () => {
  render(<MvaigcSection />);
  await userEvent.type(screen.getByLabelText('账号'), 'user');
  await userEvent.type(screen.getByLabelText('密码'), 'pass');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(mockInvoke).toHaveBeenCalledWith('mvaigc_set_credentials', {
    account: 'user', password: 'pass', port: 8787,
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/settings/MvaigcSection.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

- `settingsStore`：加三个字段（默认 `''`, `''`, `8787`）+ setter，纳入 persist。
- `MvaigcSection`：三个输入（账号 / 密码 / 端口，端口默认 8787），一个「保存」按钮 → 调 `setMvaigcCredentials` + `invoke('mvaigc_set_credentials', ...)`；保存后触发 Task 6 的自动配置。
- `SettingsCategory` 加 `'mvaigc'`；`SettingsDialog` 侧栏加一项「mvaigc」并渲染组件。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/components/settings/MvaigcSection.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/settings/MvaigcSection.tsx src/components/settings/MvaigcSection.test.tsx src/stores/settingsStore.ts src/features/settings/settingsEvents.ts src/components/SettingsDialog.tsx
git commit -m "feat(settings): mvaigc 账号密码设置面板"
```

---

### Task 6: 自动配置两个自定义供应商

**Files:**
- Create: `src/features/canvas/application/mvaigcProviderAutoConfig.ts`
- Test: `src/features/canvas/application/mvaigcProviderAutoConfig.test.ts`
- Modify: `src/components/settings/MvaigcSection.tsx`（保存后调用）

**Interfaces:**
- Consumes: `useCustomProvidersStore.addProvider/updateProvider`；`CustomProviderConfig`
- Produces:
  - `buildMvaigcProviders(port: number, credentials: string): CustomProviderConfig[]`（返回 [图片, 视频] 两个）
  - `applyMvaigcProviders(port, credentials): void`（存在则更新、不存在则新增）

- [ ] **Step 1: 写失败测试（产出的供应商字段正确）**

```ts
it('图片供应商使用 asyncTask 指向本地反代', () => {
  const [image] = buildMvaigcProviders(8787, 'user:pass');
  expect(image.mediaType).toBe('image');
  expect(image.baseUrl).toBe('http://127.0.0.1:8787');
  expect(image.endpointPath).toBe('/v1/images/generations');
  expect((image.extraParams as any).asyncTask.resultEndpointPath).toBe('/v1/tasks/{taskId}');
  expect((image.extraParams as any).asyncTask.successValues).toContain('succeeded');
});
it('视频供应商使用 video* 轮询字段', () => {
  const [, video] = buildMvaigcProviders(8787, 'user:pass');
  expect(video.mediaType).toBe('video');
  expect(video.endpointPath).toBe('/v1/videos');
  expect((video.extraParams as any).videoStatusEndpointPath).toBe('/v1/tasks/{taskId}');
  expect((video.extraParams as any).videoSuccessValues).toContain('succeeded');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/features/canvas/application/mvaigcProviderAutoConfig.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`buildMvaigcProviders` 产出：
- 图片：`{id:'mvaigc-image', label:'mvaigc 图片', mediaType:'image', baseUrl:'http://127.0.0.1:<port>', endpointPath:'/v1/images/generations', modelListEndpointPath:'/v1/models', httpMethod:'POST', apiKey:credentials, apiStyle:'generic-json', responseFormat:'generic', models:[...], extraParams:{ asyncTask:{ enabled:true, taskIdPath:'id', resultEndpointPath:'/v1/tasks/{taskId}', resultMethod:'GET', imagePath:'output[0].url', statusPath:'status', pendingValues:['processing'], successValues:['succeeded'], failedValues:['failed'], errorPath:'error.message', intervalMs:2000, timeoutMs:180000 } } }`
- 视频：`{id:'mvaigc-video', label:'mvaigc 视频', mediaType:'video', baseUrl:..., endpointPath:'/v1/videos', modelListEndpointPath:'/v1/models', apiKey:credentials, apiStyle:'generic-json', responseFormat:'generic', extraParams:{ videoTaskIdPath:'id', videoStatusEndpointPath:'/v1/tasks/{taskId}', videoStatusPath:'status', videoPendingValues:['processing'], videoSuccessValues:['succeeded'], videoFailedValues:['failed'], responseVideoPath:'output[0].url', videoErrorPath:'error.message', videoPollIntervalMs:2000, videoPollTimeoutMs:180000 } }`

`applyMvaigcProviders`：按固定 id 查已有 → `updateProvider` 或 `addProvider`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/features/canvas/application/mvaigcProviderAutoConfig.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/features/canvas/application/mvaigcProviderAutoConfig.ts src/features/canvas/application/mvaigcProviderAutoConfig.test.ts src/components/settings/MvaigcSection.tsx
git commit -m "feat(mvaigc): 保存后自动注册图片/视频供应商"
```

---

### Task 7: CLI 测试脚本

**Files:**
- Create: `mvaigc-proxy/mvaigc-cli.py`
- Create: `mvaigc-proxy/README.md`

**Interfaces:**
- Consumes: 反代 HTTP 接口（Task 3）
- Produces: 命令 `python3 mvaigc-proxy/mvaigc-cli.py models|image|video|status`

- [ ] **Step 1: 写脚本（零依赖，仅 urllib）**

子命令：
- `models` → `GET /v1/models`
- `image --prompt P [--model M]` → `POST /v1/images/generations` 后轮询 `/v1/tasks/{id}`
- `video --prompt P [--model M] [--seconds N]` → `POST /v1/videos` 后轮询
- `status <id>` → `GET /v1/tasks/{id}`

参数：`--base`（默认 `http://127.0.0.1:8787`）、`--auth`（默认读环境变量 `MVAIGC_AUTH`，即 `账号:密码`）。

- [ ] **Step 2: 手工验证（只读，不耗积分）**

Run: `MVAIGC_AUTH='<账号>:<密码>' python3 mvaigc-proxy/mvaigc-cli.py models`
Expected: 打印出模型列表（图片 + 视频）

- [ ] **Step 3: 提交**

```bash
git add mvaigc-proxy
git commit -m "feat(mvaigc-proxy): CLI 测试脚本与说明"
```

---

### Task 8: 端到端验证（消耗积分，需用户同意）

**Files:** 无（验证任务）

- [ ] **Step 1: 启动 OSC，确认反代就绪**

Run: `npm run tauri dev`
Expected: 日志出现 mvaigc 反代监听 `127.0.0.1:8787`（或端口占用 warning）

- [ ] **Step 2: 设置面板填账号密码并保存**

在 OSC 设置 →「mvaigc」填 `账号` / `密码`，保存。
Expected: 「我的配置」出现「mvaigc 图片」「mvaigc 视频」两个供应商

- [ ] **Step 3（需用户确认，耗积分）: 生成一张图片**

在画布发起一次生图。
Expected: 轮询后画布出现图片

- [ ] **Step 4（需用户确认，耗积分）: 生成一段视频**

Expected: 轮询后画布出现视频

- [ ] **Step 5: 记录结果**

如实报告：哪些通过、哪些失败、失败的具体报错。

---

## Self-Review

**Spec 覆盖**：3.2 接口→Task 3；3.3 映射→Task 3；3.4 自动启动→Task 4；3.5 账号密码面板→Task 5；3.6 端口→Task 4/5；4 模块→Task 1-6；7 测试→各任务 + Task 8；CLI→Task 7。音乐/文本明确不做。✅

**类型一致**：`encode_task_id/decode_task_id`（Task 3 定义，Task 3/6 使用）；`asyncTask` 字段名与 OSC `generic_async_poll` 预设一致；视频 `video*` 字段与 `customProviderGateway.ts` 一致。✅

**Review Focus 对应测试**：信封非 200→Task 1；fileUrl JSON→Task 2；operType 不猜→Task 2；token 过期→Task 3；端口占用→Task 4；isComplete+errorMsg→Task 2。✅
