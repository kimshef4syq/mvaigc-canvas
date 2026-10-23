# mvaigc Provider for Hypit

让 Hypit 的图片/视频生成走画布那套 mvaigc 账号（本地反代 → mvaigc.cn）。

- **图片**：`@hypit/nano-banana@1#nano-banana-pro`（分辨率固定 2K）
- **视频**：`@hypit/minimax-h3@1#minimax-h3`（`768P` / `2K`）

## 前置

画布的 mvaigc 反代必须在跑（画布设置里填过账号密码即可）。验证：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/v1/models
# 401 = 反代在跑且要鉴权（正常）
```

## 安装（手工四步）

在**画布建的 Hypit 工程目录**里操作（`<app_data_dir>/hypit-projects/<slug>/`）：

```bash
# 1. 把这个包拷进工程的 packages/
mkdir -p packages
cp -R <画布仓库>/resources/hypit-provider-mvaigc packages/

# 2. 装依赖并编译
cd packages/hypit-provider-mvaigc
npm install
npm run build

# 3. 装进工程
cd ../..
npm install ./packages/hypit-provider-mvaigc
```

## 配置

把下面两个片段**合并**进工程的 `hypit.runtime.json`（不要整体替换，保留已有服务）：

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

`baseUrl` 必须是你反代的实际地址；若在画布里改过端口，这里同步改。

## 填凭据

反代强制 `Authorization: Bearer <账号>:<密码>`，所以凭据值是**账号和密码用冒号连起来**：

```bash
hypit auth login mvaigc.local
# 提示时输入：<mvaigc 账号>:<mvaigc 密码>
```

密码存在 Hypit 自己的凭据库里（`credential-store-local`），**不落任何本项目自建的文件**。

## 验证

```bash
hypit doctor                      # 应无 RUNTIME_CREDENTIAL_MISSING
hypit plan <run-source>           # 应能解析到这两个能力
```

`doctor` 若仍报凭据缺失，说明包没被加载 —— 检查 `packages/` 是否装好、`dist/` 是否已编译。

## 成品回写画布

Hypit 出的片默认落在 Hypit 工程里，**不会自动出现在画布上**。回写是**你确认后**的动作，不由 Hypit 自动做 —— 因为它是写操作，会新建画布节点，且需要审批。

### 流程

1. **Hypit 出片并导出成品**（例如 `hypit get <build-id> --output cat.image --to ./assets/cat.png`）
2. **Agent 提示你**：出片完成时应当告诉你「成品已就绪，说『推回画布』我就把它推上去」
3. **你说「推回画布」** → Agent 调 `assets_import`

中间产物同理：按**阶段**（而不是逐个文件）批量推，你确认后一次推一批。

### `assets_import` 的调用形状

```json
{
  "files": [
    { "path": "/绝对路径/assets/cat.png",  "kind": "image", "title": "橘猫窗台" },
    { "path": "/绝对路径/assets/cat.mp4",  "kind": "video", "title": "橘猫窗台 · 动" }
  ],
  "anchor": { "nodeId": "可选：落位锚点节点 id" }
}
```

- `path` **必须是绝对路径**；相对路径会被拒绝
- `kind` 可省略 —— 省略时按扩展名推断（png/jpg→image，mp4/mov→video，mp3/wav→audio）；推断不出则拒绝
- `title` 可省略
- 数量 **1–16 个**
- 单文件上限：图片 **64 MiB**、视频/音频 **512 MiB**
- `anchor` 可省略：给了就落在该节点附近，否则落在画布已有内容右侧
- 路径必须指向**普通文件** —— 目录、符号链接、FIFO 一律拒绝，且拒绝时**不会产生任何节点或文件**

### 类型对照

| 成品 | `kind` | 落到画布 |
|---|---|---|
| 图片 | `image` | 上传节点（含 `imageUrl` + 预览图 + 宽高比） |
| 视频 | `video` | 视频节点（含 `localVideoUrl` + 缩略图 + 时长） |
| 音频 | `audio` | 音频节点（含 `localAudioUrl` + 时长） |

### 权限

`assets_import` **不是只读工具**：

- `collaboration` 模式 → 需要你在画布上确认
- `analysis` 模式 → **被拒绝**

### 前置

连接里必须含 `assets_import`。升级后旧连接没有它，**需在画布面板重建一次连接**（连接参数是持久化契约）。

## 已知限制

- **图片分辨率固定 2K**：画布从未把图片档位告诉反代（它发的是像素尺寸，反代自行解析成 2K），所以这里无法透传 1K/4K。
- **首尾帧不能与参考音频同时使用**：mvaigc 的 frames 模式是否接受音频未经验证，因此该组合会被**拒绝并说明理由**，而不是发出去静默丢音频。
- **输出格式由 mvaigc 决定**：`outputFormat` 是 nano-banana 的必填端口，所以它被接受但**不会转发**（mvaigc 没有该字段，会忽略未知字段）。作者选的 png/jpg 不生效，输出格式由 mvaigc 定；出图本身是正确的。
