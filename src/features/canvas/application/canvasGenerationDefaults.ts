import { CANVAS_NODE_TYPES, type CanvasNodeData, type CanvasNodeType } from '../domain/canvasNodes';
import type { CanvasGenerationDefaults } from '@/stores/canvasDefaultsStore';

/** Only generation settings are copied; prompts, references and generated media stay intact. */
export function generationDefaultsForNode(
  type: CanvasNodeType,
  defaults: CanvasGenerationDefaults,
): Partial<CanvasNodeData> {
  if (type === CANVAS_NODE_TYPES.imageEdit && defaults.image) {
    return {
      modelConfig: { ...defaults.image, extraParams: { ...defaults.image.extraParams } },
      requestAspectRatio: defaults.image.ratio,
    };
  }
  if (type === CANVAS_NODE_TYPES.aiVideo && defaults.video) {
    return { modelConfig: { ...defaults.video, extraParams: { ...defaults.video.extraParams } } };
  }
  return {};
}
