# 外部 Agent 连接分级审批

## 使用

在“接入其他 Agent”的“连接权限”选择：

- 分析模式（新连接默认）：读取自动通过，其他操作被拒绝。
- 协作模式：读取自动通过，其他操作沿用逐项审批。
- 全部手动：每次调用都需要审批。

已有连接以及缺少权限字段的旧持久化记录仍使用全部手动。切换权限不需要重新配置 Claude Code 或 Codex 的 MCP。面板展示最近十次自动读取。

## 权限边界

应用维护允许清单，按工具及实际子操作分类，不信任客户端的 readOnlyHint、requiresApproval 或自动模式声明。当前自动读取范围：

- canvas_command：canvas.query、asset.list、generation.status。
- asset_read：当前画布目录中存在的图片。
- profile_search、profile_read、source_read、source_inspect；来源文档额外检查所属项目。
- production_plan：get、list。
- diagnostics：已列出的 health、provider-config、generation-jobs、application-logs、preflight、classify-error、bundle-preview。

导航、修改、生成、配置修改和未知操作均不属于自动读取。分析模式拒绝它们；协作模式要求确认。制作阶段的现有确认保护保持生效。

调用继续经过审批记录、参数指纹、执行回执及幂等执行链路。自动执行和手动批准的外部调用在执行前重新检查连接、到期时间、项目和最新模式。权限切换会重新评估等待中的调用。应用代管会话保持原有流程。

## 图片读取

外部 asset_read 原先直接报错。本次增加 MCP JPEG 图片预览，最长边初始 1280 像素，必要时缩小至 base64 不超过 180,000 字符，以遵守现有 256 KiB 结果限制。原文件不变。图片内容只经临时 IPC/MCP 返回，执行回执和活动记录仅保存元数据；后端校验编码、大小和 JPEG 文件头后输出 MCP image 内容块。

## 检查记录

已完成 TypeScript 无输出类型检查及 Rust cargo check --lib。未新增或运行测试，未进行真实 Claude Code/Codex 连接的端到端操作验收。
