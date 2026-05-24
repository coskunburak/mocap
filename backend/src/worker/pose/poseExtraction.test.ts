import assert from "node:assert/strict";
import type {
  PerCameraPoseArtifact,
  PerCameraPoseFrame,
} from "../types";
import {
  type PoseDetectorAdapter,
  buildPerCameraPoseArtifact,
  extractPoseFramesForVideo,
  validatePerCameraPoseArtifact,
} from "./poseExtraction";

const sourceVideo: PerCameraPoseArtifact["sourceVideo"] = {
  storageKey: "takes/take_123/original/device_0.mov",
  normalizedStorageKey: "takes/take_123/jobs/job_123/normalized/device_0.mp4",
  fps: 30,
  width: 1280,
  height: 720,
  durationMs: 100,
};

const fixtureAdapter: PoseDetectorAdapter = {
  async extract() {
    return {
      detector: {
        name: "fixture_pose_detector",
        version: "fixture_v1",
        landmarkSchema: "body_33",
      },
      expectedFrameCount: 4,
      frames: [
        {
          frameIndex: 0,
          keypoints2d: [
            { x: 0.5, y: 0.25 },
            { x: 0.4, y: 0.75 },
          ],
          confidence: [0.9, 0.8],
        },
        {
          frameIndex: 2,
          timestampMs: 66,
          keypoints2d: [
            { x: 0.52, y: 0.27 },
            { x: 0.42, y: 0.77 },
          ],
          confidence: [0.2, 0.2],
          poseConfidence: 0.2,
        },
        {
          frameIndex: 3,
          keypoints2d: [
            { x: 0.53, y: 0.28 },
            { x: 0.43, y: 0.78 },
          ],
          confidence: [0.7, 0.7],
        },
      ],
    };
  },
};

async function testSingleCameraArtifactBuild() {
  const artifact = await extractPoseFramesForVideo(
    {
      takeId: "take_123",
      jobId: "job_123",
      deviceIndex: 0,
      deviceRole: "primary",
      sourceVideo,
      lowConfidenceThreshold: 0.4,
    },
    fixtureAdapter,
  );

  assert.equal(artifact.schema, "mocap.pose_frames_device.v1");
  assert.equal(artifact.takeId, "take_123");
  assert.equal(artifact.jobId, "job_123");
  assert.equal(artifact.cameraId, "device_0");
  assert.equal(artifact.deviceIndex, 0);
  assert.equal(artifact.deviceRole, "primary");
  assert.deepEqual(artifact.sourceVideo, sourceVideo);
  assert.equal(artifact.detector.name, "fixture_pose_detector");
  assert.equal(artifact.detector.version, "fixture_v1");
  assert.equal(artifact.detector.landmarkSchema, "body_33");
  assert.equal(artifact.frames.length, 3);
  assert.equal(artifact.frames[0].timestampMs, 0);
  assert.equal(artifact.frames[1].timestampMs, 66);
  assert.equal(artifact.frames[2].timestampMs, 100);
  assert.equal(artifact.quality.frameCount, 4);
  assert.equal(artifact.quality.detectedFrameCount, 3);
  assert.equal(artifact.quality.missingFrameCount, 1);
  assert.equal(artifact.quality.lowConfidenceFrameCount, 1);
  assert.ok(artifact.quality.averagePoseConfidence > 0.55);
  assert.ok(artifact.quality.averagePoseConfidence < 0.65);
  assert.deepEqual(validatePerCameraPoseArtifact(artifact), { ok: true });
}

function testBuilderMetadataValidation() {
  const artifact = buildPerCameraPoseArtifact({
    takeId: "take_abc",
    jobId: "job_abc",
    cameraId: "cam_a",
    deviceIndex: 1,
    deviceRole: "secondary",
    sourceVideo: {
      ...sourceVideo,
      storageKey: "takes/take_abc/original/device_1.mov",
      normalizedStorageKey:
        "takes/take_abc/jobs/job_abc/normalized/device_1.mp4",
    },
    detectorResult: {
      detector: {
        name: "fixture_pose_detector",
        version: "fixture_v1",
        landmarkSchema: "custom",
      },
      expectedFrameCount: 1,
      frames: [
        {
          frameIndex: 0,
          timestampMs: 0,
          keypoints2d: [{ x: 0.1, y: 0.2 }],
          confidence: [1],
        },
      ],
    },
  });

  assert.equal(artifact.cameraId, "cam_a");
  assert.equal(artifact.deviceIndex, 1);
  assert.equal(artifact.deviceRole, "secondary");
  assert.equal(artifact.detector.landmarkSchema, "custom");
  assert.deepEqual(validatePerCameraPoseArtifact(artifact), { ok: true });
}

function testInvalidFrameValidation() {
  const invalidFrame: PerCameraPoseFrame = {
    frameIndex: 0,
    timestampMs: 0,
    keypoints2d: [{ x: 0.1, y: Number.NaN }],
    confidence: [0.9, 0.7],
    poseConfidence: 1.2,
    detectorVersion: "fixture_v1",
  };
  const artifact: PerCameraPoseArtifact = {
    schema: "mocap.pose_frames_device.v1",
    takeId: "take_123",
    jobId: "job_123",
    cameraId: "device_0",
    deviceIndex: 0,
    deviceRole: "primary",
    sourceVideo,
    detector: {
      name: "fixture_pose_detector",
      version: "fixture_v1",
      landmarkSchema: "body_33",
    },
    frames: [invalidFrame],
    quality: {
      frameCount: 1,
      detectedFrameCount: 1,
      missingFrameCount: 0,
      lowConfidenceFrameCount: 0,
      averagePoseConfidence: 1.2,
    },
    warnings: [],
  };

  const validation = validatePerCameraPoseArtifact(artifact);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(
      validation.errors.some((error) =>
        error.includes("keypoints2d[0] must be finite"),
      ),
    );
    assert.ok(
      validation.errors.some((error) =>
        error.includes("keypoints2d and confidence lengths must match"),
      ),
    );
  }
}

function testSchemaAndDeviceMetadataValidation() {
  const artifact: PerCameraPoseArtifact = {
    schema: "mocap.pose_frames_device.v1",
    takeId: "",
    jobId: "job_123",
    cameraId: "",
    deviceIndex: -1,
    deviceRole: "",
    sourceVideo: {
      ...sourceVideo,
      normalizedStorageKey: "",
    },
    detector: {
      name: "",
      version: "",
      landmarkSchema: "body_33",
    },
    frames: [],
    quality: {
      frameCount: 0,
      detectedFrameCount: 0,
      missingFrameCount: 0,
      lowConfidenceFrameCount: 0,
      averagePoseConfidence: 0,
    },
    warnings: [],
  };

  const validation = validatePerCameraPoseArtifact(artifact);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.errors.includes("takeId is required"));
    assert.ok(validation.errors.includes("cameraId is required"));
    assert.ok(
      validation.errors.includes("deviceIndex must be a non-negative integer"),
    );
    assert.ok(validation.errors.includes("deviceRole is required"));
    assert.ok(
      validation.errors.includes("sourceVideo.normalizedStorageKey is required"),
    );
    assert.ok(validation.errors.includes("detector.name is required"));
    assert.ok(validation.errors.includes("detector.version is required"));
  }
}

void (async () => {
  await testSingleCameraArtifactBuild();
  testBuilderMetadataValidation();
  testInvalidFrameValidation();
  testSchemaAndDeviceMetadataValidation();
  console.log("pose extraction synthetic tests passed");
})();
