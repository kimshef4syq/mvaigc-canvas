import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ORIGINAL_MOTIONS, originalFrameIndex, sampleOriginalMotion, bakeOriginalMotion, type OriginalMotion } from './originalMotionAssets';
import { NeuralSkeletonAdapter, applyBakedSkeleton } from './neuralCharacterAssets';
import { normalizeSkeletonRecordings, sampleSkeletonRecording } from '@/features/canvas/application/directorSkeletonMotion';
import metaJson from '../../../../../../public/models/ai4animation/locomotion_biped_meta.json';
import reference from '../../../../../../scripts/ai4animation/fixtures/skin-reference.json';
import type { BipedMeta } from './types';
const meta=metaJson as BipedMeta;
function source(id:string):OriginalMotion {
  const definition=ORIGINAL_MOTIONS.find(m=>m.id===id)!;const file=readFileSync(`public/models/ai4animation/motions/${definition.file}`);
  return {definition,values:new Float32Array(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength))};
}
async function rig(model = 'geno') {
  const file=readFileSync(`public/models/ai4animation/${model}.glb`);const gltf=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
  const group=new THREE.Group();group.add(gltf.scene);group.userData.neuralReady=true;group.userData.neuralModelId=`ai4animation-${model}`;
  group.traverse((o:any)=>{if(o.isBone)o.userData.neuralRest={position:o.position.toArray(),quaternion:o.quaternion.toArray(),scale:o.scale.toArray()};});return group;
}
describe('original upstream motion assets',()=>{
  it('matches actual Python Actor skinning at 25 source frames across all five complete clips',async()=>{
    const group=await rig('geno'),adapter=new NeuralSkeletonAdapter(group,meta);let mesh!:THREE.SkinnedMesh;
    group.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)mesh=o as THREE.SkinnedMesh;});
    let maxSkin=0,maxJoint=0;
    for(const test of reference.cases) {
      adapter.apply(sampleOriginalMotion(source(test.motion),test.time));group.updateMatrixWorld(true);mesh.skeleton.update();
      meta.jointNames.forEach((name,i)=>{maxJoint=Math.max(maxJoint,group.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(test.positions[i])));});
      reference.vertexIndices.forEach((index,i)=>{const vertex=mesh.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);maxSkin=Math.max(maxSkin,vertex.distanceTo(new THREE.Vector3().fromArray(test.vertices[i])));});
    }
    console.log({maxJoint,maxSkin});expect(maxJoint).toBeLessThan(0.00001);expect(maxSkin).toBeLessThan(0.0001);
  });
  it('bakes a trimmed source at the cursor, clips at project end, survives saving and reverse seeking',async()=>{
    const group=await rig('geno');group.position.set(2,0,3);group.rotation.y=0.7;group.scale.setScalar(1.2);
    const recording=bakeOriginalMotion(group,meta,source('walk3_subject3'),12,17,6,8);
    expect(recording.frames).toHaveLength(61);expect(recording.frames[0].time).toBe(6);expect(recording.frames[60].time).toBe(8);
    const restored=normalizeSkeletonRecordings(JSON.parse(JSON.stringify({actor:recording})),8).actor;
    expect(restored.frames[0].jointBases).toHaveLength(207);
    for(const time of [8,7,6.4,6,7.5]) {const frame=sampleSkeletonRecording(restored,time)!;applyBakedSkeleton(group,restored.jointNames,frame);const captured=new NeuralSkeletonAdapter(group,meta).capture(time);expect(captured.jointBases!.slice(0,207)).toEqual(frame.jointBases);}
    expect(sampleSkeletonRecording(restored,5.9)).toBeNull();expect(()=>bakeOriginalMotion(group,meta,source('walk3_subject3'),1,2,8,8)).toThrow();
  });
  it('bakes and replays original motions for Cranberry',async()=>{
    const group=await rig('cranberry');group.position.set(1,0,2);group.rotation.y=0.5;
    const recording=bakeOriginalMotion(group,meta,source('run1_subject2'),2,5,1,4);
    expect(recording.modelId).toBe('ai4animation-cranberry');
    expect(recording.skeletonId).toBe('cranberry-biped-23-v1');
    expect(recording.frames).toHaveLength(91);
    const restored=normalizeSkeletonRecordings(JSON.parse(JSON.stringify({cranberry:recording})),4).cranberry;
    expect(restored).toBeDefined();
    expect(restored.frames[0].joints).toHaveLength(23 * 7);
    const frame=sampleSkeletonRecording(restored,2.5)!;
    applyBakedSkeleton(group,restored.jointNames,frame);
    expect(group.position.x).toBeCloseTo(frame.rootPosition[0]);
  });
  it('uses original nearest-frame sampling, including numpy even ties and source end clamping',()=>{
    const motion=source('walk3_subject3');expect(originalFrameIndex(motion,0.5/motion.definition.fps)).toBe(0);expect(originalFrameIndex(motion,1.5/motion.definition.fps)).toBe(2);
    expect(originalFrameIndex(motion,-2)).toBe(0);expect(originalFrameIndex(motion,motion.definition.duration+1)).toBe(motion.definition.frameCount-1);
  });
});
