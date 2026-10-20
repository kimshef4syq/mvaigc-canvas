import { useIsMultiNodeSelection } from './SingleNodeToolbar';
import { memo } from 'react';
import { Maximize2, Scissors } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type FrameCaptureMode = 'first' | 'current' | 'last';

interface VideoNodeToolbarProps {
  onPreview: () => void;
  onCaptureFrame: (mode: FrameCaptureMode) => void;
  onToggleFrameMenu?: () => void;
  frameMenuOpen?: boolean;
}

/**
 * Overlay toolbar on the 生成视频 node's video display box. Download / delete /
 * copy-source live on NodeActionToolbar (already rendered for every node); this
 * adds the video-specific 预览 + 截帧 (首帧/当前帧/尾帧) entries.
 */
export const VideoNodeToolbar = memo(({
  onPreview,
  onCaptureFrame,
  onToggleFrameMenu,
  frameMenuOpen = false,
}: VideoNodeToolbarProps) => {
  const { t } = useTranslation();
  const multiSelected = useIsMultiNodeSelection();
  const chipClass = 'nodrag flex h-7 items-center gap-1 rounded-md border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)]/80 px-2 text-[11px] text-text-dark shadow-sm backdrop-blur-sm transition-colors hover:bg-[var(--canvas-node-menu-hover)]';

  if (multiSelected) return null;

  return (
    <div className="pointer-events-auto flex items-center gap-1" data-testid="video-node-toolbar">
      <button type="button" data-testid="video-preview" className={chipClass} onClick={(event) => { event.stopPropagation(); onPreview(); }}>
        <Maximize2 className="h-3.5 w-3.5" />
        {t('node.aiVideo.preview')}
      </button>
      <button type="button" data-testid="video-capture-frame" className={chipClass} onClick={(event) => { event.stopPropagation(); onToggleFrameMenu?.(); }}>
        <Scissors className="h-3.5 w-3.5" />
        {t('node.aiVideo.captureFrame')}
      </button>
      {frameMenuOpen && (
        <div className="nowheel absolute right-0 top-full z-30 mt-1 w-[8em] overflow-hidden rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] shadow-xl">
          {([
            ['first', t('node.aiVideo.captureFirst')],
            ['current', t('node.aiVideo.captureCurrent')],
            ['last', t('node.aiVideo.captureLast')],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              data-testid={`video-capture-${mode}`}
              className="flex w-full items-center px-3 py-2 text-left text-xs text-text-dark transition-colors hover:bg-[var(--canvas-node-menu-hover)]"
              onClick={(event) => { event.stopPropagation(); onCaptureFrame(mode); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

VideoNodeToolbar.displayName = 'VideoNodeToolbar';
