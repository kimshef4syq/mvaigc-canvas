---
vendor: seedream
modality: image
status: active
provider: bytedance
backend: seedream
---

# seedream -- image 后端卡片

## 调用约定

- 自然语言、完整句子、**禁止关键词堆叠**；甜区 30-100 word
- 模型对**句首权重高**：subject + 关键 style 写最前，技术 / 灯光后置
- 中英文均可，但**禁止单句混用**
- 多 ref 必须命名角色：`Image 1: face, Image 2: outfit, Image 3: lighting only — do not copy subject`（anonymous ref 是 #1 失败模式）
- 用户需要系列图时，写清系列主题、每张图的内容与共同视觉要求。
- 编辑模式签名：`Change 'X' into 'Y'. Preserve [显式 invariant 列表]`，**一次只改一处**，多 element 拆成多句
- in-image text 必须**双引号**包裹；中文每元素 ≤ 8 字、英文 ≤ 10 词
- verbose ornate prompt 反而降质

## 已知 bug

- in-image 长中文（多行 / 段落）容易出现漏字、错字或排版偏差。
- 文字密集时按实际阅读尺寸检查清晰度，在当前能力支持的输出设置中选择合适档位。
- mega-prompt（300+ word）→ 中段 directive 被稀释，拆成 30-100 word + 迭代
- 同句中英混用 → token attention 混乱
