# Knowledge — 按需 Read 的领域知识

Knowledge 不是启动上下文。工具返回 `<knowledgeDir>` 逻辑路径，`media-agent` 在任务需要时通过 `design_read` 读取正文。

| 子目录 | 内容 | 读取者 |
|---|---|---|
| `vendors/` | 模型如何理解 prompt 与参考素材、输入表达和已知表现 | media-agent 在选定模型并读取 `design_capability_get` 后，按 `knowledgeCard` 路径读取；上下文中完整且有效的内容可复用 |

> 多阶段 workflow 已退役到 `.opencode-v3/_legacy/workflows/`，不属于 knowledge，也不再作为可执行流程。跨 vendor 语义风险卡（原 `failures/`）已退役到 `.opencode-v3/_legacy/knowledge/failures/`，不参与检索。

## Routing

- 可用型号、选型与默认策略由 `design_capability_list` 提供；调用字段、模式、值域、参考预算和组合限制统一由 `design_capability_get` 契约提供。vendor card 只描述选定模型如何理解输入及其表现经验，不重复选型、回退策略或参数表，不规定作品的内容组织。
- 知识检索默认范围为 vendors；当前 media-agent 未启用 `design_search_knowledge`，模型知识按 `knowledgeCard` 路径读取。
- 不新增中央索引，不把知识正文复制进 SP。

## Writing

- vendor card ≤50 行。
- 共用卡片中的专属方法按型号或输入用途标明范围，不把某个型号的方法泛化到整个系列；无需在每张卡重复加载顺序或契约优先级。
- 每句话都要能帮助组织 prompt、表达参考用途或识别模型的表现偏差。
- 例子只做 calibration；不要写演进史、TODO、墓碑、长解释或模型已经知道的创作常识。
