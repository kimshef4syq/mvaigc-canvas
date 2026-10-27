import { describe, expect, it, vi } from 'vitest';
import type { CustomProviderConfig } from '@/stores/customProvidersStore';
import { buildVideoModelCatalog } from '@/features/canvas/application/videoModelCatalog';
import type { GenerateRequest } from '@/commands/ai';
import {
  checkComfyUIConnection,
  ComfyUIExecutionError,
  createComfyUIWorkflowTemplate,
  effectiveTextSlots,
  getComfyUIAudioReferenceRequirements,
  getComfyUITemplateCheckpoint,
  getComfyUIVideoCapabilities,
  inspectComfyUIHistory,
  listComfyUICheckpoints,
  parseComfyUIConfig,
  pollComfyUIWorkflow,
  prepareComfyUIWorkflow,
  submitComfyUIWorkflow,
  suggestComfyUIBindings,
  suggestComfyUIOutputNodes,
  textSlotKey,
  validateComfyUIRequest,
  withComfyUITemplateCheckpoint,
  type ComfyUITransport,
} from './comfyuiGateway';

const workflow = {
  '3': { class_type: 'KSampler', inputs: { seed: 1, positive: ['6', 0] } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'original prompt' } },
  '9': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
  '10': { class_type: 'LoadImage', inputs: { image: 'old.png' } },
};

const dualPromptWorkflow = {
  ...workflow,
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'negative prompt' } },
};

const audioWorkflow = {
  '1': { class_type: 'LoadAudio', inputs: { audio: '' } },
  '2': { class_type: 'FB_Qwen3TTSVoiceClone', inputs: { target_text: ['3', 0], ref_audio: ['1', 0] } },
  '3': { class_type: 'Text', inputs: { text: 'hello' } },
  '4': { class_type: 'SaveAudioMP3', inputs: { audio: ['2', 0], quality: '128k' } },
  '5': { class_type: 'PreviewAudio', inputs: { audio: ['2', 0] } },
};

// Same graph with the LoadAudio slot already filled on the server, so the reference audio is optional.
const filledAudioWorkflow = {
  ...audioWorkflow,
  '1': { class_type: 'LoadAudio', inputs: { audio: 'server.wav' } },
};

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

function provider(overrides: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  return {
    id: 'comfy-1',
    label: 'Local ComfyUI',
    mediaType: 'image',
    baseUrl: 'http://127.0.0.1:8188',
    apiKey: '',
    apiStyle: 'comfyui',
    models: ['workflow'],
    supportsWebSearch: false,
    extraParams: {
      auth: { mode: 'none' },
      comfyui: { workflow, outputNodeIds: ['9'] },
    },
    ...overrides,
  };
}

const request: GenerateRequest = {
  prompt: 'a castle at dawn',
  model: 'custom:comfy-1:workflow',
  size: '1024x768',
  aspect_ratio: '4:3',
  reference_images: ['data:image/png;base64,AAAA'],
  extra_params: { seed: 42 },
};

function transport(): ComfyUITransport & { json: ReturnType<typeof vi.fn>; multipart: ReturnType<typeof vi.fn> } {
  return {
    json: vi.fn(),
    multipart: vi.fn(),
    url: (path, query) => `http://127.0.0.1:8188${path}?${new URLSearchParams(query).toString()}`,
  };
}

describe('ComfyUI workflow gateway', () => {
  it('builds core text and reference image templates with editable checkpoint names', () => {
    for (const id of ['text-to-image', 'image-to-image'] as const) {
      const template = createComfyUIWorkflowTemplate(id, 'model.safetensors');
      const config = parseComfyUIConfig(provider({ extraParams: { comfyui: template } }));
      expect(() => validateComfyUIRequest(config, { ...request, reference_images: id === 'image-to-image' ? request.reference_images : [] })).not.toThrow();
      expect(getComfyUITemplateCheckpoint(template.workflow)).toBe('model.safetensors');
      expect(withComfyUITemplateCheckpoint(template.workflow, 'new.safetensors')['1'].inputs).toMatchObject({ ckpt_name: 'new.safetensors' });
      expect(getComfyUITemplateCheckpoint(template.workflow)).toBe('model.safetensors');
      expect(template.outputNodeIds).toEqual(['8']);
    }
  });

  it('lists checkpoints from the direct endpoint or object info fallback', async () => {
    const direct = transport();
    direct.json.mockResolvedValueOnce(['a.safetensors', 'b.safetensors']);
    await expect(listComfyUICheckpoints(direct)).resolves.toEqual(['a.safetensors', 'b.safetensors']);
    expect(direct.json).toHaveBeenCalledTimes(1);

    const fallback = transport();
    fallback.json.mockRejectedValueOnce(new Error('unsupported')).mockResolvedValueOnce({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['legacy.ckpt']] } } },
    });
    await expect(listComfyUICheckpoints(fallback)).resolves.toEqual(['legacy.ckpt']);
    expect(fallback.json.mock.calls).toEqual([
      ['/models/checkpoints', 'GET'],
      ['/object_info/CheckpointLoaderSimple', 'GET'],
    ]);
  });

  it('requires API format and suggests common bindings and output nodes', () => {
    expect(() => parseComfyUIConfig(provider({ extraParams: {
      comfyui: { workflow: { nodes: [], links: [] } },
    } }))).toThrow('API 格式');
    expect(suggestComfyUIBindings(workflow)).toMatchObject({
      prompt: { nodeId: '6', input: 'text' },
      seed: { nodeId: '3', input: 'seed' },
      width: { nodeId: '5', input: 'width' },
      height: { nodeId: '5', input: 'height' },
      images: [{ nodeId: '10', input: 'image' }],
    });
    expect(suggestComfyUIOutputNodes(workflow)).toEqual(['9']);
  });

  it('patches prompt, seed, dimensions and uploaded image without mutating the saved graph', () => {
    const config = parseComfyUIConfig(provider());
    const patched = prepareComfyUIWorkflow(config, request, ['uploaded.png']);
    expect(patched['6'].inputs).toMatchObject({ text: 'a castle at dawn' });
    expect(patched['3'].inputs).toMatchObject({ seed: 42 });
    expect(patched['5'].inputs).toMatchObject({ width: 1024, height: 768 });
    expect(patched['10'].inputs).toMatchObject({ image: 'uploaded.png' });
    expect(workflow['10'].inputs.image).toBe('old.png');
  });

  it('requires an explicit positive prompt binding when a workflow has positive and negative text nodes', () => {
    const base = provider({ extraParams: { comfyui: { workflow: dualPromptWorkflow, outputNodeIds: ['9'] } } });
    const unmapped = parseComfyUIConfig(base);
    expect(() => validateComfyUIRequest(unmapped, { ...request, reference_images: [] }))
      .toThrow('请选择 ComfyUI 提示词节点');

    const mapped = parseComfyUIConfig(provider({ extraParams: {
      comfyui: {
        workflow: dualPromptWorkflow,
        outputNodeIds: ['9'],
        bindings: { prompt: { nodeId: '6', input: 'text' }, images: [] },
      },
    } }));
    expect(() => validateComfyUIRequest(mapped, { ...request, reference_images: [] })).not.toThrow();
  });

  it('rejects missing reference mapping before upload or generation', async () => {
    const config = parseComfyUIConfig(provider());
    const twoImages = { ...request, reference_images: [...request.reference_images!, 'data:image/png;base64,BBBB'] };
    expect(() => validateComfyUIRequest(config, twoImages)).toThrow('只有 1 个参考图输入');
    const client = transport();
    await expect(submitComfyUIWorkflow(config, twoImages, client)).rejects.toThrow('只有 1 个参考图输入');
    expect(client.multipart).not.toHaveBeenCalled();
    expect(client.json).not.toHaveBeenCalled();
  });

  it('uploads references then submits the patched workflow exactly once', async () => {
    const client = transport();
    client.multipart.mockResolvedValue({ name: 'uploaded.png', subfolder: '' });
    client.json.mockResolvedValue({ prompt_id: 'prompt-123' });
    const result = await submitComfyUIWorkflow(parseComfyUIConfig(provider()), request, client);

    expect(result).toEqual({ prompt_id: 'prompt-123' });
    expect(client.multipart).toHaveBeenCalledWith('/upload/image', expect.objectContaining({
      files: [expect.objectContaining({ name: 'image', fileName: 'canvas-reference-1.png' })],
    }));
    expect(client.json).toHaveBeenCalledTimes(1);
    expect(client.json).toHaveBeenCalledWith('/prompt', 'POST', expect.objectContaining({
      prompt: expect.objectContaining({
        '6': expect.objectContaining({ inputs: { text: 'a castle at dawn' } }),
        '10': expect.objectContaining({ inputs: { image: 'uploaded.png' } }),
      }),
    }));
  });

  it('parses selected image/video outputs and terminal execution failures', () => {
    const config = parseComfyUIConfig(provider());
    expect(inspectComfyUIHistory({}, 'prompt-123', config, 'image').state).toBe('pending');
    expect(inspectComfyUIHistory({
      'prompt-123': { outputs: { '9': { images: [{ filename: 'final.png', subfolder: '', type: 'output' }] } } },
    }, 'prompt-123', config, 'image')).toMatchObject({
      state: 'ready', file: { filename: 'final.png' },
    });
    expect(inspectComfyUIHistory({
      'prompt-123': { outputs: { '9': { gifs: [{ filename: 'clip.mp4', subfolder: '', type: 'output' }] } } },
    }, 'prompt-123', config, 'video')).toMatchObject({
      state: 'ready', file: { filename: 'clip.mp4' },
    });
    expect(inspectComfyUIHistory({
      'prompt-123': { outputs: { '9': { animations: [
        { filename: 'preview.mp4', subfolder: '', type: 'temp' },
        { filename: 'final.mp4', subfolder: '', type: 'output' },
      ] } } },
    }, 'prompt-123', config, 'video')).toMatchObject({
      state: 'ready', file: { filename: 'final.mp4', type: 'output' },
    });
    expect(inspectComfyUIHistory({
      'prompt-123': { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'missing checkpoint' }]] } },
    }, 'prompt-123', config, 'image')).toEqual({ state: 'failed', error: 'missing checkpoint' });
  });

  it('polls by prompt id and returns a safe /view URL without resubmitting', async () => {
    const config = { ...parseComfyUIConfig(provider()), pollIntervalMs: 1 };
    const client = transport();
    client.json
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        'prompt-123': { outputs: { '9': { images: [{ filename: 'final.png', subfolder: 'results', type: 'output' }] } } },
      });
    const url = await pollComfyUIWorkflow(config, 'prompt-123', 'image', client);
    expect(url).toContain('/view?filename=final.png&subfolder=results&type=output');
    expect(client.json).toHaveBeenCalledTimes(2);
    expect(client.json).toHaveBeenCalledWith('/history/prompt-123', 'GET');
    expect(client.multipart).not.toHaveBeenCalled();
  });

  it('distinguishes terminal failure from a task that can be polled again', async () => {
    const client = transport();
    client.json.mockResolvedValue({ 'prompt-123': { status: { status_str: 'error' } } });
    await expect(pollComfyUIWorkflow(parseComfyUIConfig(provider()), 'prompt-123', 'image', client))
      .rejects.toBeInstanceOf(ComfyUIExecutionError);
  });

  it('checks connectivity with read-only endpoints', async () => {
    const client = transport();
    client.json.mockRejectedValueOnce(new Error('not found')).mockResolvedValueOnce({ queue_running: [] });
    await checkComfyUIConnection(client);
    expect(client.json.mock.calls).toEqual([
      ['/system_stats', 'GET'],
      ['/queue', 'GET'],
    ]);
    expect(client.multipart).not.toHaveBeenCalled();
  });
});

const h3Workflow = {
  '1': { class_type: 'MiniMaxH3ImageToVideo', inputs: { prompt: '', width: 1344, height: 768, length: 124 } },
  '2': { class_type: 'RandomNoise', inputs: { noise_seed: 7 } },
  '9': { class_type: 'SaveVideo', inputs: { video: ['8', 0], format: 'auto', codec: 'auto', filename_prefix: 'video/H3' } },
};
function h3Provider(): CustomProviderConfig {
  return provider({ mediaType: 'video', extraParams: { auth: { mode: 'none' }, comfyui: { workflow: h3Workflow } } });
}

describe('ComfyUI video workflow contracts', () => {
  it('infers H3 prompt, canvas, frame count and noise seed from the real local node classes', () => {
    expect(suggestComfyUIBindings(h3Workflow)).toMatchObject({
      prompt: { nodeId: '1', input: 'prompt' }, width: { nodeId: '1', input: 'width' },
      height: { nodeId: '1', input: 'height' }, duration: { nodeId: '1', input: 'length' },
      seed: { nodeId: '2', input: 'noise_seed' }, images: [],
    });
    expect(suggestComfyUIBindings({ ...h3Workflow, '2': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: 17 } } }).seed)
      .toEqual({ nodeId: '2', input: 'noise_seed' });
  });

  it.each([[5, 124], [8, 192], [15, 362]])('maps %s seconds to %s H3 frames and uses a video canvas', (seconds, frames) => {
    const patched = prepareComfyUIWorkflow(parseComfyUIConfig(h3Provider()), {
      ...request, size: '768P', aspect_ratio: '9:16', reference_images: [], extra_params: { seconds, seed: 42 },
    });
    expect(patched['1'].inputs).toMatchObject({ prompt: request.prompt, length: frames, width: 768, height: 1344 });
    expect(patched['2'].inputs).toEqual({ noise_seed: 42 });
    expect(h3Workflow['1'].inputs.length).toBe(124);
  });

  it.each(['2048x2048', '1333x768', '2K'])('rejects invalid H3 size %s before submitting', async (size) => {
    const client = transport();
    await expect(submitComfyUIWorkflow(parseComfyUIConfig(h3Provider()), { ...request, size, reference_images: [] }, client)).rejects.toThrow();
    expect(client.json).not.toHaveBeenCalled();
    expect(client.multipart).not.toHaveBeenCalled();
  });

  it('writes explicit generic video duration, resolution and ratio bindings', () => {
    const config = parseComfyUIConfig(provider({ mediaType: 'video', extraParams: { comfyui: {
      workflow: { '1': { class_type: 'CustomVideo', inputs: { prompt: '', duration: 6, resolution: '720p', ratio: '16:9' } } },
      bindings: { prompt: { nodeId: '1', input: 'prompt' }, duration: { nodeId: '1', input: 'duration' },
        resolution: { nodeId: '1', input: 'resolution' }, aspectRatio: { nodeId: '1', input: 'ratio' }, images: [] },
    } } }));
    const patched = prepareComfyUIWorkflow(config, { ...request, size: '1080p', aspect_ratio: '9:16', reference_images: [], extra_params: { seconds: 12 } });
    expect(patched['1'].inputs).toEqual({ prompt: request.prompt, duration: 12, resolution: '1080p', ratio: '9:16' });
  });

  it('rejects missing required reference images before uploading or submitting', async () => {
    const config = parseComfyUIConfig(provider({ extraParams: { comfyui: createComfyUIWorkflowTemplate('image-to-image', 'model.safetensors') } }));
    const client = transport();
    await expect(submitComfyUIWorkflow(config, { ...request, reference_images: [] }, client)).rejects.toThrow('至少需要 1 张');
    expect(client.json).not.toHaveBeenCalled();
    expect(client.multipart).not.toHaveBeenCalled();
    expect(() => validateComfyUIRequest(parseComfyUIConfig(provider()), { ...request, reference_images: [] })).not.toThrow();
  });

  it('exposes only actual image bindings and keeps unbound video parameters in the workflow', () => {
    const fixed = provider({ mediaType: 'video', extraParams: { comfyui: { workflow },
      supportedDurations: ['4', '8', '12'], videoInputSchema: { images: { enabled: true, max: 9 }, video: { enabled: true } } } });
    const capabilities = getComfyUIVideoCapabilities(parseComfyUIConfig(fixed));
    expect(capabilities.supportedDurations).toEqual(['workflow']);
    expect(capabilities.inputSchema).toMatchObject({ images: { min: 0, max: 1, roles: ['reference'] }, video: { enabled: false }, audio: { enabled: false } });
    const entries = buildVideoModelCatalog([fixed, h3Provider()]);
    expect(entries[0].supportedDurations).toEqual(['workflow']);
    expect(entries[0].inputSchema.images.max).toBe(1);
    expect(entries[1].supportedDurations).toEqual(['5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15']);
    expect(entries[1].inputSchema.images.enabled).toBe(false);
    expect(entries[1].supportedResolutions).toEqual(['768P']);
  });

  it('accepts the real SaveVideo history images array containing an mp4', () => {
    expect(inspectComfyUIHistory({ task: { status: { completed: true }, outputs: { '9': { images: [
      { filename: 'H3_00001_.mp4', subfolder: 'video', type: 'output' },
    ] } } } }, 'task', parseComfyUIConfig(h3Provider()), 'video')).toMatchObject({ state: 'ready', file: { filename: 'H3_00001_.mp4', subfolder: 'video' } });
  });

  it('rejects video/audio uploads before network activity instead of silently ignoring them', async () => {
    const client = transport();
    await expect(submitComfyUIWorkflow(parseComfyUIConfig(h3Provider()), { ...request, size: '768P', reference_images: [], reference_videos: ['https://example.com/clip.mp4'] }, client)).rejects.toThrow('视频和音频');
    expect(client.json).not.toHaveBeenCalled();
  });

  it('does not accept traversal or input files as generated video results', () => {
    for (const file of [
      { filename: '../clip.mp4', subfolder: '', type: 'output' },
      { filename: 'clip.mp4', subfolder: '../private', type: 'output' },
      { filename: 'clip.mp4', subfolder: '', type: 'input' },
    ]) {
      expect(inspectComfyUIHistory({ task: { status: { completed: true }, outputs: { '9': { images: [file] } } } }, 'task', parseComfyUIConfig(h3Provider()), 'video').state).toBe('failed');
    }
  });
});

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

  it('names the missing artifact as audio in the completion error', () => {
    const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: {
      comfyui: { workflow: audioWorkflow, outputNodeIds: ['4'] },
    } }));
    expect(inspectComfyUIHistory({
      'p1': { outputs: {}, status: { completed: true, status_str: 'success' } },
    }, 'p1', config, 'audio')).toMatchObject({ error: expect.stringContaining('音频') });
  });

  it('does not apply image geometry to an audio workflow', () => {
    const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: {
      comfyui: {
        workflow: filledAudioWorkflow,
        outputNodeIds: ['4'],
        bindings: { prompt: { nodeId: '3', input: 'text' }, images: [] },
      },
    } }));
    expect(() => prepareComfyUIWorkflow(config, { ...request, reference_images: [], size: '1024x768' }))
      .not.toThrow();
  });

  it('leaves an explicitly bound audio size untouched instead of rewriting it as image geometry', () => {
    const sizedAudioWorkflow = {
      ...filledAudioWorkflow,
      '6': { class_type: 'EmptyLatentAudio', inputs: { width: 512, height: 512 } },
    };
    const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: {
      comfyui: {
        workflow: sizedAudioWorkflow,
        outputNodeIds: ['4'],
        bindings: {
          prompt: { nodeId: '3', input: 'text' },
          width: { nodeId: '6', input: 'width' },
          height: { nodeId: '6', input: 'height' },
          images: [],
        },
      },
    } }));
    const patched = prepareComfyUIWorkflow(config, { ...request, reference_images: [], size: '1024x768' });
    expect(patched['6'].inputs).toMatchObject({ width: 512, height: 512 });
  });
});

describe('ComfyUI reference audio uploads', () => {
  it('uploads reference audio through /upload/image and writes the LoadAudio slot', async () => {
    const client = transport();
    client.multipart.mockResolvedValueOnce({ name: 'ref-audio-1.mp3', subfolder: 'input' });
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

  it('requires reference audio when an audio workflow has an empty LoadAudio slot', () => {
    const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: { comfyui: {
      workflow: audioWorkflow, outputNodeIds: ['4'],
      bindings: { prompt: { nodeId: '3', input: 'text' }, audios: [{ nodeId: '1', input: 'audio' }], images: [] },
    } } }));
    expect(() => prepareComfyUIWorkflow(config, { ...request, reference_images: [], reference_audios: [] }))
      .toThrow('至少需要 1 个参考音频');
  });

  it('does not let an empty LoadAudio slot block an image workflow that passes no reference audio', () => {
    const config = parseComfyUIConfig(provider({ extraParams: { comfyui: {
      workflow: { ...workflow, '11': { class_type: 'LoadAudio', inputs: { audio: '' } } },
      outputNodeIds: ['9'], bindings: { images: [] },
    } } }));
    expect(() => prepareComfyUIWorkflow(config, { ...request, reference_images: [] })).not.toThrow();
  });

  it('rejects reference audio for a workflow that is not audio output', async () => {
    const config = parseComfyUIConfig(provider({ extraParams: { comfyui: {
      workflow: { ...workflow, '11': { class_type: 'LoadAudio', inputs: { audio: '' } } },
      outputNodeIds: ['9'], bindings: { images: [] },
    } } }));
    expect(() => prepareComfyUIWorkflow(config, {
      ...request, reference_images: [], reference_audios: ['data:audio/mpeg;base64,AAAA'],
    }, [], ['a.mp3'])).toThrow('该工作流不是音频输出类型，不能传入参考音频。');
    const client = transport();
    await expect(submitComfyUIWorkflow(config, {
      ...request, reference_images: [], reference_audios: ['data:audio/mpeg;base64,AAAA'],
    }, client)).rejects.toThrow('不是音频输出类型');
    // The pre-upload validation rejects before the audio upload loop is reached.
    expect(client.multipart).not.toHaveBeenCalled();
  });
});

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
    expect(patched['10'].inputs).toMatchObject({ text: 'BODY-NEW' });
    expect(patched['11'].inputs).toMatchObject({ text: 'VOICE-NEW' });
  });

  it('parses audio bindings and treats a filled server filename as optional', () => {
    const filled = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: { comfyui: {
      workflow: filledAudioWorkflow,
      outputNodeIds: ['4'],
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

  it('drops an ambiguous field name when unrelated candidates share it', () => {
    const ambiguousWorkflow = {
      '1': { class_type: 'SomeGenerator', inputs: { text: ['10', 0], instruct: ['11', 0] } },
      '2': { class_type: 'OtherGenerator', inputs: { text: ['12', 0] } },
      '10': { class_type: 'JjkText', inputs: { text: 'A' } },
      '11': { class_type: 'JjkText', inputs: { text: 'B' } },
      '12': { class_type: 'JjkText', inputs: { text: 'C' } },
    };
    // Two unrelated `text` candidates leave the field name unusable; `instruct` is still unambiguous.
    expect(suggestComfyUIBindings(ambiguousWorkflow).texts)
      .toEqual([{ nodeId: '11', input: 'text', label: '音色描述' }]);
  });

  it('still requires an explicit prompt binding for a dual CLIPTextEncode workflow', () => {
    expect(suggestComfyUIBindings(dualPromptWorkflow).texts).toEqual([]);
    const unmapped = parseComfyUIConfig(provider({ extraParams: { comfyui: { workflow: dualPromptWorkflow, outputNodeIds: ['9'] } } }));
    expect(() => validateComfyUIRequest(unmapped, { ...request, reference_images: [] }))
      .toThrow('请选择 ComfyUI 提示词节点');
  });

  it('traces a text slot through a forwarding node to the literal it reads', () => {
    const switchedWorkflow = {
      '1': { class_type: 'SomeTTS', inputs: { text: ['20', 0] } },
      '20': { class_type: 'ComfySwitchNode', inputs: { on_true: ['21', 0], on_false: ['21', 0], value: ['22', 0] } },
      '22': { class_type: 'PrimitiveStringMultiline', inputs: { value: 'SPOKEN' } },
      '30': { class_type: 'SaveAudio', inputs: { audio: ['1', 0] } },
    };
    expect(suggestComfyUIBindings(switchedWorkflow).texts)
      .toEqual([{ nodeId: '22', input: 'value', label: '目标文本' }]);
  });

  it('does not let detection bind a linked negative prompt in an image workflow', () => {
    const linkedNegativeWorkflow = {
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'positive inline' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: ['12', 0] } },
      '9': { class_type: 'SaveImage', inputs: { images: ['6', 0] } },
      '12': { class_type: 'PrimitiveStringMultiline', inputs: { value: 'ugly, blurry' } },
    };
    // Two CLIPTextEncode nodes leave `prompt` unresolved; the single detected slot is the negative one,
    // so detection must not apply and the legacy guard must still fire.
    const imageConfig = parseComfyUIConfig(provider({ extraParams: { comfyui: {
      workflow: linkedNegativeWorkflow, outputNodeIds: ['9'],
    } } }));
    expect(() => prepareComfyUIWorkflow(imageConfig, { ...request, reference_images: [] }))
      .toThrow('请选择 ComfyUI 提示词节点');

    // The same shape is usable for audio, where the slot UI is what tells the user which slot is which.
    const audioConfig = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: { comfyui: {
      workflow: linkedNegativeWorkflow, outputNodeIds: ['9'],
    } } }));
    const patched = prepareComfyUIWorkflow(audioConfig, { ...request, reference_images: [], prompt: 'SPOKEN' });
    expect(patched['12'].inputs).toMatchObject({ value: 'SPOKEN' });
  });

  it('keeps an explicit prompt binding instead of detected slots', () => {
    const config = parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: { comfyui: {
      workflow: voiceDesignWorkflow,
      outputNodeIds: ['3'],
      bindings: { prompt: { nodeId: '11', input: 'text' }, images: [], audios: [] },
    } } }));
    expect(effectiveTextSlots(config.bindings).map(textSlotKey)).toEqual(['11.text']);
    // Detection must not leak in: the prompt lands on the user's slot, not on detected slot 0.
    const patched = prepareComfyUIWorkflow(config, { ...request, reference_images: [], prompt: 'NEW' });
    expect(patched['11'].inputs).toMatchObject({ text: 'NEW' });
    expect(patched['10'].inputs).toMatchObject({ text: 'BODY' });
  });
});


it('honors audio mediaType stored only in extraParams', () => {
  const config = provider({ mediaType: 'image', extraParams: {
    mediaType: 'audio', comfyui: { workflow: audioWorkflow, bindings: { images: [], audios: [] }, outputNodeIds: ['4'] },
  } });
  expect(parseComfyUIConfig(config).mediaType).toBe('audio');
});

describe('YuE2 ABC controls', () => {
  const abcWorkflow = {
    ...text2MusicWorkflow,
    '33:25': { class_type: 'YuE2GenerateMusic', inputs: { style: ['33:36', 0], lyrics: ['33:37', 0], abc: ['33:14', 0] } },
    '33:14': { class_type: 'PreviewAny', inputs: { source: ['33:30', 0] } },
    '33:30': { class_type: 'ComfySwitchNode', inputs: { switch: ['33:31', 0], on_true: ['33:24', 0], on_false: ['33:32', 0] } },
    '33:32': { class_type: 'PrimitiveString', inputs: { value: '' } },
  };
  const config = (bindings?: Record<string, unknown>) => parseComfyUIConfig(provider({ mediaType: 'audio', extraParams: {
    comfyui: { workflow: abcWorkflow, bindings: { images: [], audios: [], ...bindings }, outputNodeIds: ['10'] },
  } }));
  const request: GenerateRequest = { prompt: 'pop', model: 'workflow', size: 'workflow', aspect_ratio: 'auto' };

  it('detects the planning switch and a direct optional score input without treating its control text as music input', () => {
    const bindings = suggestComfyUIBindings(abcWorkflow);
    expect(bindings.booleans).toEqual([{ nodeId: '33:31', input: 'value', label: 'ABC planning（自动规划）', defaultValue: false }]);
    expect(bindings.texts?.map(textSlotKey)).toEqual(['33:36.value', '33:37.value', '33:25.abc']);
    expect(bindings.texts?.[2]).toMatchObject({ preserveWhenEmpty: true });
  });

  it.each([true, false])('submits a real boolean %s and preserves the planning branch when custom score is blank', (enabled) => {
    const prepared = prepareComfyUIWorkflow(config(), { ...request, extra_params: {
      booleanSlotValues: { '33:31.value': enabled }, textSlotValues: { '33:25.abc': ' \n ' },
    } });
    expect(prepared['33:31']).toMatchObject({ inputs: { value: enabled } });
    expect(prepared['33:25']).toMatchObject({ inputs: { abc: ['33:14', 0] } });
    expect(abcWorkflow['33:31'].inputs.value).toEqual(['42', 0]);
  });

  it('routes a supplied score directly into music generation, overriding the connected planning output', () => {
    const score = 'X:1\nM:4/4\nK:C\nCDEF|';
    const prepared = prepareComfyUIWorkflow(config(), { ...request, extra_params: {
      textSlotValues: { '33:25.abc': score, '33:36.value': 'folk', '33:37.value': 'lyrics' },
      booleanSlotValues: { '33:31.value': true },
    } });
    expect(prepared['33:25']).toMatchObject({ inputs: { abc: score } });
    expect(prepared['33:36']).toMatchObject({ inputs: { value: 'folk' } });
    expect(prepared['33:37']).toMatchObject({ inputs: { value: 'lyrics' } });
    expect(abcWorkflow['33:25'].inputs.abc).toEqual(['33:14', 0]);
  });

  it('defaults a linked boolean to false and respects an explicit binding default', () => {
    expect(prepareComfyUIWorkflow(config(), request)['33:31']).toMatchObject({ inputs: { value: false } });
    const explicit = config({ booleans: [{ nodeId: '33:31', input: 'value', defaultValue: true }] });
    expect(prepareComfyUIWorkflow(explicit, request)['33:31']).toMatchObject({ inputs: { value: true } });
    expect(prepareComfyUIWorkflow(explicit, { ...request, extra_params: { booleanSlotValues: { '33:31.value': false } } })['33:31'])
      .toMatchObject({ inputs: { value: false } });
  });

  it('rejects string booleans in bindings and requests', () => {
    expect(() => config({ booleans: [{ nodeId: '33:31', input: 'value', defaultValue: 'false' }] })).toThrow('布尔值');
    expect(() => prepareComfyUIWorkflow(config(), { ...request, extra_params: { booleanSlotValues: { '33:31.value': 'false' } } }))
      .toThrow('布尔值');
    expect(() => config({ texts: [{ nodeId: '33:25', input: 'abc', preserveWhenEmpty: 'yes' }] })).toThrow('布尔值');
  });

  it('supports explicitly mapped optional score text, leaving an empty score connected', () => {
    const explicit = config({ texts: [
      { nodeId: '33:36', input: 'value' },
      { nodeId: '33:25', input: 'abc', preserveWhenEmpty: true },
    ], booleans: [] });
    expect(prepareComfyUIWorkflow(explicit, { ...request, extra_params: { textSlotValues: { '33:25.abc': '' } } })['33:25'])
      .toMatchObject({ inputs: { abc: ['33:14', 0] } });
    // An explicit empty boolean list disables detection and preserves the old workflow.
    expect(prepareComfyUIWorkflow(explicit, request)['33:31']).toMatchObject({ inputs: { value: ['42', 0] } });
  });
});
