import { useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Loader2, Terminal } from 'lucide-react';
import { UiButton, UiModal } from '@/components/ui';
import type { ExternalAgentRuntime } from '@/commands/externalAgent';
import { openVideoAgent, type VideoAgentLaunchPhase } from '../application/videoAgentLaunch';
import { useExternalAgentApprovals } from './useExternalAgentApprovals';

const useLaunchPreference = create(persist<{ runtime: ExternalAgentRuntime | null; full: boolean }>(() => ({ runtime: null, full: false }), {
  name: 'canvas-video-agent-preferences-v1',
}));

export function VideoAgentLaunchButton({ nodeId }: { nodeId?: string }) {
  const { t } = useTranslation();
  useExternalAgentApprovals();
  const preference = useLaunchPreference();
  const [dialog, setDialog] = useState(false);
  const [runtime, setRuntime] = useState<ExternalAgentRuntime>(preference.runtime ?? 'claude');
  const [full, setFull] = useState(preference.full);
  const [phase, setPhase] = useState<VideoAgentLaunchPhase | null>(null);
  const [upgradeEnvironment, setUpgradeEnvironment] = useState(false);
  const [error, setError] = useState('');
  const launch = async (runtime: ExternalAgentRuntime, fullProduction: boolean) => {
    if (phase) return;
    setError(''); setPhase('checking');
    try {
      await openVideoAgent({ nodeId, runtime, fullProduction, upgradeEnvironment, onPhase: setPhase });
      useLaunchPreference.setState({ runtime, full: fullProduction });
      setDialog(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setDialog(true); }
    finally { setPhase(null); }
  };
  return <>
    <span className="nodrag nopan nowheel inline-flex items-center" data-canvas-no-marquee="true" onMouseDown={event => event.stopPropagation()}>
      <button type="button" disabled={phase !== null} className="inline-flex h-8 items-center gap-1 rounded-l-full border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] px-2.5 text-xs text-text-dark disabled:opacity-50" onClick={event => {
        event.stopPropagation();
        if (preference.runtime) void launch(preference.runtime, preference.full); else setDialog(true);
      }}>
        {phase ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />}
        {t(phase ? `videoAgentLaunch.${phase}` : nodeId ? 'videoAgentLaunch.fromVideo' : 'videoAgentLaunch.fromProject')}
      </button>
      <button type="button" disabled={phase !== null} aria-label={t('videoAgentLaunch.options')} className="h-8 rounded-r-full border border-l-0 border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] px-1 text-text-dark" onClick={event => { event.stopPropagation(); setRuntime(preference.runtime ?? 'claude'); setFull(preference.full); setDialog(true); }}><ChevronDown className="h-3.5 w-3.5" /></button>
    </span>
    <UiModal isOpen={dialog} onClose={() => { if (!phase) setDialog(false); }} title={t('videoAgentLaunch.title')} widthClassName="w-[min(480px,calc(100vw-32px))]" containerClassName="!z-[14000]">
      <div className="space-y-4 text-sm text-text-dark">
        <p className="text-text-muted">{t('videoAgentLaunch.description')}</p>
        <label className="block">{t('videoAgentLaunch.agent')}<select disabled={phase !== null} value={runtime} onChange={event => setRuntime(event.target.value as ExternalAgentRuntime)} className="mt-1 block w-full rounded border border-border-dark bg-bg-dark p-2"><option value="claude">Claude Code</option><option value="codex">Codex CLI</option></select></label>
        <label className="block">{t('videoAgentLaunch.mode')}<select disabled={phase !== null} value={full ? 'full' : 'quick'} onChange={event => setFull(event.target.value === 'full')} className="mt-1 block w-full rounded border border-border-dark bg-bg-dark p-2"><option value="quick">{t('videoAgentLaunch.quick')}</option><option value="full">{t('videoAgentLaunch.full')}</option></select></label>
        <p className="text-xs text-text-muted">{t('videoAgentLaunch.firstRun')}</p>
        <details className="text-xs"><summary className="cursor-pointer text-text-muted">{t('videoAgentLaunch.advanced')}</summary><label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={upgradeEnvironment} disabled={phase !== null} onChange={event => setUpgradeEnvironment(event.target.checked)} />{t('videoAgentLaunch.upgrade')}</label></details>
        {error && <p role="alert" className="whitespace-pre-wrap break-words text-red-500">{error}</p>}
        <UiButton variant="primary" disabled={phase !== null} onClick={() => void launch(runtime, full)}>{t(phase ? `videoAgentLaunch.${phase}` : 'videoAgentLaunch.open')}</UiButton>
      </div>
    </UiModal>
  </>;
}
