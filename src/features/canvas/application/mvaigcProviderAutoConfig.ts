import type { CustomProviderConfig } from '@/stores/customProvidersStore';

/** Stable provider ids so re-saving updates the same entries in place. */
export const MVAIGC_IMAGE_PROVIDER_ID = 'mvaigc-image';
export const MVAIGC_VIDEO_PROVIDER_ID = 'mvaigc-video';

const IMAGE_MODEL_HINT = ['gpt_image2'];
const VIDEO_MODEL_HINT = ['minimax_h3'];

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
        timeoutMs: 180000,
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
      videoPollTimeoutMs: 180000,
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
