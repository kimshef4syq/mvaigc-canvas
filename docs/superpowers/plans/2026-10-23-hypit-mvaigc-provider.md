# Hypit ↔ mvaigc Provider 桥接 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Hypit 的图片/视频生成走画布那套 mvaigc 账号，产物落在 Hypit 工程里。

**Architecture:** 在画布仓库新增一个 Hypit Provider 包（`resources/hypit-provider-mvaigc/`），把 Hypit 已有的 Model 端口（`nano-banana-pro`、`minimax-h3`）映射到画布 mvaigc 反代（`:8787`）的 HTTP 协议上。包是纯翻译层：端口 → mvaigc 请求体、`start/poll/collect` 生命周期。凭据走 Hypit 官方凭据机制，不落自建文件。

**Tech Stack:** TypeScript（编译到 ESM）、`@hypit/hypit` endpoint SDK、`@hypit/generation` 映射工具、`node --test`（零额外依赖）。

**Spec:** `docs/superpowers/specs/2026-10-23-hypit-mvaigc-provider-design.md`

## Global Constraints

- 包源码放 `resources/hypit-provider-mvaigc/`（与 `resources/agent-adaptations/` 同级）。
- 依赖用**真实版本号**：`@hypit/hypit@0.3.1`、`@hypit/generation@0.1.0`、`@hypit/runtime-local@0.1.1`、`typescript@5.9.3`。**不用** `workspace:*`（范例用的是它，我们必须换掉）。
- 包名 `mvaigc-provider`；`package.json` 的 `hypit.activation` 指向 `./dist/activation.js`。
- 两个能力同包：图片 `@hypit/nano-banana@1#nano-banana-pro`，视频 `@hypit/minimax-h3@1#minimax-h3`。
- 凭据槽只有一个，值形如 **`<账号>:<密码>`**（反代要 `Bearer <账号>:<密码>`）。
- mvaigc 端点：`POST /v1/images/generations`、`POST /v1/videos` → `{id}`；`GET /v1/tasks/{id}` → `{status: processing|succeeded|failed, output[0].url, error.message}`。
- 分辨率：视频 `768P` → 模型 id `minimax_h3_768p`；`2K` → `minimax_h3`。**图片恒发 2K**。
- 首尾帧：`firstFrame`/`lastFrame` → `frames: true` + `reference_images: [首, 尾]`。
- `capabilities[].supports` 必须返回 `EndpointSupport` **对象**（`{status:"supported"}` / `{status:"unsupported",reason}`），不是布尔值。
- 不改 `@hypit/*` 官方包；不改画布 Rust 代码（反代修复已提交 `984e545`、`7d1c298`）。
- 提交流署名：`Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

- **mvaigc 报 `succeeded` 但 `output[0].url` 缺失** —— 服务契约违约，不是「还在跑」。用户期望**明确报错**，而不是静默卡住或产出空结果。任务 4 覆盖。
- **`failed` 任务的错误信息被吞掉** —— 用户排查的唯一线索是 mvaigc 的 `error.message`。期望它被带出来（URL 脱敏）。任务 4 覆盖。
- **Hypit 给了 `firstFrame` 同时给了 `referenceAudio`** —— mvaigc 的 frames 模式是否吃音频**未实测**。期望被**拒绝并说明理由**，而不是发出去静默失败。任务 2 覆盖。
- **未知分辨率档位**（如 `4K` 给了 minimax-h3）—— 期望被拒绝，而不是静默降级到某个默认档。任务 1 覆盖。
- **参考图以 data URL 交给反代** —— 反代支持 base64 data URL（`client.rs:26`），但若 resolver 返回别的形式（如裸字节或 `blob:`）会静默失败。任务 4 覆盖。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `resources/hypit-provider-mvaigc/package.json` | 包元数据、`hypit.activation`、build/test 脚本 |
| `resources/hypit-provider-mvaigc/tsconfig.json` | 编译到 `dist/`（ESM） |
| `resources/hypit-provider-mvaigc/src/provider.ts` | 端口→mvaigc 翻译 + `start/poll/collect` + `defineEndpoint` |
| `resources/hypit-provider-mvaigc/src/activation.ts` | `createRuntimeEndpointAdapterFacet`，读 config 造 endpoint |
| `resources/hypit-provider-mvaigc/test/*.test.mjs` | `node --test`，跑编译产物 |
| `resources/hypit-provider-mvaigc/README.md` | 手工安装步骤 + `hypit.runtime.json` 片段 |

**为什么测试是 `.mjs`**：范例包只有 `build` 脚本、没有测试。为不引入额外依赖，用 Node 内置 `node --test` 跑 `dist/` 的编译产物，测试脚本为 `npm run build && node --test test/`。

**为什么翻译逻辑抽成纯函数**：`buildVideoPayload` / `buildImagePayload` 不碰网络、不碰 Tauri，可直接单测。`createMvaigcProvider` 只做「取端口 → 调纯函数 → 发请求」，用注入的 `fetch` 测。

---

### Task 1: 包脚手架 + 视频载荷翻译

**Files:**
- Create: `resources/hypit-provider-mvaigc/package.json`
- Create: `resources/hypit-provider-mvaigc/tsconfig.json`
- Create: `resources/hypit-provider-mvaigc/src/provider.ts`
- Test: `resources/hypit-provider-mvaigc/test/video-payload.test.mjs`

**Interfaces:**
- Produces:
  - `export const providerModule = { name: "mvaigc-provider", version: "1" } as const`
  - `export const videoCapability = { module: { name: "@hypit/minimax-h3", version: "1" }, name: "minimax-h3" } as const`
  - `export function mvaigcVideoModelForTier(tier: string | undefined): string`（`"2K"` → `"minimax_h3"`，其余 → `"minimax_h3_768p"`）
  - `export interface MvaigcVideoPorts { prompt: string; durationSeconds: number; resolution?: string; aspectRatio?: string; referenceImages: string[]; referenceVideos: string[]; referenceAudioUrls: string[]; generateAudio: boolean; firstFrameUrl?: string; lastFrameUrl?: string }`
  - `export function buildVideoPayload(ports: MvaigcVideoPorts): { model: string; body: Record<string, unknown> }`

- [ ] **Step 1: 写失败测试**

`test/video-payload.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoPayload, mvaigcVideoModelForTier } from '../dist/provider.js';

const base = { prompt: '一只猫跑过', durationSeconds: 5, referenceImages: [],
  referenceVideos: [], referenceAudioUrls: [], generateAudio: false };

test('maps Hypit ports onto mvaigc field names', () => {
  const { body } = buildVideoPayload({ ...base, resolution: '768P', aspectRatio: '16:9',
    referenceImages: ['data:image/png;base64,AAA'],
    referenceVideos: ['data:video/mp4;base64,BBB'],
    referenceAudioUrls: ['data:audio/mpeg;base64,CCC'],
    generateAudio: true });
  assert.equal(body.prompt, '一只猫跑过');
  assert.equal(body.seconds, 5, 'duration must be renamed to seconds');
  assert.deepEqual(body.reference_images, ['data:image/png;base64,AAA']);
  assert.deepEqual(body.reference_videos, ['data:video/mp4;base64,BBB']);
  assert.deepEqual(body.reference_audios, ['data:audio/mpeg;base64,CCC']);
  assert.equal(body.audio, true);
  assert.equal(body.aspect_ratio, '16:9');
});

test('768P and 2K select different mvaigc model ids', () => {
  assert.equal(mvaigcVideoModelForTier('768P'), 'minimax_h3_768p');
  assert.equal(mvaigcVideoModelForTier('2K'), 'minimax_h3');
  assert.equal(mvaigcVideoModelForTier(undefined), 'minimax_h3_768p');
  assert.equal(buildVideoPayload({ ...base, resolution: '2K' }).model, 'minimax_h3');
  assert.equal(buildVideoPayload({ ...base, resolution: '768P' }).model, 'minimax_h3_768p');
});

test('an unknown resolution tier is refused rather than silently downgraded', () => {
  assert.throws(() => buildVideoPayload({ ...base, resolution: '4K' }), /resolution/i);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd resources/hypit-provider-mvaigc && npm run build && node --test test/`
Expected: 编译失败或模块不存在（`dist/provider.js` 无导出）

- [ ] **Step 3: 写 `package.json` 与 `tsconfig.json`**

`package.json`：

```json
{
  "name": "mvaigc-provider",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "hypit": { "activation": "./dist/activation.js" },
  "exports": { ".": "./dist/provider.js" },
  "files": ["dist"],
  "scripts": { "build": "tsc -p tsconfig.json", "test": "npm run build && node --test test/" },
  "devDependencies": {
    "@hypit/hypit": "0.3.1",
    "@hypit/runtime-local": "0.1.1",
    "typescript": "5.9.3"
  },
  "dependencies": { "@hypit/generation": "0.1.0" }
}
```

`tsconfig.json`：`target` ES2022、`module`/`moduleResolution` NodeNext、`strict` true、`declaration` true、`outDir` `dist`、`rootDir` `src`、`skipLibCheck` true、`include` `["src"]`。

- [ ] **Step 4: 实现翻译（`src/provider.ts` 第一批导出）**

`mvaigcVideoModelForTier`：`"2K"` → `"minimax_h3"`；`"768P"` 或 `undefined` → `"minimax_h3_768p"`；其它值抛错，消息含 `resolution` 与该值。

`buildVideoPayload` 产出 mvaigc 请求体，字段名照 spec §5.2：`prompt`、`seconds`、`aspect_ratio`、`reference_images`、`reference_videos`、`reference_audios`、`audio`；`model` 由 `mvaigcVideoModelForTier` 决定。首尾帧在任务 2 接上，本任务先不含。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd resources/hypit-provider-mvaigc && npm run test`
Expected: 3 passed

- [ ] **Step 6: 提交**

```bash
git add resources/hypit-provider-mvaigc
git commit -m "feat(hypit): add the mvaigc provider package with video payload translation"
```

---

### Task 2: 首尾帧翻译与不支持项拒绝

**Files:**
- Modify: `resources/hypit-provider-mvaigc/src/provider.ts`
- Test: `resources/hypit-provider-mvaigc/test/frames.test.mjs`

**Interfaces:**
- Consumes: 任务 1 的 `buildVideoPayload`、`MvaigcVideoPorts`
- Produces: `buildVideoPayload` 支持 `firstFrameUrl` / `lastFrameUrl`；新增 `export function assertSupportedVideoPorts(ports: MvaigcVideoPorts): void`

- [ ] **Step 1: 写失败测试**

`test/frames.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoPayload, assertSupportedVideoPorts } from '../dist/provider.js';

const base = { prompt: '动起来', durationSeconds: 5, referenceImages: [],
  referenceVideos: [], referenceAudioUrls: [], generateAudio: false };

test('first and last frame become frames mode with a two-item image array', () => {
  const { body } = buildVideoPayload({ ...base,
    firstFrameUrl: 'data:image/png;base64,FIRST',
    lastFrameUrl: 'data:image/png;base64,LAST' });
  assert.equal(body.frames, true);
  assert.deepEqual(body.reference_images, ['data:image/png;base64,FIRST', 'data:image/png;base64,LAST']);
});

test('a lone first frame still uses frames mode', () => {
  const { body } = buildVideoPayload({ ...base, firstFrameUrl: 'data:image/png;base64,FIRST' });
  assert.equal(body.frames, true);
  assert.deepEqual(body.reference_images, ['data:image/png;base64,FIRST']);
});

test('without frames the payload uses reference images and frames is false', () => {
  const { body } = buildVideoPayload({ ...base, referenceImages: ['data:image/png;base64,R'] });
  assert.equal(body.frames, false);
  assert.deepEqual(body.reference_images, ['data:image/png;base64,R']);
});

test('a first frame combined with reference audio is refused', () => {
  // mvaigc's frames mode accepting audio is unverified; refuse rather than
  // send a request that may silently drop the audio.
  assert.throws(() => assertSupportedVideoPorts({ ...base,
    firstFrameUrl: 'data:image/png;base64,FIRST',
    referenceAudioUrls: ['data:audio/mpeg;base64,CCC'] }), /frame.*audio|audio.*frame/i);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd resources/hypit-provider-mvaigc && npm run test`
Expected: FAIL，`assertSupportedVideoPorts` 未导出 / `body.frames` 为 undefined

- [ ] **Step 3: 实现**

`buildVideoPayload`：有 `firstFrameUrl` 或 `lastFrameUrl` 时 `frames: true`，`reference_images` 为 `[firstFrameUrl, lastFrameUrl].filter(Boolean)`；否则 `frames: false`，`reference_images` 取参考图数组。其余字段不变。

`assertSupportedVideoPorts`：有首尾帧且 `referenceAudioUrls` 非空 → 抛错，消息说明「mvaigc 的 frames 模式是否接受音频未验证」。`start()` 在发请求前调用它（任务 4 接线）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd resources/hypit-provider-mvaigc && npm run test`
Expected: 7 passed

- [ ] **Step 5: 提交**

```bash
git add resources/hypit-provider-mvaigc
git commit -m "feat(hypit): translate first/last frame ports into mvaigc frames mode"
```

---

### Task 3: 图片载荷翻译

**Files:**
- Modify: `resources/hypit-provider-mvaigc/src/provider.ts`
- Test: `resources/hypit-provider-mvaigc/test/image-payload.test.mjs`

**Interfaces:**
- Produces:
  - `export const imageCapability = { module: { name: "@hypit/nano-banana", version: "1" }, name: "nano-banana-pro" } as const`
  - `export interface MvaigcImagePorts { prompt: string; aspectRatio?: string; referenceImages: string[]; outputFormat?: string }`
  - `export function buildImagePayload(ports: MvaigcImagePorts): { model: string; body: Record<string, unknown> }`

- [ ] **Step 1: 写失败测试**

`test/image-payload.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImagePayload } from '../dist/provider.js';

test('maps image ports and always sends 2K', () => {
  const { model, body } = buildImagePayload({ prompt: '一只猫',
    aspectRatio: '16:9', referenceImages: ['data:image/png;base64,AAA'] });
  assert.equal(model, 'Nano-Banana-Pro');
  assert.equal(body.prompt, '一只猫');
  assert.equal(body.aspect_ratio, '16:9');
  assert.equal(body.resolution, '2K', 'image resolution is fixed at 2K');
  assert.deepEqual(body.reference_images, ['data:image/png;base64,AAA']);
});

test('outputFormat is refused rather than silently dropped', () => {
  // mvaigc has no outputFormat field; Hypit's rule is to refuse, not discard.
  assert.throws(() => buildImagePayload({ prompt: '猫', referenceImages: [], outputFormat: 'jpg' }),
    /outputFormat/i);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd resources/hypit-provider-mvaigc && npm run test`
Expected: FAIL，`buildImagePayload` 未导出

- [ ] **Step 3: 实现**

`buildImagePayload`：`model` 恒为 `"Nano-Banana-Pro"`（mvaigc 的图片模型 id，见 `mvaigcProviderAutoConfig.ts:11` 的注释）；`body` 含 `prompt`、`aspect_ratio`、`reference_images`、`resolution: "2K"`。`outputFormat` 出现即抛错，消息含 `outputFormat`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd resources/hypit-provider-mvaigc && npm run test`
Expected: 9 passed

- [ ] **Step 5: 提交**

```bash
git add resources/hypit-provider-mvaigc
git commit -m "feat(hypit): add the image payload translation with a fixed 2K resolution"
```

---

### Task 4: 端点生命周期（start / poll / collect）

**Files:**
- Modify: `resources/hypit-provider-mvaigc/src/provider.ts`
- Test: `resources/hypit-provider-mvaigc/test/endpoint.test.mjs`

**Interfaces:**
- Consumes: 任务 1–3 的 `buildVideoPayload`、`buildImagePayload`、`assertSupportedVideoPorts`、两个 capability
- Produces:
  - `export function createMvaigcProvider(options: { instance: string; pool: string; baseUrl: string; apiKey: CredentialRef; pollIntervalMs?: number; fetch?: typeof globalThis.fetch }): EndpointInstance`

- [ ] **Step 1: 写失败测试**

`test/endpoint.test.mjs`（用注入的假 `fetch` 与假 context）：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMvaigcProvider, videoCapability } from '../dist/provider.js';

function fakeContext(responses) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    return { ok: next.ok ?? true, status: next.status ?? 200,
      headers: new Map([['content-type', next.contentType ?? 'application/json']]),
      json: async () => next.json, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  return { calls, fetcher };
}

test('start checkpoints the mvaigc task id before returning', async () => {
  const { fetcher, calls } = fakeContext([{ json: { id: 'task-1', status: 'processing' } }]);
  const provider = createMvaigcProvider({ instance: 'i', pool: 'p',
    baseUrl: 'http://127.0.0.1:8787', apiKey: { store: 'local', key: 'k' }, fetch: fetcher });
  const endpoint = provider.capabilities.find((c) => c.capability.name === videoCapability.name).endpoint;
  let checkpointed;
  await endpoint.start({ need: { constraints: { ports: { prompt: ['一只猫'], duration: [5] } } },
    credentials: { apiKey: { secret: 'acct:pw' } },
    resources: { get: async () => undefined, put: async () => 'res_1' },
    checkpoint: async (value) => { checkpointed = value; } });
  assert.equal(checkpointed.handle.id, 'task-1');
  assert.match(calls[0].url, /\/v1\/videos$/);
  assert.equal(calls[0].init.headers.authorization, 'Bearer acct:pw');
});

test('poll reports pending, then ready with the output url', async () => {
  const { fetcher } = fakeContext([
    { json: { status: 'processing' } },
    { json: { status: 'succeeded', output: [{ url: 'https://cdn.example.com/a.mp4' }] } },
  ]);
  const provider = createMvaigcProvider({ instance: 'i', pool: 'p',
    baseUrl: 'http://127.0.0.1:8787', apiKey: { store: 'local', key: 'k' }, fetch: fetcher });
  const endpoint = provider.capabilities.find((c) => c.capability.name === videoCapability.name).endpoint;
  const credentials = { apiKey: { secret: 'acct:pw' } };
  const pending = await endpoint.poll({ handle: { id: 'task-1' }, credentials });
  assert.equal(pending.status, 'pending');
  const ready = await endpoint.poll({ handle: { id: 'task-1' }, credentials });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.handle.url, 'https://cdn.example.com/a.mp4');
});

test('a failed task surfaces the mvaigc error message', async () => {
  const { fetcher } = fakeContext([
    { json: { status: 'failed', error: { message: '上游拒绝了请求' } } },
  ]);
  const provider = createMvaigcProvider({ instance: 'i', pool: 'p',
    baseUrl: 'http://127.0.0.1:8787', apiKey: { store: 'local', key: 'k' }, fetch: fetcher });
  const endpoint = provider.capabilities.find((c) => c.capability.name === videoCapability.name).endpoint;
  const failed = await endpoint.poll({ handle: { id: 'task-1' }, credentials: { apiKey: { secret: 's' } } });
  assert.equal(failed.status, 'failed');
  assert.match(failed.failure.message, /上游拒绝了请求/);
});

test('succeeded without an output url fails loudly', async () => {
  const { fetcher } = fakeContext([{ json: { status: 'succeeded', output: [] } }]);
  const provider = createMvaigcProvider({ instance: 'i', pool: 'p',
    baseUrl: 'http://127.0.0.1:8787', apiKey: { store: 'local', key: 'k' }, fetch: fetcher });
  const endpoint = provider.capabilities.find((c) => c.capability.name === videoCapability.name).endpoint;
  await assert.rejects(() => endpoint.poll({ handle: { id: 'task-1' }, credentials: { apiKey: { secret: 's' } } }),
    /output/i);
});

test('reference media is sent as a base64 data URL the proxy can upload', async () => {
  // The proxy only uploads inline media it recognises as `data:<mime>;base64,...`
  // (mvaigc_proxy/client.rs:26); any other shape silently reaches mvaigc as a bogus URL.
  const { fetcher, calls } = fakeContext([{ json: { id: 'task-9', status: 'processing' } }]);
  const provider = createMvaigcProvider({ instance: 'i', pool: 'p',
    baseUrl: 'http://127.0.0.1:8787', apiKey: { store: 'local', key: 'k' }, fetch: fetcher });
  const endpoint = provider.capabilities.find((c) => c.capability.name === videoCapability.name).endpoint;
  await endpoint.start({
    need: { constraints: { ports: {
      prompt: ['动起来'], duration: [5],
      referenceImage: [{ artifact: 'res_9' }],
    } } },
    credentials: { apiKey: { secret: 'acct:pw' } },
    resources: { get: async () => ({ bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }),
      put: async () => 'res_1' },
    checkpoint: async () => {},
  });
  const body = JSON.parse(calls[0].init.body);
  assert.match(body.reference_images[0], /^data:image\/png;base64,/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd resources/hypit-provider-mvaigc && npm run test`
Expected: FAIL，`createMvaigcProvider` 未导出

- [ ] **Step 3: 实现 `createMvaigcProvider`**

`start`：读 `context.need.constraints.ports`；图片走 `buildImagePayload`，视频走 `assertSupportedVideoPorts` + `buildVideoPayload`。参考素材经 resolver 转 **base64 data URL**（`data:<mediaType>;base64,<...>`）—— 反代据此上传（`mvaigc_proxy/client.rs:26`）。POST 对应端点，取 `id`，`await context.checkpoint?.({ handle: { id }, receipt: { id } })`，再返回 `{ ...wakeAfter({ id }, interval), receipt: { id } }`。

`poll`：GET `/v1/tasks/{id}`；`processing` → `wakeAfter`；`failed` → `{ status: "failed", receipt: {id}, failure: { code: "MVAIGC_FAILED", message } }`，message 含 mvaigc 的 `error.message`（URL 脱敏）；`succeeded` 但 `output[0].url` 缺失 → 抛错，消息含 `output`；否则 → `{ status: "ready", handle: { id, url } }`。

`collect`：下载 url，按 `content-type` 校验前缀（视频 `video/`、图片 `image/`），`context.resources.put(...)`，返回 `sealGeneratedVideoSet` / `sealGeneratedImageSet` 包好的 inline 值。

`defineEndpoint`：`capabilities` 两项（图片 `generationTypes.imageSet`、视频 `generationTypes.videoSet`，均 `lifecycle: "asynchronous"`）；`supports` 返回 **`EndpointSupport` 对象**（用 `mappingSupportsRequest` 的布尔结果包一层）；不设 `readPricing`（mvaigc 无价格接口，不谎报）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd resources/hypit-provider-mvaigc && npm run test`
Expected: 14 passed

- [ ] **Step 5: 提交**

```bash
git add resources/hypit-provider-mvaigc
git commit -m "feat(hypit): implement the mvaigc endpoint lifecycle"
```

---

### Task 5: activation、运行时配置与安装说明

**Files:**
- Create: `resources/hypit-provider-mvaigc/src/activation.ts`
- Create: `resources/hypit-provider-mvaigc/README.md`
- Test: `resources/hypit-provider-mvaigc/test/activation.test.mjs`

**Interfaces:**
- Consumes: 任务 4 的 `createMvaigcProvider`、任务 1 的 `providerModule`
- Produces: `default export { format: "hypit.package@1", facets: [...] }`

- [ ] **Step 1: 写失败测试**

`test/activation.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import activation from '../dist/activation.js';
import { providerModule } from '../dist/provider.js';

test('activation exports one facet bound to the provider module name', () => {
  assert.equal(activation.format, 'hypit.package@1');
  assert.equal(activation.facets.length, 1);
  assert.equal(activation.facets[0].use, providerModule.name);
});

test('activation refuses a config missing baseUrl or apiKey', () => {
  const facet = activation.facets[0];
  assert.throws(() => facet.activate({ config: {}, instance: 'i', pool: 'p' }), /baseUrl|apiKey/i);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd resources/hypit-provider-mvaigc && npm run test`
Expected: FAIL，`dist/activation.js` 不存在

- [ ] **Step 3: 实现 `activation.ts`**

照范例 `provider-videos/src/activation.ts` 的形状：`createRuntimeEndpointAdapterFacet({ use: providerModule.name, activate })`，用 `runtimeConfigObject` / `runtimeConfigExact` / `runtimeConfigString` / `runtimeConfigCredentialRef` / `runtimeConfigPositiveInteger` 从 `@hypit/runtime-local/extension` 读取并校验 `baseUrl`、`apiKey`、可选 `pollIntervalMs`；缺 `baseUrl` / `apiKey` / `context.pool` 时抛错。凭据 label 写 **`mvaigc account:password`**。

- [ ] **Step 4: 写 `README.md`**

内容：手工安装四步（拷包进 Hypit 工程 → `npm install` → `npm run build` → `npm install ./packages/provider-mvaigc`）、要合并进 `hypit.runtime.json` 的片段（endpoint `mvaigc.local` + 两条 binding，见 spec §6.7）、`hypit auth login mvaigc.local` 填 `<账号>:<密码>`、以及 `hypit doctor` 应转为通过。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd resources/hypit-provider-mvaigc && npm run test`
Expected: 15 passed

- [ ] **Step 6: 提交**

```bash
git add resources/hypit-provider-mvaigc
git commit -m "feat(hypit): activate the mvaigc provider from runtime config"
```

---

## 端到端验收

在 `npm run test` 全绿、`hypit doctor` 通过的前提下，在画布建的 Hypit 工程目录里：

1. 装包并合并 `hypit.runtime.json`（见 `README.md`）
2. `hypit doctor` → 报凭据缺失（证明包被加载）→ `hypit auth login mvaigc.local` 填 `<账号>:<密码>` → `hypit doctor` 通过
3. `hypit plan` 能看到 `nano-banana-pro` 与 `minimax-h3` 两个能力
4. 让 claude 生成一张图 → 产物落进 Hypit 工程
5. 生成一段视频（minimax-h3 768P）→ 产物落进 Hypit 工程
6. 用 `assets_import` 把成品推回画布 → 画布出现对应节点

**未在本计划验证的两点**（spec §9 已记录）：参考图上传的 resolver 实际行为、mvaigc 的 frames 模式是否接受音频。前者在端到端第 4/5 步暴露，后者已按「拒绝」处理。
