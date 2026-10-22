// Continuous controller semantics from the pinned Python Biped/Program.py.
import * as THREE from 'three';
import { assembleFeatures, clonePose, mixBasis, basisQuaternion, mixPose, restPose, sampleSequence, TrajectoryPlanner, type TrajectorySample } from './bipedMath';
import { BipedIK } from './bipedIK';
import type { BipedMeta, BipedPose, BipedSequence, MotionControl } from './types';

export class BipedController {
  pose:BipedPose;
  readonly planner:TrajectoryPlanner;
  private readonly ik:BipedIK;
  previous:BipedSequence|null=null;
  sequence:BipedSequence|null=null;
  time=0;
  predictedAt=0;
  private timescale=1;
  private synchronization=0;
  private corrected:TrajectorySample[];
  constructor(readonly meta:BipedMeta) {
    this.pose=restPose(meta);this.planner=new TrajectoryPlanner(meta.sequenceLength,meta.sequenceWindow);this.ik=new BipedIK(meta,this.pose);
    this.corrected=this.planner.samples.map(s=>({position:s.position.clone(),rotation:s.rotation.clone(),velocity:s.velocity.clone()}));
  }
  control(control:MotionControl,dt:number) {
    this.time+=dt;
    this.planner.update(this.planner.samples[0].position.clone().lerp(this.pose.rootPosition,this.synchronization),control.direction,control.velocity,dt);
    if(this.sequence) {
      this.corrected=this.planner.samples.map((s,i)=>({position:s.position.clone().lerp(this.sequence!.frames[i].rootPosition,0.25),rotation:basisQuaternion(mixBasis(new THREE.Matrix4().makeRotationFromQuaternion(s.rotation),new THREE.Matrix4().makeRotationFromQuaternion(this.sequence!.frames[i].rootRotation),0.25)),velocity:s.velocity.clone()}));
      this.corrected.forEach((s,i)=>{
        const total=new THREE.Vector3();let time=0;
        for(let j=i;j<this.corrected.length;j++){total.add(this.corrected[j].position.clone().sub(this.pose.rootPosition));time+=j*this.meta.sequenceWindow/(this.meta.sequenceLength-1);}
        s.velocity.copy(total.divideScalar(time)).lerp(this.sequence!.frames[i].rootVelocity??new THREE.Vector3(),0.25);
      });
    }
  }
  needsPrediction() {return !this.sequence||this.predictedAt===0||this.time-this.predictedAt>1/this.meta.predictionFps;}
  features(control:MotionControl) {return assembleFeatures(this.pose,this.corrected,this.meta.guidances[control.velocity.length()<0.1?'Idle':control.style]??this.meta.guidances.Neutral,this.meta.models.locomotion_biped.inputDim);}
  publish(sequence:BipedSequence) {
    this.previous=this.sequence??sequence;this.sequence=sequence;this.predictedAt=this.time;
  }
  animate(dt:number) {
    if(!this.sequence||!this.previous) return this.pose;
    const length=(points:THREE.Vector3[])=>points.slice(1).reduce((sum,v,i)=>sum+v.distanceTo(points[i]),0);
    const required=(this.pose.rootPosition.distanceTo(this.planner.samples[0].position)+length(this.planner.samples.map(s=>s.position)))/this.meta.sequenceWindow;
    const predicted=length(this.sequence.frames.map(s=>s.rootPosition))/this.meta.sequenceWindow;
    const moving=required>0.1&&predicted>0.1,smooth=1-Math.exp(-dt*5);
    const interpolate=(a:number,b:number)=>{const value=THREE.MathUtils.lerp(a,b,smooth);return Math.abs(value-b)<0.01?b:value;};
    this.timescale=THREE.MathUtils.clamp(interpolate(this.timescale,moving?required/predicted:1),1,1.5);
    this.synchronization=interpolate(this.synchronization,moving?1:0);
    const sdt=dt*this.timescale,blend=(this.time-this.predictedAt)*this.meta.predictionFps;
    const next=mixPose(sampleSequence(this.previous,sdt,this.meta.sequenceWindow),sampleSequence(this.sequence,sdt,this.meta.sequenceWindow),blend);
    if(this.sequence.frames.reduce((sum,frame)=>sum+frame.contacts.reduce((a,b)=>a+b,0),0)/(this.meta.sequenceLength*4)>0.75){next.rootPosition.copy(this.pose.rootPosition);next.rootRotation.copy(this.pose.rootRotation);}
    next.positions.forEach((p,i)=>p.lerp(this.pose.positions[i].clone().addScaledVector(next.velocities[i],sdt),0.5));
    this.ik.restore(next);this.ik.solve(next);this.pose=next;
    // Preserve upstream semantics, including the first sequence being aliased.
    this.previous.startTime-=sdt;this.sequence.startTime-=sdt;
    return this.pose;
  }
  snapshot() {return clonePose(this.pose);}
}
