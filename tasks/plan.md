# Implementation Plan: 文档与 PRD/Spec 规范化基线

> 本文件按 `planning-and-task-breakdown` 规范维护当前迭代的实施计划。

## Overview

为 `mvaigc-canvas` 建立以 PRD 与 Spec 为导向的开发工作流骨架，统一项目标识并清理存量文档死链与冗余文件，为后续按模块补全 Spec 与迭代新功能打下基础。

## Architecture Decisions

- **双轨兼容归档**：保留 `docs/superpowers/` 作为早期历史设计与计划归档，新需求统一使用 `docs/prd/`、`docs/specs/`、`docs/decisions/` 与 `tasks/`。
- **能力地图索引**：通过 `docs/specs/CAPABILITY-MAP.md` 显式约束 8 个核心模块的职责与单向依赖。
- **质量门禁显式化**：通过 `AGENTS.md` 与 `CONSTRAINTS.md` 固化构建、类型、测试与 LF 换行符要求。

## Task List

### Phase 1: 规范骨架与目录整理（已完成）
- 详见 [tasks/todo.md](todo.md)

### Phase 2: 核心模块 PRD / Spec 反向补全（待启动）
- 按 `CAPABILITY-MAP.md` 依赖顺序，依次补齐 `settings-i18n`、`persistence-portability`、`ai-providers-proxy`、`canvas-core` 等模块 Spec。

