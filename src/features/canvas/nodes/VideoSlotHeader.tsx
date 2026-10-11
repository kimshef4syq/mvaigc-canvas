import { useTranslation } from 'react-i18next';

import { videoSlotLabelKeys } from '@/features/canvas/application/videoModes';
import type { VideoInputSchema } from '@/features/canvas/application/videoInputSchema';

export interface VideoSlotHeaderProps {
  /** The merged (mode × model) input schema driving which slots exist. */
  schema: VideoInputSchema;
  /** Frames mode only: toggles the sent frame order (labels stay 首帧/尾帧). */
  onSwap?: () => void;
}

/**
 * Renders the named input-slot labels for the current mode (首帧/尾帧 for frames,
 * 首帧 for image, 参考图/视频/音频 for reference) plus the frames-mode swap
 * button. Labels are fixed (槽1=首帧、槽2=尾帧); the swap button only changes
 * which image occupies each slot. Returns null when the mode has no named slots (文生).
 */
export function VideoSlotHeader({ schema, onSwap }: VideoSlotHeaderProps) {
  const { t } = useTranslation();
  const slotKeys = videoSlotLabelKeys(schema);
  if (slotKeys.length === 0) return null;
  const isFrames = slotKeys.length === 2 && slotKeys[0] === 'slotFirstFrame' && slotKeys[1] === 'slotLastFrame';
  const labels = slotKeys.map((key) => t(`node.aiVideo.${key}`));
  return (
    <div className="mb-1 flex shrink-0 items-center gap-1 text-[10px] text-text-muted">
      <span data-testid="video-slot-labels">{labels.join(' / ')}</span>
      {isFrames && (
        <button
          type="button"
          data-testid="video-swap-first-last"
          className="nodrag rounded border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-button-bg)] px-1.5 py-0.5 text-[10px] text-[var(--canvas-node-button-text)] hover:border-[var(--canvas-node-border-hover)]"
          onClick={(event) => {
            event.stopPropagation();
            onSwap?.();
          }}
        >
          {t('node.aiVideo.swapFirstLastFrame')}
        </button>
      )}
    </div>
  );
}
