---
vendor: banana
modality: image
status: active
provider: google
backend: nano-banana
---

# banana -- image 后端卡片

## 能力

- 模型：`nano_banana_2_flash`（fast/default）/ `nano_banana_2`（higher quality/slower）
- `model_id` 只能用上述两个 canonical 值；display name / picker token 不可作为 `model_id`
- t2i + i2i + 多 ref（≤10）
- 强项：subject identity 跨编辑保留、multi-ref 融合、**9-grid 表情/姿态批量**、character continuation 跨场景、conversational iteration（小幅追加 prompt 精修）
- 真实世界知识推断：历史时代 / 真实城市 / 命名事件（如 "Bethel, NY August 1969"）能渲染时代正确细节
- 弱项：最极端的 photoreal 人脸特写锐度、long-text、稠密中文版式、精确字体匹配、纯画风/审美迁移；不要仅因 photoreal / 人物 / character sheet 就离开 banana/gpt-image primary pool
- 默认选择：任务信号模糊且不含 style ref / 画风 / 审美 / 版式诉求时优先选 banana（覆盖面广）

## 调用约定

- Prompt 的任务模式和语义内容以 `semantic-judgment` 的编译结果为准；本卡只适配 banana 的自然语言表达和模型限制
- 生成 Prompt 全文使用 runtime `working_language`，用清晰、连贯的完整句子描述目标结果
- 新图生成提供建立主体、场景、动作、构图和视觉方向所需的完整信息
- 参考生成描述目标画面，并逐一说明参考图提供的有效视觉贡献
- 图片编辑描述本轮变化、变化的视觉表现，以及它与当前人物、商品和环境的自然结合
- 结构化对象根据还原需要补充形状、文字、图案、颜色和结构信息
- 五段式 `[Style/Medium] + [Subject] + [Setting] + [Action] + [Composition/Camera]` 仅作为复杂新图生成的可选组织方式
- Prompt 长度和组织方式跟随任务复杂度
- 每个 ref 必须命名角色（同 <knowledgeDir>/vendors/seedream.md 规则）
- 多参考图按 `semantic-judgment` 的 contribution map 写成简洁自然语言；ref 角色与贡献优先于装饰性展开
- 多角色用命名实体绑定：`the woman from Image 1, named "Anna", standing next to the dog from Image 2, named "Max"`（命名实体追踪比位置追踪稳）
- aspect ratio 必须**同时**写在 prompt body 和 tool param 里，单边申明会出错
- `vendor_params.resolution` 只能是 `1k` / `2k` / `4k`；image 任务不要传 `720p` / `1080p`
- 中文 in-image text ≤ 8 字、英文 ≤ 5 词；超长文本必须 reflect 给 orchestrator 改路由

## 已知 bug

- 显式品牌 / hex 色要转成感知色词并绑定位置；不要把参考图背景或纸张色推成 `warm cream / off-white`
- **过度全大写**（`EXACTLY ONCE EXACTLY ONCE`）反而触发重复，正常语气说一次即可
- 长 SD 风格 negative list（`ugly, blurry, low-q, watermark...`）→ 解析失败；默认不用 negative list
- 命名字体（`Helvetica Neue Bold`）忽略 → 用 `bold rounded sans-serif` 等定性描述
- 300+ word mega-prompt 容易稀释关键指令；优先去除重复描述，保留目标、ref 贡献和必要的视觉整合信息

## Pointer

→ <knowledgeDir>/failures/on-image-text.md（长文本路由切换）  → <knowledgeDir>/failures/character-refs.md（多 ref 命名）  → <knowledgeDir>/vendors/gpt-image.md（text-heavy 替代）  → <knowledgeDir>/vendors/seedream.md（显式 specialist 或 primary-pool 失败后的替代）
