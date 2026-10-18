---
vendor: midjourney
modality: image
status: active
provider: midjourney
backend: midjourney
---

# midjourney -- image 后端卡片

## 调用约定

- 短而聚焦的描述通常更稳定，主体、媒介和关键氛围组成 10-40 word 的 prompt 即可。
- subject 写最前（V7 attention bias 偏前置 token）
- **唯一支持英文**，禁止中文（in-prompt 和 in-image 都不可用）
- 一次一个 medium，禁止 `oil painting + photorealistic` 之类混搭 → 出 muddled
- 美学控制按目标取舍：较克制的风格化保持主体写实，更强的风格化用于装饰性和绘画感；探索程度随用户需要的候选差异调整。
- 画幅描述与本次输出设置一致，主体布局服务作品用途。
- 排除要求只表达用户明确不要的内容；具体参数形式由当前 capability 契约提供。

## 已知 bug

- in-image 多词英文 → 失败可重现 → text 留 post-overlay
- 同账号 personalization profile 影响出图 → reproducibility 问题
- 长 mega-prompt（200+ word）→ 官方明确不推荐
