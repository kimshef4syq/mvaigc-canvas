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

test('outputFormat is accepted but never sent, because mvaigc picks the format', () => {
  // outputFormat is a REQUIRED nano-banana port: refusing it would make the
  // whole capability unreachable. mvaigc has no such field and ignores unknown
  // ones, so the port is accepted and simply not forwarded — the format is
  // mvaigc's choice, and the returned image is still correct.
  const { body } = buildImagePayload({ prompt: '猫', referenceImages: [], outputFormat: 'jpg' });
  assert.equal(body.output_format, undefined);
  assert.equal(body.outputFormat, undefined);
});

test('an authored resolution is accepted but the request always asks for 2K', () => {
  for (const tier of ['1K', '2K', '4K']) {
    const { body } = buildImagePayload({ prompt: '猫', referenceImages: [], resolution: tier });
    assert.equal(body.resolution, '2K', `${tier} must be overwritten to 2K`);
  }
});
