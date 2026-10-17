import { useEffect, useState } from 'react';
import { ensureMixamoModel, getMixamoClips } from './mixamoCharacterAssets';

/** Lists the animation clips baked into a Mixamo character's own GLB and bakes
 *  the chosen one onto the timeline. Unlike the AI4Animation library there is no
 *  start/end range — the whole clip is inserted from the playhead. */
export function MixamoMotionLibrary({ modelId, remaining, onApply }: { modelId: string | null; remaining: number; onApply: (clipId: string) => Promise<void> }) {
  const [clips, setClips] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setError('');
    if (!modelId) { setClips([]); return; }
    void ensureMixamoModel(modelId)
      .then(() => { if (alive) setClips(getMixamoClips(modelId).map((clip) => clip.name)); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [modelId]);

  if (!modelId) return <p className="text-xs text-white/60">请选择一个 Mixamo 人物。</p>;
  return (
    <div className="space-y-3 text-xs text-white/75">
      <p>播放该 Mixamo 人物自带的动作。从当前播放头插入，替换此角色已有的骨骼录制。</p>
      <div className="flex flex-wrap gap-2">
        {clips.map((name) => (
          <button
            key={name}
            type="button"
            disabled={remaining < 1 / 30 || busy}
            onClick={async () => { setBusy(true); setError(''); try { await onApply(name); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}
            className="rounded border border-white/15 px-3 py-2 hover:border-accent disabled:opacity-40"
          >{name}</button>
        ))}
        {!clips.length && !error ? <span className="text-white/45">正在加载动作…</span> : null}
      </div>
      {remaining < 1 / 30 ? <p className="text-amber-200/80">时间轴剩余长度不足，请将播放头向前移动。</p> : null}
      {error ? <p role="alert" className="text-red-300">{error}</p> : null}
    </div>
  );
}
