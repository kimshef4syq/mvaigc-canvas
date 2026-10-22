import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HAND_FINGERS, HAND_POSES, GENO_FINGER_JOINT_NAMES } from '@/features/canvas/domain/directorHandPose';
import type { DirectorSkeletonRecording } from '@/features/canvas/domain/canvasNodes';
import { normalizeSkeletonRecordings, sampleSkeletonRecording } from '@/features/canvas/application/directorSkeletonMotion';
import { sampleDirectorProceduralAction } from '@/features/canvas/application/directorMotion';
import { applyBakedSkeleton, applyNeuralStaticPose, NeuralSkeletonAdapter } from './neuralCharacterAssets';
import { restPose } from './bipedMath';
import metaJson from '../../../../../../public/models/ai4animation/locomotion_biped_meta.json';
import type { BipedMeta } from './types';

async function rig() {
  const buffer = readFileSync('public/models/ai4animation/geno.glb');
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  const group = new THREE.Group(); group.add(gltf.scene);
  group.userData.neuralReady = true; group.userData.neuralModelId = 'ai4animation-geno';
  group.traverse(bone => { if ((bone as THREE.Bone).isBone) bone.userData.neuralRest = {position:bone.position.toArray(),quaternion:bone.quaternion.toArray(),scale:bone.scale.toArray()}; });
  return group;
}
const point = (group: THREE.Group, name: string) => group.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
const rotations = (group: THREE.Group) => new Map(GENO_FINGER_JOINT_NAMES.map(name => [name, group.getObjectByName(name)!.quaternion.clone().normalize()]));

describe('Geno articulated hands', () => {
  it('both hands close toward their own palms instead of bending outward', async () => {
    const group = await rig(); applyNeuralStaticPose(group, {});
    const neutral = rotations(group);
    const data = ['Left', 'Right'].map(side => {
      const wrist = point(group, side + 'Hand');
      const palm = point(group, side + 'HandIndex1').sub(wrist).cross(point(group, side + 'HandPinky1').sub(wrist)).normalize().multiplyScalar(side === 'Left' ? -1 : 1);
      return {side,wrist,palm,tip:point(group, side + 'HandMiddle3')};
    });
    applyNeuralStaticPose(group, {leftHand:HAND_POSES.fist,rightHand:HAND_POSES.fist});
    for (const {side,wrist,palm,tip} of data) {
      const curled = point(group, side + 'HandMiddle3');
      expect(curled.distanceTo(wrist)).toBeLessThan(tip.distanceTo(wrist) - 0.025);
      expect(curled.clone().sub(tip).dot(palm)).toBeGreaterThan(0.035);
      for (const finger of HAND_FINGERS) for (const joint of [1,2,3]) {
        const name = `${side}Hand${finger}${joint}`;
        expect(group.getObjectByName(name)!.quaternion.clone().normalize().angleTo(neutral.get(name)!)).toBeGreaterThan(0.25);
      }
    }
  });
  it('independent finger curl and thumb opposition preserve other fingers and the other hand', async () => {
    const group = await rig(); applyNeuralStaticPose(group, {}); const before = rotations(group);
    applyNeuralStaticPose(group, {rightHand:{index:1,thumbOpposition:0.8}});
    for (const name of GENO_FINGER_JOINT_NAMES) {
      const changed = name.startsWith('RightHandIndex') || name === 'RightHandThumb1';
      const angle = group.getObjectByName(name)!.quaternion.clone().normalize().angleTo(before.get(name)!);
      if (changed) expect(angle).toBeGreaterThan(0.25);
      if (!changed) expect(angle).toBeLessThan(1e-6);
    }
    applyNeuralStaticPose(group, {});
    for (const name of GENO_FINGER_JOINT_NAMES) expect(group.getObjectByName(name)!.quaternion.clone().normalize().angleTo(before.get(name)!)).toBeLessThan(1e-6);
  });
  it('pointing keeps the index extended while the other fingers curl', async () => {
    const group = await rig(); applyNeuralStaticPose(group, {}); const before = rotations(group);
    applyNeuralStaticPose(group, {rightHand:HAND_POSES.point});
    expect(group.getObjectByName('RightHandIndex1')!.quaternion.clone().normalize().angleTo(before.get('RightHandIndex1')!)).toBeLessThan(1e-6);
    expect(group.getObjectByName('RightHandMiddle2')!.quaternion.clone().normalize().angleTo(before.get('RightHandMiddle2')!)).toBeGreaterThan(1);
  });
  it('wrist movement changes the hand direction without moving the elbow or changing finger-local poses', async () => {
    const group = await rig(); applyNeuralStaticPose(group, {});
    const elbow = point(group,'RightForeArm'), tip = point(group,'RightHandMiddle3'), before=rotations(group);
    applyNeuralStaticPose(group, {rightWrist:{x:0.4,y:0.3,z:0.1}});
    expect(point(group,'RightForeArm').distanceTo(elbow)).toBeLessThan(1e-6);
    expect(point(group,'RightHandMiddle3').distanceTo(tip)).toBeGreaterThan(0.03);
    for (const name of GENO_FINGER_JOINT_NAMES) expect(group.getObjectByName(name)!.quaternion.clone().normalize().angleTo(before.get(name)!)).toBeLessThan(1e-6);
  });
  it('waving animates the wrist and opening after a grip clears every finger', async () => {
    const group = await rig(); applyNeuralStaticPose(group, sampleDirectorProceduralAction('wave',0));
    const wrist=group.getObjectByName('RightHand')!.quaternion.clone();
    applyNeuralStaticPose(group, sampleDirectorProceduralAction('wave',0.35));
    expect(group.getObjectByName('RightHand')!.quaternion.clone().normalize().angleTo(wrist)).toBeGreaterThan(0.25);
    applyNeuralStaticPose(group, {rightHand:HAND_POSES.open}); const open=rotations(group);
    applyNeuralStaticPose(group, {rightHand:HAND_POSES.fist});
    applyNeuralStaticPose(group, {rightHand:HAND_POSES.open});
    for (const name of GENO_FINGER_JOINT_NAMES) expect(group.getObjectByName(name)!.quaternion.clone().normalize().angleTo(open.get(name)!)).toBeLessThan(1e-6);
  });
  it('records and reloads all 53 joints, including smooth finger transitions and legacy reset', async () => {
    const group = await rig(); const meta=metaJson as unknown as BipedMeta;
    const adapter=new NeuralSkeletonAdapter(group,meta), pose=restPose(meta);
    adapter.apply(pose); const a=adapter.capture(0);
    adapter.rightHandPose=HAND_POSES.fist;
    for(let i=0;i<40;i++) adapter.apply(pose);
    const b=adapter.capture(1);
    const clip:DirectorSkeletonRecording={modelId:'ai4animation-geno',skeletonId:'geno-biped-hands-53-v2',fps:30,jointNames:adapter.jointNames,frames:[a,b]};
    const saved=normalizeSkeletonRecordings(JSON.parse(JSON.stringify({actor:clip})),8).actor;
    expect(saved.jointNames).toHaveLength(53);
    const middle=sampleSkeletonRecording(saved,0.5)!;
    applyBakedSkeleton(group,saved.jointNames,middle);
    expect(Math.max(...adapter.capture(0.5).joints.map((value,i)=>Math.abs(value-middle.joints[i])))).toBeLessThan(1e-6);
    const index=adapter.jointNames.indexOf('RightHandMiddle2')*7+3;
    expect(new THREE.Quaternion().fromArray(a.joints,index).angleTo(new THREE.Quaternion().fromArray(b.joints,index))).toBeGreaterThan(0.8);
    expect(new THREE.Quaternion().fromArray(a.joints,index).angleTo(new THREE.Quaternion().fromArray(middle.joints,index))).toBeCloseTo(new THREE.Quaternion().fromArray(middle.joints,index).angleTo(new THREE.Quaternion().fromArray(b.joints,index)),5);
    const bad=JSON.parse(JSON.stringify(clip));bad.frames[1].joints[370]=NaN;
    expect(normalizeSkeletonRecordings({actor:bad},8)).toEqual({});
    const wrong=JSON.parse(JSON.stringify(clip));wrong.jointNames[52]='unknown';
    expect(normalizeSkeletonRecordings({actor:wrong},8)).toEqual({});
    group.getObjectByName('RightHandMiddle2')!.position.x += 0.02;
    applyBakedSkeleton(group,meta.jointNames,{...a,joints:a.joints.slice(0,161)});
    expect(group.getObjectByName('RightHandMiddle2')!.position.toArray()).toEqual(group.getObjectByName('RightHandMiddle2')!.userData.neuralRest.position);
    expect(group.getObjectByName('RightHandMiddle2')!.quaternion.clone().normalize().angleTo(new THREE.Quaternion().fromArray(group.getObjectByName('RightHandMiddle2')!.userData.neuralRest.quaternion).normalize())).toBeLessThan(1e-6);
  });
  it('positive wrist flexion moves the fingers toward the palm on both mirrored hands', async () => {
    const group=await rig(); applyNeuralStaticPose(group,{});
    const metrics=['Left','Right'].map(side=>{
      const wrist=point(group,side+'Hand');
      return {side,tip:point(group,side+'HandMiddle3'),palm:point(group,side+'HandIndex1').sub(wrist).cross(point(group,side+'HandPinky1').sub(wrist)).normalize().multiplyScalar(side==='Left'?-1:1)};
    });
    applyNeuralStaticPose(group,{leftWrist:{x:0.35},rightWrist:{x:0.35}});
    for(const {side,tip,palm} of metrics) expect(point(group,side+'HandMiddle3').sub(tip).dot(palm)).toBeGreaterThan(0.035);
  });

});
