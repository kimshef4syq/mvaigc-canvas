---
vendor: official-music
modality: audio.music
status: active
provider: official
backend: minimax_music
---

# official-music -- audio.music 后端卡片

## 调用约定

- 已给歌词按用户原文使用；用户授权歌曲创作时，围绕已明确主题起草歌词并推进制作。用户要求先审歌词，或主题、语言等关键选择尚未确定时，先完成对应审阅或澄清。
- prompt 写风格、速度、乐器、情绪、声线；歌词结构用 `[Verse]` / `[Chorus]` / `[Bridge]`
- BGM 要写使用场景和情绪曲线，不要只写一个风格词

## 已知 bug

- 歌词太长会被模型压缩或漏唱；按 verse / chorus 控制结构
- 精确时长不可硬保；视频配乐要预留后期裁剪 / loop
- 版权歌曲“同款”请求只能做风格近似，不能复刻旋律
