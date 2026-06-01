import type {
  CameraCalibrationArtifact,
  CameraCalibrationQuality,
  CameraCalibrationStatus,
  CalibrationObservationsArtifact,
  CameraExtrinsicsSource,
  CameraIntrinsicsSource,
  CameraProjection,
  Matrix3x3,
  MultiViewWarningCode,
  ProjectionMatrix3x4,
  Vector3,
  WorkerMultiViewErrorCode,
} from "../types";
import {
  buildProjectionMatrix as buildProjectionMatrixFromComponents,
  validateProjectionMatrix,
} from "./triangulation";

const DEFAULT_FOV_DEGREES = 69;
const DEFAULT_BASELINE_METERS = 1;
const DEFAULT_QUALITY_WARNING_THRESHOLD = 0.5;
const APPROXIMATE_QUALITY_CAP = 0.65;
const DIAGNOSTIC_QUALITY_CAP = 0.45;

export type CameraCalibrationValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export type CameraIntrinsicsInput = {
  matrix?: Matrix3x3;
  fx?: number;
  fy?: number;
  cx?: number;
  cy?: number;
  skew?: number;
  width?: number;
  height?: number;
  source?: Exclude<CameraIntrinsicsSource, "fov_fallback">;
  distortionCoefficients?: readonly number[];
};

export type CameraExtrinsicsInput = {
  rotation?: Matrix3x3;
  translation?: Vector3;
  cameraCenter?: Vector3;
  approxCameraAngleDegrees?: number;
  source?: Exclude<CameraExtrinsicsSource, "role_angle_fallback">;
};

export type CameraCalibrationDeviceInput = {
  cameraId?: string;
  deviceId?: string;
  deviceIndex: number;
  deviceRole: string;
  imageWidth: number;
  imageHeight: number;
  intrinsics?: CameraIntrinsicsInput | null;
  extrinsics?: CameraExtrinsicsInput | null;
  fovDegrees?: number;
  approxCameraAngleDegrees?: number;
  distortionCoefficients?: readonly number[];
};

export type BuildCameraCalibrationInput = {
  takeId: string;
  jobId: string;
  devices: readonly CameraCalibrationDeviceInput[];
  allowFovFallback?: boolean;
  defaultFovDegrees?: number;
  baselineMeters?: number;
  qualityWarningThreshold?: number;
  calibrationObservations?: CalibrationObservationsArtifact | null;
};

export class CameraCalibrationError extends Error {
  constructor(
    readonly code: Extract<
      WorkerMultiViewErrorCode,
      | "camera_calibration_failed"
      | "camera_projection_invalid"
      | "metadata_intrinsics_required"
    >,
    message: string,
  ) {
    super(message);
    this.name = "CameraCalibrationError";
  }
}

type CameraProjectionBuildResult = {
  projection: CameraProjection;
  warnings: MultiViewWarningCode[];
  fallbackUsed: boolean;
};

type IntrinsicBuildResult = {
  intrinsic: Matrix3x3;
  intrinsicsSource: CameraIntrinsicsSource;
  distortionCoefficients?: readonly number[];
  warnings: MultiViewWarningCode[];
  fallbackUsed: boolean;
};

type ExtrinsicsBuildResult = {
  rotation: Matrix3x3;
  translation: Vector3;
  extrinsicsSource: CameraExtrinsicsSource;
  warnings: MultiViewWarningCode[];
  fallbackUsed: boolean;
};

export function buildCameraCalibrationArtifact(
  input: BuildCameraCalibrationInput,
): CameraCalibrationArtifact {
  validateCalibrationInput(input);
  if (input.allowFovFallback === false && hasMissingIntrinsics(input.devices)) {
    return buildMissingCalibrationArtifact({
      takeId: input.takeId,
      jobId: input.jobId,
      reason:
        "Camera intrinsics are missing and FOV fallback is disabled for this calibration stage.",
    });
  }
  const warnings: MultiViewWarningCode[] = [];
  warnings.push(...warningsFromCalibrationObservations(input.calibrationObservations));
  const projections = input.devices
    .map((device) => buildCameraProjection({ device, input }))
    .sort((a, b) => a.projection.deviceIndex - b.projection.deviceIndex);
  for (const result of projections) {
    warnings.push(...result.warnings);
  }

  const devices = projections.map((result) => result.projection);
  const quality = buildCalibrationQuality({
    devices,
    metadataIntrinsicCount: devices.filter(
      (device) => device.intrinsicsSource === "capture_metadata",
    ).length,
    fallbackUsed: projections.some((result) => result.fallbackUsed),
  });
  if (
    quality.score <
    (input.qualityWarningThreshold ?? DEFAULT_QUALITY_WARNING_THRESHOLD)
  ) {
    warnings.push("calibration_quality_low");
  }

  const status = buildCalibrationStatus(devices);
  if (status !== "ready") {
    warnings.push("calibration_approximate");
  }

  return {
    schema: "mocap.camera_calibration.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    source: buildArtifactSource(devices),
    intrinsicsSource: buildArtifactIntrinsicsSource(devices),
    devices,
    cameras: devices,
    baselineEstimate: quality.baseline,
    coordinateSystem: "right_handed_y_up",
    ...calibrationObservationSummary(input.calibrationObservations),
    status,
    reason: reasonForStatus(status),
    quality,
    warnings: dedupeWarnings(warnings),
  };
}

export function buildMissingCalibrationArtifact(input: {
  takeId: string;
  jobId: string;
  reason: string;
}): CameraCalibrationArtifact {
  return {
    schema: "mocap.camera_calibration.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    source: "metadata_and_fov_fallback",
    intrinsicsSource: "fov_fallback",
    devices: [],
    cameras: [],
    baselineEstimate: 0,
    coordinateSystem: "right_handed_y_up",
    status: "missing_calibration",
    reason: input.reason,
    quality: {
      score: 0,
      averageReprojectionErrorPx: 0,
      baseline: 0,
      convergenceAngle: 0,
    },
    warnings: ["camera_intrinsics_missing"],
  };
}

function calibrationObservationSummary(
  observations: CalibrationObservationsArtifact | null | undefined,
): Pick<
  CameraCalibrationArtifact,
  | "calibrationObservationStatus"
  | "calibrationTargetType"
  | "calibrationObservationCount"
  | "calibrationDetectorSource"
  | "calibrationObservationConfidence"
> {
  if (!observations) return {};
  const confidences = observations.frames.flatMap((frame) =>
    frame.observations.map((observation) => observation.confidence),
  );
  return {
    calibrationObservationStatus: observations.status,
    calibrationTargetType: observations.targetType,
    calibrationObservationCount: confidences.length,
    calibrationDetectorSource: observations.detectorSource,
    calibrationObservationConfidence: average(confidences),
  };
}

function warningsFromCalibrationObservations(
  observations: CalibrationObservationsArtifact | null | undefined,
): MultiViewWarningCode[] {
  if (!observations) return [];
  if (observations.status !== "ready") {
    return ["calibration_observations_missing"];
  }
  return ["calibration_observation_solve_not_implemented"];
}

export function buildCameraProjection(input: {
  device: CameraCalibrationDeviceInput;
  input?: Pick<
    BuildCameraCalibrationInput,
    "allowFovFallback" | "defaultFovDegrees" | "baselineMeters"
  >;
}): CameraProjectionBuildResult {
  validateDeviceInput(input.device);
  const intrinsicResult = buildIntrinsic({
    device: input.device,
    defaultFovDegrees: input.input?.defaultFovDegrees ?? DEFAULT_FOV_DEGREES,
    allowFovFallback: input.input?.allowFovFallback ?? true,
  });
  const extrinsics = buildExtrinsics({
    device: input.device,
    baselineMeters: input.input?.baselineMeters ?? DEFAULT_BASELINE_METERS,
  });
  const projection = buildProjectionMatrixFromComponents({
    intrinsic: intrinsicResult.intrinsic,
    rotation: extrinsics.rotation,
    translation: extrinsics.translation,
  });
  assertValidProjection(projection);

  return {
    projection: {
      cameraId: input.device.cameraId ?? `camera_${input.device.deviceIndex}`,
      deviceId: input.device.deviceId,
      deviceIndex: input.device.deviceIndex,
      deviceRole: input.device.deviceRole,
      imageWidth: input.device.imageWidth,
      imageHeight: input.device.imageHeight,
      intrinsic: intrinsicResult.intrinsic,
      intrinsicMatrixK: intrinsicResult.intrinsic,
      rotation: extrinsics.rotation,
      rotationR: extrinsics.rotation,
      translation: extrinsics.translation,
      translationT: extrinsics.translation,
      projection,
      projectionMatrixP: projection,
      distortionCoefficients:
        input.device.distortionCoefficients ??
        intrinsicResult.distortionCoefficients,
      intrinsicsSource: intrinsicResult.intrinsicsSource,
      extrinsicsSource: extrinsics.extrinsicsSource,
      calibrationQualityScore: buildCameraCalibrationQualityScore({
        intrinsicsSource: intrinsicResult.intrinsicsSource,
        extrinsicsSource: extrinsics.extrinsicsSource,
      }),
      warnings: dedupeWarnings([
        ...intrinsicResult.warnings,
        ...extrinsics.warnings,
      ]),
    },
    warnings: dedupeWarnings([
      ...intrinsicResult.warnings,
      ...extrinsics.warnings,
    ]),
    fallbackUsed: intrinsicResult.fallbackUsed || extrinsics.fallbackUsed,
  };
}

export function buildIntrinsicsFromFov(input: {
  width: number;
  height: number;
  fovDegrees?: number;
}): Matrix3x3 {
  validatePositiveFiniteNumber(input.width, "width");
  validatePositiveFiniteNumber(input.height, "height");
  const fovDegrees = input.fovDegrees ?? DEFAULT_FOV_DEGREES;
  if (!Number.isFinite(fovDegrees) || fovDegrees <= 0 || fovDegrees >= 180) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      "FOV must be a finite number between 0 and 180 degrees.",
    );
  }
  const fovRad = (fovDegrees * Math.PI) / 180;
  const fx = input.width / 2 / Math.tan(fovRad / 2);
  const fy = fx;
  return [
    fx,
    0,
    input.width / 2,
    0,
    fy,
    input.height / 2,
    0,
    0,
    1,
  ];
}

export function validateCameraCalibrationArtifact(
  artifact: CameraCalibrationArtifact,
): CameraCalibrationValidationResult {
  const errors: string[] = [];
  if (artifact.schema !== "mocap.camera_calibration.v1") {
    errors.push("schema must be mocap.camera_calibration.v1");
  }
  if (!artifact.takeId) errors.push("takeId is required");
  if (!artifact.jobId) errors.push("jobId is required");
  if (
    ![
      "calibration_payload",
      "stored_profile",
      "capture_metadata",
      "metadata_and_fov_fallback",
      "calibration_clip",
    ].includes(artifact.source)
  ) {
    errors.push("source is invalid");
  }
  if (
    ![
      "calibration_payload",
      "stored_profile",
      "capture_metadata",
      "capture_metadata_or_fov",
      "fov_fallback",
    ].includes(artifact.intrinsicsSource)
  ) {
    errors.push("intrinsicsSource is invalid");
  }
  if (artifact.status && !isCameraCalibrationStatus(artifact.status)) {
    errors.push("status is invalid");
  }
  if (
    artifact.coordinateSystem &&
    artifact.coordinateSystem !== "right_handed_y_up"
  ) {
    errors.push("coordinateSystem is invalid");
  }
  if (artifact.baselineEstimate != null) {
    validateNonNegativeFiniteNumberForReport(
      artifact.baselineEstimate,
      "baselineEstimate",
      errors,
    );
  }
  if (artifact.cameras) {
    validateCalibrationDevices(artifact.cameras, errors, "cameras");
  }
  validateCalibrationDevices(artifact.devices, errors);
  validateCalibrationQuality(artifact.quality, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function buildIntrinsic(input: {
  device: CameraCalibrationDeviceInput;
  defaultFovDegrees: number;
  allowFovFallback: boolean;
}): IntrinsicBuildResult {
  const metadataIntrinsic = buildMetadataIntrinsic(input.device.intrinsics);
  if (metadataIntrinsic) {
    return {
      intrinsic: metadataIntrinsic.intrinsic,
      intrinsicsSource: metadataIntrinsic.intrinsicsSource,
      distortionCoefficients:
        input.device.distortionCoefficients ??
        metadataIntrinsic.distortionCoefficients,
      warnings: [],
      fallbackUsed: false,
    };
  }

  if (!input.allowFovFallback) {
    throw new CameraCalibrationError(
      "metadata_intrinsics_required",
      "Camera intrinsics are missing and FOV fallback is disabled.",
    );
  }

  return {
    intrinsic: buildIntrinsicsFromFov({
      width: input.device.imageWidth,
      height: input.device.imageHeight,
      fovDegrees: input.device.fovDegrees ?? input.defaultFovDegrees,
    }),
    intrinsicsSource: "fov_fallback",
    warnings: ["camera_intrinsics_missing", "camera_intrinsics_fov_fallback_used"],
    fallbackUsed: true,
  };
}

function buildMetadataIntrinsic(
  intrinsics: CameraIntrinsicsInput | null | undefined,
): {
  intrinsic: Matrix3x3;
  intrinsicsSource: Exclude<CameraIntrinsicsSource, "fov_fallback">;
  distortionCoefficients?: readonly number[];
} | null {
  if (!intrinsics) return null;
  const intrinsicsSource = intrinsics.source ?? "capture_metadata";
  if (intrinsics.matrix) {
    validateIntrinsicMatrix(intrinsics.matrix, "intrinsics.matrix");
    return {
      intrinsic: intrinsics.matrix,
      intrinsicsSource,
      distortionCoefficients: intrinsics.distortionCoefficients,
    };
  }
  if (
    intrinsics.fx == null ||
    intrinsics.cx == null ||
    intrinsics.cy == null
  ) {
    return null;
  }
  validatePositiveFiniteNumber(intrinsics.fx, "intrinsics.fx");
  validatePositiveFiniteNumber(intrinsics.fy ?? intrinsics.fx, "intrinsics.fy");
  validateFiniteNumber(intrinsics.cx, "intrinsics.cx");
  validateFiniteNumber(intrinsics.cy, "intrinsics.cy");
  const skew = intrinsics.skew ?? 0;
  validateFiniteNumber(skew, "intrinsics.skew");
  return {
    intrinsic: [
      intrinsics.fx,
      skew,
      intrinsics.cx,
      0,
      intrinsics.fy ?? intrinsics.fx,
      intrinsics.cy,
      0,
      0,
      1,
    ],
    intrinsicsSource,
    distortionCoefficients: intrinsics.distortionCoefficients,
  };
}

function buildExtrinsics(input: {
  device: CameraCalibrationDeviceInput;
  baselineMeters: number;
}): ExtrinsicsBuildResult {
  validatePositiveFiniteNumber(input.baselineMeters, "baselineMeters");
  const provided = input.device.extrinsics;
  if (provided?.rotation) {
    validateRotationMatrix(provided.rotation, "extrinsics.rotation");
    if (provided.translation) {
      validateVector3(provided.translation, "extrinsics.translation");
      validateTranslationForDevice({
        deviceIndex: input.device.deviceIndex,
        translation: provided.translation,
        label: "extrinsics.translation",
      });
      return {
        rotation: provided.rotation,
        translation: provided.translation,
        extrinsicsSource: provided.source ?? "capture_metadata",
        warnings: [],
        fallbackUsed: false,
      };
    }
    if (provided.cameraCenter) {
      validateVector3(provided.cameraCenter, "extrinsics.cameraCenter");
      const translation = translationFromCameraCenter(
        provided.rotation,
        provided.cameraCenter,
      );
      validateTranslationForDevice({
        deviceIndex: input.device.deviceIndex,
        translation,
        label: "extrinsics.cameraCenter",
      });
      return {
        rotation: provided.rotation,
        translation,
        extrinsicsSource: provided.source ?? "capture_metadata",
        warnings: [],
        fallbackUsed: false,
      };
    }
  }

  const angleDegrees =
    input.device.extrinsics?.approxCameraAngleDegrees ??
    input.device.approxCameraAngleDegrees ??
    defaultAngleForRole(input.device.deviceRole);
  const rotation = rotationY(degreesToRadians(angleDegrees));
  const cameraCenter = approximateCameraCenter({
    deviceRole: input.device.deviceRole,
    deviceIndex: input.device.deviceIndex,
    baselineMeters: input.baselineMeters,
  });

  return {
    rotation,
    translation: translationFromCameraCenter(rotation, cameraCenter),
    extrinsicsSource: "role_angle_fallback",
    warnings: [
      "camera_extrinsics_missing",
      "camera_extrinsics_role_angle_fallback_used",
    ],
    fallbackUsed: true,
  };
}

function buildCalibrationQuality(input: {
  devices: readonly CameraProjection[];
  metadataIntrinsicCount: number;
  fallbackUsed: boolean;
}): CameraCalibrationQuality {
  const baseline = computeBaseline(input.devices);
  const convergenceAngle = computeConvergenceAngle(input.devices);
  const metadataRatio =
    input.devices.length > 0
      ? input.metadataIntrinsicCount / input.devices.length
      : 0;
  const fallbackRatio = 1 - metadataRatio;
  const baselineScore = clamp01(baseline / DEFAULT_BASELINE_METERS);
  const convergenceScore = clamp01(convergenceAngle / 30);
  const rawScore = clamp01(
    0.35 +
      metadataRatio * 0.3 +
      baselineScore * 0.2 +
      convergenceScore * 0.15 -
      fallbackRatio * 0.1,
  );
  const allIntrinsicsFallback = input.devices.every(
    (device) => device.intrinsicsSource === "fov_fallback",
  );
  const score = input.fallbackUsed
    ? Math.min(
        rawScore,
        allIntrinsicsFallback ? DIAGNOSTIC_QUALITY_CAP : APPROXIMATE_QUALITY_CAP,
      )
    : rawScore;

  return {
    score,
    averageReprojectionErrorPx: 0,
    baseline,
    convergenceAngle,
  };
}

function buildCameraCalibrationQualityScore(input: {
  intrinsicsSource: CameraIntrinsicsSource;
  extrinsicsSource: CameraExtrinsicsSource;
}) {
  let score = 1;
  if (input.intrinsicsSource === "stored_profile") score -= 0.05;
  if (input.intrinsicsSource === "capture_metadata") score -= 0.1;
  if (input.intrinsicsSource === "fov_fallback") score -= 0.35;
  if (input.extrinsicsSource === "stored_profile") score -= 0.05;
  if (input.extrinsicsSource === "capture_metadata") score -= 0.1;
  if (input.extrinsicsSource === "role_angle_fallback") score -= 0.3;
  return clamp01(score);
}

function buildCalibrationStatus(
  devices: readonly CameraProjection[],
): CameraCalibrationStatus {
  if (devices.length < 2) return "insufficient_views";
  const hasFallback = devices.some(
    (device) =>
      device.intrinsicsSource === "fov_fallback" ||
      device.extrinsicsSource === "role_angle_fallback",
  );
  return hasFallback ? "approximate" : "ready";
}

function reasonForStatus(status: CameraCalibrationStatus): string {
  if (status === "ready") {
    return [
      "Calibration has valid intrinsics, extrinsics, and projection matrices",
      "for all selected cameras.",
    ].join(" ");
  }
  if (status === "approximate") {
    return "Calibration uses one or more explicit fallback sources and is not production-grade.";
  }
  if (status === "insufficient_views") {
    return "At least two calibrated camera views are required.";
  }
  if (status === "missing_calibration") {
    return "Camera calibration data is missing.";
  }
  if (status === "invalid_calibration") {
    return "Camera calibration data failed validation.";
  }
  if (status === "diagnostic_only") {
    return "Camera calibration is suitable only for diagnostics.";
  }
  return "Camera calibration failed.";
}

function hasMissingIntrinsics(
  devices: readonly CameraCalibrationDeviceInput[],
): boolean {
  return devices.some((device) => !buildMetadataIntrinsic(device.intrinsics));
}

function buildArtifactSource(
  devices: readonly CameraProjection[],
): CameraCalibrationArtifact["source"] {
  if (
    devices.length > 0 &&
    devices.every(
      (device) =>
        device.intrinsicsSource === "calibration_payload" &&
        device.extrinsicsSource === "calibration_payload",
    )
  ) {
    return "calibration_payload";
  }
  if (
    devices.length > 0 &&
    devices.every(
      (device) =>
        device.intrinsicsSource === "stored_profile" &&
        device.extrinsicsSource === "stored_profile",
    )
  ) {
    return "stored_profile";
  }
  return devices.every(
    (device) =>
      device.intrinsicsSource === "capture_metadata" &&
      device.extrinsicsSource === "capture_metadata",
  )
    ? "capture_metadata"
    : "metadata_and_fov_fallback";
}

function buildArtifactIntrinsicsSource(
  devices: readonly CameraProjection[],
): CameraCalibrationArtifact["intrinsicsSource"] {
  if (
    devices.length > 0 &&
    devices.every((device) => device.intrinsicsSource === "calibration_payload")
  ) {
    return "calibration_payload";
  }
  if (
    devices.length > 0 &&
    devices.every((device) => device.intrinsicsSource === "stored_profile")
  ) {
    return "stored_profile";
  }
  const metadataCount = devices.filter(
    (device) => device.intrinsicsSource === "capture_metadata",
  ).length;
  if (metadataCount === devices.length) return "capture_metadata";
  if (metadataCount === 0) return "fov_fallback";
  return "capture_metadata_or_fov";
}

function approximateCameraCenter(input: {
  deviceRole: string;
  deviceIndex: number;
  baselineMeters: number;
}): Vector3 {
  const role = input.deviceRole.toLowerCase();
  if (input.deviceIndex === 0 || role === "front" || role === "primary") {
    return [0, 0, 0];
  }
  if (role === "left") return [-input.baselineMeters, 0, 0];
  if (role === "right" || role === "secondary") return [input.baselineMeters, 0, 0];
  if (role === "back") return [0, 0, -input.baselineMeters];
  const angle = (2 * Math.PI * input.deviceIndex) / 4;
  return [
    Math.sin(angle) * input.baselineMeters,
    0,
    -Math.cos(angle) * input.baselineMeters,
  ];
}

function defaultAngleForRole(deviceRole: string) {
  const role = deviceRole.toLowerCase();
  if (role === "left") return 25;
  if (role === "right" || role === "secondary") return -25;
  if (role === "back") return 180;
  return 0;
}

function translationFromCameraCenter(
  rotation: Matrix3x3,
  cameraCenter: Vector3,
): Vector3 {
  return [
    -(
      rotation[0] * cameraCenter[0] +
      rotation[1] * cameraCenter[1] +
      rotation[2] * cameraCenter[2]
    ),
    -(
      rotation[3] * cameraCenter[0] +
      rotation[4] * cameraCenter[1] +
      rotation[5] * cameraCenter[2]
    ),
    -(
      rotation[6] * cameraCenter[0] +
      rotation[7] * cameraCenter[1] +
      rotation[8] * cameraCenter[2]
    ),
  ];
}

function cameraCenterFromExtrinsics(projection: CameraProjection): Vector3 {
  const r = projection.rotation;
  const t = projection.translation;
  return [
    -(r[0] * t[0] + r[3] * t[1] + r[6] * t[2]),
    -(r[1] * t[0] + r[4] * t[1] + r[7] * t[2]),
    -(r[2] * t[0] + r[5] * t[1] + r[8] * t[2]),
  ];
}

function forwardAxisFromRotation(rotation: Matrix3x3): Vector3 {
  return [rotation[6], rotation[7], rotation[8]];
}

function computeBaseline(devices: readonly CameraProjection[]) {
  if (devices.length < 2) return 0;
  const reference = devices.find((device) => device.deviceIndex === 0) ?? devices[0];
  const referenceCenter = cameraCenterFromExtrinsics(reference);
  return Math.max(
    ...devices
      .filter((device) => device.deviceIndex !== reference.deviceIndex)
      .map((device) =>
        distance(referenceCenter, cameraCenterFromExtrinsics(device)),
      ),
    0,
  );
}

function computeConvergenceAngle(devices: readonly CameraProjection[]) {
  if (devices.length < 2) return 0;
  const reference = devices.find((device) => device.deviceIndex === 0) ?? devices[0];
  const referenceForward = forwardAxisFromRotation(reference.rotation);
  const angles = devices
    .filter((device) => device.deviceIndex !== reference.deviceIndex)
    .map((device) =>
      angleBetweenVectors(referenceForward, forwardAxisFromRotation(device.rotation)),
    );
  return angles.length ? average(angles) : 0;
}

function rotationY(radians: number): Matrix3x3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, 0, sin, 0, 1, 0, -sin, 0, cos];
}

function validateCalibrationInput(input: BuildCameraCalibrationInput) {
  if (!input.takeId) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      "takeId is required for camera calibration.",
    );
  }
  if (!input.jobId) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      "jobId is required for camera calibration.",
    );
  }
  if (input.devices.length < 2) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      "At least two camera devices are required for calibration.",
    );
  }
  const seenDeviceIndexes = new Set<number>();
  for (const device of input.devices) {
    if (seenDeviceIndexes.has(device.deviceIndex)) {
      throw new CameraCalibrationError(
        "camera_calibration_failed",
        `Duplicate camera deviceIndex ${device.deviceIndex}.`,
      );
    }
    seenDeviceIndexes.add(device.deviceIndex);
  }
}

function validateDeviceInput(device: CameraCalibrationDeviceInput) {
  if (!Number.isInteger(device.deviceIndex) || device.deviceIndex < 0) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      "deviceIndex must be a non-negative integer.",
    );
  }
  if (!device.deviceRole) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      "deviceRole is required.",
    );
  }
  validatePositiveFiniteNumber(device.imageWidth, "imageWidth");
  validatePositiveFiniteNumber(device.imageHeight, "imageHeight");
}

function validateCalibrationDevices(
  devices: readonly CameraProjection[],
  errors: string[],
  label = "devices",
) {
  if (!devices.length) errors.push(`${label} must not be empty`);
  const seenDeviceIndexes = new Set<number>();
  for (const [index, device] of devices.entries()) {
    if (!Number.isInteger(device.deviceIndex) || device.deviceIndex < 0) {
      errors.push(`${label}[${index}].deviceIndex must be a non-negative integer`);
    }
    if (seenDeviceIndexes.has(device.deviceIndex)) {
      errors.push(`${label}[${index}].deviceIndex must be unique`);
    }
    seenDeviceIndexes.add(device.deviceIndex);
    if (!device.deviceRole) errors.push(`${label}[${index}].deviceRole is required`);
    if (!isCameraIntrinsicsSource(device.intrinsicsSource)) {
      errors.push(`${label}[${index}].intrinsicsSource is invalid`);
    }
    if (
      device.extrinsicsSource &&
      !isCameraExtrinsicsSource(device.extrinsicsSource)
    ) {
      errors.push(`${label}[${index}].extrinsicsSource is invalid`);
    }
    if (device.imageWidth != null) {
      validatePositiveFiniteNumberForReport(
        device.imageWidth,
        `${label}[${index}].imageWidth`,
        errors,
      );
    }
    if (device.imageHeight != null) {
      validatePositiveFiniteNumberForReport(
        device.imageHeight,
        `${label}[${index}].imageHeight`,
        errors,
      );
    }
    validateIntrinsicMatrixForReport(
      device.intrinsic,
      `${label}[${index}].intrinsic`,
      errors,
    );
    if (device.intrinsicMatrixK) {
      validateIntrinsicMatrixForReport(
        device.intrinsicMatrixK,
        `${label}[${index}].intrinsicMatrixK`,
        errors,
      );
    }
    validateRotationMatrixForReport(
      device.rotation,
      `${label}[${index}].rotation`,
      errors,
    );
    if (device.rotationR) {
      validateRotationMatrixForReport(
        device.rotationR,
        `${label}[${index}].rotationR`,
        errors,
      );
    }
    validateVector3ForReport(
      device.translation,
      `${label}[${index}].translation`,
      errors,
    );
    if (device.translationT) {
      validateVector3ForReport(
        device.translationT,
        `${label}[${index}].translationT`,
        errors,
      );
    }
    const projectionValidation = validateProjectionMatrix({
      projection: device.projection,
    });
    if (!projectionValidation.ok) {
      errors.push(
        `${label}[${index}].projection camera_projection_invalid: ${projectionValidation.reason}`,
      );
    }
    if (device.projectionMatrixP) {
      const aliasProjectionValidation = validateProjectionMatrix({
        projection: device.projectionMatrixP,
      });
      if (!aliasProjectionValidation.ok) {
        errors.push(
          [
            `${label}[${index}].projectionMatrixP camera_projection_invalid:`,
            aliasProjectionValidation.reason,
          ].join(" "),
        );
      }
    }
    if (device.calibrationQualityScore != null) {
      validateUnitIntervalForReport(
        device.calibrationQualityScore,
        `${label}[${index}].calibrationQualityScore`,
        errors,
      );
    }
  }
}

function validateCalibrationQuality(
  quality: CameraCalibrationQuality,
  errors: string[],
) {
  validateUnitIntervalForReport(quality.score, "quality.score", errors);
  validateNonNegativeFiniteNumberForReport(
    quality.averageReprojectionErrorPx,
    "quality.averageReprojectionErrorPx",
    errors,
  );
  validateNonNegativeFiniteNumberForReport(quality.baseline, "quality.baseline", errors);
  validateNonNegativeFiniteNumberForReport(
    quality.convergenceAngle,
    "quality.convergenceAngle",
    errors,
  );
}

function assertValidProjection(projection: ProjectionMatrix3x4) {
  const validation = validateProjectionMatrix({ projection });
  if (!validation.ok) {
    throw new CameraCalibrationError(
      "camera_projection_invalid",
      validation.reason,
    );
  }
}

function validateMatrix3x3(matrix: Matrix3x3, label: string) {
  if (matrix.length !== 9 || !matrix.every(Number.isFinite)) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      `${label} must contain 9 finite numbers.`,
    );
  }
}

function validateIntrinsicMatrix(matrix: Matrix3x3, label: string) {
  validateMatrix3x3(matrix, label);
  if (matrix[0] <= 0 || matrix[4] <= 0) {
    throw new CameraCalibrationError(
      "camera_projection_invalid",
      `${label} must have positive focal lengths.`,
    );
  }
  if (
    Math.abs(matrix[6]) > 1e-9 ||
    Math.abs(matrix[7]) > 1e-9 ||
    Math.abs(matrix[8] - 1) > 1e-9
  ) {
    throw new CameraCalibrationError(
      "camera_projection_invalid",
      `${label} must use normalized camera coordinates in the third row.`,
    );
  }
}

function validateRotationMatrix(matrix: Matrix3x3, label: string) {
  validateMatrix3x3(matrix, label);
  const row0: Vector3 = [matrix[0], matrix[1], matrix[2]];
  const row1: Vector3 = [matrix[3], matrix[4], matrix[5]];
  const row2: Vector3 = [matrix[6], matrix[7], matrix[8]];
  const rowNormTolerance = 0.08;
  const orthogonalTolerance = 0.08;
  if (
    Math.abs(vectorNorm(row0) - 1) > rowNormTolerance ||
    Math.abs(vectorNorm(row1) - 1) > rowNormTolerance ||
    Math.abs(vectorNorm(row2) - 1) > rowNormTolerance ||
    Math.abs(dot(row0, row1)) > orthogonalTolerance ||
    Math.abs(dot(row0, row2)) > orthogonalTolerance ||
    Math.abs(dot(row1, row2)) > orthogonalTolerance ||
    Math.abs(determinant3x3(matrix) - 1) > 0.12
  ) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      `${label} must be a valid rotation-like matrix.`,
    );
  }
}

function validateTranslationForDevice(input: {
  deviceIndex: number;
  translation: Vector3;
  label: string;
}) {
  if (input.deviceIndex === 0) return;
  if (vectorNorm(input.translation) <= 1e-6) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      `${input.label} must be non-degenerate for non-reference cameras.`,
    );
  }
}

function validateVector3(vector: Vector3, label: string) {
  if (vector.length !== 3 || !vector.every(Number.isFinite)) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      `${label} must contain 3 finite numbers.`,
    );
  }
}

function validatePositiveFiniteNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      `${label} must be a positive finite number.`,
    );
  }
}

function validateFiniteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new CameraCalibrationError(
      "camera_calibration_failed",
      `${label} must be finite.`,
    );
  }
}

function isCameraCalibrationStatus(
  status: string,
): status is CameraCalibrationStatus {
  return [
    "ready",
    "approximate",
    "diagnostic_only",
    "missing_calibration",
    "invalid_calibration",
    "insufficient_views",
    "failed",
  ].includes(status);
}

function isCameraIntrinsicsSource(
  source: string,
): source is CameraIntrinsicsSource {
  return [
    "calibration_payload",
    "stored_profile",
    "capture_metadata",
    "fov_fallback",
  ].includes(source);
}

function isCameraExtrinsicsSource(
  source: string,
): source is CameraExtrinsicsSource {
  return [
    "calibration_payload",
    "stored_profile",
    "capture_metadata",
    "role_angle_fallback",
  ].includes(source);
}

function validateMatrix3x3ForReport(
  matrix: Matrix3x3,
  label: string,
  errors: string[],
) {
  if (matrix.length !== 9 || !matrix.every(Number.isFinite)) {
    errors.push(`${label} must contain 9 finite numbers`);
  }
}

function validateIntrinsicMatrixForReport(
  matrix: Matrix3x3,
  label: string,
  errors: string[],
) {
  validateMatrix3x3ForReport(matrix, label, errors);
  if (matrix.length !== 9 || !matrix.every(Number.isFinite)) return;
  if (matrix[0] <= 0 || matrix[4] <= 0) {
    errors.push(`${label} must have positive focal lengths`);
  }
  if (
    Math.abs(matrix[6]) > 1e-9 ||
    Math.abs(matrix[7]) > 1e-9 ||
    Math.abs(matrix[8] - 1) > 1e-9
  ) {
    errors.push(`${label} must use normalized camera coordinates in the third row`);
  }
}

function validateRotationMatrixForReport(
  matrix: Matrix3x3,
  label: string,
  errors: string[],
) {
  validateMatrix3x3ForReport(matrix, label, errors);
  if (matrix.length !== 9 || !matrix.every(Number.isFinite)) return;
  try {
    validateRotationMatrix(matrix, label);
  } catch {
    errors.push(`${label} must be a valid rotation-like matrix`);
  }
}

function validateVector3ForReport(
  vector: Vector3,
  label: string,
  errors: string[],
) {
  if (vector.length !== 3 || !vector.every(Number.isFinite)) {
    errors.push(`${label} must contain 3 finite numbers`);
  }
}

function validateNonNegativeFiniteNumberForReport(
  value: number,
  label: string,
  errors: string[],
) {
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${label} must be a non-negative finite number`);
  }
}

function validatePositiveFiniteNumberForReport(
  value: number,
  label: string,
  errors: string[],
) {
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${label} must be a positive finite number`);
  }
}

function validateUnitIntervalForReport(
  value: number,
  label: string,
  errors: string[],
) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(`${label} must be between 0 and 1`);
  }
}

function angleBetweenVectors(a: Vector3, b: Vector3) {
  const denominator = vectorNorm(a) * vectorNorm(b);
  if (denominator === 0) return 0;
  const cosine = clamp((dot(a, b) / denominator), -1, 1);
  return radiansToDegrees(Math.acos(cosine));
}

function distance(a: Vector3, b: Vector3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function dot(a: Vector3, b: Vector3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function determinant3x3(matrix: Matrix3x3) {
  return (
    matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) -
    matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) +
    matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6])
  );
}

function vectorNorm(vector: Vector3) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function average(values: readonly number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dedupeWarnings(warnings: readonly MultiViewWarningCode[]) {
  return Array.from(new Set(warnings));
}

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
