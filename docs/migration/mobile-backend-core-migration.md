# Mobile Backend-Core Migration

## Production Path

1. Start native preview and pose quality stream.
2. Start native video recording.
3. Accumulate capture quality metrics from pose preview frames.
4. Stop recording and receive local video metadata.
5. Build `mocap.capture.v1` metadata.
6. Create or use a backend take.
7. Request signed upload URLs.
8. Upload video and metadata.
9. Mark upload complete.
10. Create processing job and show backend status.

## Debug/Reference Path

Local pose-frame recording and local mobile exports stay available only for debugging and golden output comparisons. They must not be presented as production export quality once backend processing is enabled.

## Feature Flags

| Flag | Behavior |
| --- | --- |
| `EXPO_PUBLIC_MOCAP_LOCAL_FRAME_RECORDING=debug` | Writes local pose JSONL chunks during recording. |
| unset | Production default: records video + metadata only. |

