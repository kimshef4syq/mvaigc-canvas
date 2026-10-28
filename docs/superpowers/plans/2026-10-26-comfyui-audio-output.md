# ComfyUI 声音输出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ComfyUI 供应商支持「声音输出」，使画布 AI 音频节点能选用 ComfyUI 音频工作流生成音频，并支持参考音频驱动。

**Architecture:** `mediaType` 值贯穿配置层与 ComfyUI 网关；绑定格式扩展为「多命名文本槽 + 音频槽」并保持对旧 `prompt` 字段的兼容；音频节点读取由内置 TTS 与 `customProvidersStore` 派生的 ComfyUI 条目合并而成的目录，选中 ComfyUI 条目时分派到新的出音频通道。

**Tech Stack:** TypeScript / React / Zustand / Vitest / Tauri (Rust)

**Spec:** `docs/superpowers/specs/2026-10-26-comfyui-audio-output-design.md`

## Global Constraints

- ComfyUI 音频配置只存在于 `customProvidersStore`；**不得**向 `settingsStore.audioGenerationSettings` 持久化任何 ComfyUI 条目（spec §4.1）。
- 上传端点只能是 `/upload/image`，文件字段名只能是 `image`（服务端硬编码，`server.py:466`）。
- `LoadAudio` 的输入字段名是 `audio`；`SaveAudio` 族产物在 history 中挂在 `audio` 键下。
- 绑定兼容规则：`texts` 存在且非空则用之，否则回退到 `prompt`；已存配置不迁移、不重写。
- 槽键格式固定为 `${nodeId}.${input}`。
- 歧义文本槽不自动绑定。
- 选中 TTS 模型时 AI 音频节点的行为必须逐字不变。
- 不改造用户的工作流文件。
- 测试命令：`npm test`（vitest run）；Rust 用 `cargo test`（在 `src-tauri/`）。

## Review Focus

- **音频扩展名大小写与无扩展名产物**：`SaveAudioAdvanced` 可产出 `.FLAC`/`.flac`，某些节点可能产出无扩展名文件；用户期望能取到产物或得到明确「无音频文件」错误，而不是静默 pending 到超时。
- **参考音频为空字符串或纯空白**：`LoadAudio.audio` 已填服务器文件名时该槽可选；用户未连音频卡片就点生成，期望跑通而非报错。
- **音频槽存在但用户连了多个音频卡片**：用户期望得到明确「只支持 N 个参考音频」错误，而不是只悄悄用第一个或全部塞进去。
- **工作流没有任何文本槽却点了生成**：用户期望明确说明「该工作流没有可绑定的文本输入」，而不是空提示词提交上去生成一段随机音频。
- **同一工作流两个槽都叫 `text`**：用户期望节点上能区分正文与音色描述，而不是两个框都叫「文本」分不清。

---

### Task 1: 媒体类型加入 audio

**Files:**
- Modify: `src/stores/customProvidersStore.ts:10,65-85`
- Modify: `src/features/canvas/application/customImageProviderConfig.ts:399,482,527`
- Test: `src/features/canvas/application/customImageProviderConfig.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type CustomProviderMediaType = 'image' | 'video' | 'chat' | 'audio'`
  - `function isAudioCustomProvider(provider: Pick<CustomProviderConfig, 'mediaType' | 'extraParams'>): boolean`
  - `function comfyMediaType(value: unknown): 'image' | 'video' | 'audio'`（`customImageProviderConfig.ts` 内部导出，供同文件三处使用）

- [ ] **Step 1: Write the failing test**

在 `customImageProviderConfig.test.ts` 末尾追加：

```ts
it('keeps comfyui audio mediaType through the draft round trip', () => {
  const config = customImageProviderDraftToConfig({
    ...createEmptyCustomImageProviderDraft(),
    apiStyle: 'comfyui',
    mediaType: 'audio',
    label: 'audio wf',
    baseUrl: 'http://127.0.0.1:8188',
    extraParams: { comfyui: { workflow: { '1': { class_type: 'SaveAudio', inputs: {} } } } },
  }, 'audio-1').value!;
  expect(config.mediaType).toBe('audio');
  expect(customImageProviderConfigToDraft(config).mediaType).toBe('audio');
  expect(isAudioCustomProvider(config)).toBe(true);
  expect(isImageCustomProvider(config)).toBe(false);
  expect(isVideoCustomProvider(config)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/canvas/application/customImageProviderConfig.test.ts`
Expected: FAIL —— `mediaType` 为 `'image'`，`isAudioCustomProvider` 未定义。

- [ ] **Step 3: Implement**

`customProvidersStore.ts`：`CustomProviderMediaType` 加 `'audio'`；`customProviderMediaType()` 在 chat/video 判断之后、`return 'image'` 之前插入：

```ts
if (provider.mediaType === 'audio' || provider.extraParams?.mediaType === 'audio') {
  return 'audio';
}
```

并新增 `isAudioCustomProvider`，与现有 `isImageCustomProvider` 同形。

`customImageProviderConfig.ts`：新增内部助手 `comfyMediaType(value: unknown)`，返回 `'audio' | 'video' | 'image'`（非 comfyui 场景仍按原逻辑压成 image/video）；把 399、482、527 三处 `provider.apiStyle === 'comfyui' && provider.mediaType === 'video' ? 'video' : 'image'` 换成它。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/canvas/application/customImageProviderConfig.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/customProvidersStore.ts src/features/canvas/application/customImageProviderConfig.ts src/features/canvas/application/customImageProviderConfig.test.ts
git commit -m "feat(comfyui): recognise audio as a custom provider media type"
```

---

### Task 2: 网关认识音频产物

**Files:**
- Modify: `src/features/canvas/infrastructure/comfyuiGateway.ts:29-36,111-114,198-213,334-339,341-420,461-530,551-575`
- Test: `src/features/canvas/infrastructure/comfyuiGateway.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `'audio'` 值
- Produces:
  - `type ComfyUIMediaType = 'image' | 'video' | 'audio'`
  - `ComfyUIConfig.mediaType?: ComfyUIMediaType`
  - `outputFile` / `findOutputFile` / `inspectComfyUIHistory` / `pollComfyUIWorkflow` 的 mediaType 参数类型统一为 `ComfyUIMediaType`

- [ ] **Step 1: Write the failing test**

在 `comfyuiGateway.test.ts` 追加（`audioWorkflow` 常量放文件顶部）：

```ts
const audioWorkflow = {
  '1': { class_type: 'LoadAudio', inputs: { audio: '' } },
  '2': { class_type: 'FB_Qwen3TTSVoiceClone', inputs: { target_text: ['3', 0], ref_audio: ['1', 0] } },
  '3': { class_type: 'Text', inputs: { text: 'hello' } },
  '4': { class_type: 'SaveAudioMP3', inputs: { audio: ['2', 0], quality: '128k' } },
  '5': { class_type: 'PreviewAudio', inputs: { audio: ['2', 0] } },
};

describe('ComfyUI audio workflow contracts', () => {
  it('suggests audio output nodes', () => {
    expect(suggestComfyUIOutputNodes(audioWorkflow)).toEqual(['4', '5']);
  });

  it('finds the audio file under the audio history key', () => {
    const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: {
      comfyui: { workflow: audioWorkflow, outputNodeIds: ['4'] },
    } }));
    const result = inspectComfyUIHistory({
      'p1': { outputs: { '4': { audio: [{ filename: 'out.mp3', subfolder: 'audio', type: 'output' }] } } },
    }, 'p1', config, 'audio');
    expect(result).toMatchObject({ state: 'ready', file: { filename: 'out.mp3', subfolder: 'audio' } });
  });

  it('accepts uppercase audio extensions', () => {
    const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: {
      comfyui: { workflow: audioWorkflow, outputNodeIds: ['4'] },
    } }));
    expect(inspectComfyUIHistory({
      'p1': { outputs: { '4': { audio: [{ filename: 'OUT.FLAC', subfolder: '', type: 'output' }] } } },
    }, 'p1', config, 'audio')).toMatchObject({ state: 'ready' });
  });

  it('reports completion without an audio file instead of pending', () => {
    const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: {
      comfyui: { workflow: audioWorkflow, outputNodeIds: ['4'] },
    } }));
    expect(inspectComfyUIHistory({
      'p1': { outputs: {}, status: { completed: true, status_str: 'success' } },
    }, 'p1', config, 'audio')).toMatchObject({ state: 'failed' });
  });

  it('does not apply image geometry to an audio workflow', () => {
    const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: {
      comfyui: { workflow: audioWorkflow, outputNodeIds: ['4'], bindings: { images: [] } },
    } }));
    expect(() => prepareComfyUIWorkflow(config, { ...request, reference_images: [], size: '1024x768' }))
      .not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/canvas/infrastructure/comfyuiGateway.test.ts`
Expected: FAIL —— 输出节点推断不含 `4`/`5`；`'audio'` 不是合法 mediaType 参数。

- [ ] **Step 3: Implement**

- `AUDIO_EXTENSIONS = new Set(['mp3','wav','flac','ogg','opus','m4a','aac','webm'])`，与现有两个常量并列。
- `outputFile` / `findOutputFile` 的 `mediaType` 改为 `ComfyUIMediaType`，扩展名按三分支选集合，audio 优先键 `['audio', 'files']`。
- `suggestComfyUIOutputNodes` 正则加 `SaveAudio|SaveAudioMP3|SaveAudioOpus|SaveAudioAdvanced|PreviewAudio`。
- `parseComfyUIConfig` 的 mediaType 用 Task 1 的 `comfyMediaType` 语义接收三值。
- `prepareComfyUIWorkflow`：`video` 变量改为 `const nonImage = config.mediaType === 'video' || config.mediaType === 'audio' || h3`；尺寸/几何分支只在 `mediaType !== 'audio'` 时执行；H3 专属校验保持仅在 `h3` 时触发。
- `inspectComfyUIHistory` 的「已完成但没有 X 文件」文案：`audio` → `'音频'`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/canvas/infrastructure/comfyuiGateway.test.ts`
Expected: PASS（原有 20+ 条 image/video 测试也须全绿）

- [ ] **Step 5: Commit**

```bash
git add src/features/canvas/infrastructure/comfyuiGateway.ts src/features/canvas/infrastructure/comfyuiGateway.test.ts
git commit -m "feat(comfyui): read audio outputs and skip image geometry for audio workflows"
```

---

### Task 3: 绑定格式扩展为多文本槽 + 音频槽

**Files:**
- Modify: `src/features/canvas/infrastructure/comfyuiGateway.ts:8-28,141-159,299-304`
- Test: `src/features/canvas/infrastructure/comfyuiGateway.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `ComfyUIMediaType`
- Produces:
  - `interface ComfyUITextBinding extends ComfyUIInputBinding { label?: string }`
  - `ComfyUIBindings` 新增 `texts?: ComfyUITextBinding[]` 与 `audios: ComfyUIInputBinding[]`
  - `function effectiveTextSlots(bindings: ComfyUIBindings): ComfyUITextBinding[]` —— 兼容规则的唯一实现
  - `function textSlotKey(binding: ComfyUIInputBinding): string` —— 返回 `${nodeId}.${input}`
  - `function getComfyUIAudioReferenceRequirements(config: ComfyUIConfig): { min: number; max: number }`

- [ ] **Step 1: Write the failing test**

```ts
describe('ComfyUI binding compatibility', () => {
  it('falls back to the legacy prompt binding when texts is absent', () => {
    const config = parseComfyUIConfig(provider());
    expect(effectiveTextSlots(config.bindings)).toEqual([{ nodeId: '6', input: 'text' }]);
  });

  it('keeps requiring a prompt binding for image workflows but not for audio', () => {
    const noPrompt = { '1': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
      '9': { class_type: 'SaveImage', inputs: {} } };
    const imageConfig = parseComfyUIConfig(provider({ extraParams: { comfyui: {
      workflow: noPrompt, outputNodeIds: ['9'], bindings: { images: [] },
    } } }));
    expect(() => prepareComfyUIWorkflow(imageConfig, { ...request, reference_images: [] }))
      .toThrow('请选择 ComfyUI 提示词节点');

    const audioConfig = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: { comfyui: {
      workflow: { '1': { class_type: 'SaveAudio', inputs: { audio: ['2', 0] } },
        '2': { class_type: 'EmptyLatentAudio', inputs: { seconds: 5 } } },
      outputNodeIds: ['1'], bindings: { images: [], audios: [] },
    } } }));
    expect(() => prepareComfyUIWorkflow(audioConfig, { ...request, reference_images: [] }))
      .not.toThrow();
  });

  it('prefers texts over prompt when both exist', () => {
    const config = parseComfyUIConfig(provider({ extraParams: { comfyui: {
      workflow,
      outputNodeIds: ['9'],
      bindings: {
        prompt: { nodeId: '6', input: 'text' },
        texts: [{ nodeId: '6', input: 'text', label: '正文' }, { nodeId: '10', input: 'image', label: 'x' }],
        images: [{ nodeId: '10', input: 'image' }],
      },
    } } }));
    expect(effectiveTextSlots(config.bindings).map((slot) => slot.label)).toEqual(['正文', 'x']);
  });

  it('uses stable slot keys independent of array order', () => {
    expect(textSlotKey({ nodeId: '33:36', input: 'value' })).toBe('33:36.value');
  });

  it('writes every slot from textSlotValues, including non-first slots', () => {
    const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: { comfyui: {
      workflow: voiceDesignWorkflow, outputNodeIds: ['3'],
      bindings: { texts: [{ nodeId: '10', input: 'text' }, { nodeId: '11', input: 'text' }],
        images: [], audios: [] },
    } } }));
    const patched = prepareComfyUIWorkflow(config, {
      ...request, reference_images: [], prompt: 'BODY-NEW',
      extra_params: { textSlotValues: { '11.text': 'VOICE-NEW' } },
    });
    expect(patched['10'].inputs.text).toBe('BODY-NEW');
    expect(patched['11'].inputs.text).toBe('VOICE-NEW');
  });

  it('parses audio bindings and treats a filled server filename as optional', () => {
    const filled = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: { comfyui: {
      workflow: audioWorkflow, outputNodeIds: ['4'],
      bindings: { audios: [{ nodeId: '1', input: 'audio' }], images: [] },
    } } }));
    expect(getComfyUIAudioReferenceRequirements(filled)).toEqual({ min: 0, max: 1 });

    const empty = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: { comfyui: {
      workflow: { ...audioWorkflow, '1': { class_type: 'LoadAudio', inputs: { audio: '' } } },
      outputNodeIds: ['4'],
      bindings: { audios: [{ nodeId: '1', input: 'audio' }], images: [] },
    } } }));
    expect(getComfyUIAudioReferenceRequirements(empty)).toEqual({ min: 1, max: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/canvas/infrastructure/comfyuiGateway.test.ts`
Expected: FAIL —— `effectiveTextSlots` / `textSlotKey` / `getComfyUIAudioReferenceRequirements` 未导出。

- [ ] **Step 3: Implement**

- 类型按 Interfaces 扩展。`parseBindings` 解析 `texts`（数组，每项必填 nodeId+input，`label` 可选）与 `audios`（同 `images` 规则：空项报错）。
- `effectiveTextSlots`：`bindings.texts?.length ? bindings.texts : bindings.prompt ? [bindings.prompt] : []`。
- `textSlotKey`：`\`${binding.nodeId}.${binding.input}\``。
- `getComfyUIAudioReferenceRequirements`：与 `getComfyUIReferenceRequirements` 同构，基于 `effectiveBindings(config).audios`，用 `bindingValue` 判断服务器已有值。
- `prepareComfyUIWorkflow` 的提示词校验改为基于 `effectiveTextSlots`，**按 mediaType 分档**：
  - `image` / `video`：槽数为 0 时**仍抛**「请选择 ComfyUI 提示词节点及其输入字段」——保持 `comfyuiGateway.test.ts:121` 现有断言通过。
  - `audio`：槽数为 0 时**不抛**（音频工作流可以完全没有文本输入），`request.prompt` 不被写入任何节点；节点层负责提示用户（Task 10）。
  - 槽数 ≥ 1：第 1 个槽写入 `request.prompt`。
- **多槽取值**：`request.extra_params?.textSlotValues` 若为 `Record<string, string>`，按 `textSlotKey` 逐槽写入；存在该值时**覆盖**上一条的「第 1 槽写 prompt」结果。缺失的槽保持工作流原值。这是 Task 10 传入非首槽取值的唯一通道。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/canvas/infrastructure/comfyuiGateway.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/canvas/infrastructure/comfyuiGateway.ts src/features/canvas/infrastructure/comfyuiGateway.test.ts
git commit -m "feat(comfyui): add multi text slots and audio bindings with legacy fallback"
```

---

### Task 4: 文本槽自动识别

**Files:**
- Modify: `src/features/canvas/infrastructure/comfyuiGateway.ts:263-296`
- Test: `src/features/canvas/infrastructure/comfyuiGateway.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `ComfyUITextBinding` / `textSlotKey`
- Produces: `suggestComfyUIBindings(workflowInput)` 的返回值新增 `texts: ComfyUITextBinding[]` 与 `audios: ComfyUIInputBinding[]`；`prompt` 字段保留不变（旧调用方与旧测试依赖）

- [ ] **Step 1: Write the failing test**

用四个真实工作流的**结构**做夹具（只保留类名与字段名，正文用占位符）：

```ts
const voiceDesignWorkflow = {
  '1': { class_type: 'FB_Qwen3TTSVoiceDesign', inputs: { text: ['10', 0], instruct: ['11', 0], seed: 1 } },
  '3': { class_type: 'SaveAudio', inputs: { audio: ['1', 0] } },
  '10': { class_type: 'JjkText', inputs: { text: 'BODY' } },
  '11': { class_type: 'JjkText', inputs: { text: 'VOICE' } },
};
const voiceCloneWorkflow = {
  '40': { class_type: 'LoadAudio', inputs: { audio: 'server.wav' } },
  '42': { class_type: 'Text', inputs: { text: 'BODY' } },
  '43': { class_type: 'FB_Qwen3TTSVoiceClone', inputs: { target_text: ['42', 0], ref_audio: ['40', 0] } },
  '44': { class_type: 'Apply Whisper', inputs: { audio: ['40', 0], prompt: '' } },
  '52': { class_type: 'SaveAudioMP3', inputs: { audio: ['43', 0] } },
};
const musicCoverWorkflow = {
  '10': { class_type: 'SaveAudioAdvanced', inputs: { audio: ['33:9', 0] } },
  '45': { class_type: 'LoadAudio', inputs: { audio: 'server.mp3' } },
  '33:25': { class_type: 'YuE2GenerateMusic', inputs: { style: 'pop', lyrics: '[Verse]' } },
};
const text2MusicWorkflow = {
  '10': { class_type: 'SaveAudioAdvanced', inputs: { audio: ['33:9', 0] } },
  '42': { class_type: 'CR Text', inputs: { text: 'ABC' } },
  '33:24': { class_type: 'YuE2GenerateABC', inputs: { style: ['33:36', 0], lyrics: ['33:37', 0] } },
  '33:25': { class_type: 'YuE2GenerateMusic', inputs: { style: ['33:36', 0], lyrics: ['33:37', 0] } },
  '33:31': { class_type: 'PrimitiveBoolean', inputs: { value: ['42', 0] } },
  '33:36': { class_type: 'PrimitiveStringMultiline', inputs: { value: 'pop' } },
  '33:37': { class_type: 'PrimitiveStringMultiline', inputs: { value: '[Verse]' } },
};

describe('ComfyUI audio text slot detection', () => {
  it('binds both voice-design slots through their consumers', () => {
    expect(suggestComfyUIBindings(voiceDesignWorkflow).texts).toEqual([
      { nodeId: '10', input: 'text', label: '目标文本' },
      { nodeId: '11', input: 'text', label: '音色描述' },
    ]);
  });

  it('binds the voice-clone target text and skips the whisper prompt', () => {
    const suggested = suggestComfyUIBindings(voiceCloneWorkflow);
    expect(suggested.texts).toEqual([{ nodeId: '42', input: 'text', label: '目标文本' }]);
    expect(suggested.audios).toEqual([{ nodeId: '40', input: 'audio' }]);
  });

  it('reports no bindable text slot for inline literals', () => {
    expect(suggestComfyUIBindings(musicCoverWorkflow).texts).toEqual([]);
  });

  it('binds shared upstream slots once and ignores control-flow text', () => {
    const texts = suggestComfyUIBindings(text2MusicWorkflow).texts!;
    expect(texts.map(textSlotKey)).toEqual(['33:36.value', '33:37.value']);
    expect(texts.map((slot) => slot.label)).toEqual(['曲风', '歌词']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/canvas/infrastructure/comfyuiGateway.test.ts`
Expected: FAIL —— `texts` 为 `undefined`。

- [ ] **Step 3: Implement**

按 spec §4.4 实现字段驱动的识别，作为 `suggestComfyUIBindings` 的新增分支（`CLIPTextEncode` 旧规则保持，产出 `prompt` 与单元素 `texts`）：

- 文本字段候选：`['target_text', 'text', 'style', 'lyrics', 'instruct', 'ref_text', 'prompt']`。
- 字面节点类名：`/^(PrimitiveString|PrimitiveStringMultiline|JjkText|Text|CR Text|String|CR Prompt Text)$/i`。
- 对每个非字面节点的候选字段值：内联字符串 → 槽即该节点该字段；数组链接 → 沿链追溯（限 12 跳、防环），穿过开关/转发类节点（按 `value`/`text`/`style`/`lyrics` 顺序找下一个字符串型输入），直到字面节点；追溯停在非字面节点 → 跳过该字段。
- 按 `textSlotKey` 去重，保留首个消费字段用于推导 label。
- **排除控制流**：若某槽的所有消费者字段都是 `value`/`switch`/`on_true`/`on_false` 等非文本语义字段（即消费方不是生成节点），不产出该槽。实现上：只接受消费方字段属于文本候选集合的槽。
- label 推导表：`target_text`/`text` → 目标文本，`instruct` → 音色描述，`style` → 曲风，`lyrics` → 歌词，`ref_text` → 参考文本；未命中用 `${nodeId}.${input}`。
- 音频槽：`/^LoadAudio$/i` 且 inputs 含 `audio` → `audios` 项。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/canvas/infrastructure/comfyuiGateway.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/canvas/infrastructure/comfyuiGateway.ts src/features/canvas/infrastructure/comfyuiGateway.test.ts
git commit -m "feat(comfyui): detect text slots by consumer field across link indirection"
```

---

### Task 5: 参考音频上传与槽位写入

**Files:**
- Modify: `src/features/canvas/infrastructure/comfyuiGateway.ts:341-460`
- Test: `src/features/canvas/infrastructure/comfyuiGateway.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `effectiveTextSlots`、`getComfyUIAudioReferenceRequirements`
- Produces: `prepareComfyUIWorkflow(config, request, uploadedNames?: string[], uploadedAudioNames?: string[]): Record<string, JsonRecord>`；`submitComfyUIWorkflow` 内部上传音频后调用它

- [ ] **Step 1: Write the failing test**

```ts
it('uploads reference audio through /upload/image and writes the LoadAudio slot', async () => {
  const client = transport();
  client.multipart
    .mockResolvedValueOnce({ name: 'canvas-reference-1.wav', subfolder: '' })
    .mockResolvedValueOnce({ name: 'ref-audio-1.mp3', subfolder: 'input' });
  client.json.mockResolvedValue({ prompt_id: 'p-audio' });
  const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: { comfyui: {
    workflow: voiceCloneWorkflow, outputNodeIds: ['52'],
    bindings: { texts: [{ nodeId: '42', input: 'text' }], audios: [{ nodeId: '40', input: 'audio' }], images: [] },
  } } }));

  await submitComfyUIWorkflow(config, {
    ...request, reference_images: [], reference_audios: ['data:audio/mpeg;base64,AAAA'],
  }, client);

  expect(client.multipart).toHaveBeenLastCalledWith('/upload/image', expect.objectContaining({
    files: [expect.objectContaining({ name: 'image', fileName: 'canvas-audio-1.mp3' })],
  }));
  expect(client.json).toHaveBeenCalledWith('/prompt', 'POST', expect.objectContaining({
    prompt: expect.objectContaining({
      '40': expect.objectContaining({ inputs: { audio: 'input/ref-audio-1.mp3' } }),
      '42': expect.objectContaining({ inputs: { text: 'a castle at dawn' } }),
    }),
  }));
});

it('rejects reference audio when the workflow has no audio slot', async () => {
  const client = transport();
  const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: { comfyui: {
    workflow: voiceDesignWorkflow, outputNodeIds: ['3'], bindings: { images: [], audios: [] },
  } } }));
  await expect(submitComfyUIWorkflow(config, {
    ...request, reference_images: [], reference_audios: ['data:audio/mpeg;base64,AAAA'],
  }, client)).rejects.toThrow('没有音频输入槽');
  expect(client.multipart).not.toHaveBeenCalled();
});

it('rejects more reference audio than the workflow accepts', async () => {
  const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: { comfyui: {
    workflow: voiceCloneWorkflow, outputNodeIds: ['52'],
    bindings: { audios: [{ nodeId: '40', input: 'audio' }], images: [] },
  } } }));
  expect(() => prepareComfyUIWorkflow(config, {
    ...request, reference_images: [], reference_audios: ['data:audio/mpeg;base64,AA', 'data:audio/mpeg;base64,BB'],
  }, [], ['a.mp3', 'b.mp3'])).toThrow('只有 1 个参考音频输入');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/canvas/infrastructure/comfyuiGateway.test.ts`
Expected: FAIL —— 音频未上传，`40` 仍是服务器文件名。

- [ ] **Step 3: Implement**

- `submitComfyUIWorkflow`：图片上传后追加音频循环，校验 `data:audio/*;base64,` 前缀，扩展名由 mime 推导（`mpeg`→`mp3`），文件字段名固定 `image`，`fileName` 为 `canvas-audio-${index + 1}.${ext}`；沿用现有 `uploadedImageName` 校验返回值。
- `prepareComfyUIWorkflow` 增加第 4 个参数 `uploadedAudioNames: string[] = []`：
  - `referenceCount < min` → 抛 `工作流至少需要 ${min} 个参考音频…`；
  - `referenceCount > audios.length` → 抛 `工作流只有 ${audios.length} 个参考音频输入…`；
  - 有参考音频但 `audios.length === 0` → 抛 `ComfyUI 工作流没有音频输入槽；请在服务器工作流中添加 LoadAudio 映射。`；
  - 通过后按顺序写入 `audios` 槽。
- 删除现有「视频类型下收到 reference_audios 即报错」的分支，参考视频报错保留。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/canvas/infrastructure/comfyuiGateway.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/canvas/infrastructure/comfyuiGateway.ts src/features/canvas/infrastructure/comfyuiGateway.test.ts
git commit -m "feat(comfyui): upload reference audio and write LoadAudio slots"
```

---

### Task 6: 音频落盘支持鉴权头与网络路由

**Files:**
- Modify: `src-tauri/src/commands/image.rs:3269-3289,2607-2608`
- Modify: `src/commands/image.ts:205-207`
- Test: `src-tauri/src/commands/image.rs`（`#[cfg(test)]` 模块内）

**Interfaces:**
- Consumes: 无
- Produces:
  - Rust: `pub async fn persist_audio_source(app, source: String, headers: Option<HashMap<String, String>>, network: Option<MediaNetworkRouteDto>) -> Result<String, String>`
  - Rust: `resolve_audio_source_bytes(source: &str, headers: Option<&HashMap<String, String>>, network: Option<&MediaNetworkRouteDto>) -> Result<(Vec<u8>, String), String>`
  - TS: `persistAudioSource(source: string, headers?: Record<string, string>, network?: MediaNetworkRoute): Promise<string>`

- [ ] **Step 1: Write the failing test**

在 `image.rs` 的测试模块追加：

```rust
#[test]
fn audio_source_resolution_accepts_auth_arguments() {
    // Compile-level guard: the audio path must accept the same auth surface as video.
    let _ = resolve_audio_source_bytes as fn(&str, Option<&HashMap<String, String>>, Option<&MediaNetworkRouteDto>) -> _;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test audio_source_resolution_accepts_auth_arguments`
Expected: FAIL —— 函数签名不匹配（少两个参数）。

- [ ] **Step 3: Implement**

- `resolve_audio_source_bytes` 增加两个参数，透传给 `download_remote_media_bytes` 的 headers 与 network 位（当前传的是 `None, None`）。
- `persist_audio_source` 增加同名参数并透传；`load_audio_source_data_url` 调用处补 `None, None`。
- `src/commands/image.ts` 的 `persistAudioSource` 增加可选参数，`invoke('persist_audio_source', { source, headers, network })`。`audioUpload.ts` 的既有调用不传新参数，行为不变。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test`
Expected: PASS，无新增 warning

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/image.rs src/commands/image.ts
git commit -m "fix(comfyui): forward auth headers and network route when persisting audio"
```

---

### Task 7: ComfyUI 出音频通道

**Files:**
- Modify: `src/features/canvas/infrastructure/customProviderGateway.ts`
- Test: `src/features/canvas/infrastructure/customProviderGateway.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `pollComfyUIWorkflow(..., 'audio', ...)`、Task 5 的 `submitComfyUIWorkflow`、Task 6 的 `persistAudioSource(source, headers, network)`
- Produces: `export async function generateComfyUIAudio(request: GenerateRequest): Promise<{ audioUrl: string }>`

- [ ] **Step 1: Write the failing test**

```ts
it('submits, polls and persists a ComfyUI audio result', async () => {
  useCustomProvidersStore.getState().replaceAll([comfyAudioProvider()]);
  vi.mocked(persistAudioSource).mockResolvedValue('file:///audio/out.mp3');
  const result = await generateComfyUIAudio({
    prompt: 'hello', model: 'custom:comfy-audio:workflow', size: '', aspect_ratio: 'auto',
    reference_images: [], reference_audios: [],
  });
  expect(result.audioUrl).toBe('file:///audio/out.mp3');
  expect(persistAudioSource).toHaveBeenCalledWith(
    expect.stringContaining('/view'), expect.anything(), expect.anything(),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/canvas/infrastructure/customProviderGateway.test.ts`
Expected: FAIL —— `generateComfyUIAudio` 未导出。

- [ ] **Step 3: Implement**

在 `customProviderGateway.ts` 新增，紧邻 `submitCustomVideoJob`：

```ts
export async function generateComfyUIAudio(request: GenerateRequest): Promise<{ audioUrl: string }>
```

实现顺序：`resolveProviderAndModel(request.model)` → 非 ComfyUI 或非 audio 抛错 → `hasCustomProviderCredential` 校验 → `parseComfyUIConfig` → `submitComfyUIWorkflow` → `pollComfyUIWorkflow(config, promptId, 'audio', createComfyUITransport(cfg, network))` → `persistAudioSource(url, 鉴权头, 网络路由)` → 返回。鉴权头复用 `buildAuthenticatedImageFetchHeaders(cfg)`，路由复用 `buildMediaNetworkRoute(cfg, network)`，与 `materializeGeneratedVideoSource` 同源。

**不新增 job 持久化**，与现有 TTS 一致（spec §5）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/canvas/infrastructure/customProviderGateway.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/canvas/infrastructure/customProviderGateway.ts src/features/canvas/infrastructure/customProviderGateway.test.ts
git commit -m "feat(comfyui): add the audio generation channel"
```

---

### Task 8: 音频模型目录

**Files:**
- Create: `src/features/canvas/application/audioModelCatalog.ts`
- Test: `src/features/canvas/application/audioModelCatalog.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `isAudioCustomProvider`；Task 3/4 的 `parseComfyUIConfig`、`effectiveTextSlots`、`getComfyUIAudioReferenceRequirements`
- Produces:
  - `interface AudioCatalogEntry { id: string; kind: 'builtin' | 'comfyui'; providerId: string; providerLabel: string; modelId: string; modelLabel: string; providerKind: AudioProviderKind; enabled: boolean; notReadyReason?: string; textSlots: ComfyUITextBinding[]; audioRefs: { min: number; max: number }; extraParams: Record<string, unknown>; audioModel?: AudioModelConfig }`
  - `function buildAudioModelCatalog(audioSettings: AudioGenerationSettings, providers: readonly CustomProviderConfig[]): AudioCatalogEntry[]`
  - `function useAudioModelCatalog(): AudioCatalogEntry[]`

`audioModel` 承载 builtin 条目的原始 `AudioModelConfig`，供 Task 10 窄化访问 `defaultVoiceId` / `outputMode` / `timeoutMs`；`comfyui` 条目该字段为 `undefined`。

- [ ] **Step 1: Write the failing test**

```ts
it('merges builtin TTS models with ComfyUI audio providers', () => {
  const catalog = buildAudioModelCatalog(DEFAULT_AUDIO_GENERATION_SETTINGS, [comfyAudioProvider()]);
  expect(catalog.filter((e) => e.kind === 'builtin').map((e) => e.id))
    .toEqual(['local-doubao-tts', 'voxcpm-online']);
  const comfy = catalog.find((e) => e.kind === 'comfyui')!;
  expect(comfy.id).toBe('custom:comfy-audio:workflow');
  expect(comfy.providerKind).toBe('comfyui');
  expect(comfy.textSlots.map(textSlotKey)).toEqual(['42.text']);
  expect(comfy.audioRefs).toEqual({ min: 0, max: 1 });
});

it('excludes image and video providers and unusable audio providers', () => {
  const catalog = buildAudioModelCatalog(DEFAULT_AUDIO_GENERATION_SETTINGS, [
    provider(), provider({ id: 'v', mediaType: 'video' }),
    comfyAudioProvider({ baseUrl: '' }),
  ]);
  expect(catalog.filter((e) => e.kind === 'comfyui')).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/canvas/application/audioModelCatalog.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: Implement**

`buildAudioModelCatalog`：先按现有顺序把 `audioSettings.models` 映射成 `kind: 'builtin'` 条目（`textSlots: []`、`audioRefs: { min: 0, max: 0 }`）；再遍历 `providers`，仅 `isAudioCustomProvider` 且 `apiStyle === 'comfyui'` 且 `hasConfiguredCustomProvider` 者，每个 `model` 产一条 `kind: 'comfyui'` 条目；`parseComfyUIConfig` 抛错时该 provider 全部标 `notReadyReason` 而不丢弃。

`useAudioModelCatalog` 用 `useSettingsStore(audioGenerationSettings)` + `useCustomProvidersStore(providers)` + `useMemo`，与 `useVideoModelCatalog` 同形。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/canvas/application/audioModelCatalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/canvas/application/audioModelCatalog.ts src/features/canvas/application/audioModelCatalog.test.ts
git commit -m "feat(audio): derive an audio model catalog including ComfyUI providers"
```

---

### Task 9: comfyui 音频 providerKind

**Files:**
- Modify: `src/stores/settingsStore.ts:49,404-406`
- Modify: `src/features/canvas/application/audioInputSchema.ts:312`
- Test: `src/features/canvas/application/audioInputSchema.test.ts`（若不存在则新建）

**Interfaces:**
- Consumes: 无
- Produces: `AudioProviderKind` 含 `'comfyui'`；`defaultAudioInputSchemaForProviderKind('comfyui')` 返回所有输入关闭的 schema

- [ ] **Step 1: Write the failing test**

```ts
it('disables every TTS concept for the comfyui provider kind', () => {
  const schema = defaultAudioInputSchemaForProviderKind('comfyui');
  expect(schema.voice.enabled).toBe(false);
  expect(schema.referenceAudio.enabled).toBe(false);
  expect(schema.controlInstruction.enabled).toBe(false);
  expect(schema.promptText.enabled).toBe(false);
  expect(schema.parameters).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/canvas/application/audioInputSchema.test.ts`
Expected: FAIL —— 回落到 `DEFAULT_AUDIO_INPUT_SCHEMA`，`voice.enabled` 为 `true`。

- [ ] **Step 3: Implement**

- `AudioProviderKind` 加 `'comfyui'`；`normalizeAudioProviderKind` 接受该值。
- `AUDIO_PROVIDER_ORDER` / `PROVIDER_LABELS`（`AudioModelsSection.tsx`）**不**加 `comfyui` —— 它不属于「设置 → 音频模型」页面（spec §5）。若 TS 因 `Record<AudioProviderKind, …>` 报缺键，把该 Record 的键类型收窄为 `Exclude<AudioProviderKind, 'comfyui'>`。
- `defaultAudioInputSchemaForProviderKind('comfyui')` 返回关闭全部输入的 schema。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/canvas/application/audioInputSchema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/features/canvas/application/audioInputSchema.ts src/components/settings/AudioModelsSection.tsx src/features/canvas/application/audioInputSchema.test.ts
git commit -m "feat(audio): add the comfyui provider kind with no TTS-only inputs"
```

---

### Task 10: AI 音频节点接入 ComfyUI

**Files:**
- Modify: `src/features/canvas/nodes/AiAudioNode.tsx:238-276,614-730,928-970,1070-1140`
- Test: 无新增自动化测试（节点层无现成 harness）；由 Task 12 的真机验收覆盖

**Interfaces:**
- Consumes: Task 8 的 `useAudioModelCatalog` / `AudioCatalogEntry`；Task 7 的 `generateComfyUIAudio`；Task 3 的 `textSlotKey`
- Produces: `AiAudioNodeData.audioSlotValues?: Record<string, string>`（槽键 → 用户输入值）

- [ ] **Step 1: 替换模型来源**

`enabledModels` / `selectedModel` 改读 `useAudioModelCatalog()`，过滤 `enabled`。`selectedModel` 类型变为 `AudioCatalogEntry | null`。所有 `model.defaultVoiceId`、`model.outputMode`、`model.apiBaseUrl`、`model.timeoutMs`、`model.extraParams`、`model.providerKind` 的访问点改为 `entry.kind === 'builtin' ? entry.audioModel! : null` 的窄化访问——在 `AudioCatalogEntry` 上加一个 `audioModel?: AudioModelConfig` 字段承载原始 TTS 配置（Task 8 补齐该字段）。

- [ ] **Step 2: 多文本槽渲染**

当 `selectedModel.kind === 'comfyui'`：

- 用 `selectedModel.textSlots` 渲染 N 个 textarea（N ≥ 1），每个的 `label` 用 `slot.label ?? textSlotKey(slot)`；值为 `data.audioSlotValues?.[textSlotKey(slot)] ?? ''`，改动写回 `updateNodeData(id, { audioSlotValues: { ...current, [key]: value } })`。
- `textSlots.length === 0` 时显示提示 `该工作流没有可绑定的文本输入`，并禁用生成按钮。
- 保留现有 `promptDraft` 文本框的 TTS 路径不变（`kind === 'builtin'` 时）。

- [ ] **Step 3: 生成分派**

`handleGenerate` 内：`selectedModel.kind === 'comfyui'` 时组装 `GenerateRequest`：

- `prompt` 取 `selectedModel.textSlots[0]` 对应的值；
- **全部槽值**（含首槽）放进 `extra_params.textSlotValues`，键为 `textSlotKey(slot)`——这是 Task 3 定义的唯一多槽写入通道；
- 参考音频放进 `reference_audios`。

调用 `generateComfyUIAudio`，结果写进新建的音频卡片（`audioUrl` / `localAudioUrl`），错误路径复用现有 `resolveErrorContent` + `showErrorDialog`。`kind === 'builtin'` 时走现有 `generateAudio`，代码路径保持原样。

- [ ] **Step 4: 参考音频入口**

`selectedModel.kind === 'comfyui'` 时，参考音频入口的显示条件改为 `selectedModel.audioRefs.max > 0`；必填提示用 `audioRefs.min`。参考音频取自现有 `incomingAudioReferences`（已存在），最多取 `audioRefs.max` 个。

- [ ] **Step 5: 验证既有行为未变**

Run: `npm test`
Expected: PASS —— 全量测试无新增失败；`AiAudioNode` 的 TTS 分支逻辑未改动。

- [ ] **Step 6: Commit**

```bash
git add src/features/canvas/nodes/AiAudioNode.tsx src/features/canvas/application/audioModelCatalog.ts
git commit -m "feat(audio): let the AI audio node run ComfyUI audio workflows"
```

---

### Task 11: 工作台 UI 增加「声音输出」

**Files:**
- Modify: `src/components/settings/CustomImageProviderWorkbench.tsx:629-640,880-905,935`
- Modify: `src/components/settings/customImageProviderWorkbenchState.ts:112-128`
- Modify: `src/i18n/locales/zh.json:2199-2200`, `src/i18n/locales/en.json:2203-2204`
- Test: `src/components/settings/customImageProviderWorkbenchState.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `'audio'` mediaType；Task 3 的 `effectiveTextSlots`
- Produces: 无新导出；下拉第三项值 `'audio'`；`createWorkbenchPreviewRequest` 对 audio 返回 prompt-only 请求

- [ ] **Step 1: Write the failing test**

```ts
it('builds a prompt-only preview request for audio workflows', () => {
  const draft = createComfyUIProviderWorkbenchDraft();
  draft.mediaType = 'audio';
  draft.extraParams.comfyui = {
    workflow: {
      '1': { class_type: 'FB_Qwen3TTSVoiceDesign', inputs: { text: ['2', 0] } },
      '2': { class_type: 'JjkText', inputs: { text: '' } },
      '3': { class_type: 'SaveAudio', inputs: { audio: ['1', 0] } },
    },
    bindings: { images: [], audios: [] }, outputNodeIds: ['3'],
  };
  const config = customImageProviderDraftToConfig(draft, 'audio').value!;
  const sample = createWorkbenchPreviewRequest(config, 'workflow');
  expect(sample).toMatchObject({ size: '', aspect_ratio: 'auto' });
  expect(sample.reference_images).toBeUndefined();
  expect(sample.extra_params?.seconds).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/settings/customImageProviderWorkbenchState.test.ts`
Expected: FAIL —— audio 走 image 分支，`size` 为 `'1024x1024'` 并塞了参考图。

- [ ] **Step 3: Implement**

- `createWorkbenchPreviewRequest`：`config.mediaType === 'audio'` 时直接返回 `{ prompt, model, size: '', aspect_ratio: 'auto' }`，不取参考图/尺寸/时长。
- 下拉：`value` 三值映射，新增 `<option value="audio">`；onChange 写回 `mediaType`。
- 能力步骤：audio 时隐藏 `durations` / `ratios` 两个输入（它们只对 video 有意义）。
- review 卡片：`ComfyUI Audio` / `ComfyUI Video` / `ComfyUI Image` 三值。
- locale：`zh` `comfyOutputAudio: "声音输出"`，`en` `comfyOutputAudio: "Audio Output"`；`comfyOutputs` 帮助文案补 `SaveAudio`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/settings/customImageProviderWorkbenchState.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/CustomImageProviderWorkbench.tsx src/components/settings/customImageProviderWorkbenchState.ts src/i18n/locales/zh.json src/i18n/locales/en.json src/components/settings/customImageProviderWorkbenchState.test.ts
git commit -m "feat(settings): offer audio output for ComfyUI workflows"
```

---

### Task 12: 全量验证与真机验收记录

**Files:**
- Create: `docs/reviews/2026-10-26-comfyui-audio-validation.md`

**Interfaces:**
- Consumes: 全部前述任务
- Produces: 验证记录文档

- [ ] **Step 1: 跑全量前端测试**

Run: `npm test`
Expected: PASS，0 failed

- [ ] **Step 2: 跑类型检查与构建**

Run: `npm run build`
Expected: 成功，无 TS 错误

- [ ] **Step 3: 跑 Rust 测试**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 4: 用四个真实工作流跑导入识别**

在应用内依次导入 `Qwen3 TTS语音生成音色设计.json`、`qwen3tts-参考声人声.json`、`audio_yue2_music_cover.json`、`audio_yue2_text2music (2).json`，核对文本槽与输出节点与 spec §4.4 的表一致。**此步不需要 ComfyUI 在跑**。

- [ ] **Step 5: 写验证记录**

文档分三节：已通过（列命令与结果）、未验证（真机出声音、参考音频驱动音色、远程 ComfyUI 鉴权下载）、边界（music-cover 无槽、需改造工作流）。**不得**把 Step 1-4 的通过写成「端到端已验证」。

- [ ] **Step 6: Commit**

```bash
git add docs/reviews/2026-10-26-comfyui-audio-validation.md
git commit -m "docs(comfyui): record audio output validation scope"
```
