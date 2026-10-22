"""Execute the pinned, unmodified Python demo with injected controls; export motion assets and multi-frame truth."""
import argparse, gzip, hashlib, json, os, sys
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import torch

PINNED = 'bfb5866681f7ea6dac9984be05181de5955eb48b'

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--source',type=Path,required=True); args=parser.parse_args()
    source=args.source.resolve(); sys.path.insert(0,str(source))
    import subprocess
    assert subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()==PINNED
    from ai4animation import AI4Animation, Time, Transform, Quaternion, Actor
    from ai4animation.Entity import Entity
    Entity.Standalone=lambda self: None
    Actor.Standalone=lambda self: None
    torch.set_num_threads(1)
    load=torch.load
    torch.load=lambda *a,**kw: load(*a,**dict(kw,map_location="cpu"))
    out=Path('public/models/ai4animation/motions'); out.mkdir(parents=True,exist_ok=True)
    motions=[]
    labels={'walk3_subject3':'走路','run1_subject2':'跑步','sprint1_subject4':'冲刺','aiming1_subject1':'瞄准','ground1_subject1':'地面动作'}
    for path in sorted((source/'Demos/_ASSETS_/Geno/Motions').glob('*.npz')):
        with np.load(path,allow_pickle=True) as d:
            # Original NPZ stores actor-world position and xyzw, already in meters/Y-up.
            values=np.concatenate([d['positions'],d['quaternions']],axis=-1).astype('<f4')
            binary=values.tobytes(); (out/(path.stem+'.bin')).write_bytes(binary)
            motions.append(dict(id=path.stem,label=labels[path.stem],file=path.stem+'.bin',fps=float(d['framerate']),frameCount=len(values),duration=(len(values)-1)/float(d['framerate']),jointNames=d['bone_names'].tolist(),sha256=hashlib.sha256(binary).hexdigest(),sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    (out/'manifest.json').write_text(json.dumps(dict(schemaVersion=1,upstreamRevision=PINNED,format='float32-le, frame/joint/xyz-xyzw, actor-world',motions=motions),ensure_ascii=False,indent=2))
    biped=source/'Demos/Locomotion/Biped'; sys.path.insert(0,str(biped)); os.chdir(biped)
    from Program import Program
    reference=Path(__file__).resolve().parent/'fixtures/continuous'; reference.mkdir(exist_ok=True)
    cases=[]
    for style in sorted(p.stem for p in (biped/'Guidances').glob('*.npz')):
        AI4Animation(object(),mode=AI4Animation.Mode.MANUAL)
        state=dict(velocity=[0,0,0],direction=[0,0,0],sprint=False)
        io=SimpleNamespace(LogErrorIfGamepadNotAvailable=lambda:None,GamepadAvailable=lambda:True,GetLeftStick=lambda:[state['velocity'][0],-state['velocity'][2]],GetRightStick=lambda:[state['direction'][0],-state['direction'][2]],IsLeftStickPressed=lambda:state['sprint'],IsL1Pressed=lambda:False,IsR1Pressed=lambda:False)
        AI4Animation.Standalone=SimpleNamespace(Camera=SimpleNamespace(SetTarget=lambda _:None),IO=io)
        Time.TotalTime=0.; Time.DeltaTime=1/60
        p=Program(); p.Start(); p._set_guidance(p.GuidanceNames.index(style)); frames=[]; predictions=[]
        original_predict=p.Predict
        def predict():
            original_predict()
            predictions.append(dict(frame=len(frames),positions=p.Sequence.Motion.GetPositions().tolist(),rotations=Transform.GetRotation(p.Sequence.Motion.Transforms).tolist(),roots=p.Sequence.Trajectory.Transforms.tolist(),velocities=p.Sequence.Motion.Velocities.tolist(),rootVelocities=p.Sequence.Trajectory.Velocities.tolist(),contacts=p.Sequence.Contacts.tolist()))
        p.Predict=predict
        for frame in range(600):
            # idle -> walk -> sprint -> turn -> backward -> stop, 10 seconds.
            v=[0,0,0] if frame<60 or frame>=540 else [0,0,1] if frame<300 else [0.6,0,0.8] if frame<420 else [0,0,-1]
            d=[1,0,0] if 300<=frame<420 else [0,0,0]
            state.update(velocity=v,direction=d,sprint=180<=frame<300)
            Time.TotalTime+=1/60; p.Update()
            values=np.concatenate([Transform.GetPosition(p.Actor.Root).flatten(),Quaternion.FromMatrix(Transform.GetRotation(p.Actor.Root)).flatten(),p.Actor.GetPositions().flatten(),p.Actor.GetRotations().flatten(),p.Actor.GetVelocities().flatten()])
            frames.append(values)
        np.array(frames,dtype='<f4').tofile(reference/(style+'.bin'))
        # One injection case isolates controller math from divergent neural feedback.
        if style=='Neutral': (reference/'Neutral-predictions.json.gz').write_bytes(gzip.compress(json.dumps(predictions,separators=(',',':')).encode(),mtime=0))
        cases.append(dict(style=style,file=style+'.bin',frames=600,stride=len(frames[0]),predictionFrames=[x['frame'] for x in predictions]))
        print(style,len(predictions),flush=True)
    (reference/'manifest.json').write_text(json.dumps(dict(upstreamRevision=PINNED,fps=60,cases=cases),indent=2))

if __name__=='__main__': main()
