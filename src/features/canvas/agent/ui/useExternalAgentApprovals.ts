import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import i18n from 'i18next';
import { useProjectStore } from '@/stores/projectStore';
import {
  inspectExternalAgentConnection,
  listenExternalAgentEvents,
  replayExternalAgentPendingToolCalls,
  resolveExternalAgentToolCall,
  type ExternalAgentConnectionInfo,
  type ExternalAgentEventV1,
  type ExternalAgentPermissionMode,
} from '@/commands/externalAgent';
import {
  prepareExternalAgentToolRequest,
  resolveExternalAgentToolApproval,
} from '../application/externalAgentCanvasBridge';
import {
  enqueueExternalAgentApproval,
  type ExternalAgentPendingApproval,
} from '../application/externalAgentApprovalQueue';
import { assertExternalConnectionActive, externalAgentPermissionDecision } from '../application/externalAgentPermissionPolicy';
import type { ExternalAgentToolRequest } from '../domain/agentModel';

type ApprovalState = {
  connection: ExternalAgentConnectionInfo | null;
  pendingApprovals: ExternalAgentPendingApproval[];
  approvalBusy: boolean;
  error: string | null;
  automaticReads: { callId: string; summary: string }[];
};

export const useExternalAgentApprovalStore = create<ApprovalState>(() => ({
  connection: null,
  pendingApprovals: [],
  approvalBusy: false,
  error: null,
  automaticReads: [],
}));

function setError(error: unknown): void {
  useExternalAgentApprovalStore.setState({ error: error instanceof Error ? error.message : String(error) });
}

export function setExternalAgentConnection(connection: ExternalAgentConnectionInfo): void {
  const previous = useExternalAgentApprovalStore.getState().connection;
  const policyChanged = previous?.connectionId === connection.connectionId
    && previous?.permissionMode !== connection.permissionMode;
  const active = ['ready', 'connected'].includes(connection.status);
  useExternalAgentApprovalStore.setState((state) => ({
    connection,
    pendingApprovals: active && !policyChanged && state.connection?.connectionId === connection.connectionId
      ? state.pendingApprovals : [],
    automaticReads: state.connection?.connectionId === connection.connectionId ? state.automaticReads : [],
  }));
  if (policyChanged && active) void replayExternalAgentPendingToolCalls().catch(setError);
}

export async function refreshExternalAgentConnection(): Promise<void> {
  setExternalAgentConnection(await inspectExternalAgentConnection());
}

// Both settings and the canvas subscribe to one listener and one approval queue.
let subscribers = 0;
let stopListener: (() => void) | undefined;
const preparing = new Set<string>();

function startListener(): () => void {
  let active = true;
  let unlisten: (() => void) | undefined;
  let refreshing = false;
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const connection = await inspectExternalAgentConnection();
      if (active) setExternalAgentConnection(connection);
    } catch (error) {
      if (active) setError(error);
    } finally {
      refreshing = false;
    }
  };

  const handleEvent = async (event: ExternalAgentEventV1) => {
    const state = useExternalAgentApprovalStore.getState();
    const connection = state.connection;
    if (!active || !connection?.connectionId || event.sessionId !== connection.connectionId) return;
    if (event.kind === 'toolResolved' && event.data && typeof event.data === 'object'
      && 'callId' in event.data) {
      const callId = event.data.callId;
      useExternalAgentApprovalStore.setState((current) => ({
        pendingApprovals: current.pendingApprovals.filter((item) => item.request.callId !== callId),
      }));
      return;
    }
    if (event.kind !== 'toolRequested' || !event.toolCall) return;
    const request: ExternalAgentToolRequest = {
      version: 1,
      runtime: event.runtime,
      sessionId: event.sessionId,
      turnId: event.turnId ?? `managed-${event.toolCall.callId}`,
      callId: event.toolCall.callId,
      toolName: event.toolCall.name as ExternalAgentToolRequest['toolName'],
      arguments: event.toolCall.input,
    };
    const key = `${request.sessionId}:${request.callId}`;
    if (preparing.has(key) || state.pendingApprovals.some((item) => item.request.callId === request.callId)) return;
    preparing.add(key);
    let evaluatedMode: ExternalAgentPermissionMode | undefined;
    try {
      const projectId = useProjectStore.getState().currentProjectId;
      if (!projectId || connection.project?.id !== projectId) {
        await resolveExternalAgentToolCall({
          sessionId: request.sessionId,
          callId: request.callId,
          resolution: {
            outcome: 'error',
            errorCode: 'active_project_changed',
            message: i18n.t('canvasAgent.externalMcp.projectChangedResolution'),
          },
        });
        if (active) setError(i18n.t('canvasAgent.externalMcp.projectChanged'));
        return;
      }
      const approval = await prepareExternalAgentToolRequest({ projectId, request });
      // Fetch host policy after preparation, so queued/replayed requests use the latest mode.
      const latest = await inspectExternalAgentConnection();
      assertExternalConnectionActive(latest, projectId, request.sessionId);
      evaluatedMode = latest.permissionMode;
      if (!active) return;
      if (useProjectStore.getState().currentProjectId !== projectId) {
        throw new Error(i18n.t('canvasAgent.externalMcp.projectChanged'));
      }
      const decision = externalAgentPermissionDecision(latest.permissionMode, request);
      if (decision !== 'confirm') {
        const result = await resolveExternalAgentToolApproval({
          projectId, request, approve: decision === 'automatic',
          automatic: decision === 'automatic', enforceConnection: true,
          denialMessage: i18n.t('canvasAgent.externalMcp.analysisDenied'),
        });
        if (active && decision === 'automatic' && result.status === 'approved') {
          useExternalAgentApprovalStore.setState((current) => ({
            automaticReads: [{ callId: request.callId, summary: approval.summary },
              ...current.automaticReads.filter((item) => item.callId !== request.callId)].slice(0, 10),
          }));
        }
        if (active && result.status === 'error') setError(result.error ?? 'Canvas operation failed.');
        return;
      }
      if (active && useExternalAgentApprovalStore.getState().connection?.connectionId === request.sessionId
        && useProjectStore.getState().currentProjectId === projectId) {
        useExternalAgentApprovalStore.setState((current) => ({
          pendingApprovals: enqueueExternalAgentApproval(current.pendingApprovals, {
            request,
            summary: approval.summary,
            impactSummary: approval.impact.summary,
          }),
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await resolveExternalAgentToolCall({
        sessionId: request.sessionId,
        callId: request.callId,
        resolution: { outcome: 'error', errorCode: 'approval_prepare_failed', message },
      }).catch(() => undefined);
      if (active) setError(message);
    } finally {
      preparing.delete(key);
      const current = useExternalAgentApprovalStore.getState().connection;
      if (active && evaluatedMode && current?.connectionId === request.sessionId
        && current.permissionMode !== evaluatedMode) {
        // A policy change may have replayed while this request was still preparing.
        useExternalAgentApprovalStore.setState((state) => ({
          pendingApprovals: state.pendingApprovals.filter((item) => item.request.callId !== request.callId),
        }));
        void replayExternalAgentPendingToolCalls().catch(setError);
      }
    }
  };

  void (async () => {
    try {
      unlisten = await listenExternalAgentEvents((event) => { void handleEvent(event); });
      if (!active) { unlisten(); return; }
      await refresh();
      if (active) await replayExternalAgentPendingToolCalls();
    } catch (error) {
      if (active) setError(error);
    }
  })();
  const timer = globalThis.setInterval(() => { void refresh(); }, 5_000);
  // Remove previews belonging to a project the user has left. The bridge also
  // checks the active project again before executing any approved operation.
  const unsubscribeProject = useProjectStore.subscribe((state, previous) => {
    if (state.currentProjectId !== previous.currentProjectId) {
      useExternalAgentApprovalStore.setState({ pendingApprovals: [], error: null });
      void replayExternalAgentPendingToolCalls().catch(setError);
    }
  });
  return () => {
    active = false;
    unlisten?.();
    globalThis.clearInterval(timer);
    unsubscribeProject();
  };
}

export async function resolveExternalAgentApproval(approve: boolean): Promise<void> {
  const state = useExternalAgentApprovalStore.getState();
  const pendingApproval = state.pendingApprovals[0];
  const projectId = useProjectStore.getState().currentProjectId;
  if (!pendingApproval || !projectId || state.approvalBusy) return;
  useExternalAgentApprovalStore.setState({ approvalBusy: true, error: null });
  try {
    const result = await resolveExternalAgentToolApproval({ projectId, request: pendingApproval.request, approve, enforceConnection: true });
    useExternalAgentApprovalStore.setState((current) => ({
      pendingApprovals: current.pendingApprovals.filter((item) => item.request.callId !== pendingApproval.request.callId),
      error: result.status === 'error' ? result.error ?? i18n.t('canvasAgent.externalMcp.executionFailed') : null,
    }));
    await refreshExternalAgentConnection();
    await replayExternalAgentPendingToolCalls();
  } catch (error) {
    setError(error);
  } finally {
    useExternalAgentApprovalStore.setState({ approvalBusy: false });
  }
}

export function useExternalAgentApprovals() {
  const state = useExternalAgentApprovalStore();
  useEffect(() => {
    if (!isTauri()) return;
    subscribers += 1;
    if (subscribers === 1) stopListener = startListener();
    return () => {
      subscribers -= 1;
      if (subscribers === 0) { stopListener?.(); stopListener = undefined; }
    };
  }, []);
  return state;
}
