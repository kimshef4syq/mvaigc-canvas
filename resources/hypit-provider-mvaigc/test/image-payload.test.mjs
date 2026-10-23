import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImagePayload } from '../dist/provider.js';

test('maps image ports and always sends 2K', () => {
  const { model, body } = buildImagePayload({ prompt: '一只猫',
    aspectRatio: '16:9', referenceImages: ['data:image/png;base64,AAA'] });
  assert.equal(model, 'Nano-Banana-Pro');
  assert.equal(body.prompt, '一只猫');
  assert.equal(body.aspect_ratio, '16:9');
  assert.equal(body.resolution, '2K', 'image resolution is fixed at 2K');
  assert.deepEqual(body.reference_images, ['data:image/png;base64,AAA']);
});

test('outputFormat is refused rather than silently dropped', () => {
  // mvaigc has no outputFormat field; Hypit's rule is to refuse, not discard.
  assert.throws(() => buildImagePayload({ prompt: '猫', referenceImages: [], outputFormat: 'jpg' }),
    /outputFormat/i);
});
