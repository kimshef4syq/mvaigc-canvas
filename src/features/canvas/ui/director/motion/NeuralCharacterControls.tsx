import type { BlueprintItem } from '@/features/canvas/domain/canvasNodes';
import type { useNeuralCharacterPilot } from './useNeuralCharacterPilot';

export function NeuralCharacterControls({ pilot, selectedItem, hasRecording, onDeleteRecording }: { pilot: ReturnType<typeof useNeuralCharacterPilot>; selectedItem: BlueprintItem | null; hasRecording: boolean; onDeleteRecording: () => void }) {
  const compatible = selectedItem?.category === 'person' && selectedItem.presetId === 'ai4animation-geno';
  const active = pilot.status === 'active', loading = pilot.status === 'loading';
  const button = 'rounded border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';
  return <section className="pointer-events-auto ui-scrollbar absolute bottom-12 right-3 max-h-[calc(100%-116px)] max-w-[calc(100%-150px)] overflow-y-auto rounded-lg border border-white/15 bg-[#202329]/95 p-3 text-xs text-white/80 break-words" aria-label="AI 角色操控">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={button} disabled={!compatible && !active && !loading} title={compatible ? 'WASD 移动，Shift 加速，Q/E 切换风格，右键调整朝向' : '请从模型库选择 Geno；Cranberry 首版支持展示'} onClick={() => active || loading ? pilot.stop() : void pilot.start()}>{loading ? '取消加载' : active ? '退出角色操控' : 'AI 角色操控'}</button>
      {active && <>
        <label className="flex min-w-0 max-w-full items-center gap-1">风格 <select className="min-w-0 flex-1 rounded bg-[#202329] p-1" value={pilot.style} onChange={event => pilot.setStyle(event.target.value)}>{pilot.styles.map(style => <option key={style}>{style}</option>)}</select></label>
        <button type="button" className={`${button} ${pilot.recording ? 'bg-red-700' : ''}`} onClick={pilot.toggleRecording}>{pilot.recording ? '停止并保存动作' : '录制动作'}</button>
      </>}
      {hasRecording && !active && !loading && <button type="button" className={button} onClick={onDeleteRecording}>删除骨骼录制</button>}
    </div>
    {active && <p className="mt-2">WASD 移动 · Shift 加速 · Q/E 风格 · 右键朝向 · Esc 退出{pilot.recording ? ' · 录制中，到时间轴末尾自动保存' : ''}</p>}
    {loading && <p className="mt-2" role="status">正在加载动作模型…</p>}
    {!compatible && !active && <p className="mt-2 text-white/50">选择模型库中的 Geno 可操控并录制动作</p>}
    {hasRecording && !active && <p className="mt-2 text-emerald-300">骨骼动作已保存，可在时间轴回放与导出</p>}
    {pilot.error && <p className="mt-2 text-red-300" role="alert">{pilot.error}</p>}
  </section>;
}
