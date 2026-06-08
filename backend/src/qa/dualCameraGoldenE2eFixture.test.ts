import assert from "node:assert/strict";
import type {
  CleanupReport,
  CalibrationObservationsArtifact,
  Matrix3x3,
  MotionPipelineReport,
  PerCameraPoseArtifact,
  PoseFramesArtifact,
  ProjectionMatrix3x4,
  SmplParametersArtifact,
  SolvedMotionArtifact,
  Vector3,
} from "../worker/types";
import { buildQualityReport } from "../worker/export/exportValidation";
import { runDualCameraFittingFoundation } from "../worker/fitting/dualCameraFitting";
import {
  artifactRefsFromPersistedMultiViewArtifacts,
  buildMotionPipelineStage,
  buildReconstructionDiagnosticStages,
  sortMotionPipelineStages,
} from "../worker/export/motionPipelineStages";
import { buildPerCameraPoseArtifact } from "../worker/pose/poseExtraction";
import { buildCameraCalibrationArtifact } from "../worker/reconstruction/cameraCalibration";
import { persistMultiViewArtifacts } from "../worker/reconstruction/multiViewArtifacts";
import {
  resolveWorkerPipelineBranch,
  runMultiViewReconstruction,
} from "../worker/reconstruction/multiViewOrchestrator";
import { projectPoint } from "../worker/reconstruction/triangulation";
import { buildWhamInputUsageMetrics } from "../worker/whamInputUsage";

const TAKE_ID = "take_dual_camera_golden_e2e";
const JOB_ID = "job_dual_camera_golden_e2e";
const IDENTITY_INTRINSIC: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY_ROTATION: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const SYNTHETIC_LANDMARKS: readonly {
  jointId: string;
  point: Vector3;
  confidence: number;
}[] = [
  { jointId: "left_hip", point: [0.2, 0.1, 4], confidence: 0.95 },
  { jointId: "left_knee", point: [0.3, -0.5, 4.2], confidence: 0.92 },
];

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

function basePose(): PoseFramesArtifact {
  return {
    schema: "mocap.pose_frames.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    sourceVideo: sourceVideo(0),
    detector: {
      name: "wham_internal_vitpose",
      version: "fixture_v1",
      landmarkSchema: "wham_internal",
    },
    frames: [],
    quality: {
      frameCount: 30,
      detectedFrameCount: 30,
      lowConfidenceFrameCount: 0,
      averagePoseConfidence: 1,
    },
  };
}

function smplParameters(): SmplParametersArtifact {
  return {
    schema: "mocap.smpl_parameters.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "wham",
    model: { family: "SMPL" },
    fps: 30,
    frameCount: 30,
    bodyPose: [],
    globalOrient: [],
    betas: [],
    translation: [],
    smplify: {
      enabled: true,
      status: "completed",
    },
    frames: [],
  };
}

function baseSolved(): SolvedMotionArtifact {
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
    frameCount: 30,
    durationMs: 1000,
    frames: [],
    validation: {
      ok: true,
      warnings: [],
      errors: [],
    },
    smpl: smplParameters(),
  };
}

function validFittingWhamInitialization(): SolvedMotionArtifact {
  return {
    ...baseSolved(),
    frameCount: 1,
    durationMs: 33,
    frames: [
      {
        frameIndex: 0,
        timestampMs: 0,
        rootTranslation: [0, 0, 0],
        joints: {},
      },
    ],
    smpl: {
      ...smplParameters(),
      frameCount: 1,
      frames: [
        {
          frameIndex: 0,
          timestampMs: 0,
          bodyPose: [],
          globalOrient: [0, 0, 0],
          translation: [0, 0, 0],
        },
      ],
    },
  };
}

function baseCleanup(): CleanupReport {
  return {
    schema: "mocap.cleanup_report.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    algorithm: {
      name: "cleanup_quality_v1_5",
      smoothing: "confidence_aware_exponential",
      interpolation: "nearest_linear",
      footLocking: "basic_contact_anchor",
    },
    metrics: {
      sourceFrameCount: 30,
      solvedFrameCount: 30,
      cleanedFrameCount: 30,
      interpolatedFrameCount: 0,
      outlierFrameCount: 0,
      missingLandmarkRatio: 0,
      jitterScore: 1,
      jitterRms: 0,
      rootStability: 1,
      rootVerticalJitter: 0,
      footSlidingScore: 1,
      footSlidingDistance: 0,
      footContactFrameCount: 20,
      footLockFrameCount: 20,
      boneLengthConsistency: 1,
      boneLengthVariation: 0,
      leftRightSwapCount: 0,
      smoothingStrength: 0.5,
    },
    warnings: [],
    actions: [],
  };
}

function buildCalibration() {
  return buildCameraCalibrationArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    devices: [
      {
        cameraId: "device_0",
        deviceId: "phone_0",
        deviceIndex: 0,
        deviceRole: "primary",
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
        deviceRole: "secondary",
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

function buildPoseArtifact(input: {
  deviceIndex: number;
  deviceRole: string;
  projection: ProjectionMatrix3x4;
}): PerCameraPoseArtifact {
  const projected = SYNTHETIC_LANDMARKS.map((landmark) => ({
    landmark,
    point: projectPoint({
      projection: input.projection,
      point: landmark.point,
    }),
  }));

  return buildPerCameraPoseArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    cameraId: `device_${input.deviceIndex}`,
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceRole,
    sourceVideo: sourceVideo(input.deviceIndex),
    detectorResult: {
      detector: {
        name: "synthetic_dual_golden_pose_detector",
        version: "fixture_v1",
        landmarkSchema: "body_33",
      },
      expectedFrameCount: 1,
      frames: [
        {
          frameIndex: 0,
          timestampMs: 0,
          keypoints: projected.map(({ landmark, point }) => ({
            jointId: landmark.jointId,
            x: point.x,
            y: point.y,
            confidence: landmark.confidence,
          })),
          poseConfidence: 0.94,
        },
      ],
    },
  });
}

function calibrationObservations(): CalibrationObservationsArtifact {
  return {
    schemaVersion: "mocap.calibration_observations.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    sessionId: "session_dual_camera_golden_e2e",
    targetType: "apriltag",
    detectorSource: "fixture",
    status: "ready",
    reason: null,
    cameras: [
      {
        cameraId: "device_0",
        deviceId: "phone_0",
        status: "ready",
        frameCount: 1,
        observationCount: 1,
        averageConfidence: 0.9,
        warnings: [],
      },
      {
        cameraId: "device_1",
        deviceId: "phone_1",
        status: "ready",
        frameCount: 1,
        observationCount: 1,
        averageConfidence: 0.88,
        warnings: [],
      },
    ],
    frames: [
      {
        cameraId: "device_0",
        deviceId: "phone_0",
        frameIndex: 0,
        timestampMs: 0,
        observations: [
          { targetId: "tag_0", cornerId: "0", x: 20, y: 30, confidence: 0.9 },
        ],
        warnings: [],
      },
      {
        cameraId: "device_1",
        deviceId: "phone_1",
        frameIndex: 0,
        timestampMs: 0,
        observations: [
          { targetId: "tag_0", cornerId: "0", x: 25, y: 31, confidence: 0.88 },
        ],
        warnings: [],
      },
    ],
    warnings: [],
  };
}

async function buildSyntheticDualReconstruction() {
  const calibration = buildCalibration();
  const result = await runMultiViewReconstruction({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    calibrationArtifact: calibration,
    calibrationObservations: calibrationObservations(),
    processedSources: calibration.devices.map((device) => ({
      cameraId: device.cameraId ?? `device_${device.deviceIndex}`,
      deviceId: device.deviceId,
      deviceIndex: device.deviceIndex,
      deviceRole: device.deviceRole,
      videoStorageKey: sourceVideo(device.deviceIndex).storageKey,
      normalizedStorageKey: sourceVideo(device.deviceIndex).normalizedStorageKey ?? "",
      normalizedPath: `/tmp/mocapexpo/${TAKE_ID}/device_${device.deviceIndex}/normalized.mp4`,
      fps: 30,
      width: 1280,
      height: 720,
      durationMs: 33,
    })),
    poseAdapter: {
      name: "synthetic_dual_golden_pose_adapter",
      version: "fixture_v1",
      async extractPoseArtifacts({ processedSources }) {
        return processedSources.map((source) => {
          const camera = calibration.devices.find(
            (device) => device.deviceIndex === source.deviceIndex,
          );
          assert.ok(camera);
          return buildPoseArtifact({
            deviceIndex: source.deviceIndex,
            deviceRole: source.deviceRole,
            projection: camera.projection,
          });
        });
      },
    },
  });

  return result;
}

async function persistSyntheticArtifacts(
  reconstruction: Awaited<ReturnType<typeof buildSyntheticDualReconstruction>>,
  dualFitReport: ReturnType<typeof runDualCameraFittingFoundation>,
) {
  const result = await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    poseArtifacts: reconstruction.poseArtifacts,
    syncReport: reconstruction.syncReport,
    calibrationObservations: reconstruction.calibrationObservations,
    cameraCalibration: reconstruction.calibrationArtifact,
    captureVolume: reconstruction.captureVolumeArtifact,
    reconstruction: reconstruction.reconstructionArtifact,
    dualReconstruction: reconstruction.dualReconstructionArtifact,
    multiViewReconstruction:
      reconstruction.multiViewReconstructionSummaryArtifact,
    triangulatedJointTrack: reconstruction.triangulatedJointTrackArtifact,
    dualFitReport,
    diagnosticPoseFrames: reconstruction.diagnosticPoseFramesArtifact,
    storage: {
      async uploadJson(key, value) {
        return {
          storageKey: key,
          sizeBytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
        };
      },
    },
    exportsRepository: {
      async createExportFile(record) {
        return record;
      },
    },
  });

  return result;
}

function assertArtifactContract(
  artifacts: Awaited<ReturnType<typeof persistSyntheticArtifacts>>["artifacts"],
) {
  const artifactNames = artifacts.map((artifact) => artifact.artifactName);
  assert.deepEqual(artifactNames, [
    "pose_frames_device_0_json",
    "pose_frames_device_1_json",
    "multi_view_sync_json",
    "calibration_observations_json",
    "camera_calibration_json",
    "capture_volume_json",
    "triangulated_joint_track_json",
    "dual_fit_report_json",
    "dual_reconstruction_json",
    "multi_view_reconstruction_json",
    "pose_frames_json",
  ]);
  assert.equal(new Set(artifactNames).size, artifactNames.length);
  assert.ok(
    artifacts.some(
      (artifact) =>
        artifact.format === "pose_frames_device_json" &&
        artifact.artifactName === "pose_frames_device_0_json",
    ),
  );
  assert.ok(
    artifacts.some(
      (artifact) =>
        artifact.format === "pose_frames_device_json" &&
        artifact.artifactName === "pose_frames_device_1_json",
    ),
  );
}

function assertDualReconstruction(
  reconstruction: Awaited<ReturnType<typeof buildSyntheticDualReconstruction>>,
) {
  const dual = reconstruction.dualReconstructionArtifact;
  assert.ok(dual);
  assert.equal(dual.schema, "mocap.dual_reconstruction.v1");
  assert.equal(dual.status, "ready");
  assert.equal(dual.matchedFrameCount, 1);
  assert.equal(dual.triangulatedFrameCount, 1);
  assert.equal(dual.frames[0].landmarks3D.length, SYNTHETIC_LANDMARKS.length);
  assert.ok(dual.averageReprojectionErrorPx < 1e-8);
  assert.equal(dual.fallbackLandmarkRatio, 0);
  assert.ok(reconstruction.multiViewReconstructionSummaryArtifact);
  assert.ok(reconstruction.triangulatedJointTrackArtifact);
  assert.equal(
    reconstruction.triangulatedJointTrackArtifact.status,
    "ready",
  );
  assert.equal(
    reconstruction.triangulatedJointTrackArtifact.trackedFrameCount,
    1,
  );
  assert.equal(
    reconstruction.multiViewReconstructionSummaryArtifact.reconstructionSource,
    "triangulated_2d_keypoints",
  );
}

function buildFixtureQualityReport(
  reconstruction: Awaited<ReturnType<typeof buildSyntheticDualReconstruction>>,
  dualFitReport: ReturnType<typeof runDualCameraFittingFoundation>,
) {
  const whamInputUsage = buildWhamInputUsageMetrics({
    source: "dual_camera",
    selectedVideos: [
      { deviceIndex: 0, storageKey: sourceVideo(0).storageKey },
      { deviceIndex: 1, storageKey: sourceVideo(1).storageKey },
    ],
    primaryDeviceIndex: 0,
    multiViewReconstructionAvailable: true,
    multiViewConstraintsUsed: false,
    primaryWhamFallbackUsed: true,
    primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
  });

  return buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    {
      ok: true,
      errors: [],
      warnings: [],
      blenderOk: true,
      blenderSkipped: false,
    },
    "dual_camera",
    {
      whamInputUsage,
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: reconstruction.syncReport,
        calibrationObservations: reconstruction.calibrationObservations,
        cameraCalibration: reconstruction.calibrationArtifact,
        captureVolume: reconstruction.captureVolumeArtifact,
        reconstruction: reconstruction.reconstructionArtifact,
        dualReconstruction: reconstruction.dualReconstructionArtifact,
        multiViewReconstruction:
          reconstruction.multiViewReconstructionSummaryArtifact,
        jointTrack: reconstruction.triangulatedJointTrackArtifact,
        dualFitReport,
      },
    },
  );
}

function assertQualityReport(
  quality: ReturnType<typeof buildFixtureQualityReport>,
) {
  assert.equal(quality.schema, "mocap.quality_report.v1");
  assert.ok(quality.multiView);
  assert.equal(quality.multiView.reconstructionAvailable, true);
  assert.equal(quality.multiView.reconstructionUsedForConstraints, false);
  assert.equal(quality.multiView.primaryWhamFallbackUsed, true);
  assert.equal(quality.multiView.primaryCameraFallbackUsed, true);
  assert.equal(quality.multiView.finalAnimationSource, "primary_wham");
  assert.notEqual(quality.multiView.finalAnimationSource, "true_dual_solve");
  assert.notEqual(
    quality.multiView.finalAnimationSource,
    "dual_triangulation_constraint",
  );
  assert.equal(
    quality.multiView.primaryWhamFallbackReason,
    "multi_view_reconstruction_diagnostic_only",
  );
  assert.equal(quality.multiView.metrics?.matchedFrameCount, 1);
  assert.equal(quality.multiView.metrics?.triangulatedLandmarkRatio, 1);
  assert.equal(quality.multiView.calibrationObservationStatus, "ready");
  assert.equal(quality.multiView.captureVolumeStatus, "ready");
  assert.equal(quality.multiView.intrinsicsStatus, "ready");
  assert.equal(quality.multiView.extrinsicsStatus, "ready");
  assert.equal(quality.multiView.trueDualSolveAvailable, false);
  assert.equal(quality.multiView.dualReconstructionStatus, "ready");
  assert.equal(quality.multiView.jointTrackStatus, "ready");
  assert.equal(quality.multiView.dualFitStatus, "optimization_not_implemented");
  assert.equal(quality.multiView.dualFitAcceptedAsFinal, false);
  assert.equal(quality.multiView.optimizedBvhAvailable, false);
  assert.ok((quality.multiView.metrics?.reprojectionErrorPx ?? Infinity) < 1e-8);
  assert.equal(quality.metrics.multiViewMatchedFrameCount, 1);
  assert.equal(quality.metrics.multiViewTriangulatedLandmarkRatio, 1);
  assert.equal(quality.metrics.multiViewOptimizedBvhAvailable, 0);
}

function buildFixtureMotionPipelineReport(input: {
  artifacts: Awaited<ReturnType<typeof persistSyntheticArtifacts>>["artifacts"];
  quality: ReturnType<typeof buildFixtureQualityReport>;
  reconstruction: Awaited<ReturnType<typeof buildSyntheticDualReconstruction>>;
  dualFitReport: ReturnType<typeof runDualCameraFittingFoundation>;
}): MotionPipelineReport {
  const artifactRefs = artifactRefsFromPersistedMultiViewArtifacts(input.artifacts);
  const reconstructionStages = buildReconstructionDiagnosticStages({
    source: "dual_camera",
    branchKind: "multi_view_reconstruction",
    reconstructionAvailable: true,
    reconstructionStatus: "ready",
    artifactRefs,
    syncReport: input.reconstruction.syncReport,
    calibrationObservations: input.reconstruction.calibrationObservations,
    cameraCalibration: input.reconstruction.calibrationArtifact,
    captureVolume: input.reconstruction.captureVolumeArtifact,
    triangulatedJointTrack: input.reconstruction.triangulatedJointTrackArtifact,
    dualFitReport: input.dualFitReport,
    warnings: [],
  });
  const stages = sortMotionPipelineStages([
    buildMotionPipelineStage({
      stageName: "video_normalization",
      status: "completed",
      reason: "Synthetic dual-camera fixture videos were normalized.",
      artifactRefs: {
        normalized_device_0: sourceVideo(0).normalizedStorageKey ?? "",
        normalized_device_1: sourceVideo(1).normalizedStorageKey ?? "",
      },
    }),
    ...reconstructionStages,
    buildMotionPipelineStage({
      stageName: "primary_wham",
      status: "completed",
      reason:
        "WHAM produced the final animation from the primary selected video; multi-view reconstruction remained diagnostic.",
      artifactRefs: {
        smpl_parameters_json: `takes/${TAKE_ID}/jobs/${JOB_ID}/smpl_parameters.json`,
        raw_solved_motion_json: `takes/${TAKE_ID}/jobs/${JOB_ID}/raw_solved_motion.json`,
      },
      warnings: [
        "single_camera_solver_fallback_used",
        "multi_view_reconstruction_diagnostic_only",
      ],
    }),
    buildMotionPipelineStage({
      stageName: "quality_report",
      status: "completed",
      reason: "Quality report was generated with additive multi-view diagnostics.",
      artifactRefs: {
        quality_report_json: `takes/${TAKE_ID}/jobs/${JOB_ID}/quality_report.json`,
      },
    }),
    buildMotionPipelineStage({
      stageName: "final_animation_export",
      status: "completed",
      reason: "Final BVH export was generated from the primary WHAM motion path.",
      artifactRefs: {
        bvh: `takes/${TAKE_ID}/jobs/${JOB_ID}/result.bvh`,
        solved_motion_json: `takes/${TAKE_ID}/jobs/${JOB_ID}/solved_motion.json`,
      },
    }),
  ]);

  return {
    schema: "mocap.motion_pipeline_report.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    profile: "wham_smpl_smplify_only",
    engines: {
      backendMotion: "wham@fixture",
      mobileCapture: "video_upload",
      smpl: "SMPL",
      smplify: "enabled:fixture",
      inputSource: "dual_camera",
      cleanup: "cleanup_quality_v1_5",
    },
    fallback: {
      motionFallbackUsed: true,
      reasons: ["multi_view_reconstruction_diagnostic_only"],
    },
    finalAnimationSource: "primary_wham",
    artifacts: {
      smplParameters: `takes/${TAKE_ID}/jobs/${JOB_ID}/smpl_parameters.json`,
      rawSolvedMotion: `takes/${TAKE_ID}/jobs/${JOB_ID}/raw_solved_motion.json`,
      solvedMotion: `takes/${TAKE_ID}/jobs/${JOB_ID}/solved_motion.json`,
      cleanupReport: `takes/${TAKE_ID}/jobs/${JOB_ID}/cleanup_report.json`,
      qualityReport: `takes/${TAKE_ID}/jobs/${JOB_ID}/quality_report.json`,
      previewSummary: `takes/${TAKE_ID}/jobs/${JOB_ID}/preview_summary.json`,
      bvh: `takes/${TAKE_ID}/jobs/${JOB_ID}/result.bvh`,
    },
    quality: {
      score: input.quality.score,
      grade: input.quality.grade,
      warnings: input.quality.warnings,
      errors: input.quality.errors,
    },
    stages,
    whamInputUsage: input.quality.multiView?.whamInputUsage,
    createdAt: new Date(0).toISOString(),
  };
}

function assertMotionPipelineReport(report: MotionPipelineReport) {
  assert.equal(report.schema, "mocap.motion_pipeline_report.v1");
  assert.equal(report.fallback.motionFallbackUsed, true);
  assert.deepEqual(report.fallback.reasons, [
    "multi_view_reconstruction_diagnostic_only",
  ]);
  assert.equal(report.finalAnimationSource, "primary_wham");
  assert.equal(report.whamInputUsage?.primaryVideoUsed, true);
  assert.equal(report.whamInputUsage?.additionalVideosProvided, 1);
  assert.equal(report.whamInputUsage?.multiViewConstraintsUsed, false);

  const stageNames = report.stages?.map((stage) => stage.stageName);
  assert.deepEqual(stageNames, [
    "video_normalization",
    "primary_wham",
    "per_camera_pose_extraction",
    "frame_sync",
    "calibration_target_detection",
    "camera_intrinsics",
    "camera_extrinsics",
    "capture_volume",
    "camera_calibration",
    "dual_triangulation",
    "triangulated_joint_tracking",
    "dual_camera_fitting",
    "dual_reconstruction_artifacts",
    "quality_report",
    "final_animation_export",
  ]);
  assert.equal(
    report.stages?.find((stage) => stage.stageName === "primary_wham")?.status,
    "completed",
  );
  assert.equal(
    report.stages?.find(
      (stage) => stage.stageName === "calibration_target_detection",
    )?.status,
    "ready",
  );
  assert.equal(
    report.stages?.find((stage) => stage.stageName === "capture_volume")?.status,
    "ready",
  );
  assert.equal(
    report.stages?.find((stage) => stage.stageName === "dual_triangulation")
      ?.status,
    "ready",
  );
  assert.equal(
    report.stages?.find((stage) => stage.stageName === "triangulated_joint_tracking")
      ?.status,
    "ready",
  );
  assert.equal(
    report.stages?.find((stage) => stage.stageName === "dual_camera_fitting")
      ?.status,
    "diagnostic_only",
  );
  assert.equal(
    report.stages?.find((stage) => stage.stageName === "dual_camera_fitting")
      ?.finalAnimationSource,
    "primary_wham",
  );
  assert.ok(
    report.stages?.find(
      (stage) => stage.stageName === "triangulated_joint_tracking",
    )?.artifactRefs.triangulated_joint_track_json,
  );
  assert.ok(
    report.stages?.find(
      (stage) => stage.stageName === "dual_reconstruction_artifacts",
    )?.artifactRefs.dual_reconstruction_json,
  );
}

function testBranchGuardAcceptsDualInput() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "dual",
    selectedVideoCount: 2,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: true,
  });

  assert.equal(branch.kind, "multi_view_reconstruction");
  assert.equal(branch.primaryVideoUsed, true);
  assert.equal(branch.additionalVideosProvided, 1);
  assert.equal(branch.multiViewConstraintsUsed, false);
}

async function testSyntheticDualCameraGoldenE2eFixture() {
  testBranchGuardAcceptsDualInput();
  const reconstruction = await buildSyntheticDualReconstruction();
  assertDualReconstruction(reconstruction);
  const dualFitReport = runDualCameraFittingFoundation({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: validFittingWhamInitialization(),
    jointTrack: reconstruction.triangulatedJointTrackArtifact,
    poseArtifacts: reconstruction.poseArtifacts,
    cameraCalibration: reconstruction.calibrationArtifact,
  });
  assert.equal(dualFitReport.status, "optimization_not_implemented");
  assert.equal(dualFitReport.acceptedAsFinalAnimation, false);
  assert.equal(reconstruction.poseArtifacts.length, 2);
  assert.ok(
    reconstruction.poseArtifacts.every((artifact) => artifact.status !== "missing_pose_frames"),
  );
  assert.equal(reconstruction.syncReport.schema, "mocap.multiview_sync.v1");
  assert.equal(
    reconstruction.calibrationArtifact.schema,
    "mocap.camera_calibration.v1",
  );
  assert.equal(
    reconstruction.captureVolumeArtifact.schemaVersion,
    "mocap.capture_volume.v1",
  );

  const persistence = await persistSyntheticArtifacts(reconstruction, dualFitReport);
  assertArtifactContract(persistence.artifacts);

  const quality = buildFixtureQualityReport(reconstruction, dualFitReport);
  assertQualityReport(quality);

  const pipelineReport = buildFixtureMotionPipelineReport({
    artifacts: persistence.artifacts,
    quality,
    reconstruction,
    dualFitReport,
  });
  assertMotionPipelineReport(pipelineReport);
}

testSyntheticDualCameraGoldenE2eFixture()
  .then(() => {
    console.log("dual-camera golden E2E fixture test passed");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
