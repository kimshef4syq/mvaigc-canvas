# ADR-002: 采用 Rust 内置 axum 服务实现 mvaigc-proxy 反代

## Status
Accepted

## Date
2026-11-12

## Context
为了降低用户接入融媒视界（mvaigc）全线图文与视频模型的配置门槛，应用需要提供一个本地 HTTP 反代层，将 OpenAI 兼容或统一请求格式转换为上游接口并管理登录态刷新。

## Decision
将 `mvaigc-proxy` 直接以 **Rust 原生内置 `axum` HTTP 服务** 的形式集成在 Tauri 后端中，随桌面应用启动自动监听本地端口（默认 `8787`，可在设置中配置），并通过 `mvaigc-proxy/mvaigc-cli.py` 提供脱离画布的纯标准库命令行测试工具。

## Alternatives Considered

### 方案 A：独立 Python / Node.js 外部子进程（Sidecar）
- **Pros**：脚本开发迭代快。
- **Cons**：跨平台（Windows / macOS）打包分发需附带运行时或处理杀软拦截、僵尸进程清理、端口冲突与跨进程鉴权同步问题，稳定性差。
- **Rejected**：分发体积大且运维脆弱。

## Consequences
- **正面影响**：零外部运行时依赖，随应用同生同灭；与 Rust 侧任务轮询、大请求体处理及日志脱敏共享同一进程内存空间。
- **代价与风险**：需要显式处理并发 token 重登竞态与端口占用提示。
- **后续约束**：所有代理错误与日志必须脱敏，不得泄露用户账号密码或鉴权 Token。

