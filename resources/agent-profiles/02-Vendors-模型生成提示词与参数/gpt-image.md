---
vendor: gpt-image
modality: image
status: active
provider: openai
backend: openai
---

# gpt-image -- image 后端卡片

## 能力

- 模型：`gpt-image-2.5-sunburst`（默认）、`gpt-image-2.5-flare`、`gpt-image-2`；审美、画风参考、文字、版式、商品图、真人写实主体、复杂 brief 首选
- `model_id` 只能是上面三个之一。国内 picker 行是 `g-image-2.5-sunburst` / `g-image-2.5-flare` / `g-image-2`，它们和 `openai-image` 一样只是 picker token，不能当 model_id
- 能稳定解析完整视觉描述；复杂结构使用 labeled segments 能提高层级和指令清晰度
- ref 上限 16（行业最大）
- 强项：审美构图 / art direction、style ref / 画风迁移、**in-image text**（中文长 tagline、英文 ad copy、CJK + Latin 混排都稳）、infographic / UI mock / slide deck、真人写实主体、真人短剧角色锚点 / character sheet、cinematic realistic portrait、**multi-ref 合成**（virtual try-on 4-5 件衣服是 sweet spot）、photoreal、identity preservation 跨编辑
- 弱项：用户明确点名 Midjourney/MJ 风格时按用户指定路由
- 默认选型：任务含 style ref / 画风 / 审美 / in-image text / 真人写实角色锚点 / 复杂结构视觉 / 多 ref 合成时首选

## 调用约定

- Prompt 的任务模式和语义内容以 `semantic-judgment` 的编译结果为准；本卡只适配 gpt-image 的表达结构和模型限制
- 生成 Prompt 全文使用 runtime `working_language`；下方英文标签只表达结构，不改变 Prompt 语言
- 新图生成使用完整但聚焦的视觉描述，建立目标画面、主体、场景、构图和视觉方向
- 参考生成先描述目标画面，再逐一说明参考图提供的人物、商品、设计、风格或构图贡献
- 图片编辑围绕本轮目标展开，写清变化内容、发生位置、视觉结果及其与当前画面的自然结合，让源图承载既有事实
- 商品、包装、Logo、UI 和画内文字等结构化对象，按还原需要补充形状、文字、图案、颜色和结构信息
- 新构图、复杂设计或整体重绘适合结构化表达时，可使用 `Scene: / Subject: / Style: / Composition: / Text: / Constraints: / Medium:`
- 写明 intended use（`pitch deck slide` / `magazine ad` / `iPhone app mockup`）可触发 polish mode
- style/ref color/carrier handling follows `semantic-judgment`
- in-image text 双引号包裹 + 显式位置（`top center` / `bottom-right`）+ 定性字体（`bold sans-serif`）
- text-heavy 必须写成明确版式 brief：文字内容、位置、层级、字体气质、留白和对齐关系都要落在 prompt body
- 透明背景需求必须在 prompt body 写成 `transparent background / clean cut-out`，且不要传 manifest 未列出的参数
- 编辑迭代只概括本轮变化和决定结果的关键延续关系
- Prompt 长度跟随任务复杂度；结构只用于提高可读性，不作为扩写目标

## 已知 bug

- camera spec（`50mm f/1.4 ISO 400`）当 vibe hint 解析，**不做物理仿真**，不要期待精确散景
- aspect ratio 必须同时写进 `vendor_params.aspect_ratio` 和 prompt body，否则画布飘
- `vendor_params.resolution` 只能是 `1K` / `2K` / `4K`；批量使用顶层 `count`；image 任务不要传 `720p` / `1080p`
- recency bias：媒介属于目标结果时，用一句 medium statement 收尾；延续原媒介的图片编辑由源图承载
- `EXACTLY ONCE EXACTLY ONCE` 反而触发重复 → 正常语气说一次：`Render the tagline once, integrated into the layout`
- 命名字体当 style hint 解析、不精确匹配 → 用 `bold sans-serif like Inter`
- pure vibe 装饰 / fine-art 美感 < MJ → 路由切换

## Pointer

→ <knowledgeDir>/failures/on-image-text.md（in-image text 是本卡 sweet spot）  → <knowledgeDir>/failures/character-refs.md（multi-ref index + role）  → <knowledgeDir>/vendors/midjourney.md（pure vibe 替代）
