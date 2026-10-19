import { useSettingsStore } from '@/stores/settingsStore';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useImageModelCatalog, type CatalogEntry } from '../application/modelCatalog';
import { resolveVideoModelConfig, useVideoModelCatalog } from '../application/videoModelCatalog';
import { useCanvasDefaultsStore, type CanvasGenerationDefaults } from '@/stores/canvasDefaultsStore';
import { useCanvasStore } from '@/stores/canvasStore';

function imageConfig(entry: CatalogEntry, previous?: CanvasGenerationDefaults['image']) {
  const resolutions = entry.supportedResolutions?.length ? entry.supportedResolutions : ['1K', '2K', '4K'];
  const resolution = String(previous?.extraParams?.resolutionType ?? '2K');
  return {
    entryId: entry.id,
    ratio: entry.supportedRatios.includes(previous?.ratio ?? '') ? previous!.ratio : entry.supportedRatios[0] ?? 'auto',
    extraParams: { resolutionType: resolutions.includes(resolution) ? resolution : resolutions[0] },
  };
}

export function CanvasSettingsButton() {
  const { t } = useTranslation();
  const images = useImageModelCatalog().filter((entry) => entry.usable);
  const videos = useVideoModelCatalog().filter((entry) => entry.usable);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CanvasGenerationDefaults>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const imageEntry = images.find((entry) => entry.id === draft.image?.entryId);
  const videoEntry = videos.find((entry) => entry.id === draft.video?.entryId);
  const resolutions = imageEntry?.supportedResolutions?.length ? imageEntry.supportedResolutions : ['1K', '2K', '4K'];
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (event.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  const field = (label: string, value: string, options: { value: string; label: string }[], change: (value: string) => void) => (
    <label className="block space-y-1.5 text-sm">
      <span className="text-text-muted">{label}</span>
      <select className="nowheel w-full rounded-lg border border-white/15 bg-[#27272c] px-3 py-2 text-white disabled:opacity-40"
        value={value} disabled={!options.length} onChange={(event) => change(event.target.value)}>
        {!options.length && <option value="">{t('canvasDefaults.noModels')}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
  const choices = (values: string[]) => values.map((value) => ({ value, label: value === 'auto' ? t('modelParams.autoAspectRatio') : value }));
  const group = (title: string, content: ReactNode) => <fieldset className="space-y-3 rounded-xl border border-white/10 p-4"><legend className="px-2 text-sm font-medium">{title}</legend>{content}</fieldset>;

  return <>
    <button ref={trigger} type="button" title={t('canvasDefaults.title')} aria-label={t('canvasDefaults.title')}
      aria-haspopup="dialog" aria-expanded={open}
      className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/10 hover:text-white"
      onClick={() => {
        const saved = useCanvasDefaultsStore.getState();
        const image = images.find((entry) => entry.id === saved.image?.entryId) ?? images[0];
        setDraft({ image: image ? imageConfig(image, saved.image) : undefined, video: resolveVideoModelConfig(videos, saved.video) });
        setOpen(true);
      }}><Settings2 className="h-4 w-4" /></button>
    {open && createPortal(<div className="fixed inset-0 z-[210000] flex items-center justify-center bg-black/60 p-4"
      data-canvas-no-marquee="true" onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}
      onWheel={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="canvas-defaults-title" tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-[#1a1a1e] p-5 text-white shadow-2xl outline-none">
        <div className="mb-3 flex items-center justify-between"><h2 id="canvas-defaults-title" className="text-lg font-semibold">{t('canvasDefaults.title')}</h2>
          <button type="button" aria-label={t('canvasDefaults.cancel')} onClick={close} className="rounded p-1 hover:bg-white/10"><X className="h-5 w-5" /></button></div>
        <p className="mb-4 text-xs leading-5 text-text-muted">{t('canvasDefaults.description')}</p>
        <div className="space-y-4">
          {group(t('canvasDefaults.image'), <>
            {field(t('canvasDefaults.model'), draft.image?.entryId ?? '', images.map((entry) => ({ value: entry.id, label: `${entry.providerLabel} · ${entry.modelLabel}` })), (id) => setDraft({ ...draft, image: imageConfig(images.find((entry) => entry.id === id)!, draft.image) }))}
            {draft.image && imageEntry && <div className="grid grid-cols-2 gap-3">
              {field(t('canvasDefaults.ratio'), draft.image.ratio, choices(imageEntry.supportedRatios), (ratio) => setDraft({ ...draft, image: { ...draft.image!, ratio } }))}
              {field(t('canvasDefaults.resolution'), String(draft.image.extraParams?.resolutionType ?? ''), choices(resolutions), (resolutionType) => setDraft({ ...draft, image: { ...draft.image!, extraParams: { resolutionType } } }))}
            </div>}
          </>)}
          {group(t('canvasDefaults.video'), <>
            {field(t('canvasDefaults.model'), draft.video?.entryId ?? '', videos.map((entry) => ({ value: entry.id, label: `${entry.providerLabel} · ${entry.modelLabel}` })), (entryId) => setDraft({ ...draft, video: resolveVideoModelConfig(videos, { ...draft.video!, entryId, extraParams: {} }) }))}
            {draft.video && videoEntry && <>
              <div className="grid grid-cols-2 gap-3">
                {field(t('canvasDefaults.ratio'), draft.video.aspectRatio ?? '', choices(videoEntry.supportedAspectRatios), (aspectRatio) => setDraft({ ...draft, video: { ...draft.video!, aspectRatio } }))}
                {field(t('canvasDefaults.resolution'), draft.video.resolution, choices(videoEntry.supportedResolutions), (resolution) => setDraft({ ...draft, video: { ...draft.video!, resolution } }))}
              </div>
              {field(t('canvasDefaults.duration'), draft.video.duration, videoEntry.supportedDurations.map((value) => ({ value, label: t('canvasDefaults.seconds', { count: Number(value) }) })), (duration) => setDraft({ ...draft, video: { ...draft.video!, duration } }))}
            </>}
          </>)}
        </div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" className="rounded-lg px-4 py-2 text-sm hover:bg-white/10" onClick={close}>{t('canvasDefaults.cancel')}</button>
          <button type="button" disabled={!draft.image && !draft.video} className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
            onClick={() => {
              useCanvasDefaultsStore.getState().setDefaults(draft);
              if (draft.image) {
                const settings = useSettingsStore.getState();
                for (const key of Object.keys(settings.lastModelConfigByPanel ?? {})) {
                  settings.setPanelModelConfig(key, draft.image);
                }
              }
              useCanvasStore.getState().applyGenerationDefaults(draft);
              close();
            }}>{t('canvasDefaults.save')}</button></div>
      </div>
    </div>, document.body)}
  </>;
}
