# MiniMax Design 202 个文件：用途与使用位置

基于 [profiles-manifest.json](../src/generated/profiles-manifest.json) 和 `resources/agent-profiles/` 核对，共 202 个 Markdown 文件。

## 如何理解“使用位置”

- 下表的“原方案使用阶段”说明这些文档在原 MiniMax Design/OpenCode 架构中拟由哪个环节读取，不表示当前画布已经自动调用。
- 当前画布**没有读取 manifest 并按需加载 202 篇文档的运行时**；资源目录中也没有 `SKILL.md`，因此这些文件不是 202 个已安装 Skill。
- 当前已将部分规则写入功能代码：H3/Seedance 提示词编排、Failures 预检提示、精确字幕后期、H3 队列与结果分组。代码只是落实了部分规则，不等于完整执行对应文档。
- `README`、`AUTHORING`、`index`、`v3` 版本文件也计入 202；它们分别是说明、索引或版本资料，并非 202 个独立功能。

## 逐文件索引

### Agent 角色与分工（7）

原方案的任务入口与智能体编排：media-agent 判断任务，router 分流，planner 制订计划，executor 执行，comfyui-agent 处理 ComfyUI。

| 文件 | 内容 | 原方案使用阶段 |
|---|---|---|
| [README.md](../resources/agent-profiles/01-Agents-智能体人设与编排/README.md) | Agents — Per-Agent System Prompts | 目录、路由或编写说明 |
| [comfyui-agent.md](../resources/agent-profiles/01-Agents-智能体人设与编排/comfyui-agent.md) | Input contract | 原方案 Agent 启动与任务分工 |
| [executor.md](../resources/agent-profiles/01-Agents-智能体人设与编排/executor.md) | Input | 原方案 Agent 启动与任务分工 |
| [media-agent.md](../resources/agent-profiles/01-Agents-智能体人设与编排/media-agent.md) | Role | 原方案 Agent 启动与任务分工 |
| [planner.md](../resources/agent-profiles/01-Agents-智能体人设与编排/planner.md) | Input | 原方案 Agent 启动与任务分工 |
| [router.md](../resources/agent-profiles/01-Agents-智能体人设与编排/router.md) | Input | 原方案 Agent 启动与任务分工 |
| [v3/media-agent.md](../resources/agent-profiles/01-Agents-智能体人设与编排/v3/media-agent.md) | 身份与职责 | 原方案 Agent 启动与任务分工 |

### 模型卡与提示词参数（27）

生成请求准备时查具体模型的能力、素材槽位、参数和提示词格式；v3 是同主题的新版本资料。

| 文件 | 内容 | 原方案使用阶段 |
|---|---|---|
| [banana.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/banana.md) | banana -- image 后端卡片 | 模型选择与请求准备 |
| [gpt-image.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/gpt-image.md) | gpt-image -- image 后端卡片 | 模型选择与请求准备 |
| [image-recipes/poster.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/image-recipes/poster.md) | Poster Image Recipe | 图像生成配方 |
| [kling-omni.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/kling-omni.md) | kling -- video model card | 模型选择与请求准备 |
| [midjourney.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/midjourney.md) | midjourney -- image 后端卡片 | 模型选择与请求准备 |
| [minimax.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/minimax.md) | MiniMax H3 系列 -- video 后端卡片 | 模型选择与请求准备 |
| [moss.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/moss.md) | moss -- audio.tts 后端卡片 | 模型选择与请求准备 |
| [official-music.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/official-music.md) | official-music -- audio.music 后端卡片 | 模型选择与请求准备 |
| [seed-audio.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/seed-audio.md) | seed-audio -- audio.tts 后端卡片 | 模型选择与请求准备 |
| [seedance.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/seedance.md) | seedance -- video 后端卡片 | 模型选择与请求准备 |
| [seedaudio.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/seedaudio.md) | seedaudio -- audio.tts 后端卡片 | 模型选择与请求准备 |
| [seedream.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/seedream.md) | seedream -- image 后端卡片 | 模型选择与请求准备 |
| [v3/banana.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/banana.md) | banana -- image 后端卡片 | 模型选择与请求准备（v3 资料） |
| [v3/gpt-image.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/gpt-image.md) | gpt-image -- image 后端卡片 | 模型选择与请求准备（v3 资料） |
| [v3/image-search.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/image-search.md) | image-search — query playbook for design_image_search | 模型选择与请求准备（v3 资料） |
| [v3/kling-omni.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/kling-omni.md) | kling -- video model card | 模型选择与请求准备（v3 资料） |
| [v3/midjourney.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/midjourney.md) | midjourney -- image 后端卡片 | 模型选择与请求准备（v3 资料） |
| [v3/minimax.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/minimax.md) | MiniMax H3 系列 -- video 后端卡片 | 模型选择与请求准备（v3 资料） |
| [v3/moss.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/moss.md) | moss -- audio.tts 后端卡片 | 模型选择与请求准备（v3 资料） |
| [v3/official-music.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/official-music.md) | official-music -- audio.music 后端卡片 | 模型选择与请求准备（v3 资料） |
| [v3/seedance.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/seedance.md) | seedance -- video 后端卡片 | 模型选择与请求准备（v3 资料） |
| [v3/seedaudio.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/seedaudio.md) | seedaudio -- audio.tts 后端卡片 | 模型选择与请求准备（v3 资料） |
| [v3/seedream.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/seedream.md) | seedream -- image 后端卡片 | 模型选择与请求准备（v3 资料） |
| [v3/veo.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/veo.md) | veo -- video 后端卡片 | 模型选择与请求准备（v3 资料） |
| [v3/wan.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/v3/wan.md) | wan -- video 后端卡片 | 模型选择与请求准备（v3 资料） |
| [veo.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/veo.md) | veo -- video 后端卡片 | 模型选择与请求准备 |
| [wan.md](../resources/agent-profiles/02-Vendors-模型生成提示词与参数/wan.md) | Wan 3.0 — 模型使用指南 | 模型选择与请求准备 |

### 短剧与微电影（10）

短剧项目从制作计划、剧本、资产、分镜、片段提示词到后期的专用流程。

| 文件 | 内容 | 原方案使用阶段 |
|---|---|---|
| [reference/assets-blocking.md](../resources/agent-profiles/03-DramaSeries-短剧微电影完整流程/reference/assets-blocking.md) | 短剧资产与站位参考 | 短剧资产准备 |
| [reference/assets.md](../resources/agent-profiles/03-DramaSeries-短剧微电影完整流程/reference/assets.md) | 短剧资产编写参考 | 短剧资产准备 |
| [reference/h3-video-prompt.md](../resources/agent-profiles/03-DramaSeries-短剧微电影完整流程/reference/h3-video-prompt.md) | MiniMax H3 视频片段 Prompt 参考 | 短剧视频提示词编译 |
| [reference/post.md](../resources/agent-profiles/03-DramaSeries-短剧微电影完整流程/reference/post.md) | 短剧后期 / 精剪参考 | 短剧后期 |
| [reference/production-plan.md](../resources/agent-profiles/03-DramaSeries-短剧微电影完整流程/reference/production-plan.md) | 短剧制作计划参考 | 短剧前期计划 |
| [reference/scene-keyframes.md](../resources/agent-profiles/03-DramaSeries-短剧微电影完整流程/reference/scene-keyframes.md) | 场景关键帧宫格参考 | 短剧分镜 |
| [reference/script-craft.md](../resources/agent-profiles/03-DramaSeries-短剧微电影完整流程/reference/script-craft.md) | 短剧剧本创作参考 | 短剧剧本 |
| [reference/storyboard.md](../resources/agent-profiles/03-DramaSeries-短剧微电影完整流程/reference/storyboard.md) | 短剧分镜参考 | 短剧分镜 |
| [reference/video-prompt.md](../resources/agent-profiles/03-DramaSeries-短剧微电影完整流程/reference/video-prompt.md) | 视频片段 Prompt 参考 | 短剧视频提示词编译 |
| [workflow.md](../resources/agent-profiles/03-DramaSeries-短剧微电影完整流程/workflow.md) | 短剧流程 | 短剧项目路由与总流程 |

### 商业广告与 TVC（52）

商业广告创意、产品研究、品牌与角色锚点、行业品类、视觉手法、生成策略及后期。

| 文件 | 内容 | 原方案使用阶段 |
|---|---|---|
| [category/appliance.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/category/appliance.md) | Category：家用电器 | TVC 品类创意 |
| [category/auto.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/category/auto.md) | Category：汽车 | TVC 品类创意 |
| [category/beauty/anchors-beauty.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/category/beauty/anchors-beauty.md) | 美妆品类：Anchors 增量 | TVC 品类创意 |
| [category/beauty/creative-route-beauty.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/category/beauty/creative-route-beauty.md) | 美妆品类：Anchors Video Creative Route 增量 | TVC 品类创意 |
| [category/beauty.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/category/beauty.md) | Category：美妆 | TVC 品类创意 |
| [category/fashion.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/category/fashion.md) | Category：服装 | TVC 品类创意 |
| [category/food.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/category/food.md) | Category：餐饮食品 | TVC 品类创意 |
| [category/index.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/category/index.md) | TVC Category 索引 | 目录、路由或编写说明 |
| [category/tech/casebook-tech-ads.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/category/tech/casebook-tech-ads.md) | 3C数码广告案例库 — Casebook | TVC 品类创意 |
| [category/tech.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/category/tech.md) | Category：3C 数码 | TVC 品类创意 |
| [direction/brand-ad.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/direction/brand-ad.md) | Direction：品牌广告 | TVC 创意方向 |
| [direction/index.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/direction/index.md) | TVC Direction 索引 | 目录、路由或编写说明 |
| [direction/product-ad.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/direction/product-ad.md) | Direction：产品广告 | TVC 创意方向 |
| [direction/story-ad.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/direction/story-ad.md) | Direction：剧情广告 | TVC 创意方向 |
| [direction/viral-ad.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/direction/viral-ad.md) | Direction：病毒传播广告 | TVC 创意方向 |
| [reference/_internal/brand-logo-guard.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/_internal/brand-logo-guard.md) | Brand Logo Guard — Anchors 品牌资产约束 | TVC 前期调研、锚点与提示词 |
| [reference/audio-strategy.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/audio-strategy.md) | TVC 最小 BGM 策略 | TVC 音频 |
| [reference/casting-spec.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/casting-spec.md) | Casting Spec — 品牌片选角规格 | TVC 前期调研、锚点与提示词 |
| [reference/character-design-sheet.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/character-design-sheet.md) | TVC 固定模特 5-PLATE 参考卡 | TVC 前期调研、锚点与提示词 |
| [reference/creative-brainstorm.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/creative-brainstorm.md) | Anchors Creative Route（anchors）创意路线契约 | TVC 前期调研、锚点与提示词 |
| [reference/creative-research.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/creative-research.md) | TVC Visual Research — 产品与风格视觉调研 | TVC 前期调研、锚点与提示词 |
| [reference/environment-anchors.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/environment-anchors.md) | TVC Environment Anchors — MJ 环境锚点卡 | TVC 前期调研、锚点与提示词 |
| [reference/intake-and-brief.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/intake-and-brief.md) | TVC Intake 与意图确认 | TVC 前期调研、锚点与提示词 |
| [reference/post-production.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/post-production.md) | TVC Post 合成合同 | TVC 后期 |
| [reference/product-research.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/product-research.md) | Anchors 前置产品调研与证据协议 | TVC 前期调研、锚点与提示词 |
| [reference/product-spec.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/product-spec.md) | Product Spec — Anchors 产品参考路由 | TVC 前期调研、锚点与提示词 |
| [reference/prompt-templates.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/prompt-templates.md) | Anchors 图像 Prompt 模板 | TVC 前期调研、锚点与提示词 |
| [reference/video-generation-execution.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/video-generation-execution.md) | TVC Visual Gen 授权与执行 | TVC 分镜与生成 |
| [reference/video-generation-strategy.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/video-generation-strategy.md) | TVC 分镜与视频生成规划 | TVC 分镜与生成 |
| [reference/visual-style-spec.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-style-spec.md) | Anchors 前置视觉参考与 Style Master 契约 | TVC 前期调研、锚点与提示词 |
| [reference/visual-techniques/T01-glitch.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T01-glitch.md) | T01 — Glitch 热成像转场 | TVC 视觉手法选择 |
| [reference/visual-techniques/T02-logo-sequence.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T02-logo-sequence.md) | T02 — Logo 多维叙事序列 | TVC 视觉手法选择 |
| [reference/visual-techniques/T03-color-temperature-arc.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T03-color-temperature-arc.md) | T03 — 冷暖色温弧线叙事 | TVC 视觉手法选择 |
| [reference/visual-techniques/T04-flash-black-opening.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T04-flash-black-opening.md) | T04 — 闪黑碎片序章 | TVC 视觉手法选择 |
| [reference/visual-techniques/T05-hud-overlay.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T05-hud-overlay.md) | T05 — HUD 技术叠层 | TVC 视觉手法选择 |
| [reference/visual-techniques/T06-typography-composition.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T06-typography-composition.md) | T06 — 文案图形化排版 | TVC 视觉手法选择 |
| [reference/visual-techniques/T07-iconic-light-hero.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T07-iconic-light-hero.md) | T07 — 圣像光产品英雄镜头 | TVC 视觉手法选择 |
| [reference/visual-techniques/T08-monochrome-color-puncture.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T08-monochrome-color-puncture.md) | T08 — 黑白画面中的单点色彩 | TVC 视觉手法选择 |
| [reference/visual-techniques/T09-spotlight-isolation.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T09-spotlight-isolation.md) | T09 — 聚光灯孤立俯拍 | TVC 视觉手法选择 |
| [reference/visual-techniques/T10-macro-texture-montage.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T10-macro-texture-montage.md) | T10 — 微距质感蒙太奇 | TVC 视觉手法选择 |
| [reference/visual-techniques/T11-logo-self-luminance.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T11-logo-self-luminance.md) | T11 — Logo 自发光激活 | TVC 视觉手法选择 |
| [reference/visual-techniques/T12-high-key-impact-flash.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T12-high-key-impact-flash.md) | T12 — 高反差过曝冲击帧 | TVC 视觉手法选择 |
| [reference/visual-techniques/T13-manifesto-end-card.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T13-manifesto-end-card.md) | T13 — 碑文式宣言终帧 | TVC 视觉手法选择 |
| [reference/visual-techniques/T14-industrial-manual-layout.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T14-industrial-manual-layout.md) | T14 — 工业说明书式参数版面 | TVC 视觉手法选择 |
| [reference/visual-techniques/T15-abstract-to-product-morph.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T15-abstract-to-product-morph.md) | T15 — 抽象几何到产品形态蜕变 | TVC 视觉手法选择 |
| [reference/visual-techniques/T16-acoustic-ripple.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T16-acoustic-ripple.md) | T16 — 液体声波与悬浮声学隐喻 | TVC 视觉手法选择 |
| [reference/visual-techniques/T17-inside-out-tech-chain.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T17-inside-out-tech-chain.md) | T17 — 表里透视科技链 | TVC 视觉手法选择 |
| [reference/visual-techniques/T18-physics-beat-matching.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T18-physics-beat-matching.md) | T18 — 物理动力学卡点 | TVC 视觉手法选择 |
| [reference/visual-techniques/T19-speed-driven-driving.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T19-speed-driven-driving.md) | T19 — 高速推进与速度感驾驶 | TVC 视觉手法选择 |
| [reference/visual-techniques/T20-sensory-motif-translation.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques/T20-sensory-motif-translation.md) | T20 — 感官母题互译链 | TVC 视觉手法选择 |
| [reference/visual-techniques-library.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/reference/visual-techniques-library.md) | TVC Visual Technique 索引 | TVC 前期调研、锚点与提示词 |
| [workflow.md](../resources/agent-profiles/04-AdTVC-商业广告与品牌大片流程/workflow.md) | Ad TVC — 视觉广告工作流 | TVC 项目路由与总流程 |

### MV 与歌词视频（10）

以音乐时间轴为主线，处理创意、歌曲、资产、分镜、视频生成、动态字体和后期。

| 文件 | 内容 | 原方案使用阶段 |
|---|---|---|
| [reference/assets.md](../resources/agent-profiles/05-MV-音乐卡点与歌词视频流程/reference/assets.md) | MV Stage 4 — 角色与场景锚点（可选风格 Research） | MV 创意、剧本与资产 |
| [reference/creative-and-plan.md](../resources/agent-profiles/05-MV-音乐卡点与歌词视频流程/reference/creative-and-plan.md) | MV Stage 1 / 3 — 创意方向与制作计划 | MV 创意、剧本与资产 |
| [reference/music.md](../resources/agent-profiles/05-MV-音乐卡点与歌词视频流程/reference/music.md) | MV 音乐生成与实际成歌时间轴 | MV 音乐时间轴 |
| [reference/post.md](../resources/agent-profiles/05-MV-音乐卡点与歌词视频流程/reference/post.md) | MV Stage 7 — 后期合成 | MV 后期与动态包装 |
| [reference/script-writing.md](../resources/agent-profiles/05-MV-音乐卡点与歌词视频流程/reference/script-writing.md) | Script Writing — 故事与剧本写作 | MV 创意、剧本与资产 |
| [reference/storyboard.md](../resources/agent-profiles/05-MV-音乐卡点与歌词视频流程/reference/storyboard.md) | MV Stage 5 — 导演分镜与镜头组规划 | MV 分镜 |
| [reference/style-system.md](../resources/agent-profiles/05-MV-音乐卡点与歌词视频流程/reference/style-system.md) | MV 五种视觉风格系统 | MV 创意、剧本与资产 |
| [reference/typography-packaging.md](../resources/agent-profiles/05-MV-音乐卡点与歌词视频流程/reference/typography-packaging.md) | MV 动态字体与包装系统 | MV 后期与动态包装 |
| [reference/video-generation.md](../resources/agent-profiles/05-MV-音乐卡点与歌词视频流程/reference/video-generation.md) | MV Stage 6 — H3 最终 Prompt 编译、确认与派单 | MV 视频生成 |
| [workflow.md](../resources/agent-profiles/05-MV-音乐卡点与歌词视频流程/workflow.md) | MV — music-led video workflow | MV 项目路由与总流程 |

### 通用视频（61）

开放式视频项目的三种叙事路线，以及剧本、资产、导演、声音、视觉、剪辑、模型路由和质量检查。

| 文件 | 内容 | 原方案使用阶段 |
|---|---|---|
| [audio-production/workflow.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/audio-production/workflow.md) | Audio Production — standalone speech / music / audio post workflow | 通用视频总流程 |
| [profiles/narrative.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/profiles/narrative.md) | 故事驱动 profile（N） | 通用视频路线选择 |
| [profiles/on-camera.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/profiles/on-camera.md) | 出镜驱动 profile（C） | 通用视频路线选择 |
| [profiles/speech.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/profiles/speech.md) | 语音驱动 profile（S） | 通用视频路线选择 |
| [reference/assets/asset-extraction.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/assets/asset-extraction.md) | Visual Asset Extraction — 最小可复用资产判定 | 资产准备与一致性 |
| [reference/assets/casting-spec.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/assets/casting-spec.md) | Casting Spec — 出镜主体与角色选定 | 资产准备与一致性 |
| [reference/assets/character-consistency.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/assets/character-consistency.md) | Character Consistency — 人物连续性 | 资产准备与一致性 |
| [reference/assets/character-features.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/assets/character-features.md) | Character Features — 多参考人物贡献隔离 | 资产准备与一致性 |
| [reference/assets/character-guard.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/assets/character-guard.md) | Character Guard — 人物参考图守卫 | 资产准备与一致性 |
| [reference/assets/character-sheet.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/assets/character-sheet.md) | Character Sheet — general-video 角色锚点 | 资产准备与一致性 |
| [reference/assets/era-identity-guard.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/assets/era-identity-guard.md) | Era & Identity Guard — 时代、地域与身份连续性 | 资产准备与一致性 |
| [reference/assets/prop-sheet.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/assets/prop-sheet.md) | Prop Sheet — 关键道具辅助参考 | 资产准备与一致性 |
| [reference/assets/scene-sheet.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/assets/scene-sheet.md) | Scene Sheet — 可复用场景身份 | 资产准备与一致性 |
| [reference/assets/style-consistency.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/assets/style-consistency.md) | Style Consistency — 跨镜视觉系统 | 资产准备与一致性 |
| [reference/directing/digital-presenter.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/digital-presenter.md) | Digital Presenter — 数字讲者 | 导演与分镜 |
| [reference/directing/film-language-handbook.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/film-language-handbook.md) | Film Language Toolkit — 视听语言工具箱 | 导演与分镜 |
| [reference/directing/intercut-overlay-spec.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/intercut-overlay-spec.md) | Intercut and Overlay — 辅助画面编排 | 导演与分镜 |
| [reference/directing/live-action-shooting.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/live-action-shooting.md) | Live-action Direction — 真人出镜 | 导演与分镜 |
| [reference/directing/minimax-h3-shortgroup.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/minimax-h3-shortgroup.md) | Continuity-first Clip Groups — 连续镜头组 | 导演与分镜 |
| [reference/directing/montage-theory.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/montage-theory.md) | Montage — 蒙太奇设计 | 导演与分镜 |
| [reference/directing/n-grid.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/n-grid.md) | N-grid — 多格视觉预览 | 导演与分镜 |
| [reference/directing/photoreal-skin.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/photoreal-skin.md) | Photoreal Human Texture — 真人写实质感 | 导演与分镜 |
| [reference/directing/scene-description-layers.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/scene-description-layers.md) | Scene Description Layers — 画面描述分层 | 导演与分镜 |
| [reference/directing/storyboard-discipline.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/storyboard-discipline.md) | Storyboard Discipline — 分镜与 Shot Plan | 导演与分镜 |
| [reference/directing/storyboard-format.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/storyboard-format.md) | Storyboard Format — 视频执行表与可选逐镜格式 | 导演与分镜 |
| [reference/directing/storyboard-image-strategy.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/storyboard-image-strategy.md) | Storyboard Image Strategy — 分镜图与稳定状态参考 | 导演与分镜 |
| [reference/directing/video-generation-spec.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/video-generation-spec.md) | Video Generation Strategy — 视频生成策略 | 导演与分镜 |
| [reference/directing/video-generation-strategy.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/directing/video-generation-strategy.md) | Video Generation Strategy — 分组与生成策略 | 导演与分镜 |
| [reference/editing/dramatic-pause.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/editing/dramatic-pause.md) | 戏剧性停顿（Dramatic Pause） | 剪辑与时长 |
| [reference/editing/duration-reconciliation.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/editing/duration-reconciliation.md) | 时长对齐（Duration Reconciliation） | 剪辑与时长 |
| [reference/editing/editing-principles.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/editing/editing-principles.md) | 剪辑原则（Editing Principles） | 剪辑与时长 |
| [reference/editing/ffmpeg-templates.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/editing/ffmpeg-templates.md) | 确定性后期操作选择（Deterministic Post Operations） | 剪辑与时长 |
| [reference/editing/transition-decision-tree.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/editing/transition-decision-tree.md) | 转场判断（Transition Decision Tree） | 剪辑与时长 |
| [reference/editing/trim-strategy.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/editing/trim-strategy.md) | 裁切策略（Trim Strategy） | 剪辑与时长 |
| [reference/model-routing/minimax-h3-multi-ref.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/model-routing/minimax-h3-multi-ref.md) | MiniMax H3 Multi-Ref — 条件性多参考绑定 | 模型路由 |
| [reference/model-routing/models.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/model-routing/models.md) | Model Routing — plan capability requirements | 模型路由 |
| [reference/orchestration/canvas-workflow.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/orchestration/canvas-workflow.md) | Canvas Workflow — general-video 产物谱系 | 画布与声画协同 |
| [reference/orchestration/cross-modal-coordination.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/orchestration/cross-modal-coordination.md) | Cross-Modal Coordination — 声画与时间协同 | 画布与声画协同 |
| [reference/quality-control/iterate.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/quality-control/iterate.md) | Iterate — 局部修复与安全续跑 | 生成结果复核 |
| [reference/screenwriting/explainer-narrative.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/screenwriting/explainer-narrative.md) | Explainer Narrative — 讲解叙事 | 剧本与旁白 |
| [reference/screenwriting/script-writing.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/screenwriting/script-writing.md) | Script Writing — 故事与剧本写作 | 剧本与旁白 |
| [reference/screenwriting/vo-natural-writing.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/screenwriting/vo-natural-writing.md) | Natural Voiceover — 自然旁白 | 剧本与旁白 |
| [reference/sound/audio-engineering.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/sound/audio-engineering.md) | 音频工程判断（Audio Engineering） | 声音设计 |
| [reference/sound/audio-mix-hierarchy.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/sound/audio-mix-hierarchy.md) | 混音层级（Audio Mix Hierarchy） | 声音设计 |
| [reference/sound/audio-strategy.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/sound/audio-strategy.md) | Audio Strategy — 旁白与音乐策略 | 声音设计 |
| [reference/sound/batching.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/sound/batching.md) | 语音批次组织（Speech Batching） | 声音设计 |
| [reference/sound/pronunciation.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/sound/pronunciation.md) | 发音与读法（Pronunciation） | 声音设计 |
| [reference/sound/seedaudio-prompting.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/sound/seedaudio-prompting.md) | 场景化音频提示（Scene-based Audio Prompting） | 声音设计 |
| [reference/sound/source-separation.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/sound/source-separation.md) | 声源分离与重建（Source Separation） | 声音设计 |
| [reference/sound/voice-control.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/sound/voice-control.md) | 声音控制（Voice Control） | 声音设计 |
| [reference/visual-aesthetics/color.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/visual-aesthetics/color.md) | 色彩（Color） | 视觉风格 |
| [reference/visual-aesthetics/composition-depth.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/visual-aesthetics/composition-depth.md) | 构图与空间（Composition and Depth） | 视觉风格 |
| [reference/visual-aesthetics/lighting.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/visual-aesthetics/lighting.md) | 光线（Lighting） | 视觉风格 |
| [reference/visual-aesthetics/materials.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/visual-aesthetics/materials.md) | 材质与质感（Materials） | 视觉风格 |
| [reference/visual-aesthetics/movie-poster.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/visual-aesthetics/movie-poster.md) | 配套海报与标题卡（Poster and Title Card） | 视觉风格 |
| [reference/visual-aesthetics/style-migration.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/visual-aesthetics/style-migration.md) | 风格迁移（Style Migration） | 视觉风格 |
| [reference/visual-aesthetics/typography.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/visual-aesthetics/typography.md) | 文字与排版（Typography） | 视觉风格 |
| [reference/visual-aesthetics/video-reference-analysis.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/visual-aesthetics/video-reference-analysis.md) | Video Reference Analysis — 参考视频与节奏拆解 | 视觉风格 |
| [reference/visual-aesthetics/vision-decomposer.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/visual-aesthetics/vision-decomposer.md) | 视觉参考拆解（Vision Decomposer） | 视觉风格 |
| [reference/visual-aesthetics/visual-style-presets.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/reference/visual-aesthetics/visual-style-presets.md) | Visual Style Presets — 可选视觉方向样本 | 视觉风格 |
| [workflow.md](../resources/agent-profiles/06-GeneralVideo-通用视频制作流程/workflow.md) | General Video — open-ended dependency workflow | 通用视频总流程 |

### KOC/UGC 商品视频（4）

商品依据、卖点与钩子、出镜人设、口播分镜及成片的专用流程。

| 文件 | 内容 | 原方案使用阶段 |
|---|---|---|
| [reference/creative-route.md](../resources/agent-profiles/06-KOC-带货与口播种草流程/reference/creative-route.md) | KOC Creative Route Reference — 卖点 / 钩子 / 人设 / CTA | KOC 策划与拍摄 |
| [reference/product-grounding.md](../resources/agent-profiles/06-KOC-带货与口播种草流程/reference/product-grounding.md) | KOC Product Grounding Reference — 素材判定 / 人物锚 / 产品保真 | KOC 策划与拍摄 |
| [reference/shot-vo-craft.md](../resources/agent-profiles/06-KOC-带货与口播种草流程/reference/shot-vo-craft.md) | KOC Shot & VO Craft Reference — 真人感 / 分镜节奏 / 口播文案 | KOC 策划与拍摄 |
| [workflow.md](../resources/agent-profiles/06-KOC-带货与口播种草流程/workflow.md) | KOC Video — UGC product seeding workflow | KOC 项目路由与总流程 |

### 共享制作管线（8）

多个项目流程共用的资产、音频、字幕、终剪和阶段计划规范。

| 文件 | 内容 | 原方案使用阶段 |
|---|---|---|
| [AUTHORING.md](../resources/agent-profiles/07-SharedPipelines-共享资产与后期管线/AUTHORING.md) | Workflow 编写规范 | 目录、路由或编写说明 |
| [README-Workflows.md](../resources/agent-profiles/07-SharedPipelines-共享资产与后期管线/README-Workflows.md) | Workflows — authoring and directory guide | 目录、路由或编写说明 |
| [asset-pipeline.md](../resources/agent-profiles/07-SharedPipelines-共享资产与后期管线/asset-pipeline.md) | Asset Pipeline — reusable core anchors | 共享资产管线 |
| [audio-pipeline.md](../resources/agent-profiles/07-SharedPipelines-共享资产与后期管线/audio-pipeline.md) | Audio Pipeline — voice, music, stems, and mix decisions | 共享音频管线 |
| [stage-execution-plan.md](../resources/agent-profiles/07-SharedPipelines-共享资产与后期管线/stage-execution-plan.md) | Stage Execution Plan — complete execution workflow | 阶段执行计划 |
| [subtitle-pipeline.md](../resources/agent-profiles/07-SharedPipelines-共享资产与后期管线/subtitle-pipeline.md) | Subtitle Pipeline — ASS timed-text postprocess | 字幕后期 |
| [video-merge.md](../resources/agent-profiles/07-SharedPipelines-共享资产与后期管线/video-merge.md) | Video Merge — final media assembly | 终剪合成 |
| [workflow-routing-index.md](../resources/agent-profiles/07-SharedPipelines-共享资产与后期管线/workflow-routing-index.md) | Workflows — runtime routing index | 目录、路由或编写说明 |

### 失败模式与质检（15）

在提示词预检或生成前复核时按风险主题读取，避免语义漂移、文字失真、角色不一致等问题。

| 文件 | 内容 | 原方案使用阶段 |
|---|---|---|
| [README-Knowledge-v2.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/README-Knowledge-v2.md) | Knowledge — 按需 Read 的领域知识 | 目录、路由或编写说明 |
| [README-Knowledge-v3.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/README-Knowledge-v3.md) | Knowledge — 按需 Read 的领域知识 | 目录、路由或编写说明 |
| [anatomy-traps.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/anatomy-traps.md) | anatomy-traps -- semantic anatomy risk | 提示词风险预检与人工复核 |
| [brand-injection.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/brand-injection.md) | brand-injection -- semantic brand asset risk | 提示词风险预检与人工复核 |
| [character-refs.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/character-refs.md) | character-refs -- semantic reference binding risk | 提示词风险预检与人工复核 |
| [constraint-negation.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/constraint-negation.md) | constraint-negation -- semantic absence risk | 提示词风险预检与人工复核 |
| [cultural-stereotypes.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/cultural-stereotypes.md) | cultural-stereotypes -- semantic culture specificity risk | 提示词风险预检与人工复核 |
| [era-disambiguation.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/era-disambiguation.md) | era-disambiguation -- semantic era anchoring risk | 提示词风险预检与人工复核 |
| [intent-overreach.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/intent-overreach.md) | intent-overreach -- prompt expansion drift | 提示词风险预检与人工复核 |
| [medium-drift.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/medium-drift.md) | medium-drift -- semantic medium locking risk | 提示词风险预检与人工复核 |
| [mood-vocabulary.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/mood-vocabulary.md) | mood-vocabulary -- semantic mood ambiguity risk | 提示词风险预检与人工复核 |
| [on-image-text.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/on-image-text.md) | on-image-text -- semantic typography rendering risk | 提示词风险预检与人工复核 |
| [plastic-skin.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/plastic-skin.md) | plastic-skin -- semantic photoreal portrait texture risk | 提示词风险预检与人工复核 |
| [spoken-video.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/spoken-video.md) | spoken-video -- native audio video routing | 提示词风险预检与人工复核 |
| [webtoon-proportions.md](../resources/agent-profiles/08-Failures-防翻车与负向避坑知识库/webtoon-proportions.md) | webtoon-proportions -- semantic stylized body-scale risk | 提示词风险预检与人工复核 |

### 跨流程行为规则（8）

原方案要求注入 Agent 的基础纪律、避免循环、语义判断和画布分组规则。

| 文件 | 内容 | 原方案使用阶段 |
|---|---|---|
| [README-Plugins-v2.md](../resources/agent-profiles/09-Contracts-画布纪律与语义契约/README-Plugins-v2.md) | Plugins — OpenCode 运行时插件 | 目录、路由或编写说明 |
| [README-Plugins-v3.md](../resources/agent-profiles/09-Contracts-画布纪律与语义契约/README-Plugins-v3.md) | Plugins — OpenCode 运行时插件 | 目录、路由或编写说明 |
| [README.md](../resources/agent-profiles/09-Contracts-画布纪律与语义契约/README.md) | Contracts — Always-On Behavior Rules | 目录、路由或编写说明 |
| [anti-loop.md](../resources/agent-profiles/09-Contracts-画布纪律与语义契约/anti-loop.md) | Anti-Loop | 原方案 Agent 与画布行为约束 |
| [baseline.md](../resources/agent-profiles/09-Contracts-画布纪律与语义契约/baseline.md) | Baseline Contract | 原方案 Agent 与画布行为约束 |
| [canvas-discipline.md](../resources/agent-profiles/09-Contracts-画布纪律与语义契约/canvas-discipline.md) | Canvas Discipline | 原方案 Agent 与画布行为约束 |
| [canvas-grouping.md](../resources/agent-profiles/09-Contracts-画布纪律与语义契约/canvas-grouping.md) | Canvas Grouping | 原方案 Agent 与画布行为约束 |
| [semantic-judgment.md](../resources/agent-profiles/09-Contracts-画布纪律与语义契约/semantic-judgment.md) | Semantic Judgment Contract | 原方案 Agent 与画布行为约束 |

## 当前画布中已落实的部分

- 视频节点的结构化提示词：`src/features/promptCompiler/PromptCompiler.ts`、`PromptComposerDialog.tsx`，参考 H3、Seedance 模型卡和视频提示词资料。
- 提示词风险提示：`src/features/promptCompiler/PromptLinter.ts`，覆盖 Failures 类别的部分风险主题；不会自动加载原文，也不会静默改写提示词。
- 本机视频字幕烧录：`src-tauri/src/commands/video_caption.rs`，对应共享后期管线中的“精确文字由后期处理”原则。
- H3 工单排队与恢复、Agent 本轮结果分组：由画布代码实现相关规则，未通过读取上述文档驱动。

要让 Agent 真正在对话中按任务动态使用全部资料，还需建立文档检索/路由、版本选择、引用来源及能力映射。
