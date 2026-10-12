import { Loader2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useExternalAgentApprovals, resolveExternalAgentApproval } from './useExternalAgentApprovals';

export function ExternalAgentApprovalCard() {
  const { t } = useTranslation();
  const { connection, pendingApprovals, approvalBusy, error } = useExternalAgentApprovals();
  const pending = pendingApprovals[0];
  if (!pending && (!connection?.connectionId || !error)) return null;
  return (
    <section className="max-h-64 shrink-0 overflow-y-auto rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3" aria-label={t('canvasAgent.externalMcp.approvalTitle')}>
      {pending ? (
        <>
          <div className="flex items-center gap-2 text-xs font-semibold text-text-dark" role="status" aria-live="polite">
            <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            {t('canvasAgent.externalMcp.approvalTitle')}
          </div>
          <div className="mt-1 text-[10px] text-text-muted">
            {pending.request.runtime === 'claude' ? 'Claude Code' : 'Codex'}
            {pendingApprovals.length > 1 ? ` · ${t('canvasAgent.externalMcp.pendingCount', { count: pendingApprovals.length })}` : ''}
          </div>
          <p className="mt-2 break-words text-xs leading-5 text-text-dark">{pending.summary}</p>
          <p className="mt-1 break-words text-[11px] leading-5 text-text-muted">{pending.impactSummary}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" disabled={approvalBusy} onClick={() => { void resolveExternalAgentApproval(false); }}
              className="h-9 rounded-lg border border-border-dark px-3 text-xs text-text-muted hover:bg-text-dark/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40">
              {t('canvasAgent.externalMcp.deny')}
            </button>
            <button type="button" disabled={approvalBusy} onClick={() => { void resolveExternalAgentApproval(true); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40">
              {approvalBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {t('canvasAgent.externalMcp.approve')}
            </button>
          </div>
        </>
      ) : null}
      {error ? <p className="mt-2 break-words text-[11px] text-red-600 dark:text-red-300" role="alert">{error}</p> : null}
    </section>
  );
}
