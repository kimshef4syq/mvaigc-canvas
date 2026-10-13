# AI4AnimationPy assets — non-commercial prototype

Source: https://github.com/facebookresearch/ai4animationpy
Authors: Paul Starke, Sebastian Starke; copyright Meta Platforms, Inc. and affiliates.

These upstream assets and adapted animation code are covered by **CC BY-NC 4.0** (`LICENSE.txt`). They are included for the explicitly selected local, non-commercial prototype. The surrounding application's license does not remove the upstream non-commercial restriction.

`manifest.json` records the fixed upstream commit and SHA-256 checksums. Geno and Cranberry GLB files are unchanged. Networks were converted to ONNX without retraining; normalization and deterministic three-iteration inference remain embedded. Guidance templates were serialized to JSON. The TypeScript controller adapts upstream animation math and IK for Three.js.

Rebuild and usage documentation: `docs/animation/ai4animation-port.md`.
