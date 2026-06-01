import assert from "node:assert/strict";
import type {
  CameraCalibrationArtifact,
  Matrix3x3,
  PerCameraPoseArtifact,
  ProjectionMatrix3x4,
  Vector3,
} from "../types";
import { buildPerCameraPoseArtifact, buildMissingPoseFramesArtifact } from "../pose/poseExtraction";
import {
  buildCameraCalibrationArtifact,
  buildMissingCalibrationArtifact,
} from "./cameraCalibration";
import { buildDualReconstructionArtifacts } from "./dualReconstructionArtifacts";
import { buildMultiViewSyncReport } from "./frameSync";
import {
  buildMultiViewArtifactCandidates,
  persistMultiViewArtifacts,
} from "./multiViewArtifacts";
import { projectPoint } from "./triangulation";

const TAKE_ID = "take_dual_reconstruction_artifacts";
const JOB_ID = "job_dual_reconstruction_artifacts";
const IDENTITY_INTRINSIC: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY_ROTATION: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const SYNTHETIC_HIP: Vector3 = [0.2, 0.1, 4];
const SYNTHETIC_KNEE: Vector3 = [0.3, -0.5, 4.2];

function calibration(): CameraCalibrationArtifact {
  return buildCameraCalibrationArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    devices: [
      {
        cameraId: "device_0",
        deviceId: "phone_0",
        deviceIndex: 0,
        deviceRole: "front",
        imageWidth: 1280,
        imageHeight: 720,
        intrinsics: { matrix: IDENTITY_INTRINSIC },
        extrinsics: {
          rotation: IDENTITY_ROTATION,
          translation: [0, 0, 0],
        },
      },
      {
        cameraId: "device_1",
        deviceId: "phone_1",
        deviceIndex: 1,
        deviceRole: "right",
        imageWidth: 1280,
        imageHeight: 720,
        intrinsics: { matrix: IDENTITY_INTRINSIC },
        extrinsics: {
          rotation: IDENTITY_ROTATION,
          translation: [-1, 0, 0],
        },
      },
    ],
  });
}

function poseArtifact(input: {
  deviceIndex: number;
  projection: ProjectionMatrix3x4;
  includeFrames?: boolean;
}): PerCameraPoseArtifact {
  if (input.includeFrames === false) {
    return buildMissingPoseFramesArtifact({
      takeId: TAKE_ID,
      jobId: JOB_ID,
      cameraId: `device_${input.deviceIndex}`,
      deviceIndex: input.deviceIndex,
      deviceRole: input.deviceIndex === 0 ? "front" : "right",
      sourceVideo: sourceVideo(input.deviceIndex),
      reason: "No detector output for synthetic test.",
    });
  }
  const hip = projectPoint({
    projection: input.projection,
    point: SYNTHETIC_HIP,
  });
  const knee = projectPoint({
    projection: input.projection,
    point: SYNTHETIC_KNEE,
  });

  return buildPerCameraPoseArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    cameraId: `device_${input.deviceIndex}`,
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceIndex === 0 ? "front" : "right",
    sourceVideo: sourceVideo(input.deviceIndex),
    detectorResult: {
      detector: {
        name: "fixture_pose_detector",
        version: "fixture_v1",
        landmarkSchema: "body_33",
      },
      expectedFrameCount: 1,
      frames: [
        {
          frameIndex: 0,
          timestampMs: 0,
          keypoints: [
            {
              jointId: "left_hip",
              x: hip.x,
              y: hip.y,
              confidence: 0.95,
            },
            {
              jointId: "left_knee",
              x: knee.x,
              y: knee.y,
              confidence: 0.92,
            },
          ],
          poseConfidence: 0.94,
        },
      ],
    },
  });
}

function sourceVideo(deviceIndex: number) {
  return {
    storageKey: `takes/${TAKE_ID}/original/device_${deviceIndex}.mov`,
    normalizedStorageKey:
      `takes/${TAKE_ID}/jobs/${JOB_ID}/normalized/device_${deviceIndex}.mp4`,
    fps: 30,
    width: 1280,
    height: 720,
    durationMs: 33,
  };
}

function fixture(input?: { missingPoseFrames?: boolean }) {
  const cameraCalibration = calibration();
  const poseArtifacts = cameraCalibration.devices.map((camera) =>
    poseArtifact({
      deviceIndex: camera.deviceIndex,
      projection: camera.projection,
      includeFrames:
        input?.missingPoseFrames && camera.deviceIndex === 1 ? false : true,
    }),
  );
  const syncReport = buildMultiViewSyncReport({ poseArtifacts });
  return { cameraCalibration, poseArtifacts, syncReport };
}

function testValidSyntheticDualReconstruction() {
  const { cameraCalibration, poseArtifacts, syncReport } = fixture();
  const result = buildDualReconstructionArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    poseArtifacts,
    syncReport,
    calibrationArtifact: cameraCalibration,
  });
  const dual = result.dualReconstruction;

  assert.equal(dual.schema, "mocap.dual_reconstruction.v1");
  assert.equal(dual.status, "ready");
  assert.equal(dual.frameCount, 1);
  assert.equal(dual.matchedFrameCount, 1);
  assert.equal(dual.triangulatedFrameCount, 1);
  assert.equal(dual.frames[0].landmarks3D.length, 2);
  assert.equal(dual.frames[0].landmarks3D[0].jointId, "left_hip");
  assert.ok(dual.averageReprojectionErrorPx < 1e-8);
  assert.equal(dual.fallbackLandmarkRatio, 0);
  assert.equal(
    result.multiViewReconstruction.reconstructionSource,
    "triangulated_2d_keypoints",
  );
}

function testMissingCalibrationProducesDiagnosticArtifact() {
  const { poseArtifacts, syncReport } = fixture();
  const missingCalibration = buildMissingCalibrationArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    reason: "Calibration payload unavailable.",
  });
  const result = buildDualReconstructionArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    poseArtifacts,
    syncReport,
    calibrationArtifact: missingCalibration,
  });

  assert.equal(result.dualReconstruction.status, "missing_calibration");
  assert.equal(result.dualReconstruction.frames.length, 0);
  assert.ok(result.dualReconstruction.warnings.includes("missing_calibration"));
  assert.equal(result.multiViewReconstruction.status, "missing_calibration");
}

function testMissingPoseFramesProducesMissingPoseStatus() {
  const { cameraCalibration, poseArtifacts, syncReport } = fixture({
    missingPoseFrames: true,
  });
  const result = buildDualReconstructionArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    poseArtifacts,
    syncReport,
    calibrationArtifact: cameraCalibration,
  });

  assert.equal(result.dualReconstruction.status, "missing_pose_frames");
  assert.equal(result.dualReconstruction.triangulatedFrameCount, 0);
  assert.ok(result.dualReconstruction.warnings.includes("missing_pose_frames"));
}

function testApproximateSyncIsRepresentedInWarnings() {
  const { cameraCalibration, poseArtifacts, syncReport } = fixture();
  const result = buildDualReconstructionArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    poseArtifacts,
    syncReport: {
      ...syncReport,
      status: "approximate",
      warnings: ["sync_diagnostic_approximation"],
    },
    calibrationArtifact: cameraCalibration,
  });

  assert.equal(result.dualReconstruction.status, "diagnostic_only");
  assert.ok(
    result.dualReconstruction.warnings.includes("sync_diagnostic_approximation"),
  );
  assert.equal(
    result.multiViewReconstruction.syncSummary.status,
    "approximate",
  );
}

async function testArtifactPersistenceIncludesNewDiagnosticArtifacts() {
  const { cameraCalibration, poseArtifacts, syncReport } = fixture();
  const artifacts = buildDualReconstructionArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    poseArtifacts,
    syncReport,
    calibrationArtifact: cameraCalibration,
  });
  const uploads: string[] = [];
  const exports: Array<{ format: string; artifactName: string }> = [];

  await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    poseArtifacts,
    syncReport,
    cameraCalibration,
    dualReconstruction: artifacts.dualReconstruction,
    multiViewReconstruction: artifacts.multiViewReconstruction,
    diagnosticPoseFrames: artifacts.diagnosticPoseFrames,
    storage: {
      async uploadJson(key) {
        uploads.push(key);
        return { storageKey: key, sizeBytes: 1 };
      },
    },
    exportsRepository: {
      async createExportFile(record) {
        exports.push({
          format: record.format,
          artifactName: record.artifactName,
        });
      },
    },
  });

  assert.ok(uploads.some((key) => key.endsWith("/dual_reconstruction.json")));
  assert.ok(uploads.some((key) => key.endsWith("/multi_view_reconstruction.json")));
  assert.ok(uploads.some((key) => key.endsWith("/pose_frames.json")));
  assert.ok(exports.some((item) => item.format === "pose_frames_json"));
}

function testSingleCameraArtifactCandidatesRemainUnchanged() {
  const candidates = buildMultiViewArtifactCandidates({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
  });

  assert.deepEqual(candidates, []);
}

function testDiagnosticPoseFramesCompatibility() {
  const { cameraCalibration, poseArtifacts, syncReport } = fixture();
  const result = buildDualReconstructionArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    poseArtifacts,
    syncReport,
    calibrationArtifact: cameraCalibration,
  });

  assert.ok(result.diagnosticPoseFrames);
  assert.equal(result.diagnosticPoseFrames.schema, "mocap.pose_frames.v1");
  assert.equal(
    result.diagnosticPoseFrames.detector.name,
    "backend_multiview_triangulation",
  );
  assert.equal(
    result.diagnosticPoseFrames.frames[0].landmarks.length,
    0,
  );
  assert.equal(
    result.diagnosticPoseFrames.frames[0].worldLandmarks?.length,
    2,
  );
}

async function main() {
  testValidSyntheticDualReconstruction();
  testMissingCalibrationProducesDiagnosticArtifact();
  testMissingPoseFramesProducesMissingPoseStatus();
  testApproximateSyncIsRepresentedInWarnings();
  await testArtifactPersistenceIncludesNewDiagnosticArtifacts();
  testSingleCameraArtifactCandidatesRemainUnchanged();
  testDiagnosticPoseFramesCompatibility();
  console.log("dual reconstruction artifact tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
