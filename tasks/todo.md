# 任务清单 (tasks/todo.md)

## Phase 1: 文档规范骨架与目录整理

- [x] Task 1: 清理根目录重复 PDF 手册与个人缓存索引文件，精简 `.gitignore`
  - Verify: `git status -s` 无意外残留，根目录无重复手册
- [x] Task 2: 修复 `docs/development-guides/` 死链与旧项目名称残留，同步 `CONTRIBUTING.md` / `SECURITY.md` / `DEVLOG.md`
  - Verify: 核对相对路径链接有效，保留上游授权 Attribution
- [x] Task 3: 搭建 `AGENTS.md`、`CONSTRAINTS.md`、`CHANGELOG.md`、`docs/README.md` 与 PRD/Spec/ADR/Tasks 模板骨架
  - Verify: `npm run check:line-endings` 通过
- [x] Task 4: 补充 `.github/PULL_REQUEST_TEMPLATE.md` 与 `.github/ISSUE_TEMPLATE/`
  - Verify: `npm run check:line-endings` 通过

## Checkpoint: 规范骨架交付
- [x] 所有新建及修改的文档通过 LF 换行符校验
- [ ] 人工确认骨架结构，决定 Phase 2 首批补全哪几个模块的 PRD / Spec

---

## Phase 2: 核心模块 PRD / Spec 补全（已完成基线）

- [x] Task 5: 编写基线产品文档 [docs/prd/PRD-mvaigc-canvas-v2.md](../docs/prd/PRD-mvaigc-canvas-v2.md)
- [x] Task 6: 按依赖顺序补全 [SPEC-settings-i18n.md](../docs/specs/SPEC-settings-i18n.md) 与 [SPEC-persistence-portability.md](../docs/specs/SPEC-persistence-portability.md)
- [x] Task 7: 补全 [SPEC-ai-providers-proxy.md](../docs/specs/SPEC-ai-providers-proxy.md) 与 [SPEC-canvas-core.md](../docs/specs/SPEC-canvas-core.md)

## Phase 3: 扩展模块 Spec 与 ADR 补全（已完成基线）

- [x] Task 8: 补全 [SPEC-prompt-library.md](../docs/specs/SPEC-prompt-library.md)、[SPEC-director-previs.md](../docs/specs/SPEC-director-previs.md)、[SPEC-3dgs-supersplat.md](../docs/specs/SPEC-3dgs-supersplat.md)、[SPEC-canvas-agent-mcp.md](../docs/specs/SPEC-canvas-agent-mcp.md)
- [x] Task 9: 沉淀核心架构 ADR（[ADR-001](../docs/decisions/ADR-001-local-first-sqlite-persistence.md)、[ADR-002](../docs/decisions/ADR-002-embedded-axum-mvaigc-proxy.md)、[ADR-003](../docs/decisions/ADR-003-isolated-supersplat-3dgs-integration.md)）

