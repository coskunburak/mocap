import assert from "node:assert/strict";
import type {
  CameraCalibrationArtifact,
  Matrix3x3,
  MultiViewReconstructionArtifact,
  MultiViewSyncReport,
  PerCameraPoseArtifact,
  ProjectionMatrix3x4,
  Vector3,
} from "../types";
import {
  type MultiViewArtifactFormat,
  persistMultiViewArtifacts,
  poseArtifactStorageKey,
} from "./multiViewArtifacts";

const TAKE_ID = "take_multiview_artifacts";
const JOB_ID = "job_multiview_artifacts";
const IDENTITY: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const PROJECTION: ProjectionMatrix3x4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const ZERO: Vector3 = [0, 0, 0];

type UploadCall = {
  key: string;
  value: unknown;
};

type ExportCall = {
  jobId: string;
  format: MultiViewArtifactFormat;
  artifactName: string;
  storageKey: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
};

function poseArtifact(deviceIndex: number): PerCameraPoseArtifact {
  return {
    schema: "mocap.pose_frames_device.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    cameraId: `camera_${deviceIndex}`,
    deviceIndex,
    deviceRole: deviceIndex === 0 ? "front" : "right",
    sourceVideo: {
      storageKey: `takes/${TAKE_ID}/original/device_${deviceIndex}.mov`,
      normalizedStorageKey: `takes/${TAKE_ID}/jobs/${JOB_ID}/normalized/device_${deviceIndex}.mp4`,
      fps: 30,
      width: 1280,
      height: 720,
      durationMs: 1000,
    },
    detector: {
      name: "fixture_pose_detector",
      version: "fixture_v1",
      landmarkSchema: "body_33",
    },
    frames: [],
    quality: {
      frameCount: 10,
      detectedFrameCount: 10,
      missingFrameCount: 0,
      lowConfidenceFrameCount: 0,
      averagePoseConfidence: 0.95,
    },
    warnings: [],
  };
}

function syncReport(): MultiViewSyncReport {
  return {
    schema: "mocap.multiview_sync.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    referenceDeviceIndex: 0,
    devices: [0, 1].map((deviceIndex) => ({
      deviceIndex,
      offsetMs: deviceIndex === 0 ? 0 : 11,
      confidence: 0.94,
      method: "video_timestamps",
      matchedFrameCount: 10,
      droppedFrameCount: 1,
      averageTimeDeltaMs: 3.5,
      maxTimeDeltaMs: 7,
    })),
    matchedFrames: [],
    metrics: {
      matchedFrameCount: 10,
      droppedFrameCount: 1,
      averageTimeDeltaMs: 3.5,
      maxTimeDeltaMs: 7,
      syncConfidence: 0.94,
    },
    warnings: [],
  };
}

function cameraCalibration(): CameraCalibrationArtifact {
  return {
    schema: "mocap.camera_calibration.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "metadata_and_fov_fallback",
    intrinsicsSource: "capture_metadata_or_fov",
    devices: [0, 1].map((deviceIndex) => ({
      deviceIndex,
      deviceRole: deviceIndex === 0 ? "front" : "right",
      intrinsic: IDENTITY,
      rotation: IDENTITY,
      translation: ZERO,
      projection: PROJECTION,
      intrinsicsSource:
        deviceIndex === 1 ? "fov_fallback" : "capture_metadata",
    })),
    quality: {
      score: 0.82,
      averageReprojectionErrorPx: 2,
      baseline: 1,
      convergenceAngle: 30,
    },
    warnings: ["camera_intrinsics_fov_fallback_used"],
  };
}

function reconstruction(source: "dual_camera" | "multi_view"): MultiViewReconstructionArtifact {
  return {
    schema: "mocap.multiview_reconstruction.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source,
    frameCount: 0,
    landmarkSchema: "body_33",
    frames: [],
    metrics: {
      syncOffsetMs: 11,
      syncConfidence: 0.94,
      matchedFrameCount: 10,
      droppedFrameCount: 1,
      averageTimeDeltaMs: 3.5,
      reprojectionErrorPx: 2.1,
      reprojectionP95Px: 4.8,
      triangulatedLandmarkRatio: 0.78,
      fallbackLandmarkRatio: 0.22,
      calibrationQualityScore: 0.82,
      intrinsicsFallbackUsed: 1,
      multiViewQualityGain: 0.5,
    },
    warnings: [],
  };
}

function createMocks(input?: {
  failUploadKey?: string;
  failExportArtifactName?: string;
}) {
  const uploadCalls: UploadCall[] = [];
  const exportCalls: ExportCall[] = [];

  return {
    uploadCalls,
    exportCalls,
    storage: {
      async uploadJson(key: string, value: unknown) {
        uploadCalls.push({ key, value });
        if (key === input?.failUploadKey) {
          throw new Error(`upload failed: ${key}`);
        }
        return {
          storageKey: key,
          sizeBytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
        };
      },
    },
    exportsRepository: {
      async createExportFile(record: ExportCall) {
        exportCalls.push(record);
        if (record.artifactName === input?.failExportArtifactName) {
          throw new Error(`export failed: ${record.artifactName}`);
        }
        return record;
      },
    },
  };
}

async function testDualSuccessPersistence() {
  const mocks = createMocks();
  const result = await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    poseArtifacts: [poseArtifact(0), poseArtifact(1)],
    syncReport: syncReport(),
    cameraCalibration: cameraCalibration(),
    reconstruction: reconstruction("dual_camera"),
    storage: mocks.storage,
    exportsRepository: mocks.exportsRepository,
  });

  assert.deepEqual(
    mocks.uploadCalls.map((call) => call.key),
    [
      `takes/${TAKE_ID}/jobs/${JOB_ID}/pose_frames_device_0.json`,
      `takes/${TAKE_ID}/jobs/${JOB_ID}/pose_frames_device_1.json`,
      `takes/${TAKE_ID}/jobs/${JOB_ID}/multi_view_sync.json`,
      `takes/${TAKE_ID}/jobs/${JOB_ID}/camera_calibration.json`,
      `takes/${TAKE_ID}/jobs/${JOB_ID}/dual_reconstruction.json`,
    ],
  );
  assert.deepEqual(
    mocks.exportCalls.map((call) => [call.format, call.artifactName]),
    [
      ["pose_frames_device_json", "pose_frames_device_0_json"],
      ["pose_frames_device_json", "pose_frames_device_1_json"],
      ["multi_view_sync_json", "multi_view_sync_json"],
      ["camera_calibration_json", "camera_calibration_json"],
      ["dual_reconstruction_json", "dual_reconstruction_json"],
    ],
  );
  assert.equal(result.artifacts.length, 5);
  assert.equal(result.warnings.length, 0);
  assert.equal(mocks.exportCalls[0].metadata?.deviceIndex, 0);
  assert.equal(mocks.exportCalls[1].metadata?.deviceIndex, 1);
  assert.notEqual(
    mocks.exportCalls[0].artifactName,
    mocks.exportCalls[1].artifactName,
  );
}

async function testProMultiViewSuccessPersistence() {
  const mocks = createMocks();
  await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "pro_4_camera",
    poseArtifacts: [0, 1, 2, 3].map(poseArtifact),
    syncReport: syncReport(),
    cameraCalibration: cameraCalibration(),
    reconstruction: reconstruction("multi_view"),
    storage: mocks.storage,
    exportsRepository: mocks.exportsRepository,
  });

  assert.ok(
    mocks.uploadCalls.some((call) =>
      call.key.endsWith("/multi_view_reconstruction.json"),
    ),
  );
  assert.ok(
    mocks.exportCalls.some(
      (call) =>
        call.format === "multi_view_reconstruction_json" &&
        call.artifactName === "multi_view_reconstruction_json",
    ),
  );
  assert.equal(
    mocks.exportCalls.filter((call) => call.format === "pose_frames_device_json")
      .length,
    4,
  );
}

async function testMissingOptionalArtifacts() {
  const mocks = createMocks();
  const result = await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    reconstruction: reconstruction("dual_camera"),
    storage: mocks.storage,
    exportsRepository: mocks.exportsRepository,
  });

  assert.equal(result.artifacts.length, 1);
  assert.equal(mocks.uploadCalls.length, 1);
  assert.equal(mocks.exportCalls.length, 1);
  assert.equal(mocks.exportCalls[0].artifactName, "dual_reconstruction_json");
}

async function testStorageUploadFailureDoesNotCreateExportRecord() {
  const failKey = `takes/${TAKE_ID}/jobs/${JOB_ID}/pose_frames_device_0.json`;
  const mocks = createMocks({ failUploadKey: failKey });

  await assert.rejects(
    () =>
      persistMultiViewArtifacts({
        takeId: TAKE_ID,
        jobId: JOB_ID,
        source: "dual_camera",
        poseArtifacts: [poseArtifact(0)],
        storage: mocks.storage,
        exportsRepository: mocks.exportsRepository,
      }),
    /upload failed/,
  );
  assert.equal(mocks.uploadCalls.length, 1);
  assert.equal(mocks.exportCalls.length, 0);
}

async function testExportRecordFailureIsExplicit() {
  const mocks = createMocks({
    failExportArtifactName: "dual_reconstruction_json",
  });

  await assert.rejects(
    () =>
      persistMultiViewArtifacts({
        takeId: TAKE_ID,
        jobId: JOB_ID,
        source: "dual_camera",
        reconstruction: reconstruction("dual_camera"),
        storage: mocks.storage,
        exportsRepository: mocks.exportsRepository,
      }),
    /export failed/,
  );
  assert.equal(mocks.uploadCalls.length, 1);
  assert.equal(mocks.exportCalls.length, 1);
}

function testArtifactKeyDeterminism() {
  const first = poseArtifactStorageKey({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    deviceIndex: 2,
  });
  const second = poseArtifactStorageKey({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    deviceIndex: 2,
  });

  assert.equal(first, second);
  assert.equal(
    first,
    `takes/${TAKE_ID}/jobs/${JOB_ID}/pose_frames_device_2.json`,
  );
}

async function main() {
  await testDualSuccessPersistence();
  await testProMultiViewSuccessPersistence();
  await testMissingOptionalArtifacts();
  await testStorageUploadFailureDoesNotCreateExportRecord();
  await testExportRecordFailureIsExplicit();
  testArtifactKeyDeterminism();
  console.log("multi-view artifact persistence tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
