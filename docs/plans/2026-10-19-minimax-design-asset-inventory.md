# MiniMax Design 资产盘点（2026-10-19）

交接文档称有 202 篇资产；当前可取得的分类源和基线仓库实际包含 **193 个 Markdown 文件**。本次迁入保留了全部 193 个文件，未补造缺少的 9 篇。

`src/generated/profiles-manifest.json` 有 193 条记录，与 `resources/agent-profiles/` 的 Markdown 文件逐项对应。记录 ID 无重复，路径无越界，文件无缺失或漏索引。

| 分类 | 文件数 |
| --- | ---: |
| Agents | 7 |
| Vendors | 26 |
| DramaSeries | 10 |
| AdTVC | 52 |
| MV | 10 |
| GeneralVideo | 60 |
| KOC | 4 |
| SharedPipelines | 5 |
| Failures | 13 |
| Contracts | 6 |

源目录实际有 10 个顶级分类目录；交接文档所述的 12 类及 202 篇数量均与文件系统不一致。后续代码以已索引资产为准。
