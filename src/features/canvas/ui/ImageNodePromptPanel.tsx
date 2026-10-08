import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ExportImageNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveActiveModelForPanel } from '@/features/canvas/application/resolveActiveModelForPanel';
import { normalizeImageRequestGeometry } from '@/features/canvas/application/imageRequestGeometry';
import {
  normalizeGenerateCount,
  submitImageNodeGeneration,
  type ImageGenerationMode,
} from '@/features/canvas/application/imageNodeGeneration';
import { acquireGenerationSubmitLock, generationSubmitLockKey } from '@/features/canvas/application/generationSubmitLock';
import { ModelConfigPicker, type ModelConfigValue } from '@/features/canvas/ui/ModelConfigPicker';
import { canvasAiGateway } from '@/features/canvas/application/canvasServices';
import { findRelatedCanvasNodePositions } from '@/features/canvas/application/canvasNodePlacement';
import { selectInputImageSignature, parseInputImageSignature } from '@/features/canvas/application/canvasGraphSelectors';
import { EXPORT_RESULT_NODE_DEFAULT_WIDTH, EXPORT_RESULT_NODE_LAYOUT_HEIGHT } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';

const PROMPT_COMMIT_DELAY_MS = 400;

interface ImageNodePromptPanelProps {
  nodeId: string;
  data: ExportImageNodeData;
}

/**
 * The prompt panel embedded in a 生成图片 node. Kept separate from
 * ImageEditNode's panel: it only needs to submit into the node it lives in
 * (overwrite) or a new node, so it stays small and does not touch the mature
 * AI-图片 panel.
 */
export const ImageNodePromptPanel = memo(({ nodeId, data }: ImageNodePromptPanelProps) => {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const nodes = useCanvasStore((state) => state.nodes);
  const [mode, setMode] = useState<ImageGenerationMode>('overwrite');
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [countMenuOpen, setCountMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [promptDraft, setPromptDraft] = useState(() => (typeof data.prompt === 'string' ? data.prompt : ''));
  const promptCommitTimer = useRef<number | null>(null);

  const incomingImageSignature = useCanvasStore((state) =>
    selectInputImageSignature(nodeId, state.nodes, state.edges)
  );
  const referenceImages = useMemo(
    () => parseInputImageSignature(incomingImageSignature),
    [incomingImageSignature]
  );

  const modelConfig = (data.modelConfig ?? null) as ModelConfigValue | null;
  const resolved = useMemo(
    () => resolveActiveModelForPanel('aiImageNode', modelConfig),
    [modelConfig]
  );

  const prompt = promptDraft;
  const canSubmit = prompt.trim().length > 0 && !submitting && resolved.modelForGateway.length > 0;

  // Commit the draft on a debounce so typing doesn't push a canvas history
  // snapshot (and bump revision) on every keystroke — same pattern as
  // ImageEditNode's prompt box.
  const commitPromptDraft = (value: string) => {
    if (promptCommitTimer.current !== null) {
      window.clearTimeout(promptCommitTimer.current);
    }
    promptCommitTimer.current = window.setTimeout(() => {
      promptCommitTimer.current = null;
      updateNodeData(nodeId, { prompt: value });
    }, PROMPT_COMMIT_DELAY_MS);
  };

  const flushPromptDraft = () => {
    if (promptCommitTimer.current !== null) {
      window.clearTimeout(promptCommitTimer.current);
      promptCommitTimer.current = null;
      updateNodeData(nodeId, { prompt: promptDraft });
    }
  };

  useEffect(() => () => {
    if (promptCommitTimer.current !== null) {
      window.clearTimeout(promptCommitTimer.current);
    }
  }, []);

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    const release = acquireGenerationSubmitLock(generationSubmitLockKey(nodeId, 'image-node-panel'));
    if (!release) {
      return;
    }
    setSubmitting(true);
    try {
      const geometry = normalizeImageRequestGeometry({
        selectedResolution: '2K',
        selectedAspectRatio: resolved.ratio ?? data.aspectRatio ?? '1:1',
        referenceAspectRatio: data.aspectRatio,
        supportedAspectRatios: resolved.supportedRatios,
        fallbackResolution: '2K',
      });
      await submitImageNodeGeneration({
        nodeId,
        mode,
        count: normalizeGenerateCount(String(count), 1),
        payload: {
          prompt: prompt.trim(),
          model: resolved.modelForGateway,
          size: geometry.requestSize,
          aspectRatio: geometry.requestAspectRatio,
          referenceImages: [...referenceImages],
          extraParams: { ...resolved.extraParams },
        },
        deps: {
          addNode: (type, position, nodeData) => addNode(type, position, nodeData),
          updateNodeData: (id, patch) => updateNodeData(id, patch),
          submitJob: (payload) => canvasAiGateway.submitGenerateImageJob({
            ...payload,
            referenceImages: [...payload.referenceImages],
            extraParams: { ...payload.extraParams },
          }),
        },
        position: findRelatedCanvasNodePositions({
          nodes,
          relatedNodeId: nodeId,
          desired: { x: 0, y: 0 },
          size: { width: EXPORT_RESULT_NODE_DEFAULT_WIDTH, height: EXPORT_RESULT_NODE_LAYOUT_HEIGHT },
          count: 1,
        })[0] ?? { x: 100, y: 100 },
      });
    } finally {
      setSubmitting(false);
      release();
    }
  };

  return (
    <div className="mt-2 [container-type:inline-size]">
      <div
        className="nodrag nowheel shrink-0 rounded-[var(--node-radius)] border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-bg)] p-2"
        style={{ fontSize: 'clamp(6px, 1.8cqw, 14px)' }}
      >
      <textarea
        value={prompt}
        onChange={(event) => {
          const nextValue = event.target.value;
          setPromptDraft(nextValue);
          commitPromptDraft(nextValue);
        }}
        onBlur={flushPromptDraft}
        onMouseDown={(event) => event.stopPropagation()}
        placeholder={t('node.imageEdit.promptPlaceholder')}
        className="ui-scrollbar nodrag nowheel h-[4.5em] w-full resize-none rounded-md border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] px-[0.6em] py-[0.35em] text-[1em] leading-[1.6] text-text-dark outline-none placeholder:text-text-muted/80"
      />

      <div className="mt-[0.5em] flex min-w-0 items-center gap-[0.5em]">
        <ModelConfigPicker
          panelKey="aiImageNode"
          className="min-w-0 flex-1"
          value={modelConfig ?? undefined}
          onChange={(modelConfigValue) => updateNodeData(nodeId, { modelConfig: modelConfigValue })}
        />

        <div className="relative shrink-0">
          <button
            type="button"
            className="flex items-center gap-[0.2em] rounded-md border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] px-[0.7em] py-[0.35em] text-[1em] text-text-dark"
            onClick={(event) => {
              event.stopPropagation();
              setCountMenuOpen((open) => !open);
            }}
            title={t('node.imageEdit.generateCount')}
          >
            {count}张
            <span className="text-[0.8em] opacity-70">▾</span>
          </button>
          {countMenuOpen ? (
            <div
              className="nowheel absolute bottom-full right-0 z-50 mb-[0.3em] w-[5em] overflow-hidden rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] shadow-xl"
              onMouseDown={(event) => event.stopPropagation()}
            >
              {[1, 2, 3, 4].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCount(option);
                    setCountMenuOpen(false);
                  }}
                  className={`flex w-full items-center px-[0.8em] py-[0.4em] text-left text-[1em] text-text-dark transition-colors hover:bg-[var(--canvas-node-menu-hover)] ${
                    count === option ? 'bg-[var(--canvas-node-menu-active)]' : ''
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="relative flex shrink-0 items-center">
          <button
            type="button"
            disabled={!canSubmit}
            className="flex items-center gap-[0.4em] rounded-md bg-accent px-[0.9em] py-[0.35em] text-[1em] text-white disabled:opacity-50"
            onClick={(event) => {
              event.stopPropagation();
              void handleSubmit();
            }}
          >
            <Send className="h-[1em] w-[1em]" />
            {t('common.generate')}
          </button>
          <button
            type="button"
            className="ml-[0.2em] rounded-md border border-[var(--canvas-node-field-border)] px-[0.5em] py-[0.35em] text-[0.9em] text-text-dark"
            onClick={(event) => {
              event.stopPropagation();
              setModeMenuOpen((open) => !open);
            }}
          >
            ▾
          </button>
          {modeMenuOpen ? (
            <div
              className="nowheel absolute bottom-full right-0 z-50 mb-[0.3em] w-[12em] overflow-hidden rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] shadow-xl"
              onMouseDown={(event) => event.stopPropagation()}
            >
              {([
                ['overwrite', t('node.imageNode.modeOverwrite'), t('node.imageNode.modeOverwriteHint')],
                ['newNode', t('node.imageNode.modeNewNode'), t('node.imageNode.modeNewNodeHint')],
              ] as const).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMode(value);
                    setModeMenuOpen(false);
                  }}
                  className={`flex w-full flex-col items-start px-[0.8em] py-[0.5em] text-left text-[1em] text-text-dark transition-colors hover:bg-[var(--canvas-node-menu-hover)] ${
                    mode === value ? 'bg-[var(--canvas-node-menu-active)]' : ''
                  }`}
                >
                  <span>{label}</span>
                  <span className="text-[0.85em] text-text-muted">{hint}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-[0.4em] flex items-center gap-[0.3em] text-[0.85em] text-text-muted">
        <Sparkles className="h-[0.9em] w-[0.9em]" />
        {mode === 'newNode' ? t('node.imageNode.modeNewNode') : t('node.imageNode.modeOverwrite')}
      </div>
      </div>
    </div>
  );
});

ImageNodePromptPanel.displayName = 'ImageNodePromptPanel';
