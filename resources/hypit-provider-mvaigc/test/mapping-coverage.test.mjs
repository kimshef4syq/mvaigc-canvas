import test from 'node:test';
import assert from 'node:assert/strict';
import { imageMapping, videoMapping, IMAGE_PORTS, VIDEO_PORTS } from '../dist/provider.js';

// Hypit rejects a whole mapping when it does not cover the Model's port table
// ("mapping does not cover port X") or when it names a port the Model does not
// declare ("mapping names undeclared port X"). Both were real bugs here.

test('image mapping covers exactly the nano-banana-pro ports', () => {
  const declared = Object.keys(imageMapping.fields).sort();
  assert.deepEqual(declared, [...IMAGE_PORTS].sort());
});

test('video mapping covers exactly the minimax-h3 ports', () => {
  const declared = Object.keys(videoMapping.fields).sort();
  assert.deepEqual(declared, [...VIDEO_PORTS].sort());
});

test('a single-value port is not mapped as an array and vice versa', () => {
  // Hypit asserts: maxItems > 1 must use valueArray/urlArray; maxItems === 1
  // may use url, value or string.
  const singleValuePorts = ['prompt', 'duration', 'resolution', 'aspectRatio'];
  for (const name of singleValuePorts) {
    const field = videoMapping.fields[name];
    assert.ok(['value', 'string'].includes(field.as), `${name} must be a scalar mapping, got ${field.as}`);
  }
  for (const name of ['firstFrame', 'lastFrame']) {
    assert.equal(videoMapping.fields[name].as, 'url', `${name} accepts one item, so it maps as url`);
  }
  for (const name of ['referenceImage', 'referenceVideo', 'referenceAudio']) {
    assert.equal(videoMapping.fields[name].as, 'urlArray', `${name} accepts several items`);
  }
});

test('no two ports write the same wire field', () => {
  for (const mapping of [imageMapping, videoMapping]) {
    const emitted = Object.values(mapping.fields).map((field) => field.field);
    assert.equal(new Set(emitted).size, emitted.length, 'two ports must not write one wire field');
  }
});
