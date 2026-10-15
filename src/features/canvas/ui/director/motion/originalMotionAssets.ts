import * as THREE from 'three';
import manifest from '../../../../../../public/models/ai4animation/motions/manifest.json';
import { GENO_BODY_JOINT_NAMES } from '@/features/canvas/domain/directorHandPose';
import type { DirectorSkeletonRecording } from '@/features/canvas/domain/canvasNodes';
import { lookRotation } from './bipedMath';
import { NeuralSkeletonAdapter, resetNeuralPose, removeNeuralActionTransform } from './neuralCharacterAssets';
import type { BipedMeta, BipedPose } from './types';
export const ORIGINAL_MOTIONS = manifest.motions;
export type OriginalMotionDefinition = typeof ORIGINAL_MOTIONS[number];
export interface OriginalMotion { definition: OriginalMotionDefinition; values: Float32Array }
const cache = new Map<string, Promise<OriginalMotion>>();
export function loadOriginalMotion(id:string):Promise<OriginalMotion> {
  const cached=cache.get(id);if(cached) return cached;
  const definition=ORIGINAL_MOTIONS.find(m=>m.id===id);
  if(!definition) return Promise.reject(new Error('原版动作不存在'));
  const promise=(async()=>{
    const response=await fetch(`/models/ai4animation/motions/${definition.file}`);
    if(!response.ok) throw new Error(`原版动作加载失败 (${response.status})`);
    const buffer=await response.arrayBuffer();
    if(buffer.byteLength!==definition.frameCount*23*7*4 || !definition.jointNames.every((name,i)=>name===GENO_BODY_JOINT_NAMES[i])) throw new Error('原版动作骨骼数据无效');
    if(globalThis.crypto?.subtle) {
      const digest=await crypto.subtle.digest('SHA-256',buffer);
      const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
      if(hash!==definition.sha256) throw new Error('原版动作文件校验失败');
    }
    const values=new Float32Array(buffer);
    if(!values.every(Number.isFinite)) throw new Error('原版动作含无效变换');
    return {definition,values};
  })().catch(error=>{cache.delete(id);throw error;});cache.set(id,promise);return promise;
}
/** numpy.round uses ties-to-even. Original Motion.GetFrameIndices does nearest-frame sampling. */
export function originalFrameIndex(motion:OriginalMotion,time:number) {
  const x=THREE.MathUtils.clamp(time,0,motion.definition.duration)*motion.definition.fps,low=Math.floor(x);
  return Math.min(motion.definition.frameCount-1,x-low===0.5 ? low+(low%2) : Math.round(x));
}
export function sampleOriginalMotion(motion:OriginalMotion,time:number):BipedPose {
  const offset=originalFrameIndex(motion,time)*23*7;
  const positions=GENO_BODY_JOINT_NAMES.map((_,i)=>new THREE.Vector3().fromArray(motion.values,offset+i*7));
  const rotations=GENO_BODY_JOINT_NAMES.map((_,i)=>new THREE.Quaternion().fromArray(motion.values,offset+i*7+3).normalize());
  const span=(left:string,right:string)=>positions[GENO_BODY_JOINT_NAMES.indexOf(left)].clone().sub(positions[GENO_BODY_JOINT_NAMES.indexOf(right)]).setY(0).normalize();
  const forward=span('LeftUpLeg','RightUpLeg').add(span('LeftShoulder','RightShoulder')).normalize().cross(new THREE.Vector3(0,1,0));
  return {rootPosition:positions[0].clone().setY(0),rootRotation:lookRotation(forward,new THREE.Vector3(0,1,0)),positions,rotations,velocities:positions.map(()=>new THREE.Vector3()),contacts:[0,0,0,0]};
}
/** Constant rigid rebase at the selected source start; preserve all original joint relationships. */
export function rebaseOriginalPose(pose:BipedPose,origin:BipedPose):BipedPose {
  const inverse=origin.rootRotation.clone().invert();
  return {...pose,rootPosition:pose.rootPosition.clone().sub(origin.rootPosition).applyQuaternion(inverse),rootRotation:inverse.clone().multiply(pose.rootRotation),positions:pose.positions.map(p=>p.clone().sub(origin.rootPosition).applyQuaternion(inverse)),rotations:pose.rotations.map(q=>inverse.clone().multiply(q))};
}
export function bakeOriginalMotion(group:THREE.Group,meta:BipedMeta,motion:OriginalMotion,sourceStart:number,sourceEnd:number,startTime:number,projectDuration:number):DirectorSkeletonRecording {
  if(![sourceStart,sourceEnd,startTime,projectDuration].every(Number.isFinite)||sourceStart<0||sourceEnd<=sourceStart||sourceEnd>motion.definition.duration||startTime<0) throw new Error('动作片段范围无效');
  const duration=Math.min(sourceEnd-sourceStart,projectDuration-startTime);
  if(duration<1/30) throw new Error('时间轴剩余长度不足，请将播放头向前移动');
  removeNeuralActionTransform(group);resetNeuralPose(group);
  const adapter=new NeuralSkeletonAdapter(group,meta),origin=sampleOriginalMotion(motion,sourceStart),frames=[];
  for(let i=0;i<=Math.floor(duration*30);i++) {
    adapter.apply(rebaseOriginalPose(sampleOriginalMotion(motion,sourceStart+i/30),origin));
    const frame=adapter.capture(startTime+i/30);
    frames.push({...frame,joints:frame.joints.slice(0,23*7),jointBases:frame.jointBases?.slice(0,23*9)});
  }
  if(frames[frames.length-1].time<startTime+duration-1e-8) {
    adapter.apply(rebaseOriginalPose(sampleOriginalMotion(motion,sourceStart+duration),origin));const frame=adapter.capture(startTime+duration);
    frames.push({...frame,joints:frame.joints.slice(0,23*7),jointBases:frame.jointBases?.slice(0,23*9)});
  }
  const modelId = (group.userData.neuralModelId as 'ai4animation-geno' | 'ai4animation-cranberry') ?? 'ai4animation-geno';
  const isCranberry = modelId === 'ai4animation-cranberry';
  return {modelId,skeletonId:isCranberry ? 'cranberry-biped-23-v1' : 'geno-biped-23-v1',fps:30,jointNames:adapter.jointNames.slice(0, 23),frames,source:{kind:'upstream-motion',motionId:motion.definition.id,label:motion.definition.label,sourceStart,sourceEnd:sourceStart+duration}};
}
