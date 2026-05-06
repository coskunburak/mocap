# Local Export Debug Decision

Local export code is retained as a reference implementation:

- `TakeExporter`
- `BVHWriter`
- `AnimationBake`
- `GltfWriter`
- `FbxWriter`
- `UsdWriter`
- cleanup and retarget modules

This code is not removed because it is valuable for:

1. Backend worker parity tests.
2. Golden sample comparisons.
3. Debugging coordinate conversion and skeleton hierarchy regressions.
4. Offline development without backend availability.

Production result UX must list backend `ExportFile` records. Local export controls should be placed behind a debug/dev affordance.

