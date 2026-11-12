# 工程质量红线契约 (CONSTRAINTS.md)

本文件定义 `mvaigc-canvas` 不可妥协的工程质量底线，任何人类提交或 AI Agent 变更均不得静默降低以下标准。

## 1. 静态检查与构建门禁

| 维度 | 强制命令 | 通过标准 |
|---|---|---|
| **换行符规范** | `npm run check:line-endings` | 退出码为 0，所有跟踪文件使用 LF |
| **类型安全** | `npx tsc --noEmit` | 0 TypeScript 编译错误 |
| **前端测试** | `npm test` | Vitest 全量通过，无新增 `.skip` / `.only` |
| **前端构建** | `npm run build` | `tsc && vite build`（含 prebuild）成功完成 |
| **Rust 格式** | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 格式化检查通过（修改 Rust 时必跑） |
| **Rust 编译与测试** | `cargo check` / `cargo test`（`--manifest-path src-tauri/Cargo.toml`） | 无编译错误，单元测试全量通过（修改 Rust 时必跑） |

## 2. 禁止降级行为（Anti-Bypass）

1. **禁止静默屏蔽错误**：不得为了通过检查而随意添加 `@ts-ignore`、`@ts-expect-error`、`eslint-disable` 或 `#[allow(dead_code)]` 掩盖真实缺陷（确需使用必须附带简短原因注释）。
2. **禁止削弱测试**：不得通过删除失败用例、跳过测试（`it.skip` / `#[ignore]`）或放宽断言来换取 CI 变绿。
3. **禁止半成品占位**：合并到 `main` 的代码不得包含 `TODO: implement`、空桩实现或调试用的 `console.log` 残留。
4. **计费安全底线**：AI 生成请求在提交结果未知或网络超时时，禁止自动重发可能产生重复计费的请求。

## 3. 数据与国际化一致性

- **持久化兼容**：任何涉及 SQLite 项目数据的字段变更，必须具备向后兼容或自动迁移逻辑，防止旧工程打不开。
- **i18n 双语同步**：`src/i18n/` 中英文键名必须保持对齐，禁止在业务组件中硬编码面向用户的界面文案。

