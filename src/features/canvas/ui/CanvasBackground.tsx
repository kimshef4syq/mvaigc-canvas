import { memo, useMemo } from 'react';
import { Background, BackgroundVariant, useStore, type ReactFlowState } from '@xyflow/react';

const zoomSelector = (state: ReactFlowState) => state.transform[2];

export interface CanvasBackgroundProps {
  id?: string;
  className?: string;
}

/**
 * Adaptive canvas background grid that ensures layout dots remain clear and discernible
 * under comfortable node viewing scales and across arbitrary zoom levels.
 *
 * In @xyflow/react, Background calculates dot screen radius as `(size * zoom) / 2`.
 * With static size=1, dot radius collapses to 0.25px at zoom 0.5 and subpixel antialiasing
 * makes dots invisible.
 *
 * CanvasBackground dynamically compensates:
 * - At 100% zoom (1.0), size=2.6 yields a crisp dot radius of 1.3px (diameter 2.6px).
 * - As zoom scales down, size expands so that screen diameter never falls below 1.6px (radius >= 0.8px).
 * - Spacing (gap) smoothly steps at wide zoom-out to avoid visual clustering.
 */
export const CanvasBackground = memo(function CanvasBackground({ id, className }: CanvasBackgroundProps) {
  const zoom = useStore(zoomSelector);

  const adaptiveSize = useMemo(() => {
    const safeZoom = Math.max(0.08, zoom || 1);
    return Math.max(2.6, 1.6 / safeZoom);
  }, [zoom]);

  const adaptiveGap = useMemo(() => {
    const safeZoom = zoom || 1;
    if (safeZoom < 0.22) return 64;
    if (safeZoom < 0.38) return 48;
    return 32;
  }, [zoom]);

  return (
    <Background
      id={id}
      className={className}
      variant={BackgroundVariant.Dots}
      gap={adaptiveGap}
      size={adaptiveSize}
      color="var(--canvas-grid-dot)"
    />
  );
});
