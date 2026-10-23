# Hypit ↔ mvaigc Provider 桥接

日期：2026-10-23
状态：待实现

## 1. 问题

上一轮（`2026-10-23-canvas-hypit-bridge-design.md`）打通了**画布 ↔ Hypit 物料**：终端里的 claude 能读画布原图/视频/音频（`asset_read` 落盘返回路径）、把成品回写成画布节点（`assets_import`），并在应用数据目录建了 Hypit 视频工程。

但那条链有个缺口：**Hypit 出片时用的模型服务与画布无关**。画布里配的是 mvaigc（本地反代 → mvaigc.cn），而 Hypit 默认走 HypiHub（需要 Hypit 账号）。结果是用户在画布里已经有一份可用的 mvaigc 账号，却要在 Hypit 里再配一套。

本轮目标：**让 Hypit 用画布那套 mvaigc 出图出片。**

### 三个子项目的关系

| # | 内容 | 状态 |
|---|---|---|
| A | 画布的 provider 配置「出栈」，供 Hypit 读取 | **已完成，零代码** —— 见 §2 |
| B | 为 Hypit 写一个对接 mvaigc 的 Provider 包 | **本 spec** |
| C | 中间产物按阶段回写画布 | 待做（复用已有 `assets_import`） |

## 2. A 的结论（已核实，零代码）

原以为要把 provider 配置从浏览器 localStorage 搬到磁盘。探索后确认**通道早就存在**：

- `diagnostics { operation: "provider-config" }`（`agentDiagnostics.ts:569`）已返回 `baseUrl` / `endpointPath` / `modelIds` / `apiStyle` / `accessState`
- 该工具**已在**终端 claude 的连接范围内
- 实测这些值**穿过两层脱敏毫发无损**（TS 的 `ABSOLUTE_PATH` 与 Rust 的 `unix_path_regex` 都只匹配 `/Users`、`/home` 这类绝对路径，不碰 `http://127.0.0.1:8787`）
- `apiKey` 只回 `'configured'` / `'missing'`，凭据从不外流

**所以配置不搬、不复制，按需现读。** 用户已确认：「不要把一个 provider 配置搬来搬去，本来就有最好」。

## 3. 目标

在画布建的 Hypit 工程目录里放一个 Provider 包，把 Hypit 已有的 Model 端口映射到 mvaigc 的 HTTP 协议上：

- **图片**：`@hypit/nano-banana@1#nano-banana-pro`
- **视频**：`@hypit/minimax-h3@1#minimax-h3`（768p 档）

用户在 Hypit 侧 `hypit auth login` 填一次 mvaigc 的「账号:密码」，之后 Hypit 的生成就走画布那套 mvaigc 账号。

## 4. 非目标

- **不把凭据搬进任何我们自建的文件。** 密码走 Hypit 官方凭据机制（`credential-store-local`）。
- **不动态跟随画布的 provider 切换。** 用户已明确：静态复用 mvaigc 这一套，画布换 provider 时 Hypit 不自动跟着换。
- **不实现图片分辨率档位透传。** 图片固定 2K（用户已确认「图片总是 2k 没关系」）。
- 不做真实 ffmpeg 后期。
- 不改 Hypit 的 Model 包（`@hypit/minimax-h3` 等官方包只读参照）。
- 不做 `imports/` 垃圾回收。
- C（中间产物回写）不在本 spec 范围。

## 5. 已核实的事实（来自 spike 与源码，非推测）

### 5.1 Provider 包机制（spike 实测）

在 `/tmp` 用一个一次性最小 Provider 验证过，四点全部通过：

| # | 验证项 | 结果 |
|---|---|---|
| 1 | `npm install` 真实版本号 | ✅ `@hypit/hypit@0.3.1`、`@hypit/generation@0.1.0`、`typescript@5.9.3`，115 包 / 41 秒。范例的 `workspace:*` 换版本号可用 |
| 2 | `tsc` 编译 provider + activation | ✅ 通过 |
| 3 | Hypit 加载工程包 | ✅ 缺 `dist/activation.js` 时报 ENOENT（证明它读了 `package.json` 的 `hypit.activation`），补上后 `hypit runtime status` 成功 |
| 4 | binding 生效 | ✅ `hypit doctor` 报 `Endpoint mvaigc.local`，并回显包内写的凭据 label |

**一个必须记住的类型细节**：`capabilities[].supports` 必须返回 `EndpointSupport` 对象（`{status:"supported"}` 或 `{status:"unsupported",reason}`），**不是** `mappingSupportsRequest` 返回的布尔值 —— 需要显式适配。

**多能力单包可行**：`defineEndpoint` 的 `capabilities` 是数组，图片+视频可同包。

### 5.2 mvaigc 协议（来自画布源码，权威）

反代实现在 `src-tauri/src/commands/mvaigc_proxy/`。

**调用方 → 反代（`:8787`）**：

| 字段 | 说明 |
|---|---|
| `model` | mvaigc 模型 id |
| `prompt` | 提示词 |
| `size` / `aspect_ratio` | 比例，`aspect_ratio` 优先 |
| `seconds` | 时长（整数，默认 5） |
| `resolution` | 分辨率档位（本次已改为透传，见 §5.3） |
| `reference_images` / `image` | 参考图 |
| `reference_videos` / `videos` | 参考视频 |
| `reference_audios` / `audios` | 参考音频 |
| `audio` | 「生成音频」开关（本次已改为透传） |
| `frames: true` | 切到首尾帧模式 |

**端点与轮询**：

```
POST /v1/images/generations → { id, status }
POST /v1/videos             → { id, status }
GET  /v1/tasks/{id}         → { status: processing|succeeded|failed, output[0].url, error.message }
```

`frames: true` 时上游走 `scriptMutiImgToVideo`，否则 `scriptImgToVideo`。

**鉴权**：反代强制 `Authorization: Bearer <账号>:<密码>`。实测无凭据 → 401；带假凭据 → 502（说明鉴权通过、转发失败）。

### 5.3 本轮顺带修掉的反代缺陷（已提交）

`map_video_request` 有两处硬编码，导致 Hypit 侧无法诚实映射：

| 字段 | 原 | 现 |
|---|---|---|
| `resolution` | 写死 `"1080p"` | 读请求 `resolution` → 否则 `size` → 否则默认 **720p** |
| `audio` | 写死 `false` | 读请求 `audio`，没传才 `false` |

保护：`size` 含 `:` 或 `x` 时**不当作分辨率**（避免把 `16:9` 当档位发出）。

提交：`984e545`、`7d1c298`。Rust 162 测试通过。

**分辨率在画布里的来源是节点设置**（`request.extra_params.resolutionType`），provider 的 `defaultRequestParams` 只是兜底。

### 5.4 两边的档位名不一致（用户已裁定）

| | Hypit | 画布 / mvaigc |
|---|---|---|
| minimax-h3 分辨率 | `768P` / `2K` | 480p / 720p / 1080p |
| 对应模型 id | — | `minimax_h3_768p` / `minimax_h3` |

用户裁定：**「768 720 都是按 minimax_h3_768」** —— Hypit 的 `768P` 与画布的 720p 都映射到 mvaigc 的 `minimax_h3_768p`。

### 5.5 Hypit Model 端口表

**`@hypit/minimax-h3@1#minimax-h3`**：

```
prompt          文本 ≤7000，必填
duration        整数 4–15，必填
resolution      枚举 768P | 2K，可选
aspectRatio     枚举 21:9 16:9 4:3 1:1 3:4 9:16，可选
referenceImage  图片 ≤9
referenceVideo  视频 ≤3
referenceAudio  音频 ≤3
firstFrame      图片 ≤1
lastFrame       图片 ≤1
约束：firstFrame/lastFrame 与 referenceImage/referenceVideo/referenceAudio/aspectRatio 互斥；
      referenceAudio 必须配 referenceImage 或 referenceVideo；
      参考素材加权总数 ≤12
```

**`@hypit/nano-banana@1#nano-banana-pro`**：

```
prompt          文本 ≤10000，必填
images          图片 ≤8
aspectRatio     枚举（pro 档）
resolution      枚举 1K | 2K | 4K
outputFormat    枚举 png | jpg
```

## 6. 设计

### 6.1 包的位置

包源码放**画布仓库**：`resources/hypit-provider-mvaigc/`（与 `resources/agent-adaptations/` 同级，沿用既有 bundled 资源位置）。

安装是**手工一步**（用户已选）：把包目录拷进 Hypit 工程、`npm install`、`npm run build`、再 `npm install ./packages/...`。画布代码零改动。

理由：在 Rust 里跑 `npm install` 会引入新的失败面（网络、权限、npm 缺失），而手工一次的代价很小。等链路确认长期可用，再考虑自动化。

### 6.2 包结构

```
resources/hypit-provider-mvaigc/
├── package.json          name: mvaigc-provider, hypit.activation → ./dist/activation.js
├── tsconfig.json
└── src/
    ├── provider.ts       端口→mvaigc 映射 + start/poll/collect + 首尾帧翻译
    └── activation.ts     createRuntimeEndpointAdapterFacet
```

`devDependencies` 用真实版本（`@hypit/hypit@0.3.1`、`typescript@5.9.3`），`dependencies` 用 `@hypit/generation@0.1.0`。**不用** `workspace:*`。

### 6.3 两个能力

`defineEndpoint` 的 `capabilities` 数组放两项，共用一个 `baseUrl` 与一个凭据槽（同一个 mvaigc 账号）：

```ts
export const imageCapability = {
  module: { name: "@hypit/nano-banana", version: "1" }, name: "nano-banana-pro",
} as const;
export const videoCapability = {
  module: { name: "@hypit/minimax-h3", version: "1" }, name: "minimax-h3",
} as const;
```

### 6.4 视频映射

| Hypit 端口 | mvaigc 字段 | 处理 |
|---|---|---|
| `prompt` | `prompt` | 直传 |
| `duration` | `seconds` | 改名 |
| `resolution` | `resolution` + `model` | `768P` → 模型 id `minimax_h3_768p`；`2K` → `minimax_h3` |
| `aspectRatio` | `aspect_ratio` | 直传 |
| `referenceImage` | `reference_images` | 数组 |
| `referenceVideo` | `reference_videos` | 数组 |
| `referenceAudio` | `reference_audios` | 数组 |
| `generateAudio` | `audio` | 直传 |

**首尾帧需要自定义翻译**（声明式映射表达不了）：

Hypit 把首尾帧声明成两个独立端口；mvaigc 用「一个开关 + 一个数组」：

```
Hypit:  firstFrame(图A) + lastFrame(图B)
           ↓ 翻译
mvaigc: frames: true, reference_images: [图A, 图B]   （缺哪个就只放一个）
```

无首尾帧时 `frames: false`，`reference_images` 走参考图数组。Hypit 的约束表已保证这两种模式互斥，逻辑无歧义。

**分辨率与模型的联动**（此处是设计里唯一的非声明式点之一）：

mvaigc 用**模型 id** 区分档位（`minimax_h3_768p` vs `minimax_h3`），但 Hypit 的 `routes` **只能按端口是否出现来选模型**（`GenerationWireRoute = { model, whenPresent? }`，按端口名，**不能按值**）。`resolution` 无论 768P 还是 2K 都是同一个端口，所以声明式路由区分不了。

因此：**映射只声明一条路由**，档位→模型 id 的换算放在 `start()` 里做（Hypit 允许 Provider 写小的自定义 handler）：

```ts
const ports = (context.need.constraints as unknown as GenerationRequest).ports;
const tier = String(ports.resolution?.[0] ?? "768P");
const model = tier === "2K" ? "minimax_h3" : "minimax_h3_768p";
```

`compileWireRequest` 返回 `{ model, input }`，把 `model` 覆盖成上面算出的值再发出去。**不要**试图用 `routes[].when` —— 该字段不存在（自检时发现的原始设计错误）。

### 6.5 图片映射

| Hypit 端口 | mvaigc 字段 | 处理 |
|---|---|---|
| `prompt` | `prompt` | 直传 |
| `images` | `reference_images` | 数组 |
| `aspectRatio` | `aspect_ratio` | 直传 |
| `resolution` | — | **固定发 2K**（用户裁定） |
| `outputFormat` | — | **声明不支持** |

`outputFormat` 在 `supports` 里拒绝：mvaigc 不认这个字段，按 Hypit 的硬规矩「服务接不住的字段必须拒绝，绝不静默丢弃」。

### 6.6 生命周期

照 Hypit 的异步端点模型，与 mvaigc 的「提交 → 轮询 → 取回」天然对齐：

| 钩子 | 行为 |
|---|---|
| `start` | POST 对应端点 → 拿 `{id}`，**先 `checkpoint` 再返回**（断了也能对账） |
| `poll` | GET `/v1/tasks/{id}`；`processing` 继续等；`succeeded` 取 `output[0].url`；`failed` 抛错 |
| `collect` | 下载 URL → `context.resources.put(...)` → `sealGeneratedVideoSet` / `sealGeneratedImageSet` |
| `readPricing` | mvaigc 无价格接口 → 不谎报，留空 |

`failed` 必须把 mvaigc 的 `error.message` 带出来（脱敏 URL），不吞掉 —— 这是排查的唯一线索。

### 6.7 凭据

`hypit.runtime.json` 里：

```json
{
  "endpoints": {
    "mvaigc.local": {
      "use": "mvaigc-provider",
      "config": {
        "baseUrl": "http://127.0.0.1:8787",
        "apiKey": { "store": "local", "key": "mvaigc.local" }
      }
    }
  },
  "bindings": {
    "@hypit/nano-banana@1#nano-banana-pro": "mvaigc.local",
    "@hypit/minimax-h3@1#minimax-h3": "mvaigc.local"
  }
}
```

凭据槽存 **`<账号>:<密码>`**（反代要的形式），由 `hypit auth login mvaigc.local` 填一次。**密码不落任何自建文件。**

### 6.8 参考素材上传

Hypit 的参考图是资源引用，mvaigc 需要 URL 或 data URL。反代支持 data URL 内联（`upload_inline_media` 会解析并上传到 mvaigc）。所以 `compileWireRequest` 的 resolver 应把资源字节转成 data URL。

**这是 spike 未验证的一块**，实现时需先小步验证。

## 7. 验证

**单测（不需要网络）**

1. 视频映射：`duration`→`seconds` 改名；`resolution` 选对模型 id（768P→`minimax_h3_768p`，2K→`minimax_h3`）；三路参考素材进对字段；`generateAudio`→`audio`
2. 首尾帧翻译：`firstFrame`+`lastFrame` → `frames:true` 且 `reference_images=[首,尾]`；只有首帧 → 数组单元素；无首尾帧 → `frames:false` 且走参考图数组
3. 图片映射：`resolution` 恒为 2K；`outputFormat` 被拒绝（非静默丢弃）
4. 生命周期：`start` 会 checkpoint；`poll` 三态正确；`failed` 带出 mvaigc 的错误信息
5. `supports` 返回 `EndpointSupport` 对象而非布尔值

**集成（手工一次）**

1. 把包拷进 Hypit 工程、`npm install`、`npm run build`、`npm install ./packages/...`
2. `hypit.runtime.json` 合并 endpoint 与 binding
3. `hypit doctor` 报凭据缺失（证明包被加载）→ `hypit auth login mvaigc.local` 填账号密码
4. `hypit doctor` 转为通过
5. `hypit plan` 能看到这两个能力

**端到端**

1. 在 Hypit 工程里让 claude 生成一张图 → 产物落进 Hypit
2. 生成一段视频（minimax-h3 768p）→ 产物落进 Hypit
3. 用 `assets_import` 把成品推回画布 → 画布出现对应节点

## 8. 不做

- 不搬凭据、不动态跟随 provider 切换（§4）
- 不做图片分辨率档位透传（固定 2K）
- 不动 `@hypit/*` 官方 Model 包
- 不在画布代码里跑 `npm install`（安装手工一次）
- 不实现 C（中间产物回写）
- 不做 `imports/` 垃圾回收

## 9. 已知风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 参考图上传未验证 | `compileWireRequest` 的 resolver 怎么把图交给 mvaigc 没跑过 | 实现时先小步验证（§6.8） |
| 首尾帧 + 参考音频组合 | mvaigc 的 frames 模式是否接受音频未知 | **如实声明**：未验证前拒绝该组合并说明理由，不发出去静默失败 |
| mvaigc 档位字符串 | `768P` 是否被 mvaigc 接受未实测 | 用户已裁定映射到 `minimax_h3_768p`；若 mvaigc 拒收，届时按实际调整 |

（原「`GenerationWireRoute` 语法」风险已在设计阶段消除：查证 `@hypit/generation` 类型后确认 `routes` 只按端口存在与否选模型，故档位换算移到 `start()`，见 §6.4。）
