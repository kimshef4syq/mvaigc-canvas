# codebase-memory-mcp 分析库位置与索引概况

本文整理自用户提供的信息，未重新查库核验。记录日期：2026-10-13。

## 落盘位置

分析结果没有存放在项目目录，全部位于用户缓存目录：

```text
/Users/spic007/.cache/codebase-memory-mcp/
├── Users-spic007-Downloads-07-e9a1b9e79baee69687e4bbb6-000OD-mvaigc-canvas.db
├── Users-spic007-orca-workspaces-mvaigc-canvas-agent-create.db
├── _config.db
└── logs/
```

| 文件或目录 | 用途 |
| --- | --- |
| `Users-spic007-Downloads-07-e9a1b9e79baee69687e4bbb6-000OD-mvaigc-canvas.db` | 本项目分析库，约 60 MB |
| `Users-spic007-orca-workspaces-mvaigc-canvas-agent-create.db` | 另一个工作副本的分析库，约 54 MB |
| `_config.db` | daemon 配置 |
| `logs/` | daemon 日志与每次索引的历史日志 |

每个项目对应一个 SQLite 数据库。主要表包括：

- `nodes`、`edges`：代码图谱。
- `nodes_fts*`：全文检索。
- `node_vectors`、`token_vectors`：语义向量。
- `file_hashes`：文件哈希。
- `index_coverage*`：索引覆盖记录。
- `projects`、`project_summaries`：项目信息与摘要。

## 本项目已分析内容

项目路径：`/Users/spic007/Downloads/07-项目文件/000OD/mvaigc-canvas`。

| 项目 | 值 |
| --- | --- |
| 索引时间 | 2026-10-13 06:53 UTC |
| 图谱规模 | 13,168 个节点 / 40,519 条边 |
| 语义向量 | `node_vectors` 4,365 / `token_vectors` 3,627 |
| 文件哈希 | 586 |
| 索引模式 | `full`（含语义），覆盖记录为 `complete` |
| 语言分布 | TypeScript 460 / Rust 41 / CSS 3 / JS 2 / YAML 2 / HTML 1 / Python 1 / TOML 1 |
| 按设计未索引 | 84 个文件，包括 `.git`、`dist`、`docs/plans`、`.superpowers/sdd/*`、图标等 |

### 解析告警

以下 4 个测试文件有 tree-sitter 局部解析报错，文件已索引，但个别行内的符号可能缺失：

- `useExternalAgentApprovals.test.tsx`
- `generationRecovery.test.ts`
- `customProviderGateway.test.ts`
- `minimaxH3Gateway.test.ts`

## 查看方法

### 只读查询 SQLite

列出本项目数据库的表：

```sh
sqlite3 -readonly '/Users/spic007/.cache/codebase-memory-mcp/Users-spic007-Downloads-07-e9a1b9e79baee69687e4bbb6-000OD-mvaigc-canvas.db' '.tables'
```

### 图形界面

daemon 在记录时已运行，访问地址：<http://127.0.0.1:9749/>，当时返回 HTTP 200。

### 配置与刷新

```sh
codebase-memory-mcp config list
```

记录时 `auto_index=false`，索引刷新依靠 watcher 或手动调用 `index_repository`。

## 另一个已分析的工作副本

| 项目 | 值 |
| --- | --- |
| 路径 | `/Users/spic007/orca/workspaces/mvaigc-canvas/agent-create` |
| 分支 | `kimshef4syq/agent-create` |
| 节点数 | 13,091 |
| 数据库 | `/Users/spic007/.cache/codebase-memory-mcp/Users-spic007-orca-workspaces-mvaigc-canvas-agent-create.db` |

该工作副本与当前项目使用独立数据库，查询时应选择对应的分析库。

## 后续使用原则

优先利用本项目索引定位代码，再核对当前源码。索引时间之后的改动，以及上述测试文件可能缺失的符号，均以当前源码为准。
