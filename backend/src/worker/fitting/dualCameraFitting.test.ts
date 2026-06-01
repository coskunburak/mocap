import assert from "node:assert/strict";
import type {
  CameraCalibrationArtifact,
  Matrix3x3,
  ProjectionMatrix3x4,
  SmplParametersArtifact,
  SolvedMotionArtifact,
  TriangulatedJointTrackArtifact,
  Vector3,
} from "../types";
import { SKELETON } from "../export/skeletonDefinition";
import { validateSolvedMotion } from "../export/exportValidation";
import { resolveWorkerPipelineBranch } from "../reconstruction/multiViewOrchestrator";
import { runDualCameraFittingFoundation } from "./dualCameraFitting";
import { runDualCameraFittingOptimization } from "./dualCameraOptimizer";
import { validateDualFitReportArtifact } from "./dualFitArtifacts";

const TAKE_ID = "take_dual_fit";
const JOB_ID = "job_dual_fit";
const IDENTITY: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const PROJECTION: ProjectionMatrix3x4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const ZERO: Vector3 = [0, 0, 0];

function smplParameters(): SmplParametersArtifact {
  return {
    schema: "mocap.smpl_parameters.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "wham",
    model: { family: "SMPL" },
    fps: 30,
    frameCount: 2,
    bodyPose: [[], []],
    globalOrient: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    betas: [],
    translation: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    smplify: {
      enabled: true,
      status: "completed",
    },
    frames: [
      {
        frameIndex: 0,
        timestampMs: 0,
        bodyPose: [],
        globalOrient: [0, 0, 0],
        translation: [0, 0, 0],
      },
      {
        frameIndex: 1,
        timestampMs: 33,
        bodyPose: [],
        globalOrient: [0, 0, 0],
        translation: [0, 0, 0],
      },
    ],
  };
}

function whamInitialization(input: { includeSmpl?: boolean } = {}): SolvedMotionArtifact {
  return {
    schema: "mocap.solved_motion.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    skeleton: {
      name: "mocap_humanoid_v1",
      rotationOrder: "XYZ",
      coordinateSystem: "right_handed_y_up",
    },
    fps: 30,
    frameCount: 2,
    durationMs: 66,
    frames: [
      {
        frameIndex: 0,
        timestampMs: 0,
        rootTranslation: [0, 0, 0],
        joints: {},
      },
      {
        frameIndex: 1,
        timestampMs: 33,
        rootTranslation: [0, 0, 0],
        joints: {},
      },
    ],
    validation: {
      ok: true,
      warnings: [],
      errors: [],
    },
    ...(input.includeSmpl === false ? {} : { smpl: smplParameters() }),
  };
}

function whamInitializationWithSkeleton(): SolvedMotionArtifact {
  const baseJoints = Object.fromEntries(
    SKELETON.map((joint) => [joint.name, [0, 0, 0] as [number, number, number]]),
  );
  return {
    ...whamInitialization(),
    frames: [
      {
        frameIndex: 0,
        timestampMs: 0,
        rootTranslation: [0, 0, 0],
        joints: { ...baseJoints },
      },
      {
        frameIndex: 1,
        timestampMs: 33,
        rootTranslation: [0.01, 0, 0],
        joints: { ...baseJoints },
      },
    ],
  };
}

function cameraCalibration(input: { status?: CameraCalibrationArtifact["status"] } = {}): CameraCalibrationArtifact {
  return {
    schema: "mocap.camera_calibration.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "capture_metadata",
    intrinsicsSource: "capture_metadata",
    devices: [0, 1].map((deviceIndex) => ({
      cameraId: `device_${deviceIndex}`,
      deviceIndex,
      deviceRole: deviceIndex === 0 ? "primary" : "secondary",
      intrinsic: IDENTITY,
      rotation: IDENTITY,
      translation: ZERO,
      projection: PROJECTION,
      intrinsicsSource: "capture_metadata",
      extrinsicsSource: "capture_metadata",
    })),
    baselineEstimate: 1,
    status: input.status ?? "ready",
    quality: {
      score: 0.92,
      averageReprojectionErrorPx: 1.8,
      baseline: 1,
      convergenceAngle: 30,
    },
    warnings: [],
  };
}

function jointTrack(
  input: Partial<TriangulatedJointTrackArtifact["metrics"]> = {},
): TriangulatedJointTrackArtifact {
  return {
    schema: "mocap.triangulated_joint_track.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    status: "ready",
    coordinateSystem: "right_handed_y_up",
    jointSet: "body33",
    cameraIds: ["device_0", "device_1"],
    frameCount: 2,
    trackedFrameCount: 2,
    metrics: {
      matchedFrameCount: 2,
      triangulatedJointRatio: input.triangulatedJointRatio ?? 0.82,
      averageReprojectionErrorPx: input.averageReprojectionErrorPx ?? 2.2,
      reprojectionP95Px: input.reprojectionP95Px ?? 4.4,
      temporalJitterBefore: input.temporalJitterBefore ?? 0.18,
      temporalJitterAfter: input.temporalJitterAfter ?? 0.09,
      temporalSmoothingGain: input.temporalSmoothingGain ?? 0.5,
    },
    frames: [0, 1].map((frameIndex) => ({
      frameIndex,
      timestampMs: frameIndex * 33,
      sourceFrameIndices: { device_0: frameIndex, device_1: frameIndex },
      status: "ready",
      joints: [
        {
          jointId: "left_hip",
          x: 0,
          y: 1,
          z: 3,
          confidence: 0.9,
          sourceCameraIds: ["device_0", "device_1"],
          reprojectionErrorPx: 2,
          status: "tracked",
          warnings: [],
        },
        {
          jointId: "left_knee",
          x: 0,
          y: 0.5,
          z: 3,
          confidence: 0.9,
          sourceCameraIds: ["device_0", "device_1"],
          reprojectionErrorPx: 2,
          status: "tracked",
          warnings: [],
        },
        {
          jointId: "left_ankle",
          x: 0,
          y: 0,
          z: 3,
          confidence: 0.9,
          sourceCameraIds: ["device_0", "device_1"],
          reprojectionErrorPx: 2,
          status: "tracked",
          warnings: [],
        },
      ],
      warnings: [],
    })),
    warnings: [],
  };
}

function testMissingJointTrackIsHonest() {
  const report = runDualCameraFittingFoundation({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitialization(),
    cameraCalibration: cameraCalibration(),
  });

  assert.equal(report.status, "missing_joint_track");
  assert.equal(report.acceptedAsFinalAnimation, false);
  assert.equal(report.finalAnimationSourceCandidate, "primary_wham");
  assert.equal(report.metrics.acceptedAsFinalAnimation, false);
  assert.ok(report.warnings.includes("missing_joint_track"));
}

function testMissingWhamInitializationIsHonest() {
  const report = runDualCameraFittingFoundation({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    jointTrack: jointTrack(),
    cameraCalibration: cameraCalibration(),
  });

  assert.equal(report.status, "missing_wham_initialization");
  assert.equal(report.inputSources.initialization, "unavailable");
  assert.equal(report.acceptedAsFinalAnimation, false);
}

function testValidDiagnosticFixtureDoesNotBecomeFinal() {
  const report = runDualCameraFittingFoundation({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitialization(),
    jointTrack: jointTrack(),
    cameraCalibration: cameraCalibration(),
    artifactRefs: {
      triangulated_joint_track_json:
        "takes/take_dual_fit/jobs/job_dual_fit/triangulated_joint_track.json",
      camera_calibration_json:
        "takes/take_dual_fit/jobs/job_dual_fit/camera_calibration.json",
    },
  });
  const validation = validateDualFitReportArtifact(report);

  assert.equal(report.status, "optimization_not_implemented");
  assert.equal(report.acceptedAsFinalAnimation, false);
  assert.equal(report.finalAnimationSourceCandidate, "primary_wham");
  assert.equal(report.metrics.triangulatedJointRatio, 0.82);
  assert.equal(report.metrics.averageReprojectionErrorPxBefore, 2.2);
  assert.equal(report.metrics.averageReprojectionErrorPxAfter, null);
  assert.equal(report.losses.totalLoss, null);
  assert.equal(report.metrics.boneLengthConsistencyScore, 1);
  assert.equal(validation.ok, true);
}

function testQualityGateFailureBlocksAcceptanceOnly() {
  const report = runDualCameraFittingFoundation({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitialization(),
    jointTrack: jointTrack({
      triangulatedJointRatio: 0.2,
      averageReprojectionErrorPx: 18,
    }),
    cameraCalibration: cameraCalibration(),
  });

  assert.equal(report.status, "insufficient_quality");
  assert.equal(report.acceptedAsFinalAnimation, false);
  assert.ok(
    report.qualityGates.some(
      (gate) =>
        gate.name === "triangulated_joint_ratio" &&
        !gate.passed &&
        gate.severity === "blocking" &&
        gate.value === 0.2,
    ),
  );
  assert.ok(report.warnings.includes("dual_fit_quality_gate_failed"));
}

function testGateResultSerializationDoesNotFakeZeros() {
  const report = runDualCameraFittingFoundation({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitialization(),
    jointTrack: jointTrack(),
    cameraCalibration: cameraCalibration({ status: "approximate" }),
  });
  const serialized = JSON.parse(JSON.stringify(report)) as typeof report;

  assert.equal(serialized.schema, "mocap.dual_fit_report.v1");
  assert.ok(
    serialized.qualityGates.every(
      (gate) =>
        typeof gate.name === "string" &&
        typeof gate.passed === "boolean" &&
        (gate.reason === null || typeof gate.reason === "string"),
    ),
  );
  assert.equal(serialized.metrics.averageReprojectionErrorPxAfter, null);
  assert.equal(serialized.losses.initializationLoss, null);
}

function testSingleCameraBranchDoesNotRequireFitting() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "solo",
    selectedVideoCount: 1,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: true,
  });
  const report = undefined;

  assert.equal(branch.kind, "single_camera_wham");
  assert.equal(report, undefined);
}

function testAcceptedSyntheticOptimizationProducesRealMotion() {
  const result = runDualCameraFittingOptimization({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitializationWithSkeleton(),
    jointTrack: jointTrack(),
    cameraCalibration: cameraCalibration(),
    options: {
      minTriangulatedJointRatio: 0.5,
      minReliableConstraintRatio: 0.5,
      maxReprojectionErrorPx: 8,
    },
  });

  assert.equal(result.report.status, "ready");
  assert.equal(result.report.acceptedAsFinalAnimation, true);
  assert.equal(result.report.finalAnimationSourceCandidate, "true_dual_solve");
  assert.ok(result.optimizedMotion);
  assert.equal(result.optimizedMotion?.optimizedFrom?.source, "primary_wham");
  assert.equal(result.optimizedMotion?.optimizedFrom?.acceptedAsFinalAnimation, false);
  assert.equal(result.optimizedMotion?.smpl, undefined);
  assert.ok((result.report.metrics.optimizedMotionDelta ?? 0) > 0);
  assert.ok((result.report.metrics.reliableConstraintRatio ?? 0) >= 0.5);
  assert.equal(validateSolvedMotion(result.optimizedMotion!).ok, true);
  assert.equal(validateDualFitReportArtifact(result.report).ok, true);
}

function testOptimizationRejectsMissingReliableConstraints() {
  const lowConfidenceTrack = jointTrack();
  lowConfidenceTrack.frames = lowConfidenceTrack.frames.map((frame) => ({
    ...frame,
    joints: frame.joints.map((joint) => ({
      ...joint,
      confidence: 0.1,
      status: "low_confidence",
    })),
  }));
  const result = runDualCameraFittingOptimization({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitializationWithSkeleton(),
    jointTrack: lowConfidenceTrack,
    cameraCalibration: cameraCalibration(),
  });

  assert.equal(result.report.status, "insufficient_quality");
  assert.equal(result.report.acceptedAsFinalAnimation, false);
  assert.equal(result.report.finalAnimationSourceCandidate, "primary_wham");
  assert.equal(result.optimizedMotion, undefined);
  assert.ok(result.report.warnings.includes("dual_fit_no_reliable_constraints"));
}

function testApproximateCalibrationBlocksTrueDualSolve() {
  const result = runDualCameraFittingOptimization({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitializationWithSkeleton(),
    jointTrack: jointTrack(),
    cameraCalibration: cameraCalibration({ status: "approximate" }),
  });

  assert.equal(result.report.status, "insufficient_quality");
  assert.equal(result.report.acceptedAsFinalAnimation, false);
  assert.equal(result.report.finalAnimationSourceCandidate, "primary_wham");
  assert.equal(result.optimizedMotion, undefined);
  assert.ok(
    result.report.qualityGates.some(
      (gate) =>
        gate.name === "calibration_readiness" &&
        !gate.passed &&
        gate.severity === "blocking",
    ),
  );
}

testMissingJointTrackIsHonest();
testMissingWhamInitializationIsHonest();
testValidDiagnosticFixtureDoesNotBecomeFinal();
testQualityGateFailureBlocksAcceptanceOnly();
testGateResultSerializationDoesNotFakeZeros();
testSingleCameraBranchDoesNotRequireFitting();
testAcceptedSyntheticOptimizationProducesRealMotion();
testOptimizationRejectsMissingReliableConstraints();
testApproximateCalibrationBlocksTrueDualSolve();
console.log("dual-camera fitting foundation tests passed");
