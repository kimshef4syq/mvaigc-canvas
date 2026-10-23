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

## 已知限制

- **图片分辨率固定 2K**：画布从未把图片档位告诉反代（它发的是像素尺寸，反代自行解析成 2K），所以这里无法透传 1K/4K。
- **首尾帧不能与参考音频同时使用**：mvaigc 的 frames 模式是否接受音频未经验证，因此该组合会被**拒绝并说明理由**，而不是发出去静默丢音频。
- **不支持 `outputFormat`**：mvaigc 没有这个字段，请求会被拒绝而非静默忽略。
