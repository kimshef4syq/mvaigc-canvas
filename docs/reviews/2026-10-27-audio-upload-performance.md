# Audio upload performance fix

Date: 2026-10-27

Reported symptom: importing an MP3 makes the canvas lag even while playback is paused.

## Findings and changes

Desktop file uploads previously returned the entire Base64 data URL in both audio URL fields. AI audio nodes subscribed to the entire canvas node/edge arrays, recreated reference lists on layout changes, and serialized/hashed the inline audio in their render-time input hash. This provides a concrete source of synchronous work unrelated to playback or FLAC decoding.

- Desktop uploads now persist audio using the existing native audio cache and return only a file reference. Browser uploads retain their previous inline representation because native storage is unavailable.
- AI audio nodes subscribe to cached audio/text reference content. Layout, size and selection changes reuse the result. Content, connection and tag changes still invalidate it; unchanged resolved references retain their identity even after unrelated data edits. Existing inline audio remains readable.
- Import failures surface an error dialog. Temporary preview object URLs are released after import finishes.
- Existing saved projects are not automatically migrated; their inline audio remains in saved state/history until replaced or removed through normal editing.

## Verification

- Focused regression tests: 16 passed across upload, reference selector, graph resolver and ComfyUI request tests.
- Selector regression: a connected 8 MiB inline MP3 retains its reference result through 100 layout/selection/size changes. Additional cases cover content edits, undo, connection removal, text inputs and tag disablement.
- Upload regression: desktop node data contains no Base64, persistence errors propagate, and browser uploads remain supported.
- `npm test`: 1312 passed / 2 existing failed; 171 files passed / 9 failed, including the same seven mis-collected node:test files as the previous baseline.
- `npm run build` and `git diff --check`: passed.
- Synthetic measurement using the actual current input-hash function: 10 hashes of an 8 MiB inline source took 340.5 ms; 10 hashes of a local file reference took 0.1 ms. This is a local microbenchmark, not a desktop frame-time measurement.

Desktop acceptance remains: run the updated application, import the same MP3 into a fresh canvas, and compare paused dragging/panning. The user's exact canvas has not been profiled or modified.
