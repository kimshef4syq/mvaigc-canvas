"""CPU skinning truth from the original Python Actor/SkinnedMesh.Update matrices."""
import sys,json
from pathlib import Path
import numpy as np
source=Path(sys.argv[1]).resolve();sys.path.insert(0,str(source))
from ai4animation import AI4Animation,Actor,Motion,Transform
AI4Animation(object(),mode=AI4Animation.Mode.MANUAL)
definitions={};exec((source/'Demos/_ASSETS_/Geno/Definitions.py').read_text(),definitions)
actor=AI4Animation.Scene.AddEntity('Actor').AddComponent(Actor,str(source/'Demos/_ASSETS_/Geno/Model.glb'),definitions['FULL_BODY_NAMES'],True)
model=actor.Model; mesh=model.Meshes[0];bind=np.transpose(np.array(model.Skin.Inverse_bind_matrices),axes=(0,2,1))
# Same joint-to-scene mapping as SkinnedMesh, vertex order follows the shipped GLB.
indices=[actor.NameToEntity[name].Index for name in model.JointNames]
vertex_indices=list(range(0,mesh.VertexCount,47));reference=[];full=[]
for path in sorted((source/'Demos/_ASSETS_/Geno/Motions').glob('*.npz')):
 motion=Motion.LoadFromNPZ(str(path))
 for time in [0.,motion.TotalTime*.25,motion.TotalTime*.5,motion.TotalTime*.75,motion.TotalTime]:
  actor.SetTransforms(motion.GetBoneTransformations(timestamps=time,bone_names_or_indices=actor.GetBoneNames()));actor.SyncToScene()
  transforms=AI4Animation.Scene.Transforms[indices];scales=AI4Animation.Scene.Scales[indices]
  matrices=Transform.TRS(Transform.GetPosition(transforms),Transform.GetRotation(transforms),scales)@bind
  vertices=mesh.Vertices;verts4=np.concatenate([vertices,np.ones((len(vertices),1))],axis=-1)
  ids=mesh.SkinIndices[:,:4];weights=mesh.SkinWeights[:,:4]
  transformed=np.einsum('vbij,vj->vbi',matrices[ids],verts4)
  skin=(transformed*weights[:,:,None]).sum(axis=1)[:,:3]
  full.append(skin);reference.append(dict(motion=path.stem,time=time,vertices=skin[vertex_indices].tolist(),positions=actor.GetPositions().tolist()))
Path('scripts/ai4animation/fixtures/skin-reference.json').write_text(json.dumps(dict(vertexIndices=vertex_indices,cases=reference),separators=(',',':')))
np.asarray(full,dtype='<f4').tofile('scripts/ai4animation/fixtures/skin-vertices.bin')
print(len(reference),len(vertex_indices))
