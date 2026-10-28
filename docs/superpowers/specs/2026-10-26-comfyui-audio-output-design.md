# ComfyUI 供应商支持「声音」输出

日期：2026-10-26
状态：待评审。评审通过后才进入实施计划。

## 1. 目标

在「设置 → 我的配置 → ComfyUI」的「工作流输出类型」中增加「声音输出」，使画布的 AI 音频节点能够选用 ComfyUI 音频工作流生成音频。

必须支持两类工作流：

- **纯文生音频**：只给文本，不传参考音频。
- **参考音频驱动**：画布上的音频卡片作为参考声音上传给工作流。

成功标准：用户在「我的配置」导入一个 ComfyUI 音频工作流后，能在 AI 音频节点的模型下拉里选中它，填文本、（可选）连参考音频，点生成，得到可播放的音频卡片。

已核实的具体工作流形态（见 §3）：`voice-design` 与 `voice-clone` 各有 1 个可绑定文本槽，`text2music` 有 2 个，`music-cover` 的文本内联在消费者节点上、无槽可绑。

## 2. 已核实的 ComfyUI 事实

以下结论来自 ComfyUI 上游源码（`server.py`、`comfy_extras/nodes_audio.py`、`comfy_api/latest/_ui.py`），不是凭经验推断。

| 事实 | 依据 |
|---|---|
| 上传端点只有 `/upload/image` 和 `/upload/mask`，**没有** `/upload/audio` | `server.py:536,553` |
| `/upload/image` 不校验文件类型，音频字节同样接受 | `server.py:464-535` |
| 上传的文件字段名硬编码为 `image`，不能改名 | `server.py:466` `post.get("image")` |
| 返回体含 `name` / `subfolder` / `type`，`name` 即 `LoadAudio` 需要的值 | `server.py:513` |
| `LoadAudio` 的输入字段名为 `audio`，值是可带 `subfolder/` 的服务器文件名 | `nodes_audio.py:398-414` |
| `SaveAudio` / `SaveAudioMP3` / `SaveAudioOpus` / `SaveAudioAdvanced` / `PreviewAudio` 的产物统一挂在 history 输出的 `"audio"` 键下，形如 `[{filename, subfolder, type}]` | `comfy_api/latest/_ui.py:54-61,411-423` |
| `/view` 不限文件类型，音频同样可取 | `server.py:599+` |

本机 `127.0.0.1:8188` 当前未运行，因此本规格不含真机验证证据。

## 3. 四个真实工作流的核实结果

用户提供的四个工作流，重新导出后均为 API 格式：

| 文件 | 节点数 | 输出节点 | 参考音频 | 文本输入形态 |
|---|---|---|---|---|
| `Qwen3 TTS语音生成音色设计.json` | 4 | `3: SaveAudio` | 无 | `1.text` → `10.text`（正文）；`1.instruct` → `11.text`（音色描述） |
| `qwen3tts-参考声人声.json` | 7 | `52: SaveAudioMP3`、`53: PreviewAudio` | `40: LoadAudio`，已填服务器文件名 | `43.target_text` → `42.text` |
| `audio_yue2_music_cover.json` | 14 | `10: SaveAudioAdvanced` | `45: LoadAudio`，已填服务器文件名 | `33:25.style`、`33:25.lyrics`，均为**直接内联字面值** |
| `audio_yue2_text2music (2).json` | 18 | `10: SaveAudioAdvanced` | 无 | `33:36.value`、`33:37.value`（`PrimitiveStringMultiline`），同时被 `33:24` 与 `33:25` 消费；另有 `42.text` 驱动 `33:31` 的 ABC 开关 |

由此确认四个必须解决的问题：

1. **现有提示词识别规则覆盖不到这些工作流。** `suggestComfyUIBindings` 只认 `CLIPTextEncode.text`，四个工作流一个都没有。
2. **现有代码会拒绝它们。** `prepareComfyUIWorkflow` 在缺少提示词绑定时抛出「请选择 ComfyUI 提示词节点及其输入字段」。
3. **文本槽有两种形状，且可能一对多。** 一种是消费者节点上的直接内联值（music-cover），另一种是上游独立字面节点、通过链接被引用（其余三个）。后者可能同时喂给多个下游节点（text2music 的 `style`/`lyrics` 各喂两个），还可能藏在开关节点之后（`33:30 ComfySwitchNode`）。
4. **不是所有文本字段都是创作输入。** text2music 的 `42.text` 是 ABC 记谱，用于驱动 `33:31` 的模式开关，绑定它没有意义且会误导用户。

另注：music-cover 的 `style`/`lyrics` 是**内联在消费者节点上的字面值**，没有独立的上游节点可供绑定。这类工作流若要由画布控制曲风与歌词，需在 ComfyUI 中把这两个值改为 `PrimitiveStringMultiline` 之类的独立节点再导出——这属于工作流改造，不在本次实现范围内；本次只保证识别并如实报告「该工作流没有可绑定的文本槽」。

最初提供的 `audio_yue2_text2music (1).json` 是画布格式，已被重新导出的 `(2)` 取代。

## 4. 设计

### 4.1 单一事实源

ComfyUI 音频配置只保存在 `customProvidersStore`（「我的配置」）。**不**向 `settingsStore.audioGenerationSettings` 复制或持久化任何 ComfyUI 条目。AI 音频节点读取的是一个由两处数据**派生**的目录，不是新增的一份设置。

理由：`normalizeAudioModelConfigs` 会按固定的 `AUDIO_PROVIDER_ORDER` 重建模型列表，任何不属于该顺序的条目都会被丢弃；复制一份必然与「我的配置」漂移。

### 4.2 媒体类型

`CustomProviderMediaType` 增加 `'audio'`，与 `'image' | 'video' | 'chat'` 并列。`customProviderMediaType()` 在 image 兜底之前增加 audio 分支，并新增 `isAudioCustomProvider()`。

由此 `isImageCustomProvider` / `isVideoCustomProvider` / `isChatCustomProvider` 自动把音频供应商排除在图片、视频、聊天目录之外，无需逐个目录加过滤。

配置层的三处 `=== 'video' ? 'video' : 'image'` 收成一个 `comfyMediaType()` 助手，三值透传。

### 4.3 绑定格式：多文本槽 + 音频槽

绑定配置是已存供应商配置的一部分，扩展必须向后兼容。

```ts
interface ComfyUITextBinding extends ComfyUIInputBinding {
  /** 画布节点上显示的槽名，缺省用 nodeId.input */
  label?: string;
}

interface ComfyUIBindings {
  /** 旧的单槽字段，保留兼容 */
  prompt?: ComfyUIInputBinding;
  /** 新的多文本槽；存在且非空时优先于 prompt */
  texts?: ComfyUITextBinding[];
  seed?: ComfyUIInputBinding;
  width?: ComfyUIInputBinding;
  height?: ComfyUIInputBinding;
  duration?: ComfyUIInputBinding;
  resolution?: ComfyUIInputBinding;
  aspectRatio?: ComfyUIInputBinding;
  images: ComfyUIInputBinding[];
  /** 新增：参考音频槽，与 images 同构 */
  audios: ComfyUIInputBinding[];
}
```

**生效规则**：`texts` 存在且非空 → 使用 `texts`；否则若 `prompt` 存在 → 视为单槽 `[{...prompt, label: '提示词'}]`；否则无文本槽。旧的 `prompt` 字段保留，不迁移、不重写已存配置。

**槽标识**：槽键为 `${nodeId}.${input}`，用于在节点数据里持久化各自的取值。不依赖数组下标，避免绑定顺序变化后取值错位。

**必需/可选判定**：与参考图一致——绑定节点的该输入若在工作流里已填了非空值（如 `LoadAudio` 已填服务器文件名），该槽可选；若为空，则必须由画布提供。没有音频槽则一个都不要求。这正好覆盖「纯文生音频」与「必须给参考声音」两类工作流。

### 4.4 导入时的自动识别

自动识别按「消费者字段」驱动，而不是按节点类名驱动——类名会随自定义节点无限增长，字段名相对稳定。识别流程：

1. 遍历所有非字面节点的文本类输入字段（`text` / `target_text` / `style` / `lyrics` / `instruct` / `ref_text` / `prompt`）。
2. 对每个字段值：
   - 是**内联字符串** → 槽就是该消费者节点的该字段（music-cover 形态）。
   - 是**链接** → 沿链接向上追溯，穿过开关/转发类节点，直到找到持有字面值的节点；槽是那个上游节点的字面字段（其余三个工作流的形态）。
   - 追溯终止于非字面节点（如 `Apply Whisper`）→ 该字段不可绑定，跳过。
3. **按槽目标去重**：多个消费者指向同一个上游字面节点时，只生成一个槽（text2music 的 `style`/`lyrics` 各被两个节点消费，仍只算两个槽）。
4. **排除驱动控制流的文本**：若某文本字段只被开关/布尔/控制类节点消费，不生成槽（text2music 的 `42.text` 驱动 `33:31` 的 ABC 模式开关，绑定它没有意义）。

四个工作流的识别结果（已用脚本对真实文件验证）：

| 工作流 | 识别出的槽 |
|---|---|
| voice-design | `10.text`（正文，消费于 `1.text`）、`11.text`（音色描述，消费于 `1.instruct`） |
| voice-clone | `42.text`（消费于 `43.target_text`） |
| music-cover | 无槽（`style`/`lyrics` 为内联值，不是可绑定节点） |
| text2music | `33:36.value`（style）、`33:37.value`（lyrics） |

**已确认的产品决定**：voice-design 的正文与音色描述**两个槽都绑定**，画布可同时控制两者，以便每次生成更换音色。因此同一工作流出现两个槽是预期行为，不属于 §4.4 要排除的歧义——歧义指「同名候选互不相关」，此处两个槽的语义由各自的消费者字段（`text` / `instruct`）唯一确定。

`label` 由字段名与消费节点推导：`style` → 曲风，`lyrics` → 歌词，`target_text`/`text` → 目标文本，`instruct` → 音色描述；无法推导时用 `nodeId.input`。

**歧义不自动绑定。** 同一字段名对应多个互不相关的候选时留空交用户手填——写错槽位不会报错，只会静默生成错误内容，比留空更糟。

输出节点与音频槽的识别：

- **输出节点**：现有正则增加 `SaveAudio|SaveAudioMP3|SaveAudioOpus|SaveAudioAdvanced|PreviewAudio`。
- **音频槽**：识别 `LoadAudio.audio`，与 `LoadImage.image` 同构，生成 `audios` 数组。

### 4.5 输出类型与产物筛选

- `ComfyUIConfig.mediaType` 联合加 `'audio'`。
- 新增 `AUDIO_EXTENSIONS`：`mp3` / `wav` / `flac` / `ogg` / `opus` / `m4a` / `aac` / `webm`。
- `outputFile` / `findOutputFile` 按 mediaType 选择扩展名白名单与优先键；audio 优先 `audio` → `files`。
- `prepareComfyUIWorkflow` 对 audio 跳过图片几何与尺寸/时长写入。
- 「已完成但所选输出节点没有 X 文件」的文案覆盖 audio。

### 4.6 参考音频上传

复用 `/upload/image`：字段名 `image`（服务端硬编码），文件名带音频扩展名。画布音频以本地文件为主，用现有 `loadAudioSourceDataUrl` 转 data URL 后上传。上传成功返回的 `name` 写入对应 `LoadAudio.audio`。

`prepareComfyUIWorkflow` 现有规则「视频类型下收到参考音频即报错」需要改为按槽位判定：

- 有音频槽 → 接受并写入；
- 无音频槽但传入了参考音频 → 明确报错「工作流没有音频输入槽」，不静默丢弃；
- 参考视频上传仍不支持，维持原报错。

### 4.7 出音频通道

在 `customProviderGateway.ts` 新增 `generateComfyUIAudio()`：提交 → 轮询 → 落盘 → 返回 `{ audioUrl }`，形状与现有 `GenerateLocalTtsResult` 一致。

`localAudioGateway` 与 `customProviderGateway` 目前互不导入，为避免新增循环依赖，分派放在 AI 音频节点：选中 ComfyUI 供应商时调用 `generateComfyUIAudio`，否则调用现有 `generateAudio`。`localAudioGateway` 不改。

轮询超时使用 ComfyUI 配置里的 `pollTimeoutMs`。

**唯一的后端改动**：`persist_audio_source` 目前不接收鉴权头与网络路由，而 `persist_video_source` 接收。远程 ComfyUI 的 `/view` 下载会因此丢失鉴权与代理设置。给 `persist_audio_source` 增加可选的 `headers` / `network` 参数，透传给 `resolve_audio_source_bytes`，与视频路径对称。

### 4.8 AI 音频节点

节点读取的模型列表改为「内置 TTS + 派生的 ComfyUI 音频条目」合并。派生条目的 `providerKind` 为 `'comfyui'`，`extraParams` 携带 providerId、modelId 与 ComfyUI 配置。

选中 ComfyUI 条目时：

- 按绑定渲染**多个命名文本槽**，取值存进 `audioGenerationParams`，以槽键索引；
- 参考音频入口按音频槽是否必需自动显示或隐藏；
- 音色下拉、控制指令、参数面板隐藏（这些是 TTS 概念，ComfyUI 音频工作流没有）。

`AudioProviderKind` 增加 `'comfyui'`；`defaultAudioInputSchemaForProviderKind('comfyui')` 返回文本/音色/参考/参数全部关闭的 schema，因为槽位由绑定决定而非 schema 决定。

## 5. 边界（本次不做）

- **ComfyUI 音频不出现在「设置 → 音频模型」页面**，只在「我的配置」里配置。
- **不做任务持久化与断点恢复**，与现有 TTS 一致，同步等待。
- **不支持参考视频上传**，维持现有报错。
- **参考音频仅支持画布本地音频**；远程 URL 作为参考需先落盘，不做额外适配。
- **不自动猜测歧义文本槽**，交用户手填。
- **不改造工作流**。内联字面值（music-cover 的 `style`/`lyrics`）不会自动改写成可绑定节点，只在 UI 上如实说明该工作流无可用文本槽。
- 不改动设置→音频模型页、视频节点、图片节点的既有行为。

## 6. 测试策略

分三层，单测不能替代后两层。

1. **单元/契约测试**
   - `comfyuiGateway`：audio 扩展名筛选、`SaveAudio` 类节点推断、audio 轮询取 URL、audio 工作流跳过图片几何、多文本槽生效规则（`texts` 优先于 `prompt`）、音频槽必需/可选判定、无音频槽却传入参考音频时报错。
   - `customImageProviderConfig`：audio `mediaType` 往返不被压成 image。
   - 自动识别：用四个真实工作流的结构作为夹具（脱敏，只保留节点类名与字段名，不含用户正文），断言上表四个识别结果：voice-design 识别两个槽（`10.text` 正文 + `11.text` 音色描述）、voice-clone 识别一个槽、music-cover 无槽、text2music 识别两个槽且**不**识别 `42.text`。
   - `audioModelCatalog`：TTS 与 ComfyUI 条目合并、条目 id 与 schema 形状。

2. **集成测试**：假 transport 驱动上传路径、字段名、绑定写入位置；验证上传走 `/upload/image` 且字段名为 `image`。

3. **真机验收**：在运行中的 ComfyUI 上导入四个工作流（第四个需重新导出），逐个生成并确认可播放；参考音频工作流需确认画布音频卡片确实被上传并驱动了音色。此项需用户在具备 ComfyUI 的环境执行。

## 7. 风险

- **协议正确性有源码依据，但未经真机运行。** 上一轮 Hypit Provider 出现过「单测全绿、真机四个 bug」，本规格明确区分已核实与未验证。
- **多文本槽扩展了已存配置格式。** 通过「`texts` 优先、`prompt` 保留」的兼容规则规避迁移；实施时需补一条旧配置读取测试。
- **音频节点改动涉及现有 TTS 路径。** 必须保证选中 TTS 模型时行为逐字不变，现有音频相关测试全部保持通过。
