---
vendor: kling
modality: video
status: active
provider: kuaishou
backend: kling
---

# kling -- video model card

## Activate When

Use when the user selects Kling or the video requires Kling-specific references, multi-shot, or native audio.

## Decision Test

- `kling-v3-omni`：3-15s，720P/1080P/4K；支持 multi-shot、原生音频、多图参考和视频参考。适合主体/商品一致性、多镜头叙事和声画同出；对外称 `Kling 3.0 Omni`。
- Omni 参考视频最多 1 条；无视频时参考图/Element 最多 7 张，带视频时合计最多 4 张。Omni 使用 feature/base 参考视频时忽略 `audio`。
- `feature` 视频用于动作/运镜/风格参考；`base` 视频用于编辑，输出时长跟随输入视频，不能与 multi-shot 混用。
- `mode=avatar`：图片 + 驱动音频，时长跟随音频；只支持 720P/1080P。

## Action

- 全能参考统一使用 `mode=multimodal`，参考图传入 `reference_image_paths`，参考视频传入 `reference_video_urls`；`model_id` 使用 `kling-v3-omni`。Avatar 使用对应 mode，省略 `model_id`。
- 清晰度使用 `vendor_params.quality_tier`：std/pro/max 对应 720P/1080P/4K；普通生成默认 pro，Avatar 仅支持 std/pro，默认 std。
- 参考媒体按发送顺序用 `@image_1`、`@video_1`、`@<element>` 绑定，并写清每个素材的角色和用途。
- Multi-shot 按 `Shot N (Duration: Xs): ...` 编写，所有 shot 时长之和等于顶层 duration；使用 `shot_type=intelligence` 时补充顶层总览。
- 对话先写角色、动作和说话人，再写准确台词；使用稳定角色标签和具体 cinematic 动词。
- 输出声音开关使用 `vendor_params.audio`（true/false）：普通生成默认 false，带参考视频时忽略该字段。Avatar 不接受该字段。Omni 参考视频使用 `keep_source_audio` 控制原声保留。纯写实人脸 close-up 优先考虑 MiniMax H3。
