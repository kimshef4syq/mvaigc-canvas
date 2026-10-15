import { useState } from 'react';
import { ChevronDown, ChevronUp, Gamepad2, Radio, Trash2, X } from 'lucide-react';
import { HAND_POSES } from '@/features/canvas/domain/directorHandPose';
import type { BlueprintItem } from '@/features/canvas/domain/canvasNodes';
import type { useNeuralCharacterPilot } from './useNeuralCharacterPilot';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
}

export function NeuralCharacterControls({
  pilot,
  selectedItem,
  hasRecording,
  onDeleteRecording,
}: {
  pilot: ReturnType<typeof useNeuralCharacterPilot>;
  selectedItem: BlueprintItem | null;
  hasRecording: boolean;
  onDeleteRecording: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const compatible = selectedItem?.category === 'person' && (selectedItem.presetId === 'ai4animation-geno' || selectedItem.presetId === 'ai4animation-cranberry');
  const active = pilot.status === 'active';
  const loading = pilot.status === 'loading';
  const recording = pilot.recording;
  const stats = pilot.recordingStats ?? { elapsed: 0, frames: 0 };

  // Don't clutter the 3D viewport if character is not compatible and pilot is idle
  if (!compatible && !active && !loading) {
    return null;
  }

  const characterName = selectedItem?.label ?? (selectedItem?.presetId === 'ai4animation-cranberry' ? 'Cranberry' : 'Geno');

  // Collapsed mini bar mode for maximum viewport visibility
  if (collapsed) {
    return (
      <div className="pointer-events-auto absolute right-3 top-14 z-40 flex items-center gap-2 rounded-lg border border-white/15 bg-[#202329]/95 px-3 py-1.5 text-xs text-white shadow-xl backdrop-blur-md" aria-label="AI 角色操控 (最小化)">
        {active ? (
          <>
            {recording ? (
              <span className="flex items-center gap-1.5 text-red-400 font-medium">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                录制中 {formatElapsed(stats.elapsed)} ({stats.frames} 帧)
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-emerald-300">
                <Gamepad2 size={14} />
                {characterName} · {pilot.style}
              </span>
            )}
            <button
              type="button"
              className={`rounded px-2 py-0.5 text-[11px] font-medium border ${recording ? 'border-red-400 bg-red-600/80 hover:bg-red-600 text-white' : 'border-white/20 hover:bg-white/10 text-white/90'}`}
              onClick={pilot.toggleRecording}
            >
              {recording ? '停止保存' : '录制'}
            </button>
            <button
              type="button"
              className="rounded border border-white/20 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
              onClick={pilot.stop}
            >
              退出
            </button>
          </>
        ) : (
          <button
            type="button"
            className="flex items-center gap-1.5 font-medium text-emerald-300 hover:text-emerald-200"
            onClick={() => void pilot.start()}
          >
            <Gamepad2 size={14} />
            AI 角色操控
          </button>
        )}
        <button
          type="button"
          className="rounded p-0.5 text-white/50 hover:bg-white/10 hover:text-white"
          title="展开面板"
          onClick={() => setCollapsed(false)}
          aria-label="展开 AI 角色操控面板"
        >
          <ChevronDown size={14} />
        </button>
      </div>
    );
  }

  const buttonBase = 'inline-flex items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <section
      className="pointer-events-auto ui-scrollbar absolute right-3 top-14 z-40 flex max-h-[calc(100%-72px)] w-[320px] max-w-[calc(100%-24px)] flex-col overflow-y-auto rounded-xl border border-white/15 bg-[#202329]/95 p-3.5 text-xs text-white/80 shadow-2xl backdrop-blur-md transition-all duration-150 break-words"
      aria-label="AI 角色操控"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Gamepad2 size={16} className="text-teal-400 shrink-0" />
          <span className="font-semibold text-white/95 truncate">{characterName}</span>
          <span className="text-[10px] text-white/45">· AI 动力学</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {recording ? (
            <span className="flex items-center gap-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400 font-medium border border-red-500/30">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              录制中
            </span>
          ) : active ? (
            <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300 border border-emerald-500/30">
              <Radio size={10} className="animate-spin text-emerald-400" />
              操控中
            </span>
          ) : loading ? (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300 border border-amber-500/30">
              加载中…
            </span>
          ) : null}
          <button
            type="button"
            className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
            title="最小化面板"
            onClick={() => setCollapsed(true)}
            aria-label="最小化面板"
          >
            <ChevronUp size={15} />
          </button>
        </div>
      </div>

      {/* Main Action Buttons */}
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`${buttonBase} flex-1 px-3 py-1.5 ${
              active
                ? 'border-red-500/40 bg-red-500/15 text-red-200 hover:bg-red-500/25'
                : loading
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                : 'border-teal-400/40 bg-teal-500/20 text-teal-100 hover:bg-teal-500/30 font-semibold'
            }`}
            disabled={!compatible && !active && !loading}
            title={compatible ? 'WASD 移动，Shift 加速，Q/E 切换风格，右键调整朝向' : '请从模型库选择 Geno 或 Cranberry'}
            onClick={() => active || loading ? pilot.stop() : void pilot.start()}
          >
            {loading ? '取消加载' : active ? '退出角色操控' : 'AI 角色操控'}
          </button>

          {active && (
            <button
              type="button"
              className={`${buttonBase} px-3 py-1.5 ${
                recording
                  ? 'border-red-400 bg-red-600 text-white hover:bg-red-500 animate-pulse'
                  : 'border-white/20 bg-white/5 text-white/90 hover:bg-white/10'
              }`}
              onClick={pilot.toggleRecording}
            >
              {recording ? '停止并保存' : '录制动作'}
            </button>
          )}
        </div>

        {/* Live Recording Stats Banner */}
        {recording && (
          <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-[11px] text-red-200">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              已录制 {formatElapsed(stats.elapsed)}
            </span>
            <span className="text-red-300/80">{stats.frames} 帧 · 30 FPS</span>
          </div>
        )}
      </div>

      {/* Active Options: Style & Hands */}
      {active && (
        <div className="mt-3 space-y-2.5 border-t border-white/10 pt-2.5">
          <label className="flex items-center justify-between gap-2">
            <span className="text-white/70">行走风格:</span>
            <select
              aria-label="行走风格"
              className="flex-1 rounded-md border border-white/15 bg-[#171a1f] px-2 py-1 text-xs text-white outline-none focus:border-teal-400"
              value={pilot.style}
              onChange={(e) => pilot.setStyle(e.target.value)}
            >
              {pilot.styles.map((style) => (
                <option key={style} value={style} className="bg-[#1e2128] text-white">
                  {style}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2 pt-1">
            {(['left', 'right'] as const).map((side) => (
              <label key={side} className="flex flex-col gap-1">
                <span className="text-[11px] text-white/60">{side === 'left' ? '左手手势' : '右手手势'}</span>
                <select
                  aria-label={side === 'left' ? '左手手势' : '右手手势'}
                  className="rounded-md border border-white/15 bg-[#171a1f] px-2 py-1 text-xs text-white outline-none focus:border-teal-400"
                  value={pilot.handPresets[side]}
                  onChange={(e) => pilot.setHandPreset(side, e.target.value as keyof typeof HAND_POSES | 'original')}
                >
                  {(['original', 'relaxed', 'open', 'fist', 'point', 'phone'] as const).map((key) => (
                    <option key={key} value={key} className="bg-[#1e2128] text-white">
                      {{ original: '原版', relaxed: '自然放松', open: '五指张开', fist: '握拳', point: '食指指向', phone: '握持姿态' }[key]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="rounded-lg bg-black/25 p-2 text-[10px] leading-relaxed text-white/60 border border-white/5">
            <p className="font-medium text-white/75">快捷键指南：</p>
            <p>· WASD：方向移动</p>
            <p>· Shift：冲刺加速</p>
            <p>· Q / E：上一款 / 下一款风格</p>
            <p>· 鼠标右键拖动：调整朝向</p>
            <p>· Esc：退出操控</p>
          </div>
        </div>
      )}

      {/* Loading state indicator */}
      {loading && (
        <p className="mt-2 text-center text-[11px] text-amber-200 animate-pulse" role="status">
          正在加载 AI 动力学神经网络与骨骼拓扑…
        </p>
      )}

      {/* Idle status & Delete recording button */}
      {!active && !loading && (
        <div className="mt-2.5 space-y-2 border-t border-white/10 pt-2 text-[11px]">
          {hasRecording ? (
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-950/30 p-2 text-emerald-300">
              <span>✓ 骨骼动作已录制，可在时间轴回放</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-950/40 px-2 py-1 text-[10px] text-red-300 hover:bg-red-900/60 transition-colors"
                onClick={onDeleteRecording}
                title="删除骨骼动作录制并恢复站立"
              >
                <Trash2 size={11} />
                删除录制
              </button>
            </div>
          ) : (
            <p className="text-white/50 text-[11px] leading-relaxed">
              点击上方按钮进入 WASD 实时操控模式，支持 12 种情绪步态与独立手势录制。
            </p>
          )}
        </div>
      )}

      {/* Error alert banner */}
      {pilot.error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-500/40 bg-red-950/60 p-2 text-[11px] text-red-200" role="alert">
          <X size={14} className="shrink-0 mt-0.5 text-red-400" />
          <span className="flex-1 break-words">{pilot.error}</span>
        </div>
      )}
    </section>
  );
}
