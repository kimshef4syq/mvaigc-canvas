import {
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
} from '../domain/canvasNodes';
import { parseAspectRatio } from './imageData';

export interface ImageNodeSize {
  width: number;
  height: number;
}

export interface ImageNodeMinSize {
  minWidth: number;
  minHeight: number;
}

function roundPositive(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.round(value));
}

export function resolveAspectRatioValue(aspectRatio: string): number {
  return Math.max(0.1, parseAspectRatio(aspectRatio));
}

function resolveMinSizeByRatio(
  ratio: number,
  constraints: ImageNodeMinSize
): ImageNodeSize {
  const safeRatio = Math.max(0.1, ratio);
  const minWidth = roundPositive(constraints.minWidth);
  const minHeight = roundPositive(constraints.minHeight);
  const minRatio = minWidth / Math.max(1, minHeight);

  if (safeRatio >= minRatio) {
    return {
      width: roundPositive(minHeight * safeRatio),
      height: minHeight,
    };
  }

  return {
    width: minWidth,
    height: roundPositive(minWidth / safeRatio),
  };
}

export function resolveMinEdgeFittedSize(
  aspectRatio: string,
  constraints: ImageNodeMinSize
): ImageNodeSize {
  const ratio = resolveAspectRatioValue(aspectRatio);
  return resolveMinSizeByRatio(ratio, constraints);
}

export function resolveResizeMinConstraintsByAspect(
  aspectRatio: string,
  constraints: ImageNodeMinSize
): ImageNodeMinSize {
  void resolveAspectRatioValue(aspectRatio);
  const minWidth = roundPositive(constraints.minWidth);
  const minHeight = roundPositive(constraints.minHeight);
  return { minWidth, minHeight };
}

export function resolveSizeInsideTargetBox(
  aspectRatio: string,
  target: ImageNodeSize
): ImageNodeSize {
  const ratio = resolveAspectRatioValue(aspectRatio);
  const targetWidth = roundPositive(target.width);
  const targetHeight = roundPositive(target.height);
  const targetRatio = targetWidth / Math.max(1, targetHeight);

  if (ratio >= targetRatio) {
    return {
      width: targetWidth,
      height: roundPositive(targetWidth / ratio),
    };
  }

  return {
    width: roundPositive(targetHeight * ratio),
    height: targetHeight,
  };
}

/**
 * Default footprint for a freshly created image-shaped node, shared by the
 * 生成图片 node and every other node that shows a single frame of media
 * (生成视频, AI 音频). Mirrors what `ImageNode` computes for an unmeasured
 * exportImage node: fit the ratio inside the 384×288 box, then make sure at
 * least one edge reaches the 260×168 min-edge box.
 */
export function resolveDefaultImageNodeSize(aspectRatio: string): ImageNodeSize {
  const ratio = resolveAspectRatioValue(aspectRatio);
  const fitted = resolveSizeInsideTargetBox(aspectRatio, {
    width: EXPORT_RESULT_NODE_DEFAULT_WIDTH,
    height: EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  });
  const compact = resolveMinSizeByRatio(ratio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  return {
    width: Math.max(compact.width, fitted.width),
    height: Math.max(compact.height, fitted.height),
  };
}

export function ensureAtLeastOneMinEdge(
  size: ImageNodeSize,
  constraints: ImageNodeMinSize
): ImageNodeSize {
  const minWidth = roundPositive(constraints.minWidth);
  const minHeight = roundPositive(constraints.minHeight);
  const width = roundPositive(size.width);
  const height = roundPositive(size.height);
  const ratio = width / Math.max(1, height);

  if (width >= minWidth && height >= minHeight) {
    return { width, height };
  }

  return resolveMinSizeByRatio(ratio, { minWidth, minHeight });
}
