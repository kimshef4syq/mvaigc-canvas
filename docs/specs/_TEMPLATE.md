# Spec: [Module ID / Feature Name]

> **状态**：Draft | Approved | Implemented  
> **所属模块 ID**：`<module-id>`（见 [CAPABILITY-MAP.md](CAPABILITY-MAP.md)）  
> **关联 PRD**：`docs/prd/PRD-<name>.md`  
> **关联 ADR**：`docs/decisions/ADR-NNN-*.md`（如有）  
> **最后更新**：YYYY-MM-DD

---

## 1. Objective（目标与验收概述）

- **做什么与为什么**：简述本模块/特性的核心职责与业务价值。
- **用户故事 / 核心场景**：……

## 2. Tech Stack & Interfaces（技术栈与边界契约）

- **关键依赖**：列出本模块使用的核心库或 Tauri/Rust 能力。
- **对外接口 / 数据契约**：
  - TypeScript 类型 / Store Action / Tauri Command 签名。
  - 持久化字段与迁移要求（如涉及 SQLite）。

## 3. Commands（构建、测试与验证命令）

```bash
# 类型与构建
npx tsc --noEmit
npm run build

# 单元测试（可替换为聚焦测试文件）
npm test -- <path/to/test>

# Rust 检查（如涉及 src-tauri/）
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## 4. Project Structure & Code Style（目录落点与代码风格）

- **涉及目录与文件**：
  - `src/...`
  - `src-tauri/src/...`
- **关键约定 / 示例片段**：贴出一段符合本模块风格的核心接口或组件示例，胜过长篇文字描述。

## 5. Testing Strategy（测试策略）

- **单元测试**：覆盖范围、Mock 边界（如 `fake-indexeddb` / Tauri invoke mock）。
- **集成 / 手工验证**：端到端链路检查要点（含正常路径与异常降级路径）。

## 6. Boundaries（三层边界）

- **Always**：必须执行的动作（如 i18n 双语同步、安全脱敏、不重复计费）。
- **Ask first**：需人工确认的高风险动作（如改表结构、改公共接口、新增依赖）。
- **Never**：绝对禁止的动作。

## 7. Success Criteria（可测试的完成标准）

- [ ] 标准 1（可量化/可验证）
- [ ] 标准 2

## 8. Open Questions（待决事项）

- [ ] 待确认事项（Spec 审批前必须全部关闭或明确延后）

