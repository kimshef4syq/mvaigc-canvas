---
vendor: kling
modality: video
status: active
provider: kuaishou
backend: kling
---

# kling -- video model card

## Omni：参考与多镜头表达

- 参考媒体按实际发送顺序用 `@image_1`、`@video_1` 绑定，写清每个素材的角色和用途。
- 启用多镜头生成时，按 `Shot N (Duration: Xs): ...` 编写，镜头时长总和与本次输出时长一致；开头用一句话交代主体、场景和整体动作。
- 对话先写角色、动作和说话人，再写准确台词；使用稳定角色标签和具体 cinematic 动词。
- 商品展示让每个镜头揭示新的形态、材质或功能信息，人物表演围绕动作后的即时反应推进。
- 编辑源片时明确修改对象和结果，参考素材承担需要延续的身份、空间与动作关系。

## Avatar：音频驱动肖像

- 人像承载外观，音频承载说话内容和节奏；prompt 围绕音频的停顿、重音和情绪组织表情与动作。
