import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { BlueprintItem, DirectorMotionProjectV1, DirectorSkeletonFrame, DirectorSkeletonRecording } from '@/features/canvas/domain/canvasNodes';
import type { BlueprintSceneHandle } from '../../BlueprintScene';
import { NeuralSkeletonAdapter } from './neuralCharacterAssets';
import type { NeuralLocomotionEngine } from './NeuralLocomotionEngine';

interface Options {
  enabled: boolean;
  selectedItem: BlueprintItem | null;
  scene: MutableRefObject<BlueprintSceneHandle | null>;
  project: DirectorMotionProjectV1;
  currentTime: () => number;
  onTime: (time: number) => void;
  onSave: (itemId: string, recording: DirectorSkeletonRecording) => void;
  onBeforeStart: () => void;
}
interface Session {
  itemId: string;
  engine: NeuralLocomotionEngine;
  adapter: NeuralSkeletonAdapter;
  keys: Set<string>;
  yaw: number | null;
  clock: number;
  accumulator: number;
  lastNow: number;
  frames: DirectorSkeletonFrame[] | null;
  recordingStart: number;
  recordingElapsed: number;
  recordingDuration: number;
}
export function useNeuralCharacterPilot(options: Options) {
  const latest = useRef(options); latest.current = options;
  const session = useRef<Session | null>(null);
  const generation = useRef(0);
  const raf = useRef(0);
  const loadingItemId = useRef<string | null>(null);
  const loadingEngine = useRef<NeuralLocomotionEngine | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'active' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [styles, setStyles] = useState<string[]>([]);
  const [style, setStyle] = useState('Neutral');
  const styleRef = useRef(style); styleRef.current = style;
  const [inferenceMs, setInferenceMs] = useState(0);

  const finishRecording = useCallback(() => {
    const s = session.current;
    if (!s?.frames) return;
    const frames = s.frames; s.frames = null;
    setRecording(false);
    if (frames.length > 1) latest.current.onSave(s.itemId, { modelId: 'ai4animation-geno', skeletonId: 'geno-biped-23-v1', fps: 30, jointNames: [...s.engine.meta.jointNames], frames });
  }, []);
  const stop = useCallback(() => {
    generation.current++;
    cancelAnimationFrame(raf.current);
    finishRecording();
    const s = session.current; session.current = null;
    if (s) { s.keys.clear(); s.adapter.group.userData.neuralPilotActive = false; void s.engine.dispose(); }
    if (loadingEngine.current) { void loadingEngine.current.dispose(); loadingEngine.current = null; }
    setStatus('idle');
    // Restore the authored timeline after live control has released its mesh.
    if (s) latest.current.onTime(latest.current.currentTime());
  }, [finishRecording]);
  const start = useCallback(async () => {
    stop();
    const opts = latest.current;
    if (!opts.enabled || opts.selectedItem?.presetId !== 'ai4animation-geno') return;
    opts.onBeforeStart();
    const id = opts.selectedItem.id, token = generation.current;
    loadingItemId.current = id;
    setError(null); setStatus('loading');
    let engine: NeuralLocomotionEngine | null = null;
    try {
      const { NeuralLocomotionEngine: Engine } = await import('./NeuralLocomotionEngine');
      if (token !== generation.current) return;
      engine = new Engine(); loadingEngine.current = engine;
      await engine.initialize();
      if (token !== generation.current) { await engine.dispose(); return; }
      const mesh = opts.scene.current?.getNeuralCharacterMesh(id);
      if (!mesh) throw new Error('人物场景尚未准备好');
      const adapter = new NeuralSkeletonAdapter(mesh, engine.meta);
      mesh.userData.neuralPilotActive = true;
      loadingEngine.current = null;
      const s: Session = { itemId: id, engine, adapter, keys: new Set(), yaw: null, clock: 0, accumulator: 0, lastNow: performance.now(), frames: null, recordingStart: 0, recordingElapsed: 0, recordingDuration: 0 };
      session.current = s;
      const names = Object.keys(engine.meta.guidances).filter(name => name !== 'Idle');
      setStyles(names); setStyle('Neutral'); styleRef.current = 'Neutral'; setStatus('active');
      let lastMetrics = 0;
      const tick = (now: number) => {
        if (session.current !== s) return;
        const currentMesh = latest.current.scene.current?.getNeuralCharacterMesh(id);
        if (currentMesh !== mesh) { stop(); return; }
        s.accumulator += Math.min(0.05, Math.max(0, (now - s.lastNow) / 1000)); s.lastNow = now;
        while (s.accumulator >= 1 / 60) {
          s.accumulator -= 1 / 60; s.clock += 1 / 60;
          const velocity = new THREE.Vector3(Number(s.keys.has('KeyD')) - Number(s.keys.has('KeyA')), 0, Number(s.keys.has('KeyW')) - Number(s.keys.has('KeyS')));
          if (velocity.lengthSq() > 1) velocity.normalize();
          velocity.multiplyScalar(s.keys.has('ShiftLeft') || s.keys.has('ShiftRight') ? 2 : 1);
          const direction = s.yaw === null ? new THREE.Vector3() : new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
          adapter.apply(engine!.update({ velocity, direction, style: styleRef.current }, 1 / 60));
          if (s.frames) {
            s.recordingElapsed += 1 / 60;
            const end = Math.min(s.recordingStart + s.recordingElapsed, s.recordingDuration);
            const due = s.recordingStart + s.frames.length / 30;
            if (end + 1e-8 >= due && due <= s.recordingDuration) { s.frames.push(adapter.capture(Math.min(due, s.recordingDuration))); latest.current.onTime(Math.min(due, s.recordingDuration)); }
            if (end >= s.recordingDuration - 1e-8) {
              if (s.frames[s.frames.length - 1].time < s.recordingDuration) s.frames.push(adapter.capture(s.recordingDuration));
              latest.current.onTime(s.recordingDuration);
              finishRecording();
            }
          }
        }
        if (engine!.error) { const message = engine!.error.message; stop(); setError(message); setStatus('error'); return; }
        latest.current.scene.current?.renderFrame();
        if (now - lastMetrics > 1000) { setInferenceMs(engine!.lastInferenceMs); lastMetrics = now; }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch (error) {
      if (engine) await engine.dispose();
      if (token === generation.current) { loadingEngine.current = null; setError(error instanceof Error ? error.message : String(error)); setStatus('error'); }
    }
  }, [finishRecording, stop]);
  const toggleRecording = useCallback(() => {
    const s = session.current;
    if (!s) return;
    if (s.frames) { finishRecording(); return; }
    const start = latest.current.currentTime(), duration = latest.current.project.durationSeconds;
    if (duration - start < 1 / 30) { setError('时间轴已到末尾，请先将播放头移到前面'); return; }
    s.recordingStart = start; s.recordingElapsed = 0; s.recordingDuration = duration;
    s.frames = [s.adapter.capture(start)]; setError(null); setRecording(true);
  }, [finishRecording]);

  useEffect(() => {
    if (!options.enabled || options.selectedItem?.id !== session.current?.itemId && status === 'active') stop();
    if (status === 'loading' && (!options.enabled || options.selectedItem?.id !== loadingItemId.current || options.selectedItem?.presetId !== 'ai4animation-geno')) stop();
  }, [options.enabled, options.selectedItem?.id, options.selectedItem?.presetId, status, stop]);
  useEffect(() => {
    if (status !== 'active') return;
    const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input,textarea,select,[role="dialog"]')));
    const keys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);
    const down = (event: KeyboardEvent) => {
      const s = session.current; if (!s) return;
      if (editable(event.target)) { s.keys.clear(); return; }
      if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); stop(); return; }
      if (!keys.has(event.code)) return;
      event.preventDefault(); event.stopImmediatePropagation(); s.keys.add(event.code);
      if (!event.repeat && (event.code === 'KeyQ' || event.code === 'KeyE')) {
        const index = styles.indexOf(styleRef.current), next = styles[(index + (event.code === 'KeyQ' ? -1 : 1) + styles.length) % styles.length];
        styleRef.current = next; setStyle(next);
      }
    };
    const up = (event: KeyboardEvent) => { if (keys.has(event.code)) { session.current?.keys.delete(event.code); event.stopImmediatePropagation(); } };
    const clear = () => { if (session.current) { session.current.keys.clear(); session.current.yaw = null; session.current.lastNow = performance.now(); } };
    const focus = (event: FocusEvent) => { if (editable(event.target)) clear(); };
    const mouse = (event: MouseEvent) => {
      if (!(event.buttons & 2) || !session.current || event.target !== latest.current.scene.current?.getCanvas()) return;
      const s = session.current;
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(s.engine.pose.rootRotation);
      s.yaw = (s.yaw ?? Math.atan2(forward.x, forward.z)) - event.movementX * 0.005;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    const release = () => { if (session.current) session.current.yaw = null; };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true);
    window.addEventListener('blur', clear); document.addEventListener('visibilitychange', clear); document.addEventListener('focusin', focus);
    window.addEventListener('mousemove', mouse, true); window.addEventListener('mouseup', release);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear); document.removeEventListener('focusin', focus); window.removeEventListener('mousemove', mouse, true); window.removeEventListener('mouseup', release); clear(); };
  }, [status, stop, styles]);
  useEffect(() => () => { generation.current++; cancelAnimationFrame(raf.current); const s = session.current; if (s) { s.adapter.group.userData.neuralPilotActive = false; void s.engine.dispose(); } void loadingEngine.current?.dispose(); }, []);
  return { status, error, recording, styles, style, setStyle, inferenceMs, start, stop, toggleRecording };
}
