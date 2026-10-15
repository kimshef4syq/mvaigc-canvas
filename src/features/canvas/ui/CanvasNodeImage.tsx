import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ImgHTMLAttributes,
  type MouseEvent,
  type SyntheticEvent,
} from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useCanvasStore } from '@/stores/canvasStore';

export interface CanvasNodeImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  viewerSourceUrl?: string | null;
  viewerImageList?: Array<string | null | undefined>;
  fallbackSrcs?: Array<string | null | undefined>;
  disableViewer?: boolean;
  /** Open the enlarge viewer on single click instead of double click. */
  openViewerOnClick?: boolean;
}

export function shouldOpenViewer(
  trigger: 'click' | 'doubleClick',
  options: { openViewerOnClick: boolean; disableViewer: boolean; defaultPrevented: boolean }
): boolean {
  if (options.disableViewer || options.defaultPrevented) {
    return false;
  }
  return trigger === 'click' ? options.openViewerOnClick : !options.openViewerOnClick;
}

function normalizeViewerList(
  imageList: Array<string | null | undefined> | undefined,
  currentImageUrl: string
): string[] {
  const deduped: string[] = [];
  for (const rawItem of imageList ?? []) {
    const item = typeof rawItem === 'string' ? rawItem.trim() : '';
    if (!item || deduped.includes(item)) {
      continue;
    }
    deduped.push(item);
  }

  if (!deduped.includes(currentImageUrl)) {
    deduped.unshift(currentImageUrl);
  }

  return deduped.length > 0 ? deduped : [currentImageUrl];
}

export const CanvasNodeImage = memo(({
  viewerSourceUrl,
  viewerImageList,
  fallbackSrcs,
  disableViewer = false,
  openViewerOnClick = false,
  onClick,
  onDoubleClick,
  onError,
  src,
  alt,
  className,
  ...props
}: CanvasNodeImageProps) => {
  const { t } = useTranslation();
  const openImageViewer = useCanvasStore((state) => state.openImageViewer);
  const candidateSources = useMemo(() => {
    const deduped: string[] = [];
    for (const rawItem of [src, ...(fallbackSrcs ?? [])]) {
      const item = typeof rawItem === 'string' ? rawItem.trim() : '';
      if (!item || deduped.includes(item)) {
        continue;
      }
      deduped.push(item);
    }
    return deduped;
  }, [fallbackSrcs, src]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [hasLoadError, setHasLoadError] = useState(false);

  useEffect(() => {
    setSourceIndex(0);
    setHasLoadError(false);
  }, [candidateSources]);

  const activeSrc = candidateSources[sourceIndex] ?? '';

  const openViewer = useCallback((event: MouseEvent<HTMLImageElement>) => {
    const fallbackSrc = event.currentTarget.currentSrc || activeSrc;
    const viewerSrc = typeof viewerSourceUrl === 'string' ? viewerSourceUrl.trim() : '';
    const viewerSourceAlreadyFailed =
      sourceIndex > 0 && viewerSrc.length > 0 && candidateSources.includes(viewerSrc) && viewerSrc !== activeSrc;
    const resolvedSource =
      viewerSrc && !viewerSourceAlreadyFailed
        ? viewerSrc
        : fallbackSrc.trim();
    if (!resolvedSource) {
      return;
    }

    event.stopPropagation();
    openImageViewer(resolvedSource, normalizeViewerList(viewerImageList, resolvedSource));
  }, [activeSrc, candidateSources, openImageViewer, sourceIndex, viewerImageList, viewerSourceUrl]);

  const handleClick = useCallback((event: MouseEvent<HTMLImageElement>) => {
    onClick?.(event);

    if (shouldOpenViewer('click', { openViewerOnClick, disableViewer, defaultPrevented: event.defaultPrevented })) {
      openViewer(event);
    }
  }, [disableViewer, onClick, openViewer, openViewerOnClick]);

  const handleDoubleClick = useCallback((event: MouseEvent<HTMLImageElement>) => {
    onDoubleClick?.(event);

    if (shouldOpenViewer('doubleClick', { openViewerOnClick, disableViewer, defaultPrevented: event.defaultPrevented })) {
      openViewer(event);
    }
  }, [disableViewer, onDoubleClick, openViewer, openViewerOnClick]);

  const handleError = useCallback((event: SyntheticEvent<HTMLImageElement, Event>) => {
    onError?.(event);
    setSourceIndex((currentIndex) => {
      const nextIndex = currentIndex + 1;
      if (nextIndex < candidateSources.length) {
        return nextIndex;
      }
      setHasLoadError(true);
      return currentIndex;
    });
  }, [candidateSources.length, onError]);

  if (!activeSrc || hasLoadError) {
    return (
      <div
        className={`flex items-center justify-center gap-1 bg-[var(--canvas-node-media-bg)] text-[10px] leading-tight text-text-muted ${className ?? ''}`}
        role="img"
        aria-label={typeof alt === 'string' && alt.trim() ? alt : t('common.imageMissing')}
        title={t('common.imageMissing')}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
        <span className="min-w-0 truncate">{t('common.imageMissing')}</span>
      </div>
    );
  }

  return (
    <img
      draggable={false}
      {...props}
      src={activeSrc}
      alt={alt}
      className={className}
      data-viewer-src={
        typeof viewerSourceUrl === 'string' && viewerSourceUrl.trim().length > 0
          ? viewerSourceUrl.trim()
          : undefined
      }
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onError={handleError}
    />
  );
});

CanvasNodeImage.displayName = 'CanvasNodeImage';
