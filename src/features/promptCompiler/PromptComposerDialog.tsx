import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiModal } from '@/components/ui';
import {
  compileMinimaxH3Prompt,
  compileSeedancePrompt,
  type TimedAction,
} from './PromptCompiler';
import { lintPrompt } from './PromptLinter';

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

function timedActions(lines: string[], durationSeconds: number): TimedAction[] {
  const actions = lines.map((line) => line.trim()).filter(Boolean);
  return actions.map((action, index) => ({
    startSeconds: Number((index * durationSeconds / actions.length).toFixed(3)),
    endSeconds: Number(((index + 1) * durationSeconds / actions.length).toFixed(3)),
    action,
  }));
}

export function PromptComposerDialog({
  isOpen,
  modelKind,
  durationSeconds,
  originalPrompt,
  referenceImageCount,
  referenceAudioCount,
  onClose,
  onApply,
}: Props) {
  const { t } = useTranslation();
  const [scene, setScene] = useState('');
  const [camera, setCamera] = useState('');
  const [cameraMotion, setCameraMotion] = useState('');
  const [lighting, setLighting] = useState('');
  const [backgroundMotion, setBackgroundMotion] = useState('');
  const [actionsText, setActionsText] = useState('');
  const [sound, setSound] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setScene(originalPrompt);
    setCamera('');
    setCameraMotion('');
    setLighting('');
    setBackgroundMotion('');
    setActionsText('');
    setSound('');
    setPreview(null);
    setIssues([]);
    setError(null);
  }, [isOpen, modelKind]);

  useEffect(() => {
    setPreview(null);
    setIssues([]);
  }, [scene, camera, cameraMotion, lighting, backgroundMotion, actionsText, sound, durationSeconds]);

  const fieldClass = 'nodrag nowheel w-full rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] px-3 py-2 text-sm text-text-dark outline-none focus:border-accent';
  const fields = modelKind === 'h3' ? [
    { key: 'camera', label: t('node.aiVideo.compilerCamera'), value: camera, set: setCamera },
    { key: 'cameraMotion', label: t('node.aiVideo.compilerCameraMotion'), value: cameraMotion, set: setCameraMotion },
    { key: 'lighting', label: t('node.aiVideo.compilerLighting'), value: lighting, set: setLighting },
    { key: 'backgroundMotion', label: t('node.aiVideo.compilerBackgroundMotion'), value: backgroundMotion, set: setBackgroundMotion },
  ] : [];

  const compile = () => {
    try {
      const actions = timedActions(actionsText.split(/\r?\n/), durationSeconds);
      const prompt = modelKind === 'h3'
        ? compileMinimaxH3Prompt({
          durationSeconds,
          space: scene,
          camera,
          cameraMotion,
          lighting,
          backgroundMotion,
          actions,
          sound,
        })
        : compileSeedancePrompt({
          durationSeconds,
          scene,
          actions,
          characterImageSlot: referenceImageCount > 0 ? 1 : undefined,
          dialogueAudioSlot: referenceAudioCount > 0 ? 1 : undefined,
          sound: sound || undefined,
        });
      const linted = lintPrompt({ prompt, modality: 'video', referenceImageCount });
      setPreview(linted.prompt);
      setIssues(linted.issues.map((issue) => issue.message));
      setError(null);
    } catch (cause) {
      setPreview(null);
      setIssues([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return <UiModal
    isOpen={isOpen}
    title={t('node.aiVideo.compilerTitle')}
    onClose={onClose}
    widthClassName="w-[min(760px,calc(100vw-32px))]"
    containerClassName="!z-[13050]"
    footer={<>
      <UiButton variant="muted" size="sm" onClick={onClose}>{t('common.close')}</UiButton>
      <UiButton variant="muted" size="sm" onClick={compile}>{t('node.aiVideo.compilerPreview')}</UiButton>
      <UiButton variant="primary" size="sm" disabled={!preview} onClick={() => {
        if (preview) {
          onApply(preview);
          onClose();
        }
      }}>{t('node.aiVideo.compilerApply')}</UiButton>
    </>}
  >
    <div className="space-y-3 text-sm text-text-dark">
      <p className="text-xs text-text-muted">{t('node.aiVideo.compilerHint')}</p>
      <label className="block space-y-1">
        <span>{t('node.aiVideo.compilerScene')}</span>
        <textarea className={`${fieldClass} h-24 resize-y`} value={scene} onChange={(event) => setScene(event.target.value)} />
      </label>
      {fields.map((field) => <label key={field.key} className="block space-y-1">
        <span>{field.label}</span>
        <input className={fieldClass} value={field.value} onChange={(event) => field.set(event.target.value)} />
      </label>)}
      <label className="block space-y-1">
        <span>{t('node.aiVideo.compilerActions')}</span>
        <textarea className={`${fieldClass} h-28 resize-y`} value={actionsText} onChange={(event) => setActionsText(event.target.value)} placeholder={t('node.aiVideo.compilerActionsHint')} />
      </label>
      <label className="block space-y-1">
        <span>{t('node.aiVideo.compilerSound')}</span>
        <input className={fieldClass} value={sound} onChange={(event) => setSound(event.target.value)} />
      </label>
      {error && <div role="alert" className="text-red-500">{error}</div>}
      {preview && <>
        <div className="font-medium">{t('node.aiVideo.compilerResult')}</div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] p-3 text-xs">{preview}</pre>
        {issues.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-600">{issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>}
      </>}
    </div>
  </UiModal>;
}
