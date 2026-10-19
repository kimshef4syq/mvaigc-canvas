import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiModal } from '@/components/ui';
import { compileMinimaxH3Prompt, compileSeedancePrompt, type MinimaxH3Shot, type TimedAction } from './PromptCompiler';
import { lintPrompt, type PromptIssue } from './PromptLinter';

type ShotDraft = Omit<MinimaxH3Shot, 'actions'> & { actionsText: string };
type ModelKind = 'h3' | 'seedance';
interface Props {
  isOpen: boolean;
  modelKind: ModelKind;
  durationSeconds: number;
  originalPrompt: string;
  referenceImageCount: number;
  referenceAudioCount: number;
  onClose: () => void;
  onApply: (prompt: string) => void;
}

const emptyShot = (): ShotDraft => ({ camera: '', cameraMotion: '', backgroundMotion: '', actionsText: '', sound: '' });
const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
function timedActions(actions: string[], duration: number, offset = 0, total = actions.length): TimedAction[] {
  return actions.map((action, index) => ({
    startSeconds: Number(((offset + index) * duration / total).toFixed(3)),
    endSeconds: Number(((offset + index + 1) * duration / total).toFixed(3)), action,
  }));
}
function timedShots(drafts: ShotDraft[], duration: number): MinimaxH3Shot[] {
  const actionLists = drafts.map((draft) => lines(draft.actionsText));
  const total = actionLists.reduce((count, list) => count + list.length, 0);
  let offset = 0;
  return drafts.map((draft, index) => {
    const actions = timedActions(actionLists[index], duration, offset, total);
    offset += actions.length;
    return { camera: draft.camera, cameraMotion: draft.cameraMotion,
      backgroundMotion: draft.backgroundMotion, sound: draft.sound, actions };
  });
}

export function PromptComposerDialog({ isOpen, modelKind, durationSeconds, originalPrompt,
  referenceImageCount, referenceAudioCount, onClose, onApply }: Props) {
  const { t } = useTranslation();
  const [scene, setScene] = useState('');
  const [lighting, setLighting] = useState('');
  const [shots, setShots] = useState<ShotDraft[]>([emptyShot()]);
  const [actionsText, setActionsText] = useState('');
  const [sound, setSound] = useState('');
  const [imageSlot, setImageSlot] = useState(0);
  const [audioSlot, setAudioSlot] = useState(0);
  const [preciseTiming, setPreciseTiming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [issues, setIssues] = useState<PromptIssue[]>([]);
  const [suggestedPrompt, setSuggestedPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setScene(originalPrompt); setLighting(''); setShots([emptyShot()]);
    setActionsText(''); setSound('');
    setImageSlot(referenceImageCount === 1 ? 1 : 0);
    setAudioSlot(referenceAudioCount === 1 ? 1 : 0);
    setPreciseTiming(false); setPreview(null); setIssues([]); setSuggestedPrompt(null); setError(null);
  }, [isOpen, modelKind]);
  useEffect(() => { setPreview(null); setIssues([]); setSuggestedPrompt(null); },
    [scene, lighting, shots, actionsText, sound, imageSlot, audioSlot, preciseTiming, durationSeconds]);

  const fieldClass = 'nodrag nowheel w-full rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] px-3 py-2 text-sm text-text-dark outline-none focus:border-accent';
  const updateShot = (index: number, field: keyof ShotDraft, value: string) => setShots((current) =>
    current.map((shot, currentIndex) => currentIndex === index ? { ...shot, [field]: value } : shot));
  const compile = () => {
    try {
      const prompt = modelKind === 'h3'
        ? compileMinimaxH3Prompt({ durationSeconds, space: scene, lighting, shots: timedShots(shots, durationSeconds) })
        : compileSeedancePrompt({ durationSeconds, scene,
          actions: timedActions(lines(actionsText), durationSeconds),
          characterImageSlot: imageSlot || undefined, dialogueAudioSlot: audioSlot || undefined,
          timingMode: preciseTiming ? 'precise' : 'natural', sound: sound || undefined });
      const linted = lintPrompt({ prompt, modality: 'video', referenceImageCount });
      setPreview(linted.prompt); setIssues(linted.issues); setSuggestedPrompt(linted.suggestedPrompt ?? null); setError(null);
    } catch (cause) {
      setPreview(null); setIssues([]); setSuggestedPrompt(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return <UiModal isOpen={isOpen} title={t('node.aiVideo.compilerTitle')} onClose={onClose}
    widthClassName="w-[min(760px,calc(100vw-32px))]" containerClassName="!z-[13050]"
    footer={<>
      <UiButton variant="muted" size="sm" onClick={onClose}>{t('common.close')}</UiButton>
      <UiButton variant="muted" size="sm" onClick={compile}>{t('node.aiVideo.compilerPreview')}</UiButton>
      <UiButton variant="primary" size="sm" disabled={!preview} onClick={() => {
        if (preview) { onApply(preview); onClose(); }
      }}>{t('node.aiVideo.compilerApply')}</UiButton>
    </>}>
    <div className="space-y-3 text-sm text-text-dark">
      <p className="text-xs text-text-muted">{t('node.aiVideo.compilerHint')}</p>
      <label className="block space-y-1"><span>{t('node.aiVideo.compilerScene')}</span>
        <textarea className={`${fieldClass} h-24 resize-y`} value={scene} onChange={(event) => setScene(event.target.value)} /></label>
      {modelKind === 'h3' ? <>
        <label className="block space-y-1"><span>{t('node.aiVideo.compilerLighting')}</span>
          <input className={fieldClass} value={lighting} onChange={(event) => setLighting(event.target.value)} /></label>
        {shots.map((shot, index) => <div key={index} className="space-y-2 rounded-lg border border-[var(--canvas-node-field-border)] p-3">
          <div className="flex items-center justify-between font-medium">
            <span>{t('node.aiVideo.compilerShot', { index: index + 1 })}</span>
            {shots.length > 1 && <UiButton variant="muted" size="sm" onClick={() => setShots((current) => current.filter((_, i) => i !== index))}>{t('node.aiVideo.compilerRemoveShot')}</UiButton>}
          </div>
          {([['camera', 'compilerCamera'], ['cameraMotion', 'compilerCameraMotion'],
            ['backgroundMotion', 'compilerBackgroundMotion'], ['sound', 'compilerSound']] as const)
            .map(([field, label]) => <label key={field} className="block space-y-1"><span>{t(`node.aiVideo.${label}`)}</span>
              <input className={fieldClass} value={shot[field]} onChange={(event) => updateShot(index, field, event.target.value)} /></label>)}
          <label className="block space-y-1"><span>{t('node.aiVideo.compilerActions')}</span>
            <textarea className={`${fieldClass} h-24 resize-y`} value={shot.actionsText} onChange={(event) => updateShot(index, 'actionsText', event.target.value)} placeholder={t('node.aiVideo.compilerActionsHint')} /></label>
        </div>)}
        <UiButton variant="muted" size="sm" onClick={() => setShots((current) => [...current, emptyShot()])}>{t('node.aiVideo.compilerAddShot')}</UiButton>
      </> : <>
        <label className="block space-y-1"><span>{t('node.aiVideo.compilerActions')}</span>
          <textarea className={`${fieldClass} h-28 resize-y`} value={actionsText} onChange={(event) => setActionsText(event.target.value)} placeholder={t('node.aiVideo.compilerActionsHint')} /></label>
        <label className="block space-y-1"><span>{t('node.aiVideo.compilerSound')}</span>
          <input className={fieldClass} value={sound} onChange={(event) => setSound(event.target.value)} /></label>
        {referenceImageCount > 0 && <label className="block space-y-1"><span>{t('node.aiVideo.compilerImageSlot')}</span>
          <select className={fieldClass} value={imageSlot} onChange={(event) => setImageSlot(Number(event.target.value))}>
            <option value={0}>{t('node.aiVideo.compilerNoSlot')}</option>
            {Array.from({ length: referenceImageCount }, (_, index) => <option key={index} value={index + 1}>@图片{index + 1}</option>)}
          </select></label>}
        {referenceAudioCount > 0 && <label className="block space-y-1"><span>{t('node.aiVideo.compilerAudioSlot')}</span>
          <select className={fieldClass} value={audioSlot} onChange={(event) => setAudioSlot(Number(event.target.value))}>
            <option value={0}>{t('node.aiVideo.compilerNoSlot')}</option>
            {Array.from({ length: referenceAudioCount }, (_, index) => <option key={index} value={index + 1}>@音频{index + 1}</option>)}
          </select></label>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={preciseTiming} onChange={(event) => setPreciseTiming(event.target.checked)} />{t('node.aiVideo.compilerPreciseTiming')}</label>
      </>}
      {error && <div role="alert" className="text-red-500">{error}</div>}
      {preview && <>
        <div className="font-medium">{t('node.aiVideo.compilerResult')}</div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] p-3 text-xs">{preview}</pre>
        {issues.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-600">{issues.map((issue) => <li key={issue.code}>{issue.message}{issue.sourceProfileId && <span className="block text-text-muted">{issue.sourceProfileId}</span>}</li>)}</ul>}
        {suggestedPrompt && <UiButton variant="muted" size="sm" onClick={() => {
          const accepted = lintPrompt({ prompt: suggestedPrompt, modality: 'video', referenceImageCount });
          setPreview(accepted.prompt); setIssues(accepted.issues); setSuggestedPrompt(null);
        }}>{t('node.aiVideo.compilerApplySuggestion')}</UiButton>}
      </>}
    </div>
  </UiModal>;
}
