# mvaigc-canvas 文档中心导航

本目录集中管理 `mvaigc-canvas` 的产品需求、技术规格、架构决策、开发指南与用户手册。

## 1. PRD 与 Spec 导向开发文档（工程核心）

| 目录 / 文件 | 用途 | 维护时机 |
|---|---|---|
| [AGENTS.md](../AGENTS.md) | 仓库级工程规范、命令、工作流与边界 | 架构或协作规范调整时 |
| [CONSTRAINTS.md](../CONSTRAINTS.md) | 不可妥协的测试、类型与安全质量红线 | 门禁标准调整时 |
| [prd/](prd/) | 产品需求文档（PRD）与模板 `_TEMPLATE.md` | 新功能立项 / 需求变更时 |
| [specs/CAPABILITY-MAP.md](specs/CAPABILITY-MAP.md) | 全库能力模块地图与依赖关系索引 | 新增/拆分核心模块时 |
| [specs/](specs/) | 模块活文档 Spec（`SPEC-<module-id>.md`）与模板 | 编码前审批，随实现同步更新 |
| [decisions/](decisions/) | 架构决策记录（ADR，`ADR-NNN-*.md`）与模板 | 重大技术选型或结构变更时 |
| [tasks/](../tasks/) | 当前迭代的 `plan.md` 与 `todo.md` 任务清单 | Spec 审批后进入实施前 |

## 2. 开发者与扩展指南

- [基础工具安装配置（Windows / macOS）](development-guides/base-tools-installation.md)
- [项目开发环境与注意事项](development-guides/project-development-setup.md)
- [供应商与模型扩展指南](development-guides/provider-and-model-extension.md)
- [内置 Agent：技能与 MCP 扩展](development-guides/agent-extensions.md)
- [开发交接日志（DEVLOG）](../DEVLOG.md)（历史交接记录）

## 3. 用户手册与功能配置

- [用户操作手册（Markdown）](mvaigc-canvas-user-manual.md) / [PDF 版](mvaigc_桌面画布_操作手册.pdf)
- [导演台与预演台操作说明](director-previsualization.md)
- [供应商设置指南](settings/provider-guide.md)
- [ComfyUI 连接指南](settings/comfyui-guide.md)
- [MiniMax H3 指南](settings/minimax-h3-guide.md)
- [中转站生图兼容配置](settings/image-relay-compatibility.md)
- [Agent 技能使用指南](guides/agent-skills.md)

## 4. 历史归档与参考资料

- `superpowers/`：早期 `2026-10` 阶段的专项设计与实施计划归档（只读参考，新需求请使用 `prd/` 与 `specs/`）。
- `releases/`：早期 `v0.1.x` 版本发布说明（`v2.2.4` 起统一见根目录 [CHANGELOG.md](../CHANGELOG.md)）。
- `api_docs/`：第三方供应商（KIE、PPIO、fal.ai、Grsai）接口参考快照。
- `reviews/`、`bugfixes/`、`verification/`、`animation/`：历史审查、修复与验收记录。
- `legal/`：上游原作者开源授权凭证。
