# Plugins — OpenCode 运行时插件

OpenCode 启动时通过 `directories2()` 扫描 `OPENCODE_CONFIG_DIR/plugins/` 加载本目录下的 plugin。

## 文件清单

| 文件 | 用途 |
|------|------|
| `session-header.ts` | 给 chat 请求注入 session、实际 agent、request/billing Group；仅用户消息触发的首个模型请求携带 `X-Source-Type` |

## 这里 NOT 包含

`.opencode-v2/contracts/` 的注入**不是**通过本目录的 plugin 完成的——contracts 由 desktop 主进程的 `app/packages/service/src/opencode/electron-main/config-loader.ts` 中的 `setupAgentStaging` 函数，在启动 OpenCode 子进程之前拼接到 staging dir 下的 agent .md 文件，再通过 `OPENCODE_CONFIG_DIR` 让 OpenCode 走 D2 merge 右胜加载。

详见 `.opencode-v2/contracts/README.md` 的 "How injection works"。

## 修改约束

- 修改 plugin 文件后 **必须重启 OpenCode 子进程** 才生效（dev 下重跑 `pnpm dev`）
- plugin 是 OpenCode 公开 API，签名见 `@opencode-ai/plugin` 包
- 写副作用要谨慎——chat hot path 上的逻辑过重会拖慢每个 turn
