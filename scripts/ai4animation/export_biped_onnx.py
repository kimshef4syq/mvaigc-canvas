"""Export the official deterministic biped controller. Python is build-time only.

Usage: python export_biped_onnx.py --source /path/to/ai4animationpy
Only load checkpoints from the pinned, trusted upstream repository (pickle).
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch

PINNED_REVISION = 'bfb5866681f7ea6dac9984be05181de5955eb48b'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/models/ai4animation'))
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != PINNED_REVISION:
        raise RuntimeError(f'Expected upstream {PINNED_REVISION}, got {revision}')
    sys.path.insert(0, str(source))
    from ai4animation import AI4Animation, Actor, Transform, Vector3, Tensor, Rotation, RootModule, TimeSeries, FeedTensor, ReadTensor
    definitions = {}
    exec((source / 'Demos/_ASSETS_/Geno/Definitions.py').read_text(), definitions)
    names = definitions['FULL_BODY_NAMES']
    AI4Animation(object(), mode=AI4Animation.Mode.MANUAL)
    actor = AI4Animation.Scene.AddEntity('Actor').AddComponent(Actor, str(source / 'Demos/_ASSETS_/Geno/Model.glb'), names, True)
    rest = actor.GetTransforms().copy()
    output.mkdir(parents=True, exist_ok=True)
    biped = source / 'Demos/Locomotion/Biped'
    torch.set_num_threads(1)
    torch.manual_seed(42)

    class DeterministicBiped(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, features):
            return self.model(features, iterations=3, sample=False)

    class Contacts(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, features):
            return self.model(features)

    reports, fixtures, dimensions = {}, {}, {}
    for label, checkpoint in [('locomotion_biped', biped / 'Models/Network.pt'), ('contacts_biped', biped / 'Models/PostProcessor.pt')]:
        model = torch.load(checkpoint, map_location='cpu', weights_only=False).eval()
        wrapper = DeterministicBiped(model).eval() if label == 'locomotion_biped' else Contacts(model).eval()
        dimension = model.input_dim()
        x = torch.zeros(1, dimension)
        path = output / f'{label}.onnx'
        torch.onnx.export(wrapper, x, path, input_names=['features'], output_names=['prediction'], opset_version=17, dynamo=False)
        onnx.checker.check_model(onnx.load(path))
        session = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
        max_error = 0.0
        cases = []
        for i in range(4):
            x = torch.randn(1, dimension) * (0.05 if i else 0)
            with torch.no_grad():
                expected = wrapper(x).numpy()
            actual = session.run(None, {'features': x.numpy()})[0]
            np.testing.assert_allclose(actual, expected, atol=1e-4, rtol=1e-4)
            max_error = max(max_error, float(np.max(np.abs(actual - expected))))
            cases.append({'input': x.flatten().tolist(), 'output': expected.flatten().tolist()})
        dimensions[label] = {'inputDim': dimension, 'outputDim': expected.size}
        fixtures[label] = cases
        reports[label] = {'maxAbsoluteError': max_error, 'bytes': path.stat().st_size, 'cases': len(cases)}

    guidances = {}
    for path in sorted((biped / 'Guidances').glob('*.npz')):
        with np.load(path, allow_pickle=True) as data:
            index = {str(name): i for i, name in enumerate(data['Names'])}
            guidances[path.stem] = [data['Positions'][index[name]].tolist() for name in names]
    meta = {
        'schemaVersion': 1, 'upstreamRevision': revision,
        'normalization': 'embedded', 'sequenceLength': 16, 'sequenceWindow': 0.5,
        'predictionFps': 10, 'sequenceFps': 30, 'iterations': 3,
        'jointNames': names, 'parentIndices': actor.GetParentIndices(),
        'restPositions': Transform.GetPosition(rest).tolist(),
        'restMatrices': rest.tolist(),
        'zeroMatrices': [bone.ZeroTransform.tolist() for bone in actor.Bones],
        'contactIndices': actor.GetBoneIndices(['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase']),
        'guidances': guidances, 'models': dimensions,
        'coordinateSystem': 'right-handed, Y-up, Z-forward, meters; root delta yaw in degrees',
    }
    def serializable(value):
        if isinstance(value, np.ndarray):
            return value.tolist()
        if isinstance(value, np.generic):
            return value.item()
        raise TypeError(type(value))
    (output / 'locomotion_biped_meta.json').write_text(json.dumps(meta, default=serializable))
    for character in ['Geno', 'Cranberry']:
        shutil.copyfile(source / f'Demos/_ASSETS_/{character}/Model.glb', output / f'{character.lower()}.glb')
        shutil.copyfile(source / f'Demos/_ASSETS_/{character}/Definitions.py', output / f'{character.lower()}_definitions.py')
    shutil.copyfile(source / 'LICENSE', output / 'LICENSE.txt')
    manifest = {'repository': 'https://github.com/facebookresearch/ai4animationpy', 'revision': revision, 'license': 'CC-BY-NC-4.0', 'modified': 'ONNX export and guidance serialization; GLB assets unchanged', 'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in output.iterdir() if p.is_file() and p.name != 'manifest.json'}}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    fixture_dir = Path(__file__).parent / 'fixtures'
    fixture_dir.mkdir(exist_ok=True)
    (fixture_dir / 'network-parity.json').write_text(json.dumps(fixtures))
    # Golden feature ordering, world-space decoding and foot IK from upstream.
    series = RootModule.Series(TimeSeries(0.0, 0.5, 16))
    for _ in range(12):
        series.Control(series.GetPosition(0), Vector3.Create(0.3, 0, 1), Vector3.Create(0.3, 0, 1), 1 / 60)
    feed = FeedTensor('X', dimensions['locomotion_biped']['inputDim'])
    feed.Feed(Transform.GetPosition(rest))
    feed.Feed(Transform.GetAxisZ(rest))
    feed.Feed(Transform.GetAxisY(rest))
    feed.Feed(actor.GetVelocities())
    feed.FeedVector3(Transform.GetPosition(series.Transforms), x=True, y=False, z=True)
    feed.FeedVector3(Transform.GetAxisZ(series.Transforms), x=True, y=False, z=True)
    feed.FeedVector3(series.Velocities, x=True, y=False, z=True)
    feed.Feed(np.array(guidances['Neutral']))
    network = torch.load(biped / 'Models/Network.pt', map_location='cpu', weights_only=False).eval()
    with torch.no_grad():
        prediction = network(feed.GetTensor().reshape(1, -1), iterations=3, sample=False).numpy()
    reader = ReadTensor('Y', prediction.reshape(16, -1))
    vectors = reader.ReadVector3()
    delta = np.zeros_like(vectors)
    for i in range(1, 16):
        delta[i] = delta[i - 1] + vectors[i]
    roots = Transform.DeltaXZ(delta)
    motions = Transform.TransformationFrom(Transform.TR(reader.ReadVector3(23), reader.ReadRotation3D(23)), roots.reshape(16, 1, 4, 4))
    velocities = Vector3.DirectionFrom(reader.ReadVector3(23), roots.reshape(16, 1, 4, 4))
    contact_indices = actor.GetBoneIndices(['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase'])
    contact_features = np.concatenate([
        feed.Data[:276],
        Vector3.Distance(Transform.GetPosition(rest[contact_indices]), Transform.GetPosition(motions[1:, contact_indices])).flatten(),
        Rotation.Angle(rest[contact_indices], motions[1:, contact_indices]).flatten(),
        Vector3.Distance(np.zeros((4, 3)), velocities[1:, contact_indices]).flatten(),
    ])
    sys.path.insert(0, str(biped))
    from LegIK import LegIK
    from ai4animation import FABRIK
    left = LegIK(FABRIK(actor.GetBone('LeftUpLeg'), actor.GetBone('LeftFoot')), FABRIK(actor.GetBone('LeftFoot'), actor.GetBone('LeftToeBase')))
    right = LegIK(FABRIK(actor.GetBone('RightUpLeg'), actor.GetBone('RightFoot')), FABRIK(actor.GetBone('RightFoot'), actor.GetBone('RightToeBase')))
    actor.SetTransforms(motions[1].copy())
    actor.RestoreBoneLengths()
    actor.RestoreBoneAlignments()
    restored_positions = actor.GetPositions().copy()
    restored_matrices = actor.GetTransforms().copy()
    left.Solve(0.8, 0.6, 1, 1e-3, Vector3.PositionFrom(Vector3.Create(0, 0, 1), actor.GetBone('LeftLeg').GetTransform()), 1)
    right.Solve(0.7, 0.4, 1, 1e-3, Vector3.PositionFrom(Vector3.Create(0, 0, 1), actor.GetBone('RightLeg').GetTransform()), 1)
    golden = {'contactFeatures': contact_features.tolist(), 'features': feed.Data.tolist(), 'trajectoryMatrices': series.Transforms.tolist(), 'trajectoryVelocities': series.Velocities.tolist(), 'prediction': prediction.flatten().tolist(), 'rootMatrices': roots.tolist(), 'motionMatrices': motions.tolist(), 'velocities': velocities.tolist(), 'ikPositions': actor.GetPositions().tolist(), 'restoredPositions': restored_positions.tolist(), 'restoredMatrices': restored_matrices.tolist()}
    (fixture_dir / 'controller-reference.json').write_text(json.dumps(golden, default=serializable))
    (fixture_dir / 'export-report.json').write_text(json.dumps(reports, indent=2))
    print(json.dumps(reports, indent=2))


if __name__ == '__main__':
    main()
