import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BipedController } from './BipedController';
import { basisQuaternion, matrixFromRows, poseBasis } from './bipedMath';
import metaJson from '../../../../../../public/models/ai4animation/locomotion_biped_meta.json';
import type { BipedMeta, BipedSequence, MotionControl } from './types';
const meta=metaJson as BipedMeta;
const control=(frame:number,style='Neutral'):MotionControl=>({
  velocity:new THREE.Vector3(...(frame<60||frame>=540?[0,0,0]:frame<300?[0,0,1]:frame<420?[0.6,0,0.8]:[0,0,-1]) as [number,number,number]).multiplyScalar(frame>=180&&frame<300?2:1),
  direction:frame>=300&&frame<420?new THREE.Vector3(1,0,0):new THREE.Vector3(),style,
});
describe('continuous upstream biped controller',()=>{
  it('matches 600 Python frames with identical predictions, including initial alias and contact history',()=>{
    const predictions=JSON.parse(gunzipSync(readFileSync('scripts/ai4animation/fixtures/continuous/Neutral-predictions.json.gz')).toString());
    const file=readFileSync('scripts/ai4animation/fixtures/continuous/Neutral.bin');
    const truth=new Float32Array(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength));
    const c=new BipedController(meta);let prediction=0,maxPosition=0,maxBasis=0;
    for(let frame=0;frame<600;frame++) {
      c.control(control(frame),1/60);
      if(c.needsPrediction()) {
        const p=predictions[prediction++];expect(p.frame).toBe(frame);
        const sequence:BipedSequence={startTime:0,frames:p.positions.map((positions:number[][],i:number)=>{
          const root=matrixFromRows(p.roots[i]),bases=p.rotations[i].map((r:number[][])=>matrixFromRows([...r.map(row=>[...row,0]),[0,0,0,1]]));
          return {rootPosition:new THREE.Vector3().setFromMatrixPosition(root),rootRotation:basisQuaternion(root),positions:positions.map(v=>new THREE.Vector3().fromArray(v)),rotations:bases.map(basisQuaternion),rotationBases:bases,velocities:p.velocities[i].map((v:number[])=>new THREE.Vector3().fromArray(v)),rootVelocity:new THREE.Vector3().fromArray(p.rootVelocities[i]),contacts:p.contacts[i]};
        })};c.publish(sequence);
      }
      const pose=c.animate(1/60),offset=frame*352;
      let distance=0,basis=0;
      pose.positions.forEach((p,i)=>{distance=Math.max(distance,p.distanceTo(new THREE.Vector3().fromArray(truth,offset+7+i*3)));const e=poseBasis(pose,i).elements;for(let r=0;r<3;r++)for(let column=0;column<3;column++)basis=Math.max(basis,Math.abs(e[column*4+r]-truth[offset+76+i*9+r*3+column]));});
      maxPosition=Math.max(maxPosition,distance);maxBasis=Math.max(maxBasis,basis);
    }
    expect(maxPosition).toBeLessThan(0.002);expect(maxBasis).toBeLessThan(0.002);
  // The compressed 600-frame reference replay needs headroom on shared CI runners.
  }, 30_000);
});
