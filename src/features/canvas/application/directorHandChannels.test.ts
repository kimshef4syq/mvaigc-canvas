import { describe, expect, it } from 'vitest';
import { createEmptyDirectorMotionProject, normalizeDirectorMotionProject, sampleDirectorMotion } from './directorMotion';
import { normalizeHandPose } from '../domain/directorHandPose';
import { parseBlueprintPoseJson } from '../ui/blueprintPosePromptUtils';

describe('persisted hand channels', () => {
  it('normalizes finger values without accepting unknown or nonfinite fields', () => {
    expect(normalizeHandPose({thumb:2,index:-1,middle:NaN,spread:-5,thumbOpposition:0.5,other:1})).toEqual({thumb:1,index:0,spread:-1,thumbOpposition:0.5});
    expect(normalizeHandPose({other:1})).toBeUndefined();
  });
  it('round trips wrist/finger keyframes and interpolates them in saved custom clips', () => {
    const project=normalizeDirectorMotionProject(JSON.parse(JSON.stringify({
      ...createEmptyDirectorMotionProject(),
      customClips:[{id:'hands',name:'hands',durationSeconds:2,loop:false,keyframes:[
        {id:'a',time:0,easing:'linear',pose:{rightWrist:{x:0},rightHand:{index:0,spread:-0.2}}},
        {id:'b',time:2,easing:'linear',pose:{rightWrist:{x:0.6},rightHand:{index:1,spread:0.4}}},
      ]}],
      actionTracks:{actor:[{id:'clip',time:0,clipId:'hands'}]},
    })));
    const pose=sampleDirectorMotion(project,1).actions.actor.pose!;
    expect(pose.rightWrist?.x).toBeCloseTo(0.3);
    expect(pose.rightHand?.index).toBeCloseTo(0.5);
    expect(pose.rightHand?.spread).toBeCloseTo(0.1);
    expect(normalizeDirectorMotionProject(project)).toEqual(project);
    const invalid=normalizeDirectorMotionProject({...project,actionTracks:{actor:[{id:'bad',time:0,pose:{rightHand:{index:Infinity,thumb:0.4}}}]}});
    expect(invalid.actionTracks.actor[0].pose?.rightHand).toEqual({thumb:0.4});
  });
  it('imports AI-authored hand-only poses and wrist rotations', () => {
    const parsed=parseBlueprintPoseJson('```json\n{"rightHand":{"index":0,"middle":1,"ring":1,"pinky":1},"rightWrist":{"y":0.4}}\n```');
    expect(parsed.error).toBeUndefined();
    expect(parsed.pose?.rightHand).toEqual({index:0,middle:1,ring:1,pinky:1});
    expect(parsed.pose?.rightWrist).toEqual({y:0.4});
  });
});
