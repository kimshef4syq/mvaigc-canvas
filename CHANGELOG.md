# Changelog

所有对 `mvaigc-canvas` 的重要变更都将记录在此文件中。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### Added
- 建立 PRD + Spec 导向开发规范骨架（`AGENTS.md`、`CONSTRAINTS.md`、`docs/README.md`、`docs/prd/`、`docs/specs/`、`docs/decisions/`、`tasks/`）。
- 补充 GitHub 开源协作模板（`.github/PULL_REQUEST_TEMPLATE.md`、`.github/ISSUE_TEMPLATE/`）。

### Changed
- 统一 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 与 `docs/development-guides/` 中的项目名称与文档相对路径链接，修复死链。
- 清理根目录重复的 PDF 操作手册与个人环境索引文件。

## [2.2.4] - 2026-11-05

> 注：早期详细变更日志分散在 [DEVLOG.md](DEVLOG.md) 与 [docs/releases/](docs/releases/)（`v0.1.12` ~ `v0.1.27`），自 `2.2.4` 起统一收口至本文件。

### Summary
- **内置反代 `mvaigc-proxy`**：Rust `axum` 原生内置反代，支持账号密码一键接入融媒视界图文/视频模型与 CLI 测试工具。
- **一体化生成节点**：支持「生成图片」与「生成视频」一体节点、按模型+生成方式动态决定参数与槽位、图片节点摄像机控制。
- **导演台与 3D 预演**：独立预演工作区、人物/镜头路径编辑、动作片段与视频导出，集成 SuperSplat 3D 高斯泼溅（3DGS）工作流。
- **画布 Agent 与扩展体系**：内置画布 Agent（测试版）、数据型技能（Skill）安装与通用 MCP（stdio / Streamable HTTP）连接管理。
- **生态与兼容性**：支持 ComfyUI 本地/云端工作流、MiniMax H3、中转站自定义图片契约与 Hypit 桥接。

