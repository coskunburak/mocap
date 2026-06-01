import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import type { MultiViewOrchestratorSource } from "../reconstruction/multiViewOrchestrator";
import { validatePerCameraPoseArtifact } from "./poseExtraction";
import {
  createRtmposeMmposePoseAdapter,
  parseRtmposeMmposeOutput,
  runRtmposeMmposeCli,
} from "./rtmposeMmposeAdapter";
import {
  checkRtmposeMmposeRuntime,
  rtmposeMmposeRuntimeConfigFromEnv,
} from "./detectorRuntime";

const sources: MultiViewOrchestratorSource[] = [
  {
    cameraId: "device_0",
    deviceId: "phone_a",
    deviceIndex: 0,
    deviceRole: "primary",
    videoStorageKey: "takes/take_pose/original/device_0.mov",
    normalizedStorageKey: "takes/take_pose/jobs/job_pose/normalized/device_0.mp4",
    normalizedPath: "/tmp/mocapexpo/device_0.mp4",
    fps: 30,
    width: 1280,
    height: 720,
    durationMs: 100,
  },
  {
    cameraId: "device_1",
    deviceId: "phone_b",
    deviceIndex: 1,
    deviceRole: "secondary",
    videoStorageKey: "takes/take_pose/original/device_1.mov",
    normalizedStorageKey: "takes/take_pose/jobs/job_pose/normalized/device_1.mp4",
    normalizedPath: "/tmp/mocapexpo/device_1.mp4",
    fps: 30,
    width: 1280,
    height: 720,
    durationMs: 100,
  },
];

const readyRuntime = {
  detector: "rtmpose_mmpose" as const,
  cliPath: "/tmp/rtmpose",
  modelPath: "/tmp/rtmpose-model.pth",
  timeoutMs: 1000,
};

function detectorFixture(deviceIndex: number) {
  return {
    detector: {
      name: "rtmpose_mmpose",
      version: "fixture_coco17",
    },
    detectorSource: "rtmpose_mmpose",
    expectedFrameCount: 3,
    frames: [
      {
        frameIndex: 0,
        timestampMs: 0,
        keypoints: [
          [100 + deviceIndex, 200, 0.95],
          [0, 0, 0],
          [120 + deviceIndex, 220, 0.05],
        ],
      },
      {
        frameIndex: 2,
        timestampMs: 66,
        keypoints: [
          { jointId: "nose", x: 102 + deviceIndex, y: 202, confidence: 0.9 },
          { jointId: "left_eye", x: null, y: 203, confidence: 0.8 },
          { jointId: "left_shoulder", x: 122 + deviceIndex, y: 222, confidence: 0.4 },
        ],
      },
    ],
  };
}

function testParseRtmposeMmposeOutputPreservesDetectorData() {
  const parsed = parseRtmposeMmposeOutput(detectorFixture(0));

  assert.equal(parsed.detector.name, "rtmpose_mmpose");
  assert.equal(parsed.detector.version, "fixture_coco17");
  assert.equal(parsed.detector.landmarkSchema, "custom");
  assert.equal(parsed.detectorSource, "rtmpose_mmpose");
  assert.equal(parsed.expectedFrameCount, 3);
  assert.equal(parsed.frames.length, 2);
  assert.equal(parsed.frames[0].frameIndex, 0);
  assert.equal(parsed.frames[0].timestampMs, 0);
  const firstFrameKeypoints = parsed.frames[0].keypoints ?? [];
  assert.equal(firstFrameKeypoints.length, 2);
  assert.equal(firstFrameKeypoints[0]?.jointId, "nose");
  assert.equal(firstFrameKeypoints[0]?.confidence, 0.95);
  assert.equal(firstFrameKeypoints[1]?.jointId, "right_eye");
  assert.equal(firstFrameKeypoints[1]?.confidence, 0.05);
  assert.equal(
    firstFrameKeypoints.some((keypoint) =>
      keypoint ? keypoint.x === 0 && keypoint.y === 0 : false,
    ),
    false,
  );
  assert.equal(parsed.frames[1].keypoints?.length, 2);
}

async function testAdapterProducesPerCameraPoseArtifactsFromFixtureOutput() {
  const adapter = createRtmposeMmposePoseAdapter({
    runtime: readyRuntime,
    runtimeChecker: async () => ({ status: "ready", warnings: [] }),
    cliRunner: async (input) => detectorFixture(input.source.deviceIndex),
  });

  const artifacts = await adapter.extractPoseArtifacts({
    takeId: "take_pose",
    jobId: "job_pose",
    processedSources: sources,
  });

  assert.equal(artifacts.length, 2);
  assert.equal(artifacts[0].cameraId, "device_0");
  assert.equal(artifacts[0].detectorSource, "rtmpose_mmpose");
  assert.equal(artifacts[0].frames[0].keypoints?.[0].confidence, 0.95);
  assert.equal(artifacts[0].frames[0].keypoints?.[1].confidence, 0.05);
  assert.equal(artifacts[0].quality.detectedFrameCount, 2);
  assert.equal(artifacts[1].cameraId, "device_1");
  assert.equal(artifacts[1].frames[0].keypoints?.[0].x, 101);
  assert.deepEqual(validatePerCameraPoseArtifact(artifacts[0]), { ok: true });
  assert.deepEqual(validatePerCameraPoseArtifact(artifacts[1]), { ok: true });
}

async function testMissingRuntimeReturnsMissingPoseFramesArtifacts() {
  const adapter = createRtmposeMmposePoseAdapter({
    runtime: readyRuntime,
    runtimeChecker: async () => ({
      status: "missing_runtime",
      reason: "RTMPose/MMPose runtime is not configured.",
      warnings: ["MOCAPEXPO_RTMPOSE_CLI_PATH is missing."],
    }),
  });

  const artifacts = await adapter.extractPoseArtifacts({
    takeId: "take_pose",
    jobId: "job_pose",
    processedSources: sources,
  });

  assert.equal(artifacts.length, 2);
  for (const artifact of artifacts) {
    assert.equal(artifact.status, "missing_pose_frames");
    assert.equal(artifact.detectorSource, "rtmpose_mmpose");
    assert.match(artifact.reason ?? "", /runtime is not configured/);
    assert.equal(artifact.frames.length, 0);
    assert.equal(artifact.quality.detectedFrameCount, 0);
    assert.ok(artifact.warnings.includes("missing_pose_frames"));
    assert.ok(artifact.warnings.includes("pose_detector_unavailable"));
    assert.deepEqual(validatePerCameraPoseArtifact(artifact), { ok: true });
  }
}

async function testOneCameraFailureDoesNotDiscardSuccessfulCameraArtifact() {
  const adapter = createRtmposeMmposePoseAdapter({
    runtime: readyRuntime,
    runtimeChecker: async () => ({ status: "ready", warnings: [] }),
    cliRunner: async (input) => {
      if (input.source.deviceIndex === 1) {
        throw new Error("fixture detector failed for device_1");
      }
      return detectorFixture(input.source.deviceIndex);
    },
  });

  const artifacts = await adapter.extractPoseArtifacts({
    takeId: "take_pose",
    jobId: "job_pose",
    processedSources: sources,
  });

  assert.equal(artifacts[0].status, "ready");
  assert.equal(artifacts[0].quality.detectedFrameCount, 2);
  assert.equal(artifacts[1].status, "missing_pose_frames");
  assert.match(artifacts[1].reason ?? "", /device_1/);
}

async function testRuntimeConfigAndMissingModelChecks() {
  const runtime = rtmposeMmposeRuntimeConfigFromEnv({
    MOCAPEXPO_POSE_DETECTOR: "rtmpose_mmpose",
    MOCAPEXPO_RTMPOSE_CLI_PATH: "/definitely/missing/rtmpose",
    MOCAPEXPO_RTMPOSE_MODEL_PATH: "/definitely/missing/model.pth",
  });

  assert.equal(runtime.detector, "rtmpose_mmpose");
  const runtimeCheck = await checkRtmposeMmposeRuntime(runtime);
  assert.equal(runtimeCheck.status, "missing_runtime");

  const disabled = rtmposeMmposeRuntimeConfigFromEnv({});
  assert.equal(disabled.detector, "disabled");
}

async function testCliWrapperReadsStructuredJsonOutputFile() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mocapexpo-rtmpose-test-"));
  const cliPath = path.join(tmpDir, "fixture-rtmpose-cli.js");
  const modelPath = path.join(tmpDir, "model.pth");
  await writeFile(modelPath, "fixture model");
  await writeFile(
    cliPath,
    `#!/usr/bin/env node
const fs = require("fs");
const outputIndex = process.argv.indexOf("--output");
const outputPath = process.argv[outputIndex + 1];
fs.writeFileSync(outputPath, JSON.stringify({
  detector: { name: "rtmpose_mmpose", version: "fixture_cli" },
  frames: [{ frameIndex: 0, timestampMs: 0, keypoints: [[10, 20, 0.8]] }]
}));
`,
  );
  await chmod(cliPath, 0o755);

  const output = await runRtmposeMmposeCli({
    takeId: "take_pose",
    jobId: "job_pose",
    source: sources[0],
    outputJsonPath: path.join(tmpDir, "pose_frames.json"),
    runtime: {
      detector: "rtmpose_mmpose",
      cliPath,
      modelPath,
      timeoutMs: 1000,
    },
  });
  const parsed = parseRtmposeMmposeOutput(output);

  assert.equal(parsed.detector.version, "fixture_cli");
  assert.equal(parsed.frames[0].keypoints?.[0]?.confidence, 0.8);
}

void (async () => {
  testParseRtmposeMmposeOutputPreservesDetectorData();
  await testAdapterProducesPerCameraPoseArtifactsFromFixtureOutput();
  await testMissingRuntimeReturnsMissingPoseFramesArtifacts();
  await testOneCameraFailureDoesNotDiscardSuccessfulCameraArtifact();
  await testRuntimeConfigAndMissingModelChecks();
  await testCliWrapperReadsStructuredJsonOutputFile();
  console.log("rtmpose/mmpose adapter tests passed");
})();
