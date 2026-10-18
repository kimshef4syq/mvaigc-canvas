---
vendor: gpt-image
modality: image
status: active
provider: openai
backend: openai
---

# gpt-image -- image 后端卡片

## 调用约定

- Prompt 的任务模式和语义内容以用户意图及所选参考的用途为准，用清晰结构表达目标画面。
- 生成 Prompt 全文使用 runtime `working_language`；下方英文标签只表达结构，不改变 Prompt 语言
- 新图生成使用完整但聚焦的视觉描述，建立目标画面、主体、场景、构图和视觉方向
- 参考生成先描述目标画面，再逐一说明参考图提供的人物、商品、设计、风格或构图贡献
- 图片编辑围绕本轮目标展开，写清变化内容、发生位置、视觉结果及其与当前画面的自然结合，让源图承载既有事实
- 商品、包装、Logo、UI 和画内文字等结构化对象，按还原需要补充形状、文字、图案、颜色和结构信息
- 新构图、复杂设计或整体重绘适合结构化表达时，可使用 `Scene: / Subject: / Style: / Composition: / Text: / Constraints: / Medium:`
- 写明 intended use（`pitch deck slide` / `magazine ad` / `iPhone app mockup`）可触发 polish mode
- 仅传递所选参考中与请求有关的风格和颜色，不将背景、纸张等载体特征自动当作目标风格
- in-image text 用双引号保留原文；用户指定的位置、字体和排列关系完整进入 prompt。
- 文字层级多或排版关系决定可读性时，写明主要文案的位置、层级、字体气质、留白和对齐；短标题或开放版式用简洁的排版方向。
- 透明背景需求在 prompt 中写清 `transparent background / clean cut-out`，输出设置按当前 capability 契约选择。
- 编辑迭代只概括本轮变化和决定结果的关键延续关系
- Prompt 长度跟随任务复杂度；结构只用于提高可读性，不作为扩写目标

## 已知 bug

- camera spec（`50mm f/1.4 ISO 400`）当 vibe hint 解析，**不做物理仿真**，不要期待精确散景
- Prompt 的画幅和构图描述与本次采用的输出设置一致；文字密集的图像按实际阅读尺寸判断清晰度。
- recency bias：媒介属于目标结果时，用一句 medium statement 收尾；延续原媒介的图片编辑由源图承载
- `EXACTLY ONCE EXACTLY ONCE` 反而触发重复 → 正常语气说一次：`Render the tagline once, integrated into the layout`
- 命名字体当 style hint 解析、不精确匹配 → 用 `bold sans-serif like Inter`
