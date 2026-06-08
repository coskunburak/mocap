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
      rotationOrder: "ZXY",
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

function whamInitializationWithSkeleton(
  input: {
    rootTranslations?: readonly Vector3[];
    jointOverrides?: Record<string, [number, number, number]>;
  } = {},
): SolvedMotionArtifact {
  const baseJoints = Object.fromEntries(
    SKELETON.map((joint) => [joint.name, [0, 0, 0] as [number, number, number]]),
  );
  const rootTranslations = input.rootTranslations ?? [
    [0, 0, 0],
    [0.01, 0, 0],
  ];
  const frames = rootTranslations.map((rootTranslation, frameIndex) => ({
    frameIndex,
    timestampMs: frameIndex * 33,
    rootTranslation: [...rootTranslation] as [number, number, number],
    joints: {
      ...baseJoints,
      ...(input.jointOverrides ?? {}),
    },
  }));
  return {
    ...whamInitialization(),
    frameCount: frames.length,
    durationMs: frames.length * 33,
    frames,
  };
}

function cameraCalibration(
  input: {
    status?: CameraCalibrationArtifact["status"];
    score?: number;
  } = {},
): CameraCalibrationArtifact {
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
      score: input.score ?? 0.92,
      averageReprojectionErrorPx: 1.8,
      baseline: 1,
      convergenceAngle: 30,
    },
    warnings: [],
  };
}

type JointTrackFixtureInput = Partial<TriangulatedJointTrackArtifact["metrics"]> & {
  frameCount?: number;
  confidence?: number;
  reprojectionErrorPx?: number;
  rootTargets?: readonly Vector3[];
  footSlideMeters?: number;
};

function jointTrack(input: JointTrackFixtureInput = {}): TriangulatedJointTrackArtifact {
  const frameCount = input.frameCount ?? input.rootTargets?.length ?? 2;
  const rootTarget = (frameIndex: number): Vector3 =>
    input.rootTargets?.[frameIndex] ?? [0, 1, 3];
  const confidence = input.confidence ?? 0.9;
  const reprojectionErrorPx = input.reprojectionErrorPx ?? 2;
  return {
    schema: "mocap.triangulated_joint_track.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    status: "ready",
    coordinateSystem: "right_handed_y_up",
    jointSet: "body33",
    cameraIds: ["device_0", "device_1"],
    frameCount,
    trackedFrameCount: frameCount,
    metrics: {
      matchedFrameCount: frameCount,
      triangulatedJointRatio: input.triangulatedJointRatio ?? 0.82,
      averageReprojectionErrorPx: input.averageReprojectionErrorPx ?? 2.2,
      reprojectionP95Px: input.reprojectionP95Px ?? 4.4,
      temporalJitterBefore: input.temporalJitterBefore ?? 0.18,
      temporalJitterAfter: input.temporalJitterAfter ?? 0.09,
      temporalSmoothingGain: input.temporalSmoothingGain ?? 0.5,
    },
    frames: Array.from({ length: frameCount }, (_, frameIndex) => {
      const target = rootTarget(frameIndex);
      const footSlide = input.footSlideMeters
        ? frameIndex * input.footSlideMeters
        : 0;
      return {
        frameIndex,
        timestampMs: frameIndex * 33,
        sourceFrameIndices: { device_0: frameIndex, device_1: frameIndex },
        status: "ready",
        joints: [
          {
            jointId: "left_hip",
            x: target[0],
            y: target[1],
            z: target[2],
            confidence,
            sourceCameraIds: ["device_0", "device_1"],
            reprojectionErrorPx,
            status: "tracked",
            warnings: [],
          },
          {
            jointId: "left_knee",
            x: target[0],
            y: target[1] - 0.5,
            z: target[2],
            confidence,
            sourceCameraIds: ["device_0", "device_1"],
            reprojectionErrorPx,
            status: "tracked",
            warnings: [],
          },
          {
            jointId: "left_ankle",
            x: target[0] + footSlide,
            y: target[1] - 1,
            z: target[2],
            confidence,
            sourceCameraIds: ["device_0", "device_1"],
            reprojectionErrorPx,
            status: "tracked",
            warnings: [],
          },
        ],
        warnings: [],
      };
    }),
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
  assert.equal(report.acceptance?.accepted, false);
  assert.equal(
    report.acceptance?.finalAnimationSourceRecommendation,
    "primary_wham",
  );
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
        gate.code === "triangulated_joint_ratio_low" &&
        gate.value === 0.2,
    ),
  );
  assert.deepEqual(report.acceptance?.blockingFailures, [
    "triangulated_joint_ratio_low",
    "reprojection_error_high",
  ]);
  assert.equal(
    report.acceptance?.finalAnimationSourceRecommendation,
    "primary_wham",
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
      maxRootTranslationDeltaMeters: 0.3,
    },
  });

  assert.equal(result.report.status, "ready");
  assert.equal(result.report.acceptedAsFinalAnimation, true);
  assert.equal(result.report.finalAnimationSourceCandidate, "true_dual_solve");
  assert.equal(result.report.acceptance?.accepted, true);
  assert.deepEqual(result.report.acceptance?.blockingFailures, []);
  assert.equal(
    result.report.acceptance?.finalAnimationSourceRecommendation,
    "true_dual_solve",
  );
  assert.ok(result.optimizedMotion);
  assert.equal(result.optimizedMotion?.optimizedFrom?.source, "primary_wham");
  assert.equal(result.optimizedMotion?.optimizedFrom?.method, "kinematic_post_fit");
  assert.equal(result.optimizedMotion?.optimizedFrom?.acceptedAsFinalAnimation, false);
  assert.equal(result.optimizedMotion?.smpl, undefined);
  assert.ok((result.report.metrics.optimizedMotionDelta ?? 0) > 0);
  assert.ok((result.report.metrics.reliableConstraintRatio ?? 0) >= 0.5);
  assert.equal(result.report.metrics.optimizedMotionValid, true);
  assert.equal(result.report.metrics.fullSmplOptimization, false);
  assert.equal(result.report.metrics.reliableConstraintCount, 6);
  assert.equal(result.report.metrics.rejectedConstraintCount, 0);
  assert.equal(result.report.metrics.calibrationQualityScore, 0.92);
  assert.ok((result.report.metrics.rootTranslationMaxDelta ?? 0) > 0);
  assert.ok((result.report.metrics.footLockViolationCount ?? -1) >= 0);
  assert.ok(
    result.report.warnings.includes("dual_fit_method_not_full_smpl"),
  );
  assert.ok(
    result.report.warnings.includes("optimized_smpl_parameters_not_produced"),
  );
  assert.ok(
    result.optimizedMotion?.validation.warnings.includes(
      "dual_fit_method_not_full_smpl",
    ),
  );
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
  assert.ok(
    result.report.acceptance?.blockingFailures.includes(
      "reliable_constraint_ratio_low",
    ),
  );
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
        gate.severity === "blocking" &&
        gate.code === "calibration_not_ready",
    ),
  );
  assert.deepEqual(result.report.acceptance?.blockingFailures, [
    "calibration_not_ready",
  ]);
}

function assertBlockingFailure(
  result: ReturnType<typeof runDualCameraFittingOptimization>,
  code: string,
) {
  const failures = result.report.acceptance?.blockingFailures as
    | readonly string[]
    | undefined;
  assert.ok(
    failures?.includes(code),
    `expected blocking failure ${code}, got ${JSON.stringify(
      result.report.acceptance?.blockingFailures,
    )}`,
  );
}

function testLowCalibrationQualityRejected() {
  const result = runDualCameraFittingOptimization({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitializationWithSkeleton(),
    jointTrack: jointTrack(),
    cameraCalibration: cameraCalibration({ score: 0.2 }),
    options: { maxRootTranslationDeltaMeters: 0.3 },
  });

  assert.equal(result.report.acceptedAsFinalAnimation, false);
  assertBlockingFailure(result, "calibration_quality_low");
  assert.equal(result.optimizedMotion, undefined);
}

function testHighReprojectionRejected() {
  const result = runDualCameraFittingOptimization({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitializationWithSkeleton(),
    jointTrack: jointTrack({
      averageReprojectionErrorPx: 24,
      reprojectionP95Px: 31,
      reprojectionErrorPx: 24,
    }),
    cameraCalibration: cameraCalibration(),
    options: { maxRootTranslationDeltaMeters: 0.3 },
  });

  assert.equal(result.report.acceptedAsFinalAnimation, false);
  assertBlockingFailure(result, "reprojection_error_high");
  assertBlockingFailure(result, "reprojection_p95_high");
}

function testInvalidOptimizedMotionRejected() {
  const invalidWham = whamInitializationWithSkeleton({
    rootTranslations: [
      [Number.NaN, 0, 0],
      [0.01, 0, 0],
    ],
  });
  const result = runDualCameraFittingOptimization({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: invalidWham,
    jointTrack: jointTrack(),
    cameraCalibration: cameraCalibration(),
    options: { maxRootTranslationDeltaMeters: 0.3 },
  });

  assert.equal(result.report.acceptedAsFinalAnimation, false);
  assert.equal(result.report.metrics.optimizedMotionValid, false);
  assertBlockingFailure(result, "optimized_motion_invalid");
  assert.equal(result.optimizedMotion, undefined);
}

function testExcessiveDeltaRejected() {
  const result = runDualCameraFittingOptimization({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitializationWithSkeleton(),
    jointTrack: jointTrack(),
    cameraCalibration: cameraCalibration(),
    options: {
      maxRootAdjustmentMeters: 0.25,
      maxRootTranslationDeltaMeters: 0.05,
    },
  });

  assert.equal(result.report.acceptedAsFinalAnimation, false);
  assertBlockingFailure(result, "excessive_motion_delta");
}

function testInsufficientDeltaRejected() {
  const result = runDualCameraFittingOptimization({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitializationWithSkeleton(),
    jointTrack: jointTrack({ rootTargets: [[0, 0, 0], [0.01, 0, 0]] }),
    cameraCalibration: cameraCalibration(),
    options: {
      maxRootAdjustmentMeters: 0,
      maxJointRotationAdjustmentDegrees: 0,
    },
  });

  assert.equal(result.report.acceptedAsFinalAnimation, false);
  assertBlockingFailure(result, "insufficient_motion_delta");
}

function testTemporalJitterIncreaseRejected() {
  const result = runDualCameraFittingOptimization({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitializationWithSkeleton({
      rootTranslations: [
        [0, 0, 0],
        [0.01, 0, 0],
        [0.02, 0, 0],
      ],
    }),
    jointTrack: jointTrack({
      frameCount: 3,
      rootTargets: [
        [0, 1, 3],
        [0.4, 1, 3],
        [-0.4, 1, 3],
      ],
    }),
    cameraCalibration: cameraCalibration(),
    options: {
      maxRootAdjustmentMeters: 0.15,
      maxRootTranslationDeltaMeters: 0.2,
      maxTemporalJitterIncreaseRatio: 0.05,
    },
  });

  assert.equal(result.report.acceptedAsFinalAnimation, false);
  assertBlockingFailure(result, "temporal_jitter_increased");
}

function testJointLimitViolationsRejected() {
  const result = runDualCameraFittingOptimization({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitializationWithSkeleton({
      jointOverrides: { Head: [181, 0, 0] },
    }),
    jointTrack: jointTrack(),
    cameraCalibration: cameraCalibration(),
    options: { maxRootTranslationDeltaMeters: 0.3 },
  });

  assert.equal(result.report.acceptedAsFinalAnimation, false);
  assertBlockingFailure(result, "joint_limit_violation_high");
}

function testFootLockMetricsProduced() {
  const result = runDualCameraFittingOptimization({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: whamInitializationWithSkeleton(),
    jointTrack: jointTrack({ footSlideMeters: 0.01 }),
    cameraCalibration: cameraCalibration(),
    options: { maxRootTranslationDeltaMeters: 0.3 },
  });

  assert.equal(typeof result.report.metrics.footContactStabilityScore, "number");
  assert.equal(typeof result.report.metrics.footLockViolationCount, "number");
  assert.ok(Number.isFinite(result.report.metrics.footContactStabilityScore));
  assert.ok(Number.isFinite(result.report.metrics.footLockViolationCount));
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
testLowCalibrationQualityRejected();
testHighReprojectionRejected();
testInvalidOptimizedMotionRejected();
testExcessiveDeltaRejected();
testInsufficientDeltaRejected();
testTemporalJitterIncreaseRejected();
testJointLimitViolationsRejected();
testFootLockMetricsProduced();
console.log("dual-camera fitting foundation tests passed");
