# MiniMax Design 资产盘点（2026-10-19）

交接文档称有 202 篇资产。最初迁入时分类源和基线仓库只有 193 个 Markdown 文件；2026-10-19 更新后，源目录与 manifest 已补齐到 **202 个文件**。新增 9 个文件，原有 193 个文件内容没有变化。

`src/generated/profiles-manifest.json` 有 202 条记录，与 `resources/agent-profiles/` 的 Markdown 文件逐项对应。记录 ID 和路径无重复，路径无越界，文件无缺失或漏索引，`sizeBytes` 与生成脚本使用的文本长度一致。运行 `npm run profiles:verify` 可重复核对。

| 分类 | 文件数 |
| --- | ---: |
| Agents | 7 |
| Vendors | 27 |
| DramaSeries | 10 |
| AdTVC | 52 |
| MV | 10 |
| GeneralVideo | 61 |
| KOC | 4 |
| SharedPipelines | 8 |
| Failures | 15 |
| Contracts | 8 |

源目录实际有 10 个顶级分类目录；交接文档所述的 12 类仍与目录结构不一致。Failures 的 15 个文件中包含 13 个规则文件和 2 个 README。后续代码以已索引资产为准。
