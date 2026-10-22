import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Clipboard,
  ExternalLink,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import {
  createExternalAgentConnection,
  revokeExternalAgentConnection,
  setExternalAgentConnectionPermission,
  type ExternalAgentPermissionMode,
  type ExternalAgentProviderConfig,
  type ExternalAgentToolDefinition,
} from '@/commands/externalAgent';
import {
  useExternalAgentApprovals,
  setExternalAgentConnection,
  refreshExternalAgentConnection,
} from './useExternalAgentApprovals';
import { ExternalAgentApprovalCard } from './ExternalAgentApprovalCard';
import { useSettingsStore } from '@/stores/settingsStore';

type ProviderTab = 'codex' | 'claude';

export interface ExternalAgentConnectionPanelProps {
  projectId: string | null;
  projectName: string | null;
  tools: ExternalAgentToolDefinition[];
  className?: string;
}

function formatDate(value: number | null, locale: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(value);
}

function destination(config: ExternalAgentProviderConfig): string {
  const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent);
  return isWindows ? config.destinationWindows : config.destinationMacos;
}

export function ExternalAgentConnectionPanel({
  projectId,
  projectName,
  tools,
  className = '',
}: ExternalAgentConnectionPanelProps) {
  const { t, i18n } = useTranslation();
  const claudeCodeProjectDir = useSettingsStore((s) => s.claudeCodeProjectDir);
  const setClaudeCodeProjectDir = useSettingsStore((s) => s.setClaudeCodeProjectDir);
  const { connection, approvalBusy, automaticReads } = useExternalAgentApprovals();
  const [newPermissionMode, setNewPermissionMode] = useState<ExternalAgentPermissionMode>('analysis');
  const [provider, setProvider] = useState<ProviderTab>('codex');
  const [busy, setBusy] = useState<'create' | 'refresh' | 'revoke' | 'permission' | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async (silent = false) => {
    if (!silent) setBusy('refresh');
    try {
      await refreshExternalAgentConnection();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!silent) setBusy(null);
    }
  };

  const config = connection?.configs?.[provider] ?? null;
  const canCreate = Boolean(projectId && projectName && tools.length > 0 && busy === null);
  const activeConnection = Boolean(connection?.connectionId);
  const statusClass = connection?.status === 'connected'
    ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300'
    : connection?.status === 'expired'
      ? 'border-amber-500/30 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300'
      : 'border-border-dark bg-text-dark/[0.035] text-text-muted';
  const scope = useMemo(() => connection?.scope.join('、') || '—', [connection?.scope]);

  const handleCreate = async () => {
    if (!projectId || !projectName) return;
    setBusy('create');
    setError(null);
    try {
      setExternalAgentConnection(
        await createExternalAgentConnection({ projectId, projectName, tools, claudeCodeProjectDir, permissionMode: newPermissionMode })
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async () => {
    if (!connection?.connectionId) return;
    setBusy('revoke');
    setError(null);
    try {
      setExternalAgentConnection(await revokeExternalAgentConnection(connection.connectionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const handlePermissionChange = async (mode: ExternalAgentPermissionMode) => {
    if (!connection?.connectionId) { setNewPermissionMode(mode); return; }
    if (approvalBusy || busy || connection.project?.id !== projectId) return;
    setBusy('permission');
    setError(null);
    try {
      setExternalAgentConnection(await setExternalAgentConnectionPermission(connection.connectionId, mode));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!config) return;
    try {
      await navigator.clipboard.writeText(config.contents);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1_500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className={`rounded-xl border border-border-dark bg-surface-dark/55 p-4 ${className}`} aria-label={t('canvasAgent.externalMcp.title')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-dark">
            <Plug className="h-4 w-4 text-accent" />
            {t('canvasAgent.externalMcp.title')}
          </div>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {t('canvasAgent.externalMcp.description')}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors duration-150 hover:bg-text-dark/[0.05] hover:text-text-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"
          onClick={() => void refresh()}
          disabled={busy !== null}
          aria-label={t('canvasAgent.externalMcp.refresh')}
        >
          <RefreshCw className={`h-4 w-4 ${busy === 'refresh' ? 'motion-safe:animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        <div className={`rounded-lg border px-3 py-2 ${statusClass}`}>
          <div className="text-[10px] uppercase tracking-wide opacity-70">{t('canvasAgent.externalMcp.statusLabel')}</div>
          <div className="mt-1 font-medium">{t(`canvasAgent.externalMcp.status.${connection?.status ?? 'disconnected'}`)}</div>
        </div>
        <div className="rounded-lg border border-border-dark bg-bg-dark px-3 py-2 text-text-muted">
          <div className="text-[10px] uppercase tracking-wide">{t('canvasAgent.externalMcp.project')}</div>
          <div className="mt-1 truncate font-medium text-text-dark">
            {connection?.project?.name ?? projectName ?? t('canvasAgent.externalMcp.noProject')}
          </div>
        </div>
        <div className="rounded-lg border border-border-dark bg-bg-dark px-3 py-2 text-text-muted">
          <div className="text-[10px] uppercase tracking-wide">{t('canvasAgent.externalMcp.scope')}</div>
          <div className="mt-1 line-clamp-2 text-text-dark">{scope}</div>
        </div>
        <div className="rounded-lg border border-border-dark bg-bg-dark px-3 py-2 text-text-muted">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide">
            <ShieldCheck className="h-3 w-3" />{t('canvasAgent.externalMcp.approvalMode')}
          </div>
          <div className="mt-1 font-medium text-text-dark">{t(`canvasAgent.externalMcp.modes.${connection?.connectionId ? connection.permissionMode : newPermissionMode}`)}</div>
        </div>
      </div>

      <label className="mt-4 flex flex-col gap-1 text-xs">
        <span className="font-medium text-text-dark">{t('canvasAgent.externalMcp.permissionLabel')}</span>
        <select
          value={connection?.connectionId ? connection.permissionMode : newPermissionMode}
          disabled={busy !== null || approvalBusy || (activeConnection &&
            (connection?.project?.id !== projectId || connection?.status === 'expired'))}
          onChange={(event) => { void handlePermissionChange(event.target.value as ExternalAgentPermissionMode); }}
          className="rounded-lg border border-border-dark bg-bg-dark px-3 py-2 text-text-dark disabled:opacity-40"
        >
          {(['analysis', 'collaboration', 'manual'] as const).map((mode) => (
            <option key={mode} value={mode}>{t(`canvasAgent.externalMcp.modes.${mode}`)}</option>
          ))}
        </select>
        <span className="leading-5 text-text-muted">
          {t(`canvasAgent.externalMcp.modeHints.${connection?.connectionId ? connection.permissionMode : newPermissionMode}`)}
        </span>
      </label>
      {automaticReads.length > 0 ? (
        <details className="mt-3 text-[11px] text-text-muted">
          <summary className="cursor-pointer">{t('canvasAgent.externalMcp.automaticReads')}</summary>
          <ul className="mt-2 space-y-1">
            {automaticReads.map((item) => <li key={item.callId}>{item.summary} · {t('canvasAgent.externalMcp.readAllowed')}</li>)}
          </ul>
        </details>
      ) : null}

      <label className="mt-4 flex flex-col gap-1 text-[11px]">
        <span className="text-text-muted">{t('canvasAgent.externalMcp.claudeProjectDirLabel')}</span>
        <input
          aria-label={t('canvasAgent.externalMcp.claudeProjectDirLabel')}
          value={claudeCodeProjectDir}
          onChange={(e) => setClaudeCodeProjectDir(e.target.value)}
          className="rounded-md border border-border-dark bg-surface-dark px-2 py-1 font-mono text-text-dark outline-none focus:border-accent/50"
        />
        <span className="text-text-muted/70">{t('canvasAgent.externalMcp.claudeProjectDirHint')}</span>
      </label>

      {activeConnection ? (
        <>
          <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-[11px] leading-5 text-text-muted">
            <dt>{t('canvasAgent.externalMcp.expires')}</dt><dd className="text-text-dark">{formatDate(connection?.expiresAt ?? null, i18n.language)}</dd>
            <dt>{t('canvasAgent.externalMcp.connectedAt')}</dt><dd className="text-text-dark">{formatDate(connection?.connectedAt ?? null, i18n.language)}</dd>
            <dt>{t('canvasAgent.externalMcp.lastActivity')}</dt><dd className="text-text-dark">{formatDate(connection?.lastActivityAt ?? null, i18n.language)}</dd>
            <dt>{t('canvasAgent.externalMcp.calls')}</dt><dd className="text-text-dark">{connection?.callCount ?? 0}</dd>
          </dl>

          <div className="mt-4 flex rounded-lg border border-border-dark bg-bg-dark p-1" role="tablist" aria-label={t('canvasAgent.externalMcp.providerTabs')}>
            {(['codex', 'claude'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={provider === item}
                onClick={() => setProvider(item)}
                className={`h-9 flex-1 rounded-md text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${provider === item ? 'bg-text-dark/[0.08] text-text-dark' : 'text-text-muted hover:text-text-dark'}`}
              >
                {item === 'codex' ? 'Codex' : 'Claude Code'}
              </button>
            ))}
          </div>

          {config ? (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
                <span className="truncate">{t('canvasAgent.externalMcp.mergeConfig', { destination: destination(config) })}</span>
                <span className="shrink-0 uppercase">{config.format}</span>
              </div>
              <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-border-dark bg-black/[0.08] p-3 text-[11px] leading-5 text-text-dark dark:bg-black/20">{config.contents}</pre>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-dark px-3 text-xs text-text-dark transition-colors duration-150 hover:bg-text-dark/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
                  {copied ? t('canvasAgent.externalMcp.copied') : t('canvasAgent.externalMcp.copy')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRevoke()}
                  disabled={busy !== null}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-500/30 px-3 text-xs text-red-600 transition-colors duration-150 hover:bg-red-500/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 disabled:opacity-40 dark:text-red-300"
                >
                  {busy === 'revoke' ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                  {t('canvasAgent.externalMcp.revoke')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={!canCreate}
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-xs font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === 'create' ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          {t('canvasAgent.externalMcp.create')}
        </button>
      )}

      <div className="mt-4"><ExternalAgentApprovalCard /></div>

      {!projectId || !projectName ? (
        <p className="mt-3 text-[11px] leading-5 text-amber-700 dark:text-amber-300">{t('canvasAgent.externalMcp.openProjectFirst')}</p>
      ) : null}
      {error ? <p className="mt-3 break-words text-[11px] leading-5 text-red-600 dark:text-red-300" role="alert">{error}</p> : null}
    </section>
  );
}
