---
vendor: veo
modality: video
status: active
provider: google
backend: veo3
---

# veo -- video 后端卡片

## 调用约定

- prompt 5-part formula：`[Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]`
- detail wins control：`a woman in her twenties with wavy brown hair and light freckles` 远好于 `a brown-haired woman`
- 如需 dialogue / SFX / ambient / music，写清画面、说话人和声音意图；参考声音的可用方式以所选能力为准。
- negative 用**正向缺席描述**：`a desolate landscape with no buildings or roads`，避免无结构地堆叠排除词。

## 已知 bug

- 风格参考需要先落实为可观察的媒介、材质、光线和色彩；所选能力仅接受画面锚点时，可用符合目标风格的关键帧承载这些特征。
- 所有输出强制 SynthID 隐形水印（Google AI 内容标记），不可关闭
- multi-shot brief 塞一段长 prompt 容易丢失 shot 边界；复杂切镜可分成独立片段表达。
