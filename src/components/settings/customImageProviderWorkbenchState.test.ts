import { describe, expect, it } from 'vitest';

import { customImageProviderDraftToConfig } from '@/features/canvas/application/customImageProviderConfig';
import { createComfyUIWorkflowTemplate, validateComfyUIRequest, parseComfyUIConfig, prepareComfyUIWorkflow } from '@/features/canvas/infrastructure/comfyuiGateway';
import {
  createCustomImageProviderWorkbenchDraft,
  createComfyUIProviderWorkbenchDraft,
  createWorkbenchPreviewRequest,
  createWorkbenchImportedBindings,
  getImageToImageVariant,
  updateFirstWorkbenchImageField,
} from './customImageProviderWorkbenchState';

describe('manual image provider workbench', () => {
  it('previews local H3 with video capabilities instead of image dimensions', () => {
    const draft = createComfyUIProviderWorkbenchDraft();
    draft.mediaType = 'video';
    draft.extraParams.comfyui = {
      workflow: {
        '1': { class_type: 'MiniMaxH3ImageToVideo', inputs: { prompt: '', width: 1344, height: 768, length: 124 } },
        '2': { class_type: 'SaveVideo', inputs: { video: ['1', 0] } },
      },
      bindings: { images: [] }, outputNodeIds: ['2'],
    };
    const config = customImageProviderDraftToConfig(draft, 'h3').value!;
    const sample = createWorkbenchPreviewRequest(config, 'h3');
    expect(sample).toMatchObject({ size: '768P', aspect_ratio: '16:9', extra_params: { seconds: 5 } });
    const workflow = prepareComfyUIWorkflow(parseComfyUIConfig(config), sample);
    expect(workflow['1'].inputs).toMatchObject({ width: 1344, height: 768, length: 124 });
  });

  it('supplies required image placeholders when previewing an image-to-image workflow', () => {
    const draft = createComfyUIProviderWorkbenchDraft();
    draft.extraParams.comfyui = createComfyUIWorkflowTemplate('image-to-image', 'sd.safetensors');
    const config = customImageProviderDraftToConfig(draft, 'i2i').value!;
    const sample = createWorkbenchPreviewRequest(config, 'workflow');
    expect(sample.reference_images).toHaveLength(1);
    const workflow = prepareComfyUIWorkflow(parseComfyUIConfig(config), sample, ['placeholder.png']);
    expect(workflow['4'].inputs).toMatchObject({ image: 'placeholder.png' });
  });

  it('preserves additional imported image fields through editing and saving', () => {
    const draft = createCustomImageProviderWorkbenchDraft();
    draft.baseUrl = 'https://relay.example/v1';
    draft.models = ['image-model'];
    const variant = getImageToImageVariant(draft);
    variant.imageFields = [
      { name: 'image', mode: 'single', encoding: 'data-url' },
      { name: 'mask', mode: 'single', encoding: 'base64' },
    ];
    draft.imageRequestContract.imageToImage = {
      ...variant,
      imageFields: updateFirstWorkbenchImageField(variant, { name: 'images', mode: 'array', encoding: 'url' }),
    };
    const saved = customImageProviderDraftToConfig(draft, 'provider-1');
    expect(saved.issues).toEqual([]);
    expect(saved.value?.extraParams?.imageRequestContract).toMatchObject({ imageToImage: { imageFields: [
      { name: 'images', mode: 'array', encoding: 'url' },
      { name: 'mask', mode: 'single', encoding: 'base64' },
    ] } });
    expect(variant.imageFields[0].name).toBe('image');
  });

  it('persists the image field shown when image-to-image is first enabled', () => {
    const draft = createCustomImageProviderWorkbenchDraft();
    draft.baseUrl = 'https://relay.example/v1';
    draft.models = ['image-model'];
    draft.imageRequestContract.textToImage = {
      ...draft.imageRequestContract.textToImage,
      endpointPath: '/images/generations',
    };

    draft.imageRequestContract.imageToImage = getImageToImageVariant(draft);
    const saved = customImageProviderDraftToConfig(draft, 'provider-1');

    expect(saved.issues).toEqual([]);
    expect(saved.value?.extraParams?.imageRequestContract).toMatchObject({
      imageToImage: {
        endpointPath: '/images/generations',
        imageFields: [{ name: 'image', mode: 'single', encoding: 'data-url' }],
        responseImagePaths: ['data[0].url'],
      },
    });
  });
});

describe('ComfyUI audio workbench', () => {
  it('previews audio without image geometry or video parameters', () => {
    const draft = createComfyUIProviderWorkbenchDraft();
    draft.mediaType = 'audio';
    draft.extraParams.comfyui = {
      workflow: {
        '1': { class_type: 'Voice', inputs: { text: ['2', 0] } },
        '2': { class_type: 'JjkText', inputs: { text: '' } },
        '3': { class_type: 'SaveAudio', inputs: { audio: ['1', 0] } },
      }, bindings: { images: [], audios: [] }, outputNodeIds: ['3'],
    };
    const config = customImageProviderDraftToConfig(draft, 'audio').value!;
    const sample = createWorkbenchPreviewRequest(config, 'workflow');
    expect(sample).toMatchObject({ size: '', aspect_ratio: 'auto' });
    expect(sample.reference_images).toBeUndefined();
    expect(sample.extra_params?.seconds).toBeUndefined();
    expect(prepareComfyUIWorkflow(parseComfyUIConfig(config), sample)['2']).toMatchObject({ inputs: { text: 'preview prompt' } });
  });

  it('keeps imported linked negative text transient and preserves legacy image prompt validation', () => {
    const workflow = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'positive inline' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: ['3', 0] } },
      '3': { class_type: 'PrimitiveString', inputs: { value: 'negative' } },
      '4': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
    };
    const bindings = createWorkbenchImportedBindings(workflow);
    expect(bindings).not.toHaveProperty('texts');
    const draft = createComfyUIProviderWorkbenchDraft();
    draft.extraParams.comfyui = { workflow, bindings, outputNodeIds: ['4'] };
    const config = customImageProviderDraftToConfig(draft, 'image').value!;
    expect(() => prepareComfyUIWorkflow(parseComfyUIConfig(config), createWorkbenchPreviewRequest(config, 'workflow')))
      .toThrow('提示词');
  });
});

it('validates previews of audio workflows that require a canvas reference', () => {
  const draft = createComfyUIProviderWorkbenchDraft();
  draft.mediaType = 'audio';
  draft.extraParams.comfyui = {
    workflow: {
      '1': { class_type: 'LoadAudio', inputs: { audio: '' } },
      '2': { class_type: 'VoiceClone', inputs: { target_text: ['3', 0], audio: ['1', 0] } },
      '3': { class_type: 'JjkText', inputs: { text: '' } },
      '4': { class_type: 'SaveAudio', inputs: { audio: ['2', 0] } },
    }, bindings: { images: [], audios: [] }, outputNodeIds: ['4'],
  };
  const config = customImageProviderDraftToConfig(draft, 'clone').value!;
  const sample = createWorkbenchPreviewRequest(config, 'workflow');
  expect(sample.reference_audios).toHaveLength(1);
  expect(() => validateComfyUIRequest(parseComfyUIConfig(config), sample)).not.toThrow();
});

it('round-trips explicit ABC score and planning mappings through workbench configuration', () => {
  const draft = createComfyUIProviderWorkbenchDraft();
  draft.mediaType = 'audio';
  draft.extraParams.comfyui = {
    workflow: {
      'plan': { class_type: 'PrimitiveBoolean', inputs: { value: true } },
      'music': { class_type: 'YuE2GenerateMusic', inputs: { abc: '' } },
      'save': { class_type: 'SaveAudio', inputs: { audio: ['music', 0] } },
    }, bindings: {
      texts: [{ nodeId: 'music', input: 'abc', label: 'ABC', preserveWhenEmpty: true }],
      booleans: [{ nodeId: 'plan', input: 'value', label: 'ABC planning', defaultValue: false }],
      images: [], audios: [],
    }, outputNodeIds: ['save'],
  };
  const saved = customImageProviderDraftToConfig(draft, 'abc');
  expect(saved.issues).toEqual([]);
  const config = parseComfyUIConfig(saved.value!);
  expect(config.bindings.texts?.[0]).toMatchObject({ preserveWhenEmpty: true });
  expect(config.bindings.booleans?.[0]).toMatchObject({ defaultValue: false });
  expect(prepareComfyUIWorkflow(config, createWorkbenchPreviewRequest(saved.value!, 'workflow')).plan)
    .toMatchObject({ inputs: { value: false } });
});
