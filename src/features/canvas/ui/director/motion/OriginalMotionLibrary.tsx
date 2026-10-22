import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import metaJson from '../../../../../../public/models/ai4animation/locomotion_biped_meta.json';
import { ORIGINAL_MOTIONS, loadOriginalMotion, sampleOriginalMotion, rebaseOriginalPose, type OriginalMotion } from './originalMotionAssets';
import { ensureNeuralModel, createNeuralCharacter, NeuralSkeletonAdapter } from './neuralCharacterAssets';
import type { BipedMeta } from './types';

export function OriginalMotionLibrary({compatible,selectedModelId,remaining,onApply}:{compatible:boolean;selectedModelId?:string;remaining:number;onApply:(id:string,start:number,end:number)=>Promise<void>}) {
  const [id,setId]=useState('walk3_subject3'),[motion,setMotion]=useState<OriginalMotion|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [start,setStart]=useState(0),[end,setEnd]=useState(Math.min(5,remaining)),[playing,setPlaying]=useState(false),[time,setTime]=useState(0);
  const host=useRef<HTMLDivElement>(null),draw=useRef<((time:number)=>void)|null>(null);
  useEffect(()=>{let alive=true;setMotion(null);setError('');setPlaying(false);setStart(0);setTime(0);setEnd(Math.max(1/30,Math.min(5,remaining)));
    void loadOriginalMotion(id).then(m=>{if(alive){setMotion(m);setEnd(Math.min(5,remaining,m.definition.duration));}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[id]);
  useEffect(()=>{
    if(!motion||!host.current)return;let alive=true,renderer:THREE.WebGLRenderer|undefined,group:THREE.Group|undefined;
    const modelToPreview = selectedModelId === 'ai4animation-cranberry' ? 'ai4animation-cranberry' : 'ai4animation-geno';
    void ensureNeuralModel(modelToPreview).then(()=>{
      if(!alive||!host.current)return;
      renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(300,280);renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.current.append(renderer.domElement);
      const scene=new THREE.Scene();scene.background=new THREE.Color('#202329');scene.add(new THREE.HemisphereLight(0xffffff,0x777777,3));
      const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,4,5);scene.add(light);
      group=createNeuralCharacter(modelToPreview,1.7);scene.add(group,new THREE.GridHelper(8,40));
      const adapter=new NeuralSkeletonAdapter(group,metaJson as BipedMeta),origin=sampleOriginalMotion(motion,start);
      const camera=new THREE.PerspectiveCamera(38,300/280,0.01,100);
      draw.current=(t)=>{adapter.apply(rebaseOriginalPose(sampleOriginalMotion(motion,t),origin));const p=group!.position;camera.position.set(p.x+2.7,p.y+1.5,p.z+3.3);camera.lookAt(p.x,p.y+0.85,p.z);renderer!.render(scene,camera);};draw.current(time);
    }).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;draw.current=null;if(renderer){renderer.domElement.remove();renderer.dispose();renderer.forceContextLoss();}group?.traverse((o:any)=>{if(o.isMesh){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});};
  },[motion,start,selectedModelId]);
  useEffect(()=>{draw.current?.(time);},[time]);
  useEffect(()=>{if(!playing)return;let raf=0,last=performance.now();const tick=(now:number)=>{const dt=(now-last)/1000;last=now;setTime(t=>t+dt>end?start:t+dt);raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[playing,start,end]);
  const valid=Boolean(motion&&start>=0&&end>start&&end<=motion.definition.duration&&remaining>=1/30);
  return <div className="space-y-3 text-xs text-white/75">
    <p>直接播放原仓库的标准动捕数据。选择片段后，从当前播放头插入；替换此角色已有骨骼录制。</p>
    <div className="flex flex-wrap gap-2">{ORIGINAL_MOTIONS.map(m=><button key={m.id} type="button" onClick={()=>setId(m.id)} className={`rounded border px-3 py-2 ${id===m.id?'border-accent text-white':'border-white/15'}`}>{m.label}</button>)}</div>
    <div className="flex flex-wrap gap-4"><div ref={host} aria-label="原仓库动作预览" className="h-[280px] w-[300px] shrink-0 rounded bg-black/20"/>
      <div className="min-w-[180px] flex-1 space-y-3">
        <p>{motion?`${motion.definition.label} · ${motion.definition.fps.toFixed(2)} FPS · ${motion.definition.duration.toFixed(2)} 秒`:'正在加载原版动作…'}</p>
        <label className="flex items-center gap-2">起点（秒）<input aria-label="原版动作起点" type="number" min="0" max={motion?.definition.duration} step="0.1" value={start} onChange={e=>{setPlaying(false);setStart(Number(e.target.value));setTime(Number(e.target.value));}} className="w-24 rounded bg-black/30 p-2"/></label>
        <label className="flex items-center gap-2">终点（秒）<input aria-label="原版动作终点" type="number" min={start} max={motion?.definition.duration} step="0.1" value={end} onChange={e=>setEnd(Number(e.target.value))} className="w-24 rounded bg-black/30 p-2"/></label>
        <input aria-label="原版动作预览时间" className="w-full" type="range" min={start} max={Math.max(start,end)} step="0.016667" value={time} onChange={e=>{setPlaying(false);setTime(Number(e.target.value));}}/>
        <p>预览：{time.toFixed(2)} 秒 · 插入长度：{Math.max(0,Math.min(end-start,remaining)).toFixed(2)} 秒</p>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={!valid} onClick={()=>{if(!playing)setTime(start);setPlaying(!playing);}} className="rounded border border-white/20 px-3 py-2 disabled:opacity-40">{playing?'暂停':'播放原版'}</button>
          <button type="button" disabled={!compatible||!valid||busy} onClick={async()=>{setBusy(true);setPlaying(false);setError('');try{await onApply(id,start,end);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}} className="rounded bg-accent px-3 py-2 text-white disabled:opacity-40">{busy?'正在插入…':'插入原版动作'}</button></div>
        {!compatible&&<p>请选择 Geno 或 Cranberry，并打开预演台以插入动作。</p>}
        {error&&<p role="alert" className="text-red-300">{error}</p>}
      </div>
    </div>
  </div>;
}
