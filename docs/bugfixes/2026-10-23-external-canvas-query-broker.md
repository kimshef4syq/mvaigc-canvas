# 外部画布查询与 broker 响应修复

## 代码中确认的问题

- 外部 canvas_command 的 input 原先是任意对象，未描述各子命令字段，Agent 容易漏传 canvas.query.scope。
- 查询按记录条数截断，未按字节预算控制，也没有总数和下一页信息。30 个节点的详细数据就可能达到数万字符。
- MCP 同时返回文本及 structuredContent，结果序列化后会放大。broker 服务端只接受 256 KiB + 16 KiB 的响应，超限直接返回错误并关闭 socket；客户端又使用 256 KiB 的通用 JSONL 限制。前端收到的是笼统的 broker closed，而不是查询超限原因。
- MCP ping 原先只检查 stdio 进程存活，没有实际访问 broker。元数据健康诊断也不能证明媒体文件存在或供应商鉴权有效。

这些是静态代码确认的缺陷；没有将特定历史请求的实际字节数当成已复现证据。

## 修改

- 外部工具 schema 按命令提供 input 字段。broker 对只读 canvas.query 补全缺失的 scope=graph、detail=summary、limit=20；明确传错的参数仍按原验证流程返回错误。
- canvas.query 增加 detail、offset、edgeOffset、fields。保留原有 value 结构，在 output.page 返回总数、返回条数、revision、hasMore 和 nextInput。调用方按 nextInput 继续读取；revision 变化时重新从首页读取，避免混合快照。
- 节点和连线共享 40 KiB 数据预算，每类最多 100 条。单节点详情过大时显式降级摘要并列出 detailsOmittedNodeIds，可用 fields 按需取详情。分页不会写入画布。
- broker 返回与客户端读取统一使用独立的 1 MiB 响应上限，为原有 256 KiB 业务结果的 MCP 双份表示留空间；请求和 Agent stdout 的原有上限不变。响应超限、参数过大、非法 JSON 返回明确错误码，不再无响应关连接。连接日志只记录错误码。
- MCP ping 实际检查 broker，诊断 health 明示检查范围，不把缺失图片、401 和画布查询状态混为一谈。

## 使用

重启更新后的桌面应用，再重新连接外部 Agent，让其重新获取工具 schema。查询示例：

```json
{"type":"canvas.query","input":{"scope":"graph","detail":"summary","limit":20}}
```

完整遍历应使用每次返回的 output.page.nextInput，直到 null。具体节点的提示词详情使用 detail=full、nodeIds 和 fields=["prompt"]。

图片原文件丢失需要恢复或重新关联原素材；供应商 401 需要修复对应账号/密钥。此次连接修复不会删除节点、替换原图或自动重新提交付费生成。

## 检查

执行 TypeScript 类型检查与 Rust cargo check --lib。未新增或运行测试，未对真实 Claude Code 会话做端到端验收。

## 后续 scope 错误定位

用户提供的失败参数为 scope="viewport"、detail="full"、limit=5。此次 scope 是明确传入的非法值，并非漏传；缺省补全不会改变它。保留原有四种 scope 的含义，拒绝将 viewport 静默改为 graph。

参数说明现已列出各 scope 的语义，并明确不支持 viewport。非法 scope 错误会显示安全的实际值、合法值，以及仅修正 scope 并保留其他查询参数的示例；不再要求用户为可纠正的参数错误重新连接或审批。
