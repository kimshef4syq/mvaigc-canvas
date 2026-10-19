import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Bug, Camera, Check, ChevronDown, ChevronRight, Copy, History, Loader2, Maximize2, Sparkles, Type, Video, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';

import {
  type CameraControlOptions,
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  isAiVideoNode,
  type AiVideoNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import {
  parseInputImageSignature,
  parseInputReferenceSignature,
  selectInputImageSignature,
  selectInputReferenceSignature,
} from '@/features/canvas/application/canvasGraphSelectors';
import {
  buildReferenceContextPrompt,
  collapseTagGroupReferenceOptions,
  collectInputReferences,
  normalizeReferenceTokensForSubmission,
} from '@/features/canvas/application/graphReferenceResolver';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { prepareNodeImageFromFile } from '@/features/canvas/application/imageData';
import { prepareAudioNodeDataFromFile } from '@/features/canvas/application/audioUpload';
import { prepareVideoNodeDataFromFile } from '@/features/canvas/application/videoUpload';
import { findRelatedCanvasNodePositions } from '@/features/canvas/application/canvasNodePlacement';
import {
  canAddReferenceKind,
  listReferenceCandidates,
  type ReferenceMediaKind,
} from '@/features/canvas/application/videoReferenceCandidates';
import type { VideoGenerationMode } from '@/features/canvas/application/videoNodeGeneration';
import { buildCompletedVideoPatch, normalizeVideoHistory, resolveMainVideoEntry } from '@/features/canvas/application/generatedVideoHistory';
import { buildCapturedFrameNodeData, captureVideoThumbnail, resolveFrameCaptureTime } from '@/features/canvas/application/videoUpload';
import { VideoNodeToolbar, type FrameCaptureMode } from '@/features/canvas/ui/VideoNodeToolbar';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import {
  CURRENT_RUNTIME_SESSION_ID,
  createReferenceImagePlaceholders,
  getRuntimeDiagnostics,
  type GenerationDebugContext,
} from '@/features/canvas/application/generationErrorReport';
import {
  acquireGenerationSubmitLock,
  generationSubmitLockKey,
} from '@/features/canvas/application/generationSubmitLock';
import {
  findReferenceTokens,
  insertReferenceToken as insertReferenceTokenText,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from '@/features/canvas/application/referenceTokenEditing';
import {
  buildVideoModelCatalog,
  resolveVideoModelConfig,
  useVideoModelCatalog,
  type VideoCatalogEntry,
  type VideoModelConfigValue,
} from '@/features/canvas/application/videoModelCatalog';
import {
  parseDreaminaTransitionSegments,
  resizeDreaminaTransitionSegments,
  validateDreaminaVideoRequest,
  type DreaminaTransitionSegment,
} from '@/features/canvas/application/dreaminaCapabilities';
import { subscribeCanvasGenerationTrigger } from '@/features/canvas/application/canvasGenerationTriggers';
import {
  getVideoReferenceOverflow,
  type VideoInputSchema,
} from '@/features/canvas/application/videoInputSchema';
import {
  VIDEO_NODE_MODES,
  mergeModeWithModelCapability,
  videoModeImageMode,
  videoModeInputSchema,
  type VideoNodeModeKind,
} from '@/features/canvas/application/videoModes';
import {
  buildVideoGenerationDebugPreview,
  canvasEventBus,
  canvasVideoGateway,
} from '@/features/canvas/application/canvasServices';
import {
  getLocalDateStamp,
  resolveDefaultGeneratedVideoDisplayName,
  resolveDefaultGeneratedVideoFileStem,
  resolveNextGeneratedMediaSequence,
} from '@/features/canvas/application/generatedMediaNaming';
import { VideoSlotHeader } from './VideoSlotHeader';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { CameraControlPanel } from '@/features/canvas/ui/CameraControlPanel';
import { DreaminaMultiframeEditor } from '@/features/canvas/ui/DreaminaMultiframeEditor';
import { buildCameraPrompt } from '@/features/canvas/application/cameraPromptLibrary';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { UiButton, UiModal } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCustomProvidersStore } from '@/stores/customProvidersStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { isMiniMaxDesignVideoModel, lintPrompt } from '@/features/promptCompiler/PromptLinter';
import { PromptComposerDialog } from '@/features/promptCompiler/PromptComposerDialog';

type AiVideoNodeProps = NodeProps & {
  id: string;
  data: AiVideoNodeData;
  selected?: boolean;
};

const AI_VIDEO_NODE_MIN_WIDTH = 560;
const AI_VIDEO_NODE_MIN_HEIGHT = 260;
const AI_VIDEO_NODE_DEFAULT_WIDTH = 680;
const AI_VIDEO_NODE_DEFAULT_HEIGHT = 360;
const AI_VIDEO_NODE_MAX_WIDTH = 1400;
const AI_VIDEO_NODE_MAX_HEIGHT = 1000;
const PROMPT_COMMIT_DELAY_MS = 650;
const VIDEO_GENERATION_PROGRESS_DURATION_MS = 15 * 60 * 1000;
const PICKER_FALLBACK_ANCHOR = { left: 8, top: 8 };
const PICKER_Y_OFFSET_PX = 20;
const REFERENCE_PICKER_WIDTH_PX = 150;
const FUNCTION_PICKER_WIDTH_PX = 280;
const PROMPT_PRESET_GROUP_ID = '__prompt_presets__';
const AI_VIDEO_SELECTOR_CHIP_CLASS =
  'border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-button-bg)] text-text-dark shadow-sm hover:border-[var(--canvas-node-border-hover)] hover:bg-[var(--canvas-node-menu-hover)]';
const AI_VIDEO_COMPACT_ICON_CHIP_CLASS =
  '!w-6 !px-0 border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-button-bg)] text-text-dark shadow-sm hover:border-[var(--canvas-node-border-hover)] hover:bg-[var(--canvas-node-menu-hover)]';

function renderPromptWithHighlights(prompt: string, maxImageCount: number): ReactNode {
  if (!prompt) return ' ';
  const segments: ReactNode[] = [];
  let lastIndex = 0;
  for (const token of findReferenceTokens(prompt, maxImageCount)) {
    if (token.start > lastIndex) {
      segments.push(<span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex, token.start)}</span>);
    }
    segments.push(
      <span
        key={`ref-${token.start}`}
        className="inline rounded-[5px] bg-accent/45 font-medium text-white [box-decoration-break:clone] [-webkit-box-decoration-break:clone] [text-shadow:0.24px_0_currentColor,-0.24px_0_currentColor]"
      >
        {token.token}
      </span>
    );
    lastIndex = token.start + token.token.length;
  }
  if (lastIndex < prompt.length) {
    segments.push(<span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex)}</span>);
  }
  return segments;
}

function getTextareaCaretOffset(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): { left: number; top: number } {
  const mirror = document.createElement('div');
  const computed = window.getComputedStyle(textarea);
  const mirrorStyle = mirror.style;

  mirrorStyle.position = 'absolute';
  mirrorStyle.visibility = 'hidden';
  mirrorStyle.pointerEvents = 'none';
  mirrorStyle.whiteSpace = 'pre-wrap';
  mirrorStyle.overflowWrap = 'break-word';
  mirrorStyle.wordBreak = 'break-word';
  mirrorStyle.boxSizing = computed.boxSizing;
  mirrorStyle.width = `${textarea.clientWidth}px`;
  mirrorStyle.font = computed.font;
  mirrorStyle.lineHeight = computed.lineHeight;
  mirrorStyle.letterSpacing = computed.letterSpacing;
  mirrorStyle.padding = computed.padding;
  mirrorStyle.border = computed.border;
  mirrorStyle.textTransform = computed.textTransform;
  mirrorStyle.textIndent = computed.textIndent;

  mirror.textContent = textarea.value.slice(0, caretIndex);
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(caretIndex, caretIndex + 1) || ' ';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const left = marker.offsetLeft - textarea.scrollLeft;
  const top = marker.offsetTop - textarea.scrollTop;
  document.body.removeChild(mirror);

  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
  };
}

function resolvePickerAnchor(
  container: HTMLDivElement | null,
  textarea: HTMLTextAreaElement,
  caretIndex: number
): { left: number; top: number } {
  if (!container) {
    return PICKER_FALLBACK_ANCHOR;
  }

  const containerRect = container.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const caretOffset = getTextareaCaretOffset(textarea, caretIndex);

  return {
    left: Math.max(0, textareaRect.left - containerRect.left + caretOffset.left),
    top: Math.max(0, textareaRect.top - containerRect.top + caretOffset.top + PICKER_Y_OFFSET_PX),
  };
}

function resolveConfigEntry(
  catalog: readonly VideoCatalogEntry[],
  config?: VideoModelConfigValue
): VideoCatalogEntry | undefined {
  return config ? catalog.find((entry) => entry.id === config.entryId) : undefined;
}

function aspectRatioFromPixelResolution(resolution: string): string | null {
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(resolution.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function serializeDebugJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function defaultDurationForVideoEntry(entry: VideoCatalogEntry): string {
  if (entry.providerId === 'agnes' && entry.supportedDurations.includes('5')) {
    return '5';
  }
  return entry.supportedDurations[0] ?? '4';
}

function resolveAgnesVideoMode(extraParams: Record<string, unknown> | undefined): 'keyframes' | null {
  const raw = extraParams?.agnesVideoMode ?? extraParams?.videoMode ?? extraParams?.mode;
  return typeof raw === 'string' && raw.toLowerCase() === 'keyframes' ? 'keyframes' : null;
}

function describeVideoInputSchema(schema: VideoInputSchema): string {
  const parts: string[] = [];
  if (schema.images.enabled) {
    const imagePart = schema.images.max > 0
      ? `图 ${schema.images.min}-${schema.images.max}`
      : '图 0';
    parts.push(schema.images.requireImageHost ? `${imagePart} URL` : imagePart);
  }
  if (schema.video.enabled) {
    parts.push(`视频 ${schema.video.min}-${schema.video.max}`);
  }
  if (schema.audio.enabled) {
    parts.push(`音频 ${schema.audio.min}-${schema.audio.max}`);
  }
  return parts.length > 0 ? parts.join(' / ') : '无引用';
}

function describeCompactVideoInputSchema(schema: VideoInputSchema): string {
  const parts: string[] = [];
  if (schema.images.enabled) {
    const imagePart = `图${Math.max(0, schema.images.max)}`;
    parts.push(schema.images.requireImageHost ? `${imagePart}URL` : imagePart);
  }
  if (schema.video.enabled) {
    parts.push(`视频${Math.max(0, schema.video.max)}`);
  }
  if (schema.audio.enabled) {
    parts.push(`音频${Math.max(0, schema.audio.max)}`);
  }
  return parts.length > 0 ? parts.join('/') : '无';
}

interface VideoGenerationRequestAssembly {
  prompt: string;
  latestModelConfig: VideoModelConfigValue;
  latestEntry: VideoCatalogEntry;
  latestIncomingImages: string[];
  latestIncomingVideos: string[];
  latestIncomingAudios: string[];
  outputAspectRatio: string;
  gatewayPayload: {
    prompt: string;
    model: string;
    size: string;
    aspectRatio?: string;
    seconds?: number;
    referenceImages: string[];
    referenceVideos: string[];
    referenceAudios: string[];
    extraParams?: Record<string, unknown>;
  };
}

export const AiVideoNode = memo(({ id, data, selected, width, height }: AiVideoNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const rootRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptBoxRef = useRef<HTMLDivElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const promptCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedPromptRef = useRef(data.prompt ?? '');
  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(promptDraft);
  const [error, setError] = useState<string | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referencePickerAnchor, setReferencePickerAnchor] = useState(PICKER_FALLBACK_ANCHOR);
  const [referencePickerCursor, setReferencePickerCursor] = useState<number | null>(null);
  const [referencePickerActiveIndex, setReferencePickerActiveIndex] = useState(0);
  const [showFunctionPicker, setShowFunctionPicker] = useState(false);
  const [functionPickerAnchor, setFunctionPickerAnchor] = useState(PICKER_FALLBACK_ANCHOR);
  const [functionPickerActiveIndex, setFunctionPickerActiveIndex] = useState(0);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptComposerOpen, setPromptComposerOpen] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionText, setCaptionText] = useState('');
  const [captionStart, setCaptionStart] = useState('0');
  const [captionEnd, setCaptionEnd] = useState('4');
  const [captionBusy, setCaptionBusy] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [generationMode, setGenerationMode] = useState<VideoGenerationMode>('overwrite');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [frameMenuOpen, setFrameMenuOpen] = useState(false);
  const [videoPreviewSource, setVideoPreviewSource] = useState<string | null>(null);

  const videoHistory = useMemo(
    () => normalizeVideoHistory(data as Record<string, unknown>)?.videos ?? [],
    [data]
  );
  const mainVideoEntry = useMemo(
    () => resolveMainVideoEntry(videoHistory, data.mainVideoIndex),
    [videoHistory, data.mainVideoIndex]
  );
  const displayVideoUrl = mainVideoEntry?.videoUrl ?? data.videoUrl ?? null;
  const displayPosterUrl = mainVideoEntry?.thumbnailUrl ?? data.thumbnailUrl ?? null;
  const displayVideoSource = displayVideoUrl ? resolveImageDisplayUrl(displayVideoUrl) : null;
  const localCaptionSource = mainVideoEntry?.localVideoUrl ?? data.localVideoUrl ?? (displayVideoUrl?.startsWith('/') ? displayVideoUrl : null);
  const [showCameraControl, setShowCameraControl] = useState(false);
  const [payloadDebugText, setPayloadDebugText] = useState<string | null>(null);
  const [payloadDebugCopied, setPayloadDebugCopied] = useState(false);

  const incomingImageSignature = useCanvasStore((state) =>
    selectInputImageSignature(id, state.nodes, state.edges)
  );
  const incomingReferenceSignature = useCanvasStore((state) =>
    selectInputReferenceSignature(id, state.nodes, state.edges)
  );
  const incomingImages = useMemo(
    () => parseInputImageSignature(incomingImageSignature),
    [incomingImageSignature]
  );
  const incomingReferences = useMemo(
    () => parseInputReferenceSignature(incomingReferenceSignature),
    [incomingReferenceSignature]
  );
  const incomingViewerList = useMemo(
    () => incomingImages.map((imageUrl) => resolveImageDisplayUrl(imageUrl)),
    [incomingImages]
  );
  const incomingReferenceItems = useMemo(
    () => incomingReferences.map((reference) => ({
      ...reference,
      displayUrl: reference.kind === 'image' && reference.imageUrl
        ? resolveImageDisplayUrl(reference.imageUrl)
        : reference.kind === 'video' && reference.thumbnailUrl
          ? resolveImageDisplayUrl(reference.thumbnailUrl)
          : null,
    })),
    [incomingReferences]
  );
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const catalog = useVideoModelCatalog();
  const showNodePayloadPreview = useSettingsStore((state) => state.showNodePayloadPreview);
  const promptPresets = useSettingsStore((state) => state.promptPresets);
  const resolvedModelConfig = useMemo(
    () => resolveVideoModelConfig(catalog, data.modelConfig),
    [catalog, data.modelConfig]
  );
  const selectedEntry = useMemo(
    () => resolveConfigEntry(catalog, resolvedModelConfig),
    [catalog, resolvedModelConfig]
  );
  // The generation mode is a node-level choice, uniform across every model and
  // provider: it decides how connected media is used and what imageMode we send.
  const videoMode: VideoNodeModeKind = data.videoMode ?? 'reference';
  const currentInputSchema = useMemo(
    () => mergeModeWithModelCapability(videoModeInputSchema(videoMode), {
      images: selectedEntry?.supportedImageCount,
      videos: selectedEntry?.supportedVideoCount,
      audios: selectedEntry?.supportedAudioCount,
    }),
    [videoMode, selectedEntry]
  );
  const schemaIncomingImageItems = useMemo(
    () => currentInputSchema.images.enabled
      ? incomingReferenceItems
        .filter((reference) => reference.kind === 'image' && reference.imageUrl)
        .slice(0, currentInputSchema.images.max)
      : [],
    [currentInputSchema.images.enabled, currentInputSchema.images.max, incomingReferenceItems]
  );
  const schemaReferencePickerItems = useMemo(() => {
    const items = collapseTagGroupReferenceOptions(incomingReferenceItems.filter((reference) => {
      if (reference.kind === 'image') return currentInputSchema.images.enabled;
      if (reference.kind === 'video') return currentInputSchema.video.enabled;
      if (reference.kind === 'audio') return currentInputSchema.audio.enabled;
      return true;
    }));
    // Frames mode + swapped: the thumbnail row must mirror the label order so
    // the first shown image is the one actually sent as the last frame.
    if (videoMode === 'frames' && data.framesSwapped) {
      const images = items.filter((item) => item.kind === 'image');
      if (images.length >= 2) {
        const reversed = [...images].reverse();
        let cursor = 0;
        return items.map((item) => (item.kind === 'image' ? reversed[cursor++] : item));
      }
    }
    return items;
  }, [currentInputSchema.audio.enabled, currentInputSchema.images.enabled, currentInputSchema.video.enabled, incomingReferenceItems, videoMode, data.framesSwapped]);

  // "＋" reference picker: add media (local upload or canvas node) as a
  // connected reference, gated by the current mode's schema.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [canvasPickerKind, setCanvasPickerKind] = useState<ReferenceMediaKind | null>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);
  const canvasNodes = useCanvasStore((state) => state.nodes);
  const canvasEdges = useCanvasStore((state) => state.edges);
  const referenceCandidates = useMemo(
    () => listReferenceCandidates(canvasNodes, canvasEdges, id),
    [canvasNodes, canvasEdges, id]
  );
  const addSlotState = useMemo(() => ({
    image: { enabled: currentInputSchema.images.enabled, count: schemaIncomingImageItems.length, max: currentInputSchema.images.max },
    video: {
      enabled: currentInputSchema.video.enabled,
      count: incomingReferenceItems.filter((r) => r.kind === 'video').length,
      max: currentInputSchema.video.max,
    },
    audio: {
      enabled: currentInputSchema.audio.enabled,
      count: incomingReferenceItems.filter((r) => r.kind === 'audio').length,
      max: currentInputSchema.audio.max,
    },
  }), [
    currentInputSchema.images.enabled, currentInputSchema.images.max,
    currentInputSchema.video.enabled, currentInputSchema.video.max,
    currentInputSchema.audio.enabled, currentInputSchema.audio.max,
    schemaIncomingImageItems.length, incomingReferenceItems,
  ]);
  const addMenuKindEnabled = useMemo(
    () => ({
      image: canAddReferenceKind(addSlotState.image),
      video: canAddReferenceKind(addSlotState.video),
      audio: canAddReferenceKind(addSlotState.audio),
    }),
    [addSlotState]
  );
  const fileAcceptForKinds = useMemo(() => {
    const parts: string[] = [];
    if (addMenuKindEnabled.image) parts.push('image/*');
    if (addMenuKindEnabled.video) parts.push('video/*');
    if (addMenuKindEnabled.audio) parts.push('audio/*');
    return parts.join(',');
  }, [addMenuKindEnabled]);

  const placeUploadedNode = useCallback(() => {
    const [position] = findRelatedCanvasNodePositions({
      nodes: canvasNodes,
      relatedNodeId: id,
      desired: { x: 0, y: 0 },
      size: { width: EXPORT_RESULT_NODE_DEFAULT_WIDTH, height: EXPORT_RESULT_NODE_LAYOUT_HEIGHT },
      count: 1,
    });
    return position ?? { x: 0, y: 0 };
  }, [canvasNodes, id]);

  const handleReferenceFile = useCallback(async (file: File) => {
    const kind: ReferenceMediaKind = file.type.startsWith('video/')
      ? 'video'
      : file.type.startsWith('audio/')
        ? 'audio'
        : 'image';
    if (!addMenuKindEnabled[kind]) return;
    const position = placeUploadedNode();
    try {
      if (kind === 'video') {
        const prepared = await prepareVideoNodeDataFromFile(file);
        const nodeId = addNode(CANVAS_NODE_TYPES.video, position, { ...prepared, displayName: file.name });
        addEdge(nodeId, id);
      } else if (kind === 'audio') {
        const prepared = await prepareAudioNodeDataFromFile(file);
        const nodeId = addNode(CANVAS_NODE_TYPES.audio, position, { ...prepared, displayName: file.name });
        addEdge(nodeId, id);
      } else {
        const prepared = await prepareNodeImageFromFile(file);
        const nodeId = addNode(CANVAS_NODE_TYPES.upload, position, {
          imageUrl: prepared.imageUrl,
          previewImageUrl: prepared.previewImageUrl,
          aspectRatio: prepared.aspectRatio || '1:1',
          sourceFileName: file.name,
        });
        addEdge(nodeId, id);
      }
    } catch {
      // Unreadable files simply produce no node.
    }
  }, [addMenuKindEnabled, placeUploadedNode, addNode, addEdge, id]);

  const handleAddCanvasReference = useCallback((candidate: { nodeId: string }) => {
    addEdge(candidate.nodeId, id);
    setCanvasPickerKind(null);
    setAddMenuOpen(false);
  }, [addEdge, id]);

  const functionPickerItems = useMemo(() => (
    promptPresets.length > 0
      ? [{
        kind: 'presetGroup' as const,
        id: PROMPT_PRESET_GROUP_ID,
        label: t('nodeToolbar.promptPreset') as string,
        description: t('nodeToolbar.promptPresetMenuTitle') as string,
        icon: Sparkles,
      }]
      : []
  ), [promptPresets.length, t]);
  const selectedPresetLabel = useMemo(() => {
    if (!data.selectedPromptPresetId) {
      return null;
    }
    return promptPresets.find((preset) => preset.id === data.selectedPromptPresetId)?.name ?? null;
  }, [data.selectedPromptPresetId, promptPresets]);
  const isAgnesVideoModel = selectedEntry?.providerId === 'agnes';
  const isDreaminaMultiframe = selectedEntry?.id === 'dreamina:multi-frame-video';
  const dreaminaMultiframeImageCount = isDreaminaMultiframe ? schemaIncomingImageItems.length : 0;
  const dreaminaTransitionValue = resolvedModelConfig?.extraParams?.dreaminaTransitionSegments
    ?? resolvedModelConfig?.extraParams?.transitionSegments;
  const agnesVideoMode = resolveAgnesVideoMode(resolvedModelConfig?.extraParams);
  const entriesByProvider = useMemo(() => {
    const map = new Map<string, VideoCatalogEntry[]>();
    for (const entry of catalog) {
      const bucket = map.get(entry.providerLabel) ?? [];
      bucket.push(entry);
      map.set(entry.providerLabel, bucket);
    }
    return map;
  }, [catalog]);
  const modelsForSelectedProvider = useMemo(
    () => selectedEntry ? (entriesByProvider.get(selectedEntry.providerLabel) ?? []) : [],
    [entriesByProvider, selectedEntry]
  );
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.aiVideo, data),
    [data]
  );
  const resolvedWidth = Math.max(AI_VIDEO_NODE_MIN_WIDTH, Math.round(width ?? AI_VIDEO_NODE_DEFAULT_WIDTH));
  const resolvedHeight = Math.max(AI_VIDEO_NODE_MIN_HEIGHT, Math.round(height ?? AI_VIDEO_NODE_DEFAULT_HEIGHT));

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    if (!data.modelConfig && resolvedModelConfig) {
      updateNodeData(id, { modelConfig: resolvedModelConfig });
    }
  }, [data.modelConfig, id, resolvedModelConfig, updateNodeData]);

  const clearPromptCommitTimer = useCallback(() => {
    if (promptCommitTimerRef.current) {
      clearTimeout(promptCommitTimerRef.current);
      promptCommitTimerRef.current = null;
    }
  }, []);

  const flushPromptDraft = useCallback((nextPrompt = promptDraftRef.current) => {
    clearPromptCommitTimer();
    promptDraftRef.current = nextPrompt;
    if (Object.is(lastCommittedPromptRef.current, nextPrompt)) {
      return;
    }
    lastCommittedPromptRef.current = nextPrompt;
    updateNodeData(id, { prompt: nextPrompt });
  }, [clearPromptCommitTimer, id, updateNodeData]);

  const schedulePromptCommit = useCallback((nextPrompt: string) => {
    promptDraftRef.current = nextPrompt;
    clearPromptCommitTimer();
    if (Object.is(lastCommittedPromptRef.current, nextPrompt)) {
      return;
    }
    promptCommitTimerRef.current = setTimeout(() => {
      promptCommitTimerRef.current = null;
      const latest = promptDraftRef.current;
      if (Object.is(lastCommittedPromptRef.current, latest)) {
        return;
      }
      lastCommittedPromptRef.current = latest;
      updateNodeData(id, { prompt: latest });
    }, PROMPT_COMMIT_DELAY_MS);
  }, [clearPromptCommitTimer, id, updateNodeData]);

  useEffect(() => {
    const externalPrompt = data.prompt ?? '';
    lastCommittedPromptRef.current = externalPrompt;
    if (externalPrompt !== promptDraftRef.current) {
      clearPromptCommitTimer();
      promptDraftRef.current = externalPrompt;
      setPromptDraft(externalPrompt);
    }
  }, [clearPromptCommitTimer, data.prompt]);

  useEffect(() => {
    return () => {
      if (promptCommitTimerRef.current) {
        clearTimeout(promptCommitTimerRef.current);
      }
      const latest = promptDraftRef.current;
      if (!Object.is(lastCommittedPromptRef.current, latest)) {
        updateNodeData(id, { prompt: latest });
      }
    };
  }, [id, updateNodeData]);

  const syncPromptHighlightScroll = useCallback(() => {
    if (!promptRef.current || !promptHighlightRef.current) return;
    promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
    promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
  }, []);

  const insertReferenceToken = useCallback((index: number) => {
    const marker = schemaReferencePickerItems[index]?.token ?? '';
    if (!marker) {
      return;
    }
    const textarea = promptRef.current;
    const current = promptDraftRef.current;
    const cursor = referencePickerCursor ?? textarea?.selectionStart ?? current.length;
    const { nextText: nextPrompt, nextCursor } = insertReferenceTokenText(current, cursor, marker);
    setPromptDraft(nextPrompt);
    flushPromptDraft(nextPrompt);
    setReferencePickerOpen(false);
    setReferencePickerCursor(null);
    setReferencePickerActiveIndex(0);
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(nextCursor, nextCursor);
      syncPromptHighlightScroll();
    });
  }, [flushPromptDraft, referencePickerCursor, schemaReferencePickerItems, syncPromptHighlightScroll]);

  const selectPromptPresetFromPicker = useCallback((presetId: string) => {
    updateNodeData(id, { selectedPromptPresetId: presetId });
    setShowFunctionPicker(false);
    setFunctionPickerActiveIndex(0);
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      syncPromptHighlightScroll();
    });
  }, [id, syncPromptHighlightScroll, updateNodeData]);

  const selectFunctionPickerItem = useCallback((index: number) => {
    const item = functionPickerItems[index];
    if (!item) return;
    const firstPreset = promptPresets[0];
    if (firstPreset) {
      selectPromptPresetFromPicker(firstPreset.id);
    }
  }, [functionPickerItems, promptPresets, selectPromptPresetFromPicker]);

  const clearSelectedPromptPreset = useCallback(() => {
    updateNodeData(id, { selectedPromptPresetId: null });
  }, [id, updateNodeData]);

  const handleCameraControlApply = useCallback((cameraControl: CameraControlOptions) => {
    updateNodeData(id, { cameraControl });
  }, [id, updateNodeData]);

  const handleConfigChange = useCallback((patch: Partial<VideoModelConfigValue>) => {
    const base = resolvedModelConfig ?? resolveVideoModelConfig(catalog, null);
    if (!base) return;
    updateNodeData(id, { modelConfig: { ...base, ...patch } });
  }, [catalog, id, resolvedModelConfig, updateNodeData]);

  const handleAgnesVideoModeChange = useCallback((mode: 'multi' | 'keyframes') => {
    const base = resolvedModelConfig ?? resolveVideoModelConfig(catalog, null);
    if (!base) return;
    const nextExtraParams = { ...(base.extraParams ?? {}) };
    if (mode === 'keyframes') {
      nextExtraParams.agnesVideoMode = 'keyframes';
    } else {
      delete nextExtraParams.agnesVideoMode;
      delete nextExtraParams.videoMode;
      delete nextExtraParams.mode;
    }
    updateNodeData(id, {
      modelConfig: {
        ...base,
        extraParams: nextExtraParams,
      },
    });
  }, [catalog, id, resolvedModelConfig, updateNodeData]);

  const handleDreaminaTransitionsChange = useCallback((segments: DreaminaTransitionSegment[]) => {
    const base = resolvedModelConfig ?? resolveVideoModelConfig(catalog, null);
    if (!base) return;
    const nextExtraParams = { ...(base.extraParams ?? {}) };
    nextExtraParams.dreaminaTransitionSegments = segments;
    delete nextExtraParams.transitionSegments;
    updateNodeData(id, {
      modelConfig: {
        ...base,
        extraParams: nextExtraParams,
      },
    });
  }, [catalog, id, resolvedModelConfig, updateNodeData]);

  useEffect(() => {
    if (!isDreaminaMultiframe || dreaminaMultiframeImageCount < 3 || !resolvedModelConfig) {
      return;
    }
    const expectedCount = dreaminaMultiframeImageCount - 1;
    const current = parseDreaminaTransitionSegments(dreaminaTransitionValue);
    if (current?.length === expectedCount) {
      return;
    }
    handleDreaminaTransitionsChange(
      resizeDreaminaTransitionSegments(dreaminaTransitionValue, expectedCount),
    );
  }, [
    dreaminaMultiframeImageCount,
    dreaminaTransitionValue,
    handleDreaminaTransitionsChange,
    isDreaminaMultiframe,
    resolvedModelConfig,
  ]);

  const closeOpenPopovers = useCallback(() => {
    setProviderOpen(false);
    setModelOpen(false);
    setParamsOpen(false);
    setReferencePickerOpen(false);
    setReferencePickerCursor(null);
    setShowFunctionPicker(false);
  }, []);

  useEffect(() => {
    if (!providerOpen && !modelOpen && !paramsOpen && !referencePickerOpen && !showFunctionPicker) {
      return;
    }
    const handleOutside = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as globalThis.Node)) {
        return;
      }
      closeOpenPopovers();
    };
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [closeOpenPopovers, modelOpen, paramsOpen, providerOpen, referencePickerOpen, showFunctionPicker]);

  const assembleVideoGenerationRequest = useCallback((): VideoGenerationRequestAssembly | null => {
    const latestPromptDraft = promptDraftRef.current;
    flushPromptDraft(latestPromptDraft);
    const latestCanvasState = useCanvasStore.getState();
    const latestNode = latestCanvasState.nodes.find((candidate) => candidate.id === id);
    const latestData = latestNode && isAiVideoNode(latestNode) ? latestNode.data : data;
    const latestSettings = useSettingsStore.getState();
    const latestCatalog = buildVideoModelCatalog(
      useCustomProvidersStore.getState().providers,
      latestSettings.agnesApiKey,
      latestSettings.dreaminaStatus
    );
    const latestModelConfig = resolveVideoModelConfig(latestCatalog, latestData.modelConfig ?? resolvedModelConfig);
    const latestEntry = resolveConfigEntry(latestCatalog, latestModelConfig);
    const latestReferences = collectInputReferences(id, latestCanvasState.nodes, latestCanvasState.edges);
    const basePrompt = normalizeReferenceTokensForSubmission(latestPromptDraft, latestReferences);
    let sourcePrompt = '';
    if (latestData.selectedPromptPresetId) {
      const selectedPreset = latestSettings.promptPresets.find((preset) => preset.id === latestData.selectedPromptPresetId);
      if (!selectedPreset) {
        const message = t('node.imageEdit.promptPresetMissing');
        setError(message);
        void showErrorDialog(message, t('common.error'));
        return null;
      }
      sourcePrompt = selectedPreset.prompt.trim();
    }
    let composedPrompt = sourcePrompt && basePrompt
      ? `${sourcePrompt}\n\n${t('node.imageEdit.userSupplementLabel')}${basePrompt}`
      : sourcePrompt || basePrompt;
    const cc = latestData.cameraControl;
    if (cc?.enabled === true) {
      try {
        const cameraPrompt = buildCameraPrompt({
          cameraId: cc.camera,
          lensId: cc.lens,
          focalLengthMm: cc.focalLength,
          apertureF: cc.aperture,
        }, latestSettings);
        if (cameraPrompt) {
          composedPrompt = composedPrompt ? `${composedPrompt}, ${cameraPrompt}` : cameraPrompt;
        }
      } catch {
        // Keep the user's prompt if camera prompt assembly fails.
      }
    }
    const referenceContextPrompt = buildReferenceContextPrompt(latestReferences);
    const prompt = referenceContextPrompt
      ? `${referenceContextPrompt}\n\n${composedPrompt}`
      : composedPrompt;
    if (!prompt) {
      const message = t('node.aiVideo.promptRequired');
      setError(message);
      void showErrorDialog(message, t('common.error'));
      return null;
    }
    if (!latestModelConfig || !latestEntry) {
      const message = t('node.aiVideo.noVideoProvider');
      setError(message);
      void showErrorDialog(message, t('common.error'));
      return null;
    }
    if (!latestEntry.usable) {
      const message = latestEntry.notReadyReason ?? t('node.aiVideo.noVideoProvider');
      setError(message);
      void showErrorDialog(message, t('common.error'));
      return null;
    }
    const latestInputSchema = mergeModeWithModelCapability(videoModeInputSchema(data.videoMode ?? 'reference'), {
      images: latestEntry.supportedImageCount,
      videos: latestEntry.supportedVideoCount,
      audios: latestEntry.supportedAudioCount,
    });
    const latestIncomingImages = latestInputSchema.images.enabled
      ? latestReferences
        .filter((reference) => reference.kind === 'image' && reference.imageUrl)
        .map((reference) => reference.imageUrl as string)
      : [];
    // Frames mode: a swapped node sends the first image as the last frame.
    if (data.framesSwapped && latestIncomingImages.length >= 2) {
      [latestIncomingImages[0], latestIncomingImages[1]] = [latestIncomingImages[1], latestIncomingImages[0]];
    }
    const latestIncomingVideos = latestInputSchema.video.enabled
      ? latestReferences
        .filter((reference) => reference.kind === 'video' && reference.videoUrl)
        .map((reference) => reference.videoUrl as string)
      : [];
    const latestIncomingAudios = latestInputSchema.audio.enabled
      ? latestReferences
        .filter((reference) => reference.kind === 'audio' && reference.audioUrl)
        .map((reference) => reference.audioUrl as string)
      : [];
    const overflow = getVideoReferenceOverflow(latestInputSchema, {
      images: latestIncomingImages.length,
      video: latestIncomingVideos.length,
      audio: latestIncomingAudios.length,
    });
    if (overflow) {
      const message = t(`videoInputModes.limitErrors.${overflow.kind}`, { count: overflow.count, max: overflow.max });
      setError(message);
      void showErrorDialog(message, t('common.error'));
      return null;
    }
    if (latestIncomingImages.length < latestInputSchema.images.min) {
      const message = `当前模型至少需要 ${latestInputSchema.images.min} 张图片引用。`;
      setError(message);
      void showErrorDialog(message, t('common.error'));
      return null;
    }
    if (latestIncomingVideos.length < latestInputSchema.video.min) {
      const message = `当前模型至少需要 ${latestInputSchema.video.min} 个视频引用。`;
      setError(message);
      void showErrorDialog(message, t('common.error'));
      return null;
    }
    if (latestIncomingAudios.length < latestInputSchema.audio.min) {
      const message = `当前模型至少需要 ${latestInputSchema.audio.min} 个音频引用。`;
      setError(message);
      void showErrorDialog(message, t('common.error'));
      return null;
    }
    const outputAspectRatio =
      aspectRatioFromPixelResolution(latestModelConfig.resolution)
      ?? latestModelConfig.aspectRatio
      ?? '16:9';
    const extraParams = { ...(latestModelConfig.extraParams ?? {}) };
    extraParams.videoInputSchema = latestInputSchema;
    extraParams.imageMode = videoModeImageMode(data.videoMode ?? 'reference');
    // The mvaigc proxy switches to its start/end-frame endpoint on a top-level
    // `frames` bool (it does not read imageMode). Send it only for that mode.
    extraParams.frames = (data.videoMode ?? 'reference') === 'frames';
    if (latestEntry.id === 'dreamina:multi-frame-video' && latestIncomingImages.length >= 3) {
      const transitions = parseDreaminaTransitionSegments(
        extraParams.dreaminaTransitionSegments ?? extraParams.transitionSegments,
      );
      const expectedCount = latestIncomingImages.length - 1;
      const transitionIssues = validateDreaminaVideoRequest({
        command: 'multiframe2video',
        resolution: latestModelConfig.resolution,
        duration: Number(latestModelConfig.duration) || undefined,
        ratio: latestModelConfig.aspectRatio,
        imageCount: latestIncomingImages.length,
        videoCount: 0,
        audioCount: 0,
        transitions,
      }).filter(({ field }) => field === 'transitions' || field.startsWith('transitions.'));
      if (transitions?.length !== expectedCount || transitionIssues.length > 0) {
        const message = t('node.aiVideo.multiframeIncomplete', { count: expectedCount });
        setParamsOpen(true);
        setError(message);
        void showErrorDialog(message, t('common.error'));
        return null;
      }
    }

    return {
      prompt,
      latestModelConfig,
      latestEntry,
      latestIncomingImages,
      latestIncomingVideos,
      latestIncomingAudios,
      outputAspectRatio,
      gatewayPayload: {
        prompt,
        model: latestModelConfig.entryId,
        size: latestModelConfig.resolution,
        aspectRatio: latestModelConfig.aspectRatio,
        seconds: Number(latestModelConfig.duration) || undefined,
        referenceImages: latestIncomingImages,
        referenceVideos: latestIncomingVideos,
        referenceAudios: latestIncomingAudios,
        extraParams,
      },
    };
  }, [data, flushPromptDraft, id, resolvedModelConfig, t]);

  const handleGenerate = useCallback(async () => {
    const releaseSubmitLock = acquireGenerationSubmitLock(
      generationSubmitLockKey(id, 'ai-video-node')
    );
    if (!releaseSubmitLock) {
      return;
    }
    let resultNodeId: string | null = null;
    let generationStartedAt = Date.now();
    let generationDebugContext: GenerationDebugContext | null = null;
    try {
      const assembled = assembleVideoGenerationRequest();
      if (!assembled) {
        return;
      }
      const {
        prompt,
        latestModelConfig,
        latestEntry,
        latestIncomingImages,
        latestIncomingVideos,
        latestIncomingAudios,
        outputAspectRatio,
        gatewayPayload,
      } = assembled;
      generationStartedAt = Date.now();
      const generationDurationMs = VIDEO_GENERATION_PROGRESS_DURATION_MS;
      const generatedSequence = resolveNextGeneratedMediaSequence(
        'video',
        useCanvasStore.getState().nodes
      );
      const generatedDateStamp = getLocalDateStamp();
      const resultNodeData = {
        isGenerating: true,
        generationStartedAt,
        generationDurationMs,
        displayName: resolveDefaultGeneratedVideoDisplayName(generatedSequence, prompt),
        generatedNamingMode: 'default' as const,
        generatedSequence,
        generatedDateStamp,
        generatedFileName: `${resolveDefaultGeneratedVideoFileStem(generatedSequence, generatedDateStamp)}.mp4`,
        aspectRatio: outputAspectRatio,
        durationSeconds: Number(latestModelConfig.duration) || null,
        sourcePrompt: prompt,
        sourceReferenceCount: latestIncomingImages.length,
      };
      if (generationMode === 'newNode') {
        const newNodePosition = findNodePosition(
          id,
          EXPORT_RESULT_NODE_DEFAULT_WIDTH,
          EXPORT_RESULT_NODE_LAYOUT_HEIGHT
        );
        resultNodeId = addNode(CANVAS_NODE_TYPES.video, newNodePosition, resultNodeData);
        addEdge(id, resultNodeId);
      } else {
        resultNodeId = id;
        updateNodeData(id, resultNodeData);
      }
      setError(null);

      const runtimeDiagnostics = await getRuntimeDiagnostics();
      generationDebugContext = {
        sourceType: 'aiVideo',
        providerId: latestEntry.providerId,
        requestModel: latestEntry.modelId,
        requestSize: latestModelConfig.resolution,
        prompt,
        extraParams: {
          duration: latestModelConfig.duration,
          resolution: latestModelConfig.resolution,
          aspectRatio: latestModelConfig.aspectRatio,
          referenceVideoCount: latestIncomingVideos.length,
          referenceAudioCount: latestIncomingAudios.length,
          ...(latestModelConfig.extraParams ?? {}),
        },
        referenceImageCount: latestIncomingImages.length,
        referenceImagePlaceholders: createReferenceImagePlaceholders(latestIncomingImages.length),
        appVersion: runtimeDiagnostics.appVersion,
        osName: runtimeDiagnostics.osName,
        osVersion: runtimeDiagnostics.osVersion,
        osBuild: runtimeDiagnostics.osBuild,
        userAgent: runtimeDiagnostics.userAgent,
      };

      const jobId = await canvasVideoGateway.submitGenerateVideoJob({
        ...gatewayPayload,
      });
      updateNodeData(resultNodeId, {
        generationJobId: jobId,
        generationProviderId: latestEntry.providerId,
        generationClientSessionId: CURRENT_RUNTIME_SESSION_ID,
        generationDebugContext,
      });
    } catch (submitError) {
      const resolvedError = resolveErrorContent(submitError, t('ai.error'));
      setError(resolvedError.message);
      void showErrorDialog(
        resolvedError.message,
        t('common.error'),
        resolvedError.details
      );
      if (resultNodeId) {
        updateNodeData(resultNodeId, {
          isGenerating: false,
          generationStartedAt: null,
          generationElapsedMs: Math.max(0, Date.now() - generationStartedAt),
          generationJobId: null,
          generationError: resolvedError.message,
          generationErrorDetails: resolvedError.details ?? null,
          generationDebugContext,
        });
      }
    } finally {
      releaseSubmitLock();
    }
  }, [
    addEdge,
    addNode,
    assembleVideoGenerationRequest,
    data,
    findNodePosition,
    generationMode,
    id,
    t,
    updateNodeData,
  ]);

  const handleCaptureFrame = useCallback(async (mode: FrameCaptureMode) => {
    setFrameMenuOpen(false);
    if (!displayVideoSource) {
      return;
    }
    const videoEl = rootRef.current?.querySelector('video');
    const duration = videoEl?.duration ?? 0;
    const currentTime = videoEl?.currentTime ?? 0;
    const captureTime = resolveFrameCaptureTime(mode, duration, currentTime);
    const frameUrl = await captureVideoThumbnail(displayVideoUrl ?? displayVideoSource, captureTime);
    if (!frameUrl) {
      void showErrorDialog(t('node.aiVideo.captureFrameFailed'), t('common.error'));
      return;
    }
    // Place the captured frame to the RIGHT of this node — downstream of the
    // video, matching the edge direction (frame → video). findNodePosition can
    // fall back to the left/above when the right side is crowded, so pin it.
    const selfNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
    const position = selfNode
      ? { x: selfNode.position.x + resolvedWidth + 32, y: selfNode.position.y }
      : findNodePosition(id, EXPORT_RESULT_NODE_DEFAULT_WIDTH, EXPORT_RESULT_NODE_LAYOUT_HEIGHT);
    const frameNodeId = addNode(
      CANVAS_NODE_TYPES.exportImage,
      position,
      buildCapturedFrameNodeData(frameUrl, mainVideoEntry?.aspectRatio ?? data.aspectRatio ?? '')
    );
    // video → frame (downstream), so the frame node accepts the edge.
    addEdge(id, frameNodeId);
  }, [
    addEdge,
    addNode,
    data.aspectRatio,
    displayVideoSource,
    displayVideoUrl,
    findNodePosition,
    id,
    mainVideoEntry?.aspectRatio,
    resolvedWidth,
    t,
  ]);

  const handleOpenPayloadDebug = useCallback(async () => {
    try {
      const assembled = assembleVideoGenerationRequest();
      if (!assembled) {
        return;
      }
      const preflight = isMiniMaxDesignVideoModel(assembled.gatewayPayload.model)
        ? lintPrompt({
          prompt: assembled.prompt,
          modality: 'video',
          referenceImageCount: assembled.latestIncomingImages.length,
        })
        : null;
      const preview = await buildVideoGenerationDebugPreview({
        ...assembled.gatewayPayload,
        prompt: preflight?.prompt ?? assembled.prompt,
      });
      setPayloadDebugText(serializeDebugJson({
        ...(preflight ? { promptPreflight: {
          preparedPrompt: preflight.prompt,
          issues: preflight.issues,
          ...(preflight.suggestedPrompt ? { suggestedPrompt: preflight.suggestedPrompt } : {}),
        } } : {}),
        gatewayRequest: preview.gatewayRequest,
        route: preview.route,
        providerRequest: preview.providerRequest ?? null,
      }));
      setPayloadDebugCopied(false);
    } catch (debugError) {
      const resolvedError = resolveErrorContent(debugError, t('ai.error'));
      setError(resolvedError.message);
      void showErrorDialog(
        resolvedError.message,
        t('common.error'),
        resolvedError.details,
      );
    }
  }, [assembleVideoGenerationRequest, t]);

  const handleCopyPayloadDebug = useCallback(async () => {
    if (!payloadDebugText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(payloadDebugText);
      setPayloadDebugCopied(true);
      window.setTimeout(() => setPayloadDebugCopied(false), 1600);
    } catch (copyError) {
      const resolvedError = resolveErrorContent(copyError, t('nodeToolbar.copyFailed'));
      void showErrorDialog(resolvedError.message, t('common.error'), resolvedError.details);
    }
  }, [payloadDebugText, t]);

  useEffect(() => {
    return subscribeCanvasGenerationTrigger(
      canvasEventBus,
      CANVAS_NODE_TYPES.aiVideo,
      id,
      handleGenerate,
    );
  }, [handleGenerate, id]);

  const handlePromptKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const currentPrompt = promptDraftRef.current;
      const selectionStart = event.currentTarget.selectionStart ?? currentPrompt.length;
      const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
      const deleteRange = resolveReferenceAwareDeleteRange(
        currentPrompt,
        selectionStart,
        selectionEnd,
        event.key === 'Backspace' ? 'backward' : 'forward',
        incomingReferences.length
      );
      if (deleteRange) {
        event.preventDefault();
        const { nextText, nextCursor } = removeTextRange(currentPrompt, deleteRange);
        setPromptDraft(nextText);
        flushPromptDraft(nextText);
        requestAnimationFrame(() => {
          promptRef.current?.focus();
          promptRef.current?.setSelectionRange(nextCursor, nextCursor);
          syncPromptHighlightScroll();
        });
        return;
      }
      if (
        event.key === 'Backspace'
        && !currentPrompt.trim()
        && selectedPresetLabel
        && selectionStart === 0
        && selectionEnd === 0
      ) {
        event.preventDefault();
        clearSelectedPromptPreset();
        return;
      }
    }

    if (showFunctionPicker && functionPickerItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFunctionPickerActiveIndex((previous) => (previous + 1) % functionPickerItems.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFunctionPickerActiveIndex((previous) =>
          previous === 0 ? functionPickerItems.length - 1 : previous - 1
        );
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        selectFunctionPickerItem(functionPickerActiveIndex);
        return;
      }
    }

    if (referencePickerOpen && schemaReferencePickerItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setReferencePickerActiveIndex((previous) => (previous + 1) % schemaReferencePickerItems.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setReferencePickerActiveIndex((previous) =>
          previous === 0 ? schemaReferencePickerItems.length - 1 : previous - 1
        );
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        insertReferenceToken(referencePickerActiveIndex);
        return;
      }
    }

    if (event.key === '/' && functionPickerItems.length > 0) {
      event.preventDefault();
      const cursor = event.currentTarget.selectionStart ?? promptDraftRef.current.length;
      const anchor = resolvePickerAnchor(rootRef.current, event.currentTarget, cursor);
      setFunctionPickerAnchor({
        left: Math.max(8, Math.min(anchor.left, resolvedWidth - FUNCTION_PICKER_WIDTH_PX - 8)),
        top: anchor.top,
      });
      setShowFunctionPicker(true);
      setFunctionPickerActiveIndex(0);
      setReferencePickerOpen(false);
      setReferencePickerCursor(null);
      return;
    }

    if (event.key === '@' && schemaReferencePickerItems.length > 0) {
      event.preventDefault();
      const cursor = event.currentTarget.selectionStart ?? promptDraftRef.current.length;
      const anchor = resolvePickerAnchor(promptBoxRef.current, event.currentTarget, cursor);
      setReferencePickerAnchor({
        left: Math.max(8, Math.min(anchor.left, resolvedWidth - REFERENCE_PICKER_WIDTH_PX - 8)),
        top: Math.max(8, anchor.top),
      });
      setReferencePickerCursor(cursor);
      setReferencePickerOpen(true);
      setReferencePickerActiveIndex(0);
      setProviderOpen(false);
      setModelOpen(false);
      setParamsOpen(false);
      setShowFunctionPicker(false);
      return;
    }
    if (event.key === 'Escape' && (referencePickerOpen || showFunctionPicker)) {
      event.preventDefault();
      setReferencePickerOpen(false);
      setReferencePickerCursor(null);
      setReferencePickerActiveIndex(0);
      setShowFunctionPicker(false);
      setFunctionPickerActiveIndex(0);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleGenerate();
    }
  }, [
    clearSelectedPromptPreset,
    flushPromptDraft,
    functionPickerActiveIndex,
    functionPickerItems.length,
    handleGenerate,
    incomingReferences.length,
    insertReferenceToken,
    referencePickerActiveIndex,
    referencePickerOpen,
    resolvedWidth,
    schemaReferencePickerItems.length,
    selectFunctionPickerItem,
    selectedPresetLabel,
    showFunctionPicker,
    syncPromptHighlightScroll,
  ]);

  const handlePickProvider = useCallback((providerLabel: string) => {
    const entry = entriesByProvider.get(providerLabel)?.find((candidate) => candidate.usable);
    if (!entry) return;
    updateNodeData(id, {
      modelConfig: {
        entryId: entry.id,
        duration: defaultDurationForVideoEntry(entry),
        resolution: entry.supportedResolutions[0] ?? '1280x720',
        aspectRatio: entry.supportedAspectRatios[0] ?? '16:9',
        extraParams: { ...(entry.defaultExtraParams ?? {}) },
      },
    });
    setProviderOpen(false);
  }, [entriesByProvider, id, updateNodeData]);

  const handlePickModel = useCallback((entry: VideoCatalogEntry) => {
    if (!entry.usable) return;
    updateNodeData(id, {
      modelConfig: {
        entryId: entry.id,
        duration: resolvedModelConfig?.duration && entry.supportedDurations.includes(resolvedModelConfig.duration)
          ? resolvedModelConfig.duration
          : defaultDurationForVideoEntry(entry),
        resolution: resolvedModelConfig?.resolution && entry.supportedResolutions.includes(resolvedModelConfig.resolution)
          ? resolvedModelConfig.resolution
          : entry.supportedResolutions[0] ?? '1280x720',
        aspectRatio: resolvedModelConfig?.aspectRatio && entry.supportedAspectRatios.includes(resolvedModelConfig.aspectRatio)
          ? resolvedModelConfig.aspectRatio
          : entry.supportedAspectRatios[0] ?? '16:9',
        extraParams: { ...(entry.defaultExtraParams ?? {}) },
      },
    });
    setModelOpen(false);
  }, [id, resolvedModelConfig, updateNodeData]);

  return (
    <div
      ref={rootRef}
      className={`
        group relative h-full overflow-visible rounded-[var(--node-radius)] border bg-[var(--canvas-node-bg)] p-0 shadow-[var(--canvas-node-shadow)] transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[var(--canvas-node-border)] hover:border-[var(--canvas-node-border-hover)]'}
      `}
      style={{ width: `${resolvedWidth}px`, height: `${resolvedHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Video className="h-4 w-4" />}
        titleText={resolvedTitle}
        rightSlot={showNodePayloadPreview || isMiniMaxDesignVideoModel(resolvedModelConfig?.entryId ?? '') ? <div className="flex items-center gap-1">
          {isMiniMaxDesignVideoModel(resolvedModelConfig?.entryId ?? '') && <button
            type="button"
            data-canvas-no-marquee="true"
            className="nodrag nowheel inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--canvas-node-border)] bg-[var(--canvas-node-menu-bg)] text-text-muted shadow-sm transition-colors hover:border-accent/50 hover:bg-[var(--canvas-node-menu-hover)] hover:text-accent"
            title={t('node.aiVideo.compilerButton')}
            aria-label={t('node.aiVideo.compilerButton')}
            onClick={(event) => {
              event.stopPropagation();
              setPromptComposerOpen(true);
            }}
          ><Sparkles className="h-3.5 w-3.5" /></button>}
          {localCaptionSource && <button
            type="button"
            data-canvas-no-marquee="true"
            className="nodrag nowheel inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--canvas-node-border)] bg-[var(--canvas-node-menu-bg)] text-text-muted shadow-sm transition-colors hover:border-accent/50 hover:bg-[var(--canvas-node-menu-hover)] hover:text-accent"
            title={t('node.aiVideo.captionButton')}
            aria-label={t('node.aiVideo.captionButton')}
            onClick={(event) => { event.stopPropagation(); setCaptionError(null); setCaptionOpen(true); }}
          ><Type className="h-3.5 w-3.5" /></button>}
          <button
            type="button"
            data-canvas-no-marquee="true"
            className="nodrag nowheel inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--canvas-node-border)] bg-[var(--canvas-node-menu-bg)] text-text-muted shadow-sm transition-colors hover:border-accent/50 hover:bg-[var(--canvas-node-menu-hover)] hover:text-accent"
            title={t('node.aiVideo.payloadDebug')}
            aria-label={t('node.aiVideo.payloadDebug')}
            onClick={(event) => {
              event.stopPropagation();
              if (payloadDebugText !== null) {
                setPayloadDebugText(null);
                return;
              }
              void handleOpenPayloadDebug();
            }}
          >
            <Bug className="h-3.5 w-3.5" />
          </button>
        </div> : undefined}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="relative h-full w-full overflow-hidden rounded-[var(--node-radius)] bg-black">
        <div className="relative h-full w-full overflow-hidden">
          {data.isGenerating ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-muted">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-[11px]">{t('node.videoNode.waitingResult')}</span>
            </div>
          ) : displayVideoSource ? (
            <video
              src={displayVideoSource}
              poster={displayPosterUrl ? resolveImageDisplayUrl(displayPosterUrl) : undefined}
              controls
              playsInline
              className="nodrag nowheel h-full w-full bg-black object-contain"
            />
          ) : data.generationError ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-red-300">
              <AlertTriangle className="h-6 w-6 opacity-90" />
              <span className="text-center text-[11px] font-semibold">
                {t('node.videoNode.generationFailed')}
              </span>
              <span className="max-h-[60px] overflow-y-auto break-words text-center text-[10px] text-red-200/85">
                {data.generationError}
              </span>
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[11px] text-text-muted">
              {t('node.imageNode.emptyHint')}
            </div>
          )}

          {videoHistory.length > 1 && (
            <div className="nodrag absolute left-2 top-2 z-20">
              <button
                type="button"
                className="flex h-6 items-center gap-1 rounded-md border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)]/80 px-2 text-[11px] text-text-dark backdrop-blur-sm transition-colors hover:bg-[var(--canvas-node-menu-hover)]"
                onClick={(event) => {
                  event.stopPropagation();
                  setHistoryOpen((open) => !open);
                }}
              >
                <History className="h-3.5 w-3.5" />
                {t('node.aiVideo.history', { count: videoHistory.length })}
              </button>
              {historyOpen && (
                <div
                  className="nowheel mt-1 max-h-[200px] w-[200px] overflow-y-auto rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] p-1.5 shadow-xl"
                  onWheelCapture={(event) => event.stopPropagation()}
                >
                  <div className="grid grid-cols-3 gap-1">
                    {videoHistory.map((entry, index) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`relative aspect-square overflow-hidden rounded-md border ${
                          index === (data.mainVideoIndex ?? -1) ? 'border-accent' : 'border-transparent'
                        } bg-black`}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateNodeData(id, {
                            mainVideoIndex: index,
                            videoUrl: entry.videoUrl,
                            thumbnailUrl: entry.thumbnailUrl,
                          });
                          setHistoryOpen(false);
                        }}
                      >
                        {entry.thumbnailUrl ? (
                          <img
                            src={resolveImageDisplayUrl(entry.thumbnailUrl)}
                            alt=""
                            className="h-full w-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-text-muted">
                            <Video className="h-4 w-4" />
                          </span>
                        )}
                        {index === (data.mainVideoIndex ?? -1) ? (
                          <span className="absolute bottom-0 left-0 rounded-tr bg-accent px-1 text-[10px] text-white">
                            {t('node.aiVideo.mainVideo')}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {displayVideoSource && !data.isGenerating && (
            <div className="nodrag absolute right-2 top-2 z-20">
              <VideoNodeToolbar
                onPreview={() => setVideoPreviewSource(displayVideoSource)}
                onCaptureFrame={(mode) => void handleCaptureFrame(mode)}
                onToggleFrameMenu={() => setFrameMenuOpen((open) => !open)}
                frameMenuOpen={frameMenuOpen}
              />
            </div>
          )}
        </div>
      </div>

      {selected && (
      <div className="mt-2 flex w-[563px] max-w-[92vw] shrink-0 flex-col rounded-[var(--node-radius)] border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-bg)] p-2">
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1">
        <span className="mr-1 text-[10px] text-text-muted">{t('videoModeTabs.label')}</span>
        {VIDEO_NODE_MODES.map((mode) => {
          const active = videoMode === mode.kind;
          return (
            <button
              key={mode.kind}
              type="button"
              data-testid={`video-mode-${mode.kind}`}
              className={`nodrag rounded-md border px-2 py-1 text-[11px] transition-colors ${
                active
                  ? 'border-accent/60 bg-accent/15 text-accent'
                  : 'border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-button-bg)] text-[var(--canvas-node-button-text)] hover:border-[var(--canvas-node-border-hover)] hover:bg-[var(--canvas-node-menu-hover)]'
              }`}
              onClick={(event) => {
                event.stopPropagation();
                updateNodeData(id, { videoMode: mode.kind });
              }}
            >
              {t(mode.labelKey)}
            </button>
          );
        })}
      </div>
      <VideoSlotHeader
        schema={currentInputSchema}
        onSwap={() => updateNodeData(id, { framesSwapped: !data.framesSwapped })}
      />
      {(addMenuKindEnabled.image || addMenuKindEnabled.video || addMenuKindEnabled.audio) && (
        <div className="relative mb-1 flex shrink-0">
          <button
            type="button"
            data-testid="video-add-reference"
            className="nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded border border-dashed border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] text-lg leading-none text-text-muted transition-colors hover:border-accent/50 hover:text-text-dark"
            title={t('node.aiVideo.addReference')}
            onClick={(event) => {
              event.stopPropagation();
              setAddMenuOpen((open) => !open);
              setCanvasPickerKind(null);
            }}
          >
            +
          </button>
          <input
            ref={referenceFileInputRef}
            type="file"
            accept={fileAcceptForKinds || undefined}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void handleReferenceFile(file);
            }}
          />
          {addMenuOpen && (
            <div
              className="nowheel absolute left-0 top-full z-40 mt-1 w-[160px] overflow-hidden rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] p-1 shadow-xl"
              onMouseDown={(event) => event.stopPropagation()}
              onWheelCapture={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                data-testid="video-add-local"
                className="flex w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--canvas-node-button-text)] hover:bg-[var(--canvas-node-menu-hover)]"
                onClick={(event) => {
                  event.stopPropagation();
                  setAddMenuOpen(false);
                  referenceFileInputRef.current?.click();
                }}
              >
                {t('node.aiVideo.addFromLocal')}
              </button>
              {(['image', 'video', 'audio'] as const)
                .filter((kind) => addMenuKindEnabled[kind] && referenceCandidates[kind].length > 0)
                .map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="flex w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--canvas-node-button-text)] hover:bg-[var(--canvas-node-menu-hover)]"
                    onClick={(event) => {
                      event.stopPropagation();
                      setCanvasPickerKind(kind);
                    }}
                  >
                    {t(`node.aiVideo.addFromCanvas.${kind}`)}
                  </button>
                ))}
            </div>
          )}
          {canvasPickerKind && (
            <div
              className="nowheel absolute left-0 top-full z-40 mt-1 max-h-[200px] w-[200px] overflow-y-auto rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] p-1 shadow-xl"
              onMouseDown={(event) => event.stopPropagation()}
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {referenceCandidates[canvasPickerKind].map((candidate) => (
                <button
                  key={candidate.nodeId}
                  type="button"
                  className="flex w-full truncate rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--canvas-node-button-text)] hover:bg-[var(--canvas-node-menu-hover)]"
                  title={candidate.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleAddCanvasReference(candidate);
                  }}
                >
                  {candidate.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {schemaReferencePickerItems.length > 0 && (
        <div className="mb-2 flex shrink-0 flex-wrap gap-1">
          {schemaReferencePickerItems.map((item, index) => (
                <button
                  key={`${item.kind}-${item.sourceNodeId}-${index}`}
                  type="button"
                  className="nodrag nowheel flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] text-[10px] font-semibold text-text-muted"
                  title={item.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (item.kind !== 'image') {
                      insertReferenceToken(index);
                    }
                  }}
                >
                  {item.kind === 'image' && item.displayUrl ? (
                    <CanvasNodeImage
                      src={item.displayUrl}
                      alt={item.label}
                      viewerSourceUrl={resolveImageDisplayUrl(item.imageUrl ?? item.displayUrl)}
                      viewerImageList={incomingViewerList}
                      className="h-full w-full object-cover"
                      draggable={false}
                      openViewerOnClick
                    />
                  ) : item.kind === 'video' && item.videoUrl ? (
                    // A video reference shows its first frame (a `#t=` media
                    // fragment makes the browser paint frame 0) and plays on
                    // click, instead of a bare "V" chip.
                    <video
                      src={`${resolveImageDisplayUrl(item.videoUrl)}#t=0.1`}
                      className="h-full w-full object-cover"
                      muted
                      preload="metadata"
                      playsInline
                      draggable={false}
                      onClick={(event) => {
                        event.stopPropagation();
                        setVideoPreviewSource(resolveImageDisplayUrl(item.videoUrl as string));
                      }}
                    />
                  ) : (
                    <span>{item.kind === 'video' ? 'V' : item.kind === 'audio' ? 'A' : 'T'}</span>
                  )}
                </button>
              ))}
        </div>
      )}
      <div className="image-box relative h-[88px] shrink-0 rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] p-2">
        <div ref={promptBoxRef} className="relative h-full min-h-0">
          {selectedPresetLabel && (
            <div className="absolute left-1 top-1 z-20 flex max-w-[calc(100%-8px)] items-center gap-1 rounded-md border border-accent/35 bg-accent/18 px-2 py-1 text-xs text-accent shadow-sm">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{selectedPresetLabel}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  clearSelectedPromptPreset();
                  promptRef.current?.focus();
                }}
                className="ml-0.5 rounded p-0.5 text-accent/80 hover:bg-accent/20 hover:text-accent"
                title={t('nodeToolbar.promptPreset') as string}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <div
            ref={promptHighlightRef}
            aria-hidden="true"
            className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className={`min-h-full whitespace-pre-wrap break-words px-1 py-0.5 ${selectedPresetLabel ? 'pt-8' : ''}`}>
              {renderPromptWithHighlights(promptDraft, incomingReferences.length)}
            </div>
          </div>
          <textarea
            ref={promptRef}
            value={promptDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              promptDraftRef.current = nextValue;
              setPromptDraft(nextValue);
              schedulePromptCommit(nextValue);
            }}
            onBlur={() => flushPromptDraft()}
            onKeyDown={handlePromptKeyDown}
            onScroll={syncPromptHighlightScroll}
            onMouseDown={(event) => event.stopPropagation()}
            placeholder={t('node.aiVideo.promptPlaceholder')}
            className={`ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-transparent caret-text-dark outline-none placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words ${selectedPresetLabel ? 'pt-8' : ''}`}
            style={{ scrollbarGutter: 'stable' }}
          />
          <button
            type="button"
            className="nodrag absolute right-1 top-1 z-20 flex h-6 w-6 items-center justify-center rounded-md border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)]/70 text-text-muted backdrop-blur-sm transition-colors hover:bg-[var(--canvas-node-menu-hover)] hover:text-text-dark"
            title={t('node.aiVideo.expandPrompt')}
            onClick={(event) => {
              event.stopPropagation();
              setPromptExpanded(true);
            }}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {referencePickerOpen && schemaReferencePickerItems.length > 0 && (
          <div
            className="nowheel absolute z-30 w-[150px] overflow-hidden rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] shadow-xl"
            style={{ left: referencePickerAnchor.left, top: referencePickerAnchor.top }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            <div className="ui-scrollbar nowheel max-h-[220px] overflow-y-auto" onWheelCapture={(event) => event.stopPropagation()}>
              {schemaReferencePickerItems.map((item, index) => (
                <button
                  key={`${item.kind}-${item.sourceNodeId}-${index}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    insertReferenceToken(index);
                  }}
                  onMouseEnter={() => setReferencePickerActiveIndex(index)}
                  className={`flex w-full items-center gap-2 border border-transparent bg-transparent px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[var(--canvas-node-field-border)] hover:bg-[var(--canvas-node-menu-hover)] ${
                    referencePickerActiveIndex === index
                      ? 'border-accent/35 bg-[var(--canvas-node-menu-active)]'
                      : ''
                  }`}
                >
                  {item.kind === 'image' && item.displayUrl ? (
                    <CanvasNodeImage
                      src={item.displayUrl}
                      alt={item.label}
                      viewerSourceUrl={resolveImageDisplayUrl(item.imageUrl ?? item.displayUrl)}
                      viewerImageList={incomingViewerList}
                      className="h-8 w-8 rounded object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[var(--canvas-node-button-bg)] text-[10px] font-semibold text-text-muted">
                      {item.kind === 'video' ? 'V' : item.kind === 'audio' ? 'A' : 'T'}
                    </span>
                  )}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {showFunctionPicker && functionPickerItems.length > 0 && (
          <div
            className="nowheel absolute z-40 w-[280px] overflow-visible rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] p-1.5 shadow-2xl"
            style={{ left: functionPickerAnchor.left, top: functionPickerAnchor.top }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            <div className="px-2 py-1 text-[11px] font-medium text-text-muted">
              输入 / 选择提示词预设
            </div>
            <div className="ui-scrollbar nowheel max-h-[260px] overflow-y-auto pr-1">
              {functionPickerItems.map((item, index) => {
                const Icon = item.icon;
                const active = functionPickerActiveIndex === index;
                const selected = Boolean(data.selectedPromptPresetId);
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      selectFunctionPickerItem(index);
                    }}
                    onMouseEnter={() => setFunctionPickerActiveIndex(index)}
                    className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'bg-[var(--canvas-node-menu-active)] text-text-dark'
                        : 'text-text-dark hover:bg-[var(--canvas-node-menu-hover)]'
                    }`}
                    title={item.description}
                  >
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                        我的提示词预设
                      </span>
                    </span>
                    {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}
                    {item.kind === 'presetGroup' && <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />}
                  </button>
                );
              })}
            </div>
            {functionPickerItems[functionPickerActiveIndex]?.kind === 'presetGroup' && (
              <div
                className="nowheel absolute left-[calc(100%+8px)] w-[240px] overflow-hidden rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] p-1.5 shadow-2xl"
                style={{ top: `${Math.min(44 + functionPickerActiveIndex * 58, 150)}px` }}
                onMouseDown={(event) => event.stopPropagation()}
                onWheelCapture={(event) => event.stopPropagation()}
              >
                <div className="px-2 py-1 text-[11px] font-medium text-text-muted">
                  我的提示词预设
                </div>
                <div className="ui-scrollbar nowheel max-h-[220px] overflow-y-auto pr-1">
                {promptPresets.map((preset) => {
                  const presetSelected = data.selectedPromptPresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                        presetSelected
                          ? 'bg-[var(--canvas-node-menu-active)] text-text-dark'
                          : 'text-text-dark hover:bg-[var(--canvas-node-menu-hover)]'
                      }`}
                      title={preset.prompt}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectPromptPresetFromPicker(preset.id);
                      }}
                    >
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{preset.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-text-muted">我的提示词预设</span>
                      </span>
                      {presetSelected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}
                    </button>
                  );
                })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex min-w-0 shrink-0 items-center gap-1 overflow-visible">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <div className="relative min-w-0 max-w-[92px] shrink">
            <UiButton
              onClick={(event) => {
                event.stopPropagation();
                setProviderOpen((open) => !open);
                setModelOpen(false);
                setParamsOpen(false);
                setReferencePickerOpen(false);
                setReferencePickerCursor(null);
                setShowFunctionPicker(false);
              }}
              variant="muted"
              className={`w-full justify-start ${NODE_CONTROL_CHIP_CLASS} ${AI_VIDEO_SELECTOR_CHIP_CLASS}`}
              title={selectedEntry?.providerLabel ?? t('node.aiVideo.noModel')}
            >
              <Video className={NODE_CONTROL_ICON_CLASS} />
              <span className="min-w-0 truncate">{selectedEntry?.providerLabel ?? t('node.aiVideo.noModel')}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
            </UiButton>
            {providerOpen && (
              <div
                className="nowheel absolute bottom-full left-0 z-50 mb-1 min-w-[170px] overflow-hidden rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] p-1.5 shadow-xl"
                onMouseDown={(event) => event.stopPropagation()}
              >
                {catalog.length === 0 ? (
                  <div className="flex items-start gap-2 p-2 text-xs leading-5 text-text-muted">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                    <span>{t('node.aiVideo.noVideoProvider')}</span>
                  </div>
                ) : (
                  <div className="ui-scrollbar max-h-[220px] overflow-y-auto pr-1">
                    {Array.from(entriesByProvider.keys()).map((providerLabel) => {
                      const active = selectedEntry?.providerLabel === providerLabel;
                      return (
                        <button
                          key={providerLabel}
                          type="button"
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                            active
                              ? 'bg-[var(--canvas-node-menu-active)] text-text-dark'
                              : 'text-text-dark hover:bg-[var(--canvas-node-menu-hover)]'
                          }`}
                          onClick={(event) => {
                            event.stopPropagation();
                            handlePickProvider(providerLabel);
                          }}
                        >
                          {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                          <span className="min-w-0 truncate">{providerLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

        <div className="relative min-w-0 max-w-[124px] shrink">
          <UiButton
            onClick={(event) => {
              event.stopPropagation();
              setModelOpen((open) => !open);
              setProviderOpen(false);
              setParamsOpen(false);
              setReferencePickerOpen(false);
              setReferencePickerCursor(null);
              setShowFunctionPicker(false);
            }}
            variant="muted"
            className={`w-full justify-start ${NODE_CONTROL_CHIP_CLASS} ${AI_VIDEO_SELECTOR_CHIP_CLASS}`}
            title={selectedEntry?.modelLabel ?? t('node.aiVideo.noModel')}
          >
            <span className="min-w-0 truncate">{selectedEntry?.modelLabel ?? t('node.aiVideo.noModel')}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </UiButton>
          {modelOpen && (
            <div
              className="nowheel absolute bottom-full left-0 z-50 mb-1 w-[280px] overflow-hidden rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] p-1.5 shadow-xl"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="ui-scrollbar max-h-[240px] overflow-y-auto pr-1">
                {(modelsForSelectedProvider.length > 0 ? modelsForSelectedProvider : catalog).map((entry) => {
                  const active = resolvedModelConfig?.entryId === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={!entry.usable}
                      className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors ${
                        active
                          ? 'bg-[var(--canvas-node-menu-active)] text-text-dark'
                          : 'text-text-dark hover:bg-[var(--canvas-node-menu-hover)]'
                      } disabled:cursor-not-allowed disabled:opacity-55`}
                      title={entry.notReadyReason ?? entry.modelLabel}
                      onClick={(event) => {
                        event.stopPropagation();
                        handlePickModel(entry);
                      }}
                    >
                      <Video className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{entry.modelLabel}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                          {entry.usable ? entry.modelId : entry.notReadyReason}
                        </span>
                      </span>
                      {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {resolvedModelConfig && selectedEntry && (
          <div className="relative min-w-0 max-w-[96px] shrink">
            <UiButton
              onClick={(event) => {
                event.stopPropagation();
                setParamsOpen((open) => !open);
                setProviderOpen(false);
                setModelOpen(false);
                setReferencePickerOpen(false);
                setReferencePickerCursor(null);
                setShowFunctionPicker(false);
              }}
              variant="muted"
              className={`w-full justify-start ${NODE_CONTROL_CHIP_CLASS}`}
              title={`${t('node.aiVideo.duration')} / ${t('node.aiVideo.resolution')} / ${t('node.aiVideo.aspectRatio')}`}
            >
              <span className="min-w-0 truncate">
                {isDreaminaMultiframe && dreaminaMultiframeImageCount >= 3
                  ? t('node.aiVideo.multiframeSummary', {
                    count: dreaminaMultiframeImageCount - 1,
                    resolution: resolvedModelConfig.resolution,
                  })
                  : `${resolvedModelConfig.duration === 'workflow' ? t('node.aiVideo.workflow') : `${resolvedModelConfig.duration}s`}·${resolvedModelConfig.resolution === 'workflow' ? t('node.aiVideo.workflow') : resolvedModelConfig.resolution}·${resolvedModelConfig.aspectRatio}`}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
            </UiButton>
            {paramsOpen && (
              <div
                className={`ui-scrollbar nowheel absolute bottom-full right-0 z-50 mb-1 max-h-[min(620px,70vh)] space-y-2 overflow-y-auto rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] p-2 shadow-xl ${isDreaminaMultiframe && dreaminaMultiframeImageCount >= 3 ? 'w-[380px]' : 'w-[300px]'}`}
                onMouseDown={(event) => event.stopPropagation()}
                onWheelCapture={(event) => event.stopPropagation()}
              >
                {(!isDreaminaMultiframe || dreaminaMultiframeImageCount < 3) && <div>
                  <div className="mb-1 text-[10px] text-text-muted">{t('node.aiVideo.duration')}</div>
                  {isAgnesVideoModel ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={1}
                          max={18}
                          step={1}
                          value={Math.min(18, Math.max(1, Number(resolvedModelConfig.duration) || 5))}
                          onChange={(event) => handleConfigChange({ duration: event.target.value })}
                          className="nodrag nowheel h-5 min-w-0 flex-1 accent-accent"
                        />
                        <span className="w-10 text-right text-[11px] font-medium text-text-dark">
                          {resolvedModelConfig.duration}s
                        </span>
                      </div>
                      <div className="text-[10px] leading-4 text-text-muted">
                        {t('node.aiVideo.agnesDurationHint')}
                      </div>
                    </div>
                  ) : (
                    <select
                      data-testid="video-duration-select"
                      className="nodrag nowheel w-full rounded-md border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-button-bg)] px-2 py-1 text-[11px] text-[var(--canvas-node-button-text)] outline-none"
                      value={resolvedModelConfig.duration}
                      onChange={(event) => handleConfigChange({ duration: event.target.value })}
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      {selectedEntry.supportedDurations.map((duration) => (
                        <option key={duration} value={duration}>
                          {duration === 'workflow' ? t('node.aiVideo.workflow') : `${duration}s`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>}
                {isAgnesVideoModel && schemaIncomingImageItems.length > 1 && (
                  <div>
                    <div className="mb-1 text-[10px] text-text-muted">{t('node.aiVideo.agnesMode')}</div>
                    <div className="grid grid-cols-2 gap-1">
                      {([
                        ['multi', t('node.aiVideo.agnesModeMulti')],
                        ['keyframes', t('node.aiVideo.agnesModeKeyframes')],
                      ] as const).map(([mode, label]) => {
                        const active = mode === 'keyframes' ? agnesVideoMode === 'keyframes' : agnesVideoMode !== 'keyframes';
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => handleAgnesVideoModeChange(mode)}
                            className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                              active
                                ? 'border-accent/60 bg-accent/15 text-accent'
                                : 'border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-button-bg)] text-[var(--canvas-node-button-text)] hover:border-[var(--canvas-node-border-hover)] hover:bg-[var(--canvas-node-menu-hover)]'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <div className="mb-1 text-[10px] text-text-muted">{t('node.aiVideo.aspectRatio')}</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedEntry.supportedAspectRatios.map((aspectRatio) => {
                      const active = resolvedModelConfig.aspectRatio === aspectRatio;
                      return (
                        <button
                          key={aspectRatio}
                          type="button"
                          onClick={() => handleConfigChange({ aspectRatio })}
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            active
                              ? 'border-accent/60 bg-accent/15 text-accent'
                              : 'border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-button-bg)] text-[var(--canvas-node-button-text)] hover:border-[var(--canvas-node-border-hover)] hover:bg-[var(--canvas-node-menu-hover)]'
                          }`}
                        >
                          {aspectRatio}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10px] text-text-muted">{t('node.aiVideo.resolution')}</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedEntry.supportedResolutions.map((resolution) => {
                      const active = resolvedModelConfig.resolution === resolution;
                      return (
                        <button
                          key={resolution}
                          type="button"
                          onClick={() => handleConfigChange({ resolution })}
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            active
                              ? 'border-accent/60 bg-accent/15 text-accent'
                              : 'border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-button-bg)] text-[var(--canvas-node-button-text)] hover:border-[var(--canvas-node-border-hover)] hover:bg-[var(--canvas-node-menu-hover)]'
                          }`}
                        >
                          {resolution === 'workflow' ? t('node.aiVideo.workflow') : resolution}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {isDreaminaMultiframe && dreaminaMultiframeImageCount >= 3 && (
                  <DreaminaMultiframeEditor
                    imageCount={dreaminaMultiframeImageCount}
                    value={dreaminaTransitionValue}
                    onChange={handleDreaminaTransitionsChange}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {selectedEntry && (
          <UiButton
            variant="muted"
            className={`min-w-[92px] max-w-[132px] shrink-0 justify-start ${NODE_CONTROL_CHIP_CLASS}`}
            title={describeVideoInputSchema(currentInputSchema)}
          >
            <span className="min-w-0 truncate">{describeCompactVideoInputSchema(currentInputSchema)}</span>
          </UiButton>
        )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <UiButton
            onClick={(event) => {
              event.stopPropagation();
              setShowCameraControl(true);
            }}
            variant={data.cameraControl?.enabled === true ? 'primary' : 'muted'}
            className={`shrink-0 ${NODE_CONTROL_CHIP_CLASS} ${data.cameraControl?.enabled === true ? '' : AI_VIDEO_COMPACT_ICON_CHIP_CLASS}`}
            title={t('cameraControl.title') as string}
            aria-label={t('cameraControl.title') as string}
          >
            <Camera className={NODE_CONTROL_ICON_CLASS} />
          </UiButton>

        {schemaReferencePickerItems.length > 0 && (
          <UiButton
            onClick={(event) => {
              event.stopPropagation();
              setReferencePickerOpen((open) => !open);
              setReferencePickerAnchor({ left: 12, top: 12 });
              setReferencePickerCursor(promptDraftRef.current.length);
              setReferencePickerActiveIndex(0);
              setProviderOpen(false);
              setModelOpen(false);
              setParamsOpen(false);
              setShowFunctionPicker(false);
            }}
            variant="muted"
            className={`shrink-0 ${NODE_CONTROL_CHIP_CLASS}`}
          >
            <span>{t('node.aiVideo.referenceCount', { count: schemaReferencePickerItems.length })}</span>
          </UiButton>
        )}
          <UiButton
            disabled={data.isGenerating === true}
            onClick={(event) => {
              event.stopPropagation();
              void handleGenerate();
            }}
            variant="primary"
            className={`shrink-0 ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
          >
            <Sparkles className={NODE_CONTROL_ICON_CLASS} strokeWidth={2.8} />
            {t('canvas.generate')}
          </UiButton>
          <div className="relative shrink-0">
            <UiButton
              onClick={(event) => {
                event.stopPropagation();
                setModeMenuOpen((open) => !open);
              }}
              variant="muted"
              className={`${NODE_CONTROL_CHIP_CLASS} ${AI_VIDEO_COMPACT_ICON_CHIP_CLASS}`}
              title={t('node.imageNode.modeOverwrite')}
              aria-label={t('node.imageNode.modeOverwrite')}
            >
              <ChevronDown className={NODE_CONTROL_ICON_CLASS} />
            </UiButton>
            {modeMenuOpen && (
              <div
                className="nowheel absolute bottom-full right-0 z-50 mb-1 w-[12em] overflow-hidden rounded-xl border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] shadow-xl"
                onMouseDown={(event) => event.stopPropagation()}
              >
                {([
                  ['overwrite', t('node.imageNode.modeOverwrite'), t('node.imageNode.modeOverwriteHint')],
                  ['newNode', t('node.imageNode.modeNewNode'), t('node.imageNode.modeNewNodeHint')],
                ] as const).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--canvas-node-menu-hover)] ${
                      generationMode === value ? 'bg-[var(--canvas-node-menu-active)]' : ''
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setGenerationMode(value);
                      setModeMenuOpen(false);
                    }}
                  >
                    <span>{label}</span>
                    <span className="text-[11px] text-text-muted">{hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <div className="mt-1 shrink-0 text-xs text-red-700 dark:text-red-300">{error}</div>}
      </div>
      )}

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle
        minWidth={AI_VIDEO_NODE_MIN_WIDTH}
        minHeight={AI_VIDEO_NODE_MIN_HEIGHT}
        maxWidth={AI_VIDEO_NODE_MAX_WIDTH}
        maxHeight={AI_VIDEO_NODE_MAX_HEIGHT}
      />

      <UiModal
        isOpen={payloadDebugText !== null}
        title={t('node.imageEdit.payloadDebugTitle')}
        onClose={() => setPayloadDebugText(null)}
        widthClassName="w-[min(760px,calc(100vw-32px))]"
        containerClassName="!z-[13050]"
        footer={(
          <>
            <UiButton
              variant="muted"
              size="sm"
              onClick={() => setPayloadDebugText(null)}
            >
              {t('common.close')}
            </UiButton>
            <UiButton
              variant="primary"
              size="sm"
              onClick={() => void handleCopyPayloadDebug()}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {payloadDebugCopied ? t('nodeToolbar.copied') : t('nodeToolbar.copy')}
            </UiButton>
          </>
        )}
      >
        <div className="space-y-2">
          <div className="text-xs text-text-muted">
            {t('node.imageEdit.payloadDebugHint')}
          </div>
          <pre
            className="ui-scrollbar nowheel max-h-[60vh] overflow-auto rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] p-3 text-xs leading-5 text-text-dark"
            onWheelCapture={(event) => event.stopPropagation()}
            onTouchMoveCapture={(event) => event.stopPropagation()}
          >
            {payloadDebugText}
          </pre>
        </div>
      </UiModal>

      <PromptComposerDialog
        isOpen={promptComposerOpen}
        modelKind={/seedance/i.test(resolvedModelConfig?.entryId ?? '') ? 'seedance' : 'h3'}
        durationSeconds={Number(resolvedModelConfig?.duration) || 4}
        originalPrompt={promptDraft}
        referenceImageCount={schemaIncomingImageItems.length}
        referenceAudioCount={incomingReferenceItems.filter((item) => item.kind === 'audio').length}
        onClose={() => setPromptComposerOpen(false)}
        onApply={(compiledPrompt) => {
          setPromptDraft(compiledPrompt);
          flushPromptDraft(compiledPrompt);
        }}
      />

      <UiModal
        isOpen={captionOpen}
        title={t('node.aiVideo.captionTitle')}
        onClose={() => { if (!captionBusy) setCaptionOpen(false); }}
        widthClassName="w-[min(480px,calc(100vw-32px))]"
        containerClassName="!z-[13050]"
        footer={<>
          <UiButton variant="muted" size="sm" disabled={captionBusy} onClick={() => setCaptionOpen(false)}>{t('common.cancel')}</UiButton>
          <UiButton variant="primary" size="sm" disabled={captionBusy || !captionText.trim()} onClick={() => {
            if (!localCaptionSource) return;
            setCaptionBusy(true);
            setCaptionError(null);
            void invoke<string>('burn_video_caption', {
              inputPath: localCaptionSource,
              text: captionText,
              startSeconds: Number(captionStart),
              endSeconds: Number(captionEnd),
            }).then((outputPath) => {
              updateNodeData(id, buildCompletedVideoPatch({
                currentVideos: videoHistory,
                videoUrl: outputPath,
                localVideoUrl: outputPath,
                thumbnailUrl: displayPosterUrl,
                aspectRatio: mainVideoEntry?.aspectRatio ?? resolvedModelConfig?.aspectRatio ?? '16:9',
                sourcePrompt: promptDraft,
              }));
              setCaptionOpen(false);
            }).catch((error: unknown) => setCaptionError(String(error)))
              .finally(() => setCaptionBusy(false));
          }}>{captionBusy ? t('node.aiVideo.captionWorking') : t('node.aiVideo.captionApply')}</UiButton>
        </>}
      >
        <div className="space-y-3 text-sm text-text-dark">
          <p className="text-xs text-text-muted">{t('node.aiVideo.captionHint')}</p>
          <textarea className="w-full rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] p-2" rows={3} value={captionText} onChange={(event) => setCaptionText(event.target.value)} maxLength={300} />
          <div className="flex gap-3">
            <label className="flex-1 text-xs">{t('node.aiVideo.captionStart')}<input className="mt-1 w-full rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] p-2" type="number" min="0" step="0.1" value={captionStart} onChange={(event) => setCaptionStart(event.target.value)} /></label>
            <label className="flex-1 text-xs">{t('node.aiVideo.captionEnd')}<input className="mt-1 w-full rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] p-2" type="number" min="0.1" step="0.1" value={captionEnd} onChange={(event) => setCaptionEnd(event.target.value)} /></label>
          </div>
          {captionError && <p role="alert" className="text-xs text-red-500">{captionError}</p>}
        </div>
      </UiModal>

      <UiModal
        isOpen={promptExpanded}
        title={t('node.aiVideo.expandPrompt')}
        onClose={() => {
          flushPromptDraft();
          setPromptExpanded(false);
        }}
        widthClassName="w-[min(760px,calc(100vw-32px))]"
        containerClassName="!z-[13050]"
        footer={(
          <UiButton
            variant="primary"
            size="sm"
            onClick={() => {
              flushPromptDraft();
              setPromptExpanded(false);
            }}
          >
            {t('common.close')}
          </UiButton>
        )}
      >
        <textarea
          value={promptDraft}
          onChange={(event) => {
            const nextValue = event.target.value;
            promptDraftRef.current = nextValue;
            setPromptDraft(nextValue);
            schedulePromptCommit(nextValue);
          }}
          onBlur={() => flushPromptDraft()}
          placeholder={t('node.aiVideo.promptPlaceholder')}
          className="ui-scrollbar nowheel h-[40vh] w-full resize-none rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] p-3 text-sm leading-6 text-text-dark outline-none placeholder:text-text-muted/80"
        />
      </UiModal>

      <UiModal
        isOpen={videoPreviewSource !== null}
        title={resolvedTitle}
        onClose={() => setVideoPreviewSource(null)}
        widthClassName="w-[min(880px,calc(100vw-32px))]"
        containerClassName="!z-[13050]"
      >
        {videoPreviewSource && (
          <video
            src={videoPreviewSource}
            controls
            autoPlay
            playsInline
            className="nowheel max-h-[70vh] w-full rounded-lg bg-black"
          />
        )}
      </UiModal>

      <CameraControlPanel
        isOpen={showCameraControl}
        onClose={() => setShowCameraControl(false)}
        cameraControl={data.cameraControl}
        onApply={handleCameraControlApply}
      />
    </div>
  );
});

AiVideoNode.displayName = 'AiVideoNode';
