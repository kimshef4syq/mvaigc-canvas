import type { CustomProviderConfig } from '@/stores/customProvidersStore';

/** Stable provider ids so re-saving updates the same entries in place. */
export const MVAIGC_IMAGE_PROVIDER_ID = 'mvaigc-image';
export const MVAIGC_VIDEO_PROVIDER_ID = 'mvaigc-video';

// The mvaigc model ids surfaced in OSC's pickers. These are mvaigc's own
// model keys (from imgPlatform/getImgModel and videoPlatform/getVideoApi).
const IMAGE_MODEL_HINT = [
  'doubao5.0_Pro',   // Seedream-5.0-Pro
  'doubao',          // Seedream-4.5
  'gpt_image2',      // GPT-Image-2
  'wan2_7_Image',    // WAN-2.7
  'wan2_7_Image-pro',// WAN-2.7-Pro
  'Nano-Banana',     // Nano-Banana-2
  'Nano-Banana-Pro', // Nano-Banana-Pro
  'qwen',            // Qwen-2.0-Pro
];
const VIDEO_MODEL_HINT = [
  'botsmart_seedance_2_5', // Seedance-2.5
  'botsmart_seedance_2',   // Seedance-2.0
  'botsmart_seedance_2_hd',// Seedance-2.0-1080P
  'botsmart_seedance_2_fast', // Seedance-2.0-Fast
  'veo_3_1',               // Veo-3.1
  'minimax_h3',            // MiniMax-H3-2K
  'minimax_h3_768p',       // MiniMax-H3-768P
  'vidu_q3',               // Vidu-Q3
  'happyhorse_1_720p',     // HappyHorse-1.1
  'happyhorse_1_1080p',    // HappyHorse-1.1-1080P
  'kling_v3_omni',         // kling-v3-omni
  'wan_2_7',               // WAN-2.7
];

/**
 * Build the two OSC custom providers that point at the built-in mvaigc proxy.
 * The image provider uses the declarative `asyncTask` poll contract; the video
 * provider uses the separate `video*` poll fields OSC's video gateway reads.
 */
export function buildMvaigcProviders(port: number, credentials: string): CustomProviderConfig[] {
  const baseUrl = `http://127.0.0.1:${port}`;

  const image: CustomProviderConfig = {
    id: MVAIGC_IMAGE_PROVIDER_ID,
    label: 'mvaigc 图片',
    mediaType: 'image',
    baseUrl,
    endpointPath: '/v1/images/generations',
    modelListEndpointPath: '/v1/models',
    httpMethod: 'POST',
    apiKey: credentials,
    apiStyle: 'generic-json',
    responseFormat: 'generic',
    models: IMAGE_MODEL_HINT,
    supportsWebSearch: false,
    supportedResolutions: ['1k', '2k', '4k'],
    extraParams: {
      supportedRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      asyncTask: {
        enabled: true,
        taskIdPath: 'id',
        resultEndpointPath: '/v1/tasks/{taskId}',
        resultMethod: 'GET',
        imagePath: 'output[0].url',
        statusPath: 'status',
        pendingValues: ['processing'],
        successValues: ['succeeded'],
        failedValues: ['failed'],
        errorPath: 'error.message',
        intervalMs: 2000,
        timeoutMs: 900000,
      },
    },
    note: '由 mvaigc 设置面板自动生成：本地反代 → mvaigc.cn',
  };

  const video: CustomProviderConfig = {
    id: MVAIGC_VIDEO_PROVIDER_ID,
    label: 'mvaigc 视频',
    mediaType: 'video',
    baseUrl,
    endpointPath: '/v1/videos',
    modelListEndpointPath: '/v1/models',
    httpMethod: 'POST',
    apiKey: credentials,
    apiStyle: 'generic-json',
    responseFormat: 'generic',
    models: VIDEO_MODEL_HINT,
    supportsWebSearch: false,
    supportedResolutions: ['720p', '1080p'],
    extraParams: {
      supportedRatios: ['16:9', '9:16', '1:1'],
      supportedDurations: [5, 10],
      // The local proxy accepts JSON only; without this OSC defaults video
      // providers to multipart and every submit fails with HTTP 415.
      videoRequestBodyMode: 'json',
      videoTaskIdPath: 'id',
      videoStatusEndpointPath: '/v1/tasks/{taskId}',
      videoStatusPath: 'status',
      videoPendingValues: ['processing'],
      videoSuccessValues: ['succeeded'],
      videoFailedValues: ['failed'],
      responseVideoPath: 'output[0].url',
      videoErrorPath: 'error.message',
      videoPollIntervalMs: 2000,
      videoPollTimeoutMs: 900000,
    },
    note: '由 mvaigc 设置面板自动生成：本地反代 → mvaigc.cn',
  };

  return [image, video];
}

interface ProviderStoreActions {
  updateProvider: (id: string, patch: Partial<CustomProviderConfig>) => void;
  addProvider: (provider: CustomProviderConfig) => void;
  hasProvider: (id: string) => boolean;
}

/**
 * Register the mvaigc image/video providers: add them on first save, update
 * them in place afterwards (stable ids), so a port/credential change never
 * accumulates duplicates.
 */
export function applyMvaigcProviders(
  port: number,
  credentials: string,
  actions: ProviderStoreActions,
): void {
  const providers = buildMvaigcProviders(port, credentials);
  providers.forEach((provider) => {
    if (actions.hasProvider(provider.id)) {
      actions.updateProvider(provider.id, provider);
    } else {
      actions.addProvider(provider);
    }
  });
}

export { IMAGE_MODEL_HINT, VIDEO_MODEL_HINT };
