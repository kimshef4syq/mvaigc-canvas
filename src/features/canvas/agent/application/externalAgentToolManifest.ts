import { canvasCommandRegistry } from '@/features/canvas/application/canvasCommandService';
import { CANVAS_COMMAND_VERSION } from '@/features/canvas/domain/canvasCommands';
import type { AgentToolKind } from './agentSkills';
import type { ExternalAgentToolName } from '../domain/agentModel';

export const EXTERNAL_CANVAS_MCP_NAMESPACE = 'storyboard_canvas' as const;
export const EXTERNAL_CANVAS_MCP_VERSION = 1 as const;

export type ExternalAgentSupportedKind =
  | AgentToolKind
  | 'knowledge'
  | 'production'
  | 'media-postprocess';

export interface ExternalCanvasMcpTool {
  name: ExternalAgentToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

export interface ExternalCanvasMcpManifestV1 {
  version: typeof EXTERNAL_CANVAS_MCP_VERSION;
  namespace: typeof EXTERNAL_CANVAS_MCP_NAMESPACE;
  tools: ExternalCanvasMcpTool[];
}

const diagnosticsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['operation'],
  properties: {
    operation: {
      type: 'string',
      enum: ['health', 'provider-config', 'generation-jobs', 'application-logs', 'preflight', 'classify-error', 'bundle-preview'],
    },
    error: { type: 'string' },
    width: { type: 'number' },
    height: { type: 'number' },
    aspectRatio: { type: 'string' },
    resolution: { type: 'string' },
    maxPixels: { type: 'number' },
    nodeIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
    requiresVision: { type: 'boolean' },
    supportsVision: { type: 'boolean' },
    requiresTools: { type: 'boolean' },
    supportsTools: { type: 'boolean' },
    accessState: { type: 'string', enum: ['configured', 'missing'] },
    endpointValid: { type: 'boolean' },
    reproductionSteps: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    jobId: { type: 'string' },
    severity: { type: 'string', enum: ['debug', 'info', 'warning', 'error'] },
    source: { type: 'string', maxLength: 200 },
    query: { type: 'string', maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
};

const configPatchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ['preview', 'apply', 'rollback'] },
    providerId: { type: 'string' },
    settingsTarget: { type: 'string', enum: ['generation-network'] },
    networkRoute: { type: 'string', enum: ['system', 'direct', 'custom-proxy'] },
    baseRevision: { type: 'string' },
    rollbackToken: { type: 'string' },
    baseUrl: { type: 'string' },
    endpointPath: { type: 'string' },
    apiStyle: { type: 'string' },
    modelId: { type: 'string' },
    supportsTools: { type: 'boolean' },
    supportsMultimodal: { type: 'boolean' },
    supportsStreaming: { type: 'boolean' },
    supportsReasoningSummary: { type: 'boolean' },
    supportsToolSearch: { type: 'boolean' },
    agentProtocol: {
      type: 'string',
      enum: ['openai-responses', 'openai-chat-completions', 'anthropic-messages', 'google-gemini'],
    },
  },
};

const assetReadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assetId'],
  properties: { assetId: { type: 'string', minLength: 1 } },
};

const profileSearchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    category: { type: 'string' },
    kind: { type: 'string' },
    stage: { type: 'string' },
    intent: { type: 'string' },
    modality: { type: 'string' },
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 20 },
  },
};

const profileReadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string' },
    revision: { type: 'string' },
    cursor: { type: 'integer', minimum: 0 },
    limitCharacters: { type: 'integer', minimum: 1, maximum: 50000 },
  },
};

const sourceReadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceId'],
  properties: {
    sourceId: { type: 'string' },
    cursor: { type: 'integer', minimum: 0 },
    limitCharacters: { type: 'integer', minimum: 1, maximum: 50000 },
  },
};

const sourceInspectSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceId'],
  properties: {
    sourceId: { type: 'string' },
  },
};

const productionPlanSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'get', 'list', 'author_stage', 'replan', 'record_review', 'retry_items', 'set_status'],
    },
    planId: { type: 'string' },
    expectedRevision: { type: 'integer', minimum: 1 },
    createInput: { type: 'object', additionalProperties: true },
    authorStageInput: { type: 'object', additionalProperties: true },
    replanInput: { type: 'object', additionalProperties: true },
    recordReviewInput: { type: 'object', additionalProperties: true },
    retryItemsInput: { type: 'object', additionalProperties: true },
    setStatusInput: { type: 'object', additionalProperties: true },
  },
};

const mediaPostprocessSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['operation'],
  properties: {
    operation: { type: 'object', additionalProperties: true },
  },
};

function canvasCommandTool(): ExternalCanvasMcpTool {
  return {
    name: 'canvas_command',
    title: 'Canvas command',
    description: 'Inspect or change the canvas through the versioned command registry. Start with {type:"canvas.query",input:{scope:"graph",detail:"summary",limit:20}}. Query scope must be graph, nodes, edges, or selection; viewport is not supported. Missing scope defaults to graph. graph reads the canvas graph, not the visible viewport. Results are bounded pages: follow output.page.nextInput until null; never assume one page is the full canvas. Read full details using nodeIds and detail:"full" (optionally fields). Read-only calls follow the connection policy; changes require approval or are blocked in analysis mode.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'input'],
      properties: {
        type: {
          type: 'string',
          enum: canvasCommandRegistry.list().map((definition) => definition.type),
        },
        version: { type: 'number', const: CANVAS_COMMAND_VERSION },
        input: { type: 'object', additionalProperties: true },
      },
      oneOf: canvasCommandRegistry.list().map((definition) => ({
        type: 'object',
        required: ['type', 'input'],
        properties: {
          type: { const: definition.type },
          input: definition.type === 'canvas.query'
            ? { ...definition.schema.input, required: [],
              description: 'Defaults: scope=graph, detail=summary, limit=20. Continue with output.page.nextInput.' }
            : definition.schema.input,
        },
      })),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  };
}

const toolsByKind: Record<Exclude<AgentToolKind, 'canvas'>, ExternalCanvasMcpTool> = {
  diagnostics: {
    name: 'diagnostics',
    title: 'Canvas diagnostics',
    description: 'Inspect bounded, redacted runtime and provider evidence under the connection permission policy.',
    inputSchema: diagnosticsSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  config: {
    name: 'config_patch',
    title: 'Configuration patch',
    description: 'Preview, apply, or roll back an allowlisted non-secret configuration patch under the connection permission policy.',
    inputSchema: configPatchSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  'asset-read': {
    name: 'asset_read',
    title: 'Canvas image read',
    description: 'Read one stable canvas image asset under the connection permission policy.',
    inputSchema: assetReadSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
};

const knowledgeTools: ExternalCanvasMcpTool[] = [
  {
    name: 'profile_search',
    title: 'Search Agent Profiles',
    description: 'Search the 202 MiniMax Design profile catalog by query, category, kind, stage, intent, or modality.',
    inputSchema: profileSearchSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'profile_read',
    title: 'Read Agent Profile',
    description: 'Read the full verified content of a profile by ID with pagination and hash verification.',
    inputSchema: profileReadSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'source_read',
    title: 'Read Source Document',
    description: 'Read user-provided source script, document, or audio transcript with character budgets and pagination.',
    inputSchema: sourceReadSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'source_inspect',
    title: 'Inspect Source Document',
    description: 'Inspect metadata, structure, character count, and modality of a source document.',
    inputSchema: sourceInspectSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const productionTools: ExternalCanvasMcpTool[] = [
  {
    name: 'production_plan',
    title: 'Production Plan Service',
    description: 'Create, inspect, or manage structured production plans, stage authoring, reviews, and item retries.',
    inputSchema: productionPlanSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const mediaPostprocessTools: ExternalCanvasMcpTool[] = [
  {
    name: 'media_postprocess',
    title: 'Controlled Media Postprocess',
    description: 'Execute controlled ffmpeg probe, trim, concat, scale, transcode, mix, fade, or subtitle burning operations.',
    inputSchema: mediaPostprocessSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

export function buildExternalCanvasMcpManifest(
  toolKinds: readonly ExternalAgentSupportedKind[],
): ExternalCanvasMcpManifestV1 {
  const kinds = new Set(toolKinds);
  const tools = [
    ...(kinds.has('canvas') ? [canvasCommandTool()] : []),
    ...(['diagnostics', 'config', 'asset-read'] as const).flatMap((kind) => (
      kinds.has(kind) ? [toolsByKind[kind]] : []
    )),
    ...(kinds.has('knowledge') ? knowledgeTools : []),
    ...(kinds.has('production') ? productionTools : []),
    ...(kinds.has('media-postprocess') ? mediaPostprocessTools : []),
  ];
  return {
    version: EXTERNAL_CANVAS_MCP_VERSION,
    namespace: EXTERNAL_CANVAS_MCP_NAMESPACE,
    tools,
  };
}

export function assertExternalCanvasToolAllowed(
  manifest: ExternalCanvasMcpManifestV1,
  toolName: string,
): ExternalCanvasMcpTool {
  const tool = manifest.tools.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`External Agent tool ${toolName} is not allowed for this turn.`);
  return tool;
}
