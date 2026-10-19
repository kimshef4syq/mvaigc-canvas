---
vendor: banana
modality: image
status: active
provider: google
backend: nano-banana
---

# banana -- image 后端卡片

## 调用约定

- Prompt 的任务模式和语义内容以用户意图及所选参考的用途为准，用自然语言表达目标画面。
- 生成 Prompt 全文使用 runtime `working_language`，用清晰、连贯的完整句子描述目标结果
- 新图生成提供建立主体、场景、动作、构图和视觉方向所需的完整信息
- 参考生成描述目标画面，并逐一说明参考图提供的有效视觉贡献
- 图片编辑描述本轮变化、变化的视觉表现，以及它与当前人物、商品和环境的自然结合
- 结构化对象根据还原需要补充形状、文字、图案、颜色和结构信息
- 五段式 `[Style/Medium] + [Subject] + [Setting] + [Action] + [Composition/Camera]` 仅作为复杂新图生成的可选组织方式
- Prompt 长度和组织方式跟随任务复杂度
- 每个 ref 命名其在画面中的角色。
- 用简洁自然语言写清每份参考提供的有效视觉贡献；ref 角色与贡献优先于装饰性展开
- 多角色用命名实体绑定：`the woman from Image 1, named "Anna", standing next to the dog from Image 2, named "Max"`（命名实体追踪比位置追踪稳）
- Prompt 的构图方向与本次采用的画幅保持一致；编辑时延续用户选定源图的构图关系。
- 画内文字较短时更稳定；长文案容易出现漏字、错字或排版偏差。

## 已知 bug

- 显式品牌 / hex 色要转成感知色词并绑定位置；不要把参考图背景或纸张色推成 `warm cream / off-white`
- **过度全大写**（`EXACTLY ONCE EXACTLY ONCE`）反而触发重复，正常语气说一次即可
- 长 SD 风格 negative list（`ugly, blurry, low-q, watermark...`）→ 解析失败；默认不用 negative list
- 命名字体（`Helvetica Neue Bold`）忽略 → 用 `bold rounded sans-serif` 等定性描述
- 300+ word mega-prompt 容易稀释关键指令；优先去除重复描述，保留目标、ref 贡献和必要的视觉整合信息
