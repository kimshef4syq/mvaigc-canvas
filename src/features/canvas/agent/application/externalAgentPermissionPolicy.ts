import type { ExternalAgentConnectionInfo, ExternalAgentPermissionMode } from '@/commands/externalAgent';
import type { ExternalAgentToolRequest } from '../domain/agentModel';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Host-owned allowlist. Mixed read/write tools are classified by their actual action. */
export function isExternalAgentReadOnly(request: ExternalAgentToolRequest): boolean {
  const args = request.arguments;
  if (!record(args)) return false;
  switch (request.toolName) {
    case 'canvas_command':
      return record(args.input)
        && (args.version === undefined || args.version === 1)
        && ['canvas.query', 'asset.list', 'generation.status'].includes(String(args.type));
    case 'asset_read':
    case 'profile_read':
    case 'profile_search':
    case 'source_read':
    case 'source_inspect':
      return true;
    case 'production_plan':
      return args.action === 'get' || args.action === 'list';
    case 'diagnostics':
      return ['health', 'provider-config', 'generation-jobs', 'application-logs',
        'preflight', 'classify-error', 'bundle-preview'].includes(String(args.operation));
    default:
      return false;
  }
}

export function externalAgentPermissionDecision(
  mode: ExternalAgentPermissionMode,
  request: ExternalAgentToolRequest,
): 'automatic' | 'confirm' | 'deny' {
  if (mode !== 'analysis' && mode !== 'collaboration') return 'confirm';
  if (isExternalAgentReadOnly(request)) return 'automatic';
  return mode === 'analysis' ? 'deny' : 'confirm';
}

export function assertExternalConnectionActive(
  connection: ExternalAgentConnectionInfo,
  projectId: string,
  sessionId: string,
): void {
  if (connection.connectionId !== sessionId || connection.project?.id !== projectId
    || !['ready', 'connected'].includes(connection.status)
    || !connection.expiresAt || Date.now() >= connection.expiresAt) {
    throw new Error('The Canvas connection is expired, revoked, or belongs to another project.');
  }
}
