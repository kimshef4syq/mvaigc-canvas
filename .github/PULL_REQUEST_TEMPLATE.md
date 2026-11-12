## 变更摘要

<!-- 简述本次 PR 解决的问题或新增的能力 -->

## 关联文档

- 关联 PRD：`docs/prd/...`（如适用）
- 关联 Spec：`docs/specs/...`（如适用）
- 关联 ADR：`docs/decisions/...`（如适用）

## 变更类型

- [ ] 新功能（Feature）
- [ ] 问题修复（Bugfix）
- [ ] 文档 / 规范（Docs）
- [ ] 重构 / 性能优化（Refactor / Perf）

## 质量自检清单

- [ ] 已运行 `npm run check:line-endings`（LF 换行符检查通过）
- [ ] 已运行 `npx tsc --noEmit`（TypeScript 类型检查通过）
- [ ] 已运行 `npm test`（前端单元测试通过）
- [ ] 已运行 `npm run build`（前端构建通过）
- [ ] 若修改 `src-tauri/**`，已运行 `cargo fmt --check` 与 `cargo check`
- [ ] 若新增用户可见文案，已同步 `src/i18n/zh.json` 与 `en.json`
- [ ] 确认未包含真实 API Key、Token、本地 `.db` 或个人敏感路径

