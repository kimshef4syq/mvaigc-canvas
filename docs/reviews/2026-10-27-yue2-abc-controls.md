# YuE2 ABC controls validation

Date: 2026-10-27

Implemented boolean bindings and optional text overrides for ComfyUI audio nodes. YuE2 text2music imports detect the ABC planning switch by graph connections and expose a custom ABC field on the music generator. Explicit existing text bindings retain precedence and can use the complete example in docs/settings/examples/yue2-text2music-abc-bindings.json.

- New binding fields: `booleans` (`nodeId`, `input`, optional `label` / boolean `defaultValue`) and text `preserveWhenEmpty`.
- New node data: `audioBooleanValues`. New request channel: `extra_params.booleanSlotValues`. Existing text controls and builtin TTS routing are retained.
- Blank optional score retains the original branch. Nonblank score directly overrides the generator's ABC input. The boolean controls the original planning branch independently; turn it off when supplying a custom score to avoid unnecessary planning work.
- Linked boolean inputs fall back to false unless an explicit default is configured. String boolean values are rejected. Invalid boolean mappings stay inside the catalog not-ready path.

Verification:

- Focused tests: 81 passed across gateway, request assembly, catalog and workbench suites.
- Full frontend tests: 1323 passed / 2 existing failed; same nine failed files as baseline, including seven mis-collected node:test files. No new failures.
- `npm run build`: passed. `git diff --check`: passed.
- Actual user text2music API JSON was exercised through workbench import, configuration conversion, catalog derivation, request assembly and workflow preparation. Automatic and explicit example mappings passed all four combinations of planning enabled/disabled and custom score provided/blank. Source JSON remained unchanged.
- Actual ComfyUI generation and desktop interaction remain unverified. The local 8188 service refused connection (curl exit 7).
