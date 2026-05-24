import type {
  CameraCalibrationArtifact,
  CameraCalibrationQuality,
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
};

export type CameraExtrinsicsInput = {
  rotation?: Matrix3x3;
  translation?: Vector3;
  cameraCenter?: Vector3;
  approxCameraAngleDegrees?: number;
};

export type CameraCalibrationDeviceInput = {
  deviceIndex: number;
  deviceRole: string;
  imageWidth: number;
  imageHeight: number;
  intrinsics?: CameraIntrinsicsInput | null;
  extrinsics?: CameraExtrinsicsInput | null;
  fovDegrees?: number;
  approxCameraAngleDegrees?: number;
};

export type BuildCameraCalibrationInput = {
  takeId: string;
  jobId: string;
  devices: readonly CameraCalibrationDeviceInput[];
  defaultFovDegrees?: number;
  baselineMeters?: number;
  qualityWarningThreshold?: number;
};

export class CameraCalibrationError extends Error {
  constructor(
    readonly code: Extract<
      WorkerMultiViewErrorCode,
      "camera_calibration_failed" | "camera_projection_invalid"
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
};

type IntrinsicBuildResult = {
  intrinsic: Matrix3x3;
  intrinsicsSource: CameraProjection["intrinsicsSource"];
  warnings: MultiViewWarningCode[];
};

type ExtrinsicsBuildResult = {
  rotation: Matrix3x3;
  translation: Vector3;
};

export function buildCameraCalibrationArtifact(
  input: BuildCameraCalibrationInput,
): CameraCalibrationArtifact {
  validateCalibrationInput(input);
  const warnings: MultiViewWarningCode[] = [];
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
  });
  if (
    quality.score <
    (input.qualityWarningThreshold ?? DEFAULT_QUALITY_WARNING_THRESHOLD)
  ) {
    warnings.push("calibration_quality_low");
  }

  return {
    schema: "mocap.camera_calibration.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    source: buildArtifactSource(devices),
    intrinsicsSource: buildArtifactIntrinsicsSource(devices),
    devices,
    quality,
    warnings: dedupeWarnings(warnings),
  };
}

export function buildCameraProjection(input: {
  device: CameraCalibrationDeviceInput;
  input?: Pick<BuildCameraCalibrationInput, "defaultFovDegrees" | "baselineMeters">;
}): CameraProjectionBuildResult {
  validateDeviceInput(input.device);
  const intrinsicResult = buildIntrinsic({
    device: input.device,
    defaultFovDegrees: input.input?.defaultFovDegrees ?? DEFAULT_FOV_DEGREES,
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
      deviceIndex: input.device.deviceIndex,
      deviceRole: input.device.deviceRole,
      intrinsic: intrinsicResult.intrinsic,
      rotation: extrinsics.rotation,
      translation: extrinsics.translation,
      projection,
      intrinsicsSource: intrinsicResult.intrinsicsSource,
    },
    warnings: intrinsicResult.warnings,
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
    !["capture_metadata", "metadata_and_fov_fallback", "calibration_clip"].includes(
      artifact.source,
    )
  ) {
    errors.push("source is invalid");
  }
  if (
    !["capture_metadata", "capture_metadata_or_fov", "fov_fallback"].includes(
      artifact.intrinsicsSource,
    )
  ) {
    errors.push("intrinsicsSource is invalid");
  }
  validateCalibrationDevices(artifact.devices, errors);
  validateCalibrationQuality(artifact.quality, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function buildIntrinsic(input: {
  device: CameraCalibrationDeviceInput;
  defaultFovDegrees: number;
}): IntrinsicBuildResult {
  const metadataIntrinsic = buildMetadataIntrinsic(input.device.intrinsics);
  if (metadataIntrinsic) {
    return {
      intrinsic: metadataIntrinsic,
      intrinsicsSource: "capture_metadata",
      warnings: [],
    };
  }

  return {
    intrinsic: buildIntrinsicsFromFov({
      width: input.device.imageWidth,
      height: input.device.imageHeight,
      fovDegrees: input.device.fovDegrees ?? input.defaultFovDegrees,
    }),
    intrinsicsSource: "fov_fallback",
    warnings: ["camera_intrinsics_missing", "camera_intrinsics_fov_fallback_used"],
  };
}

function buildMetadataIntrinsic(
  intrinsics: CameraIntrinsicsInput | null | undefined,
): Matrix3x3 | null {
  if (!intrinsics) return null;
  if (intrinsics.matrix) {
    validateMatrix3x3(intrinsics.matrix, "intrinsics.matrix");
    return intrinsics.matrix;
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
  return [
    intrinsics.fx,
    skew,
    intrinsics.cx,
    0,
    intrinsics.fy ?? intrinsics.fx,
    intrinsics.cy,
    0,
    0,
    1,
  ];
}

function buildExtrinsics(input: {
  device: CameraCalibrationDeviceInput;
  baselineMeters: number;
}): ExtrinsicsBuildResult {
  validatePositiveFiniteNumber(input.baselineMeters, "baselineMeters");
  const provided = input.device.extrinsics;
  if (provided?.rotation) {
    validateMatrix3x3(provided.rotation, "extrinsics.rotation");
    if (provided.translation) {
      validateVector3(provided.translation, "extrinsics.translation");
      return {
        rotation: provided.rotation,
        translation: provided.translation,
      };
    }
    if (provided.cameraCenter) {
      validateVector3(provided.cameraCenter, "extrinsics.cameraCenter");
      return {
        rotation: provided.rotation,
        translation: translationFromCameraCenter(
          provided.rotation,
          provided.cameraCenter,
        ),
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
  };
}

function buildCalibrationQuality(input: {
  devices: readonly CameraProjection[];
  metadataIntrinsicCount: number;
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
  const score = clamp01(
    0.35 +
      metadataRatio * 0.3 +
      baselineScore * 0.2 +
      convergenceScore * 0.15 -
      fallbackRatio * 0.1,
  );

  return {
    score,
    averageReprojectionErrorPx: 0,
    baseline,
    convergenceAngle,
  };
}

function buildArtifactSource(
  devices: readonly CameraProjection[],
): CameraCalibrationArtifact["source"] {
  return devices.every((device) => device.intrinsicsSource === "capture_metadata")
    ? "capture_metadata"
    : "metadata_and_fov_fallback";
}

function buildArtifactIntrinsicsSource(
  devices: readonly CameraProjection[],
): CameraCalibrationArtifact["intrinsicsSource"] {
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
) {
  if (!devices.length) errors.push("devices must not be empty");
  const seenDeviceIndexes = new Set<number>();
  for (const [index, device] of devices.entries()) {
    if (!Number.isInteger(device.deviceIndex) || device.deviceIndex < 0) {
      errors.push(`devices[${index}].deviceIndex must be a non-negative integer`);
    }
    if (seenDeviceIndexes.has(device.deviceIndex)) {
      errors.push(`devices[${index}].deviceIndex must be unique`);
    }
    seenDeviceIndexes.add(device.deviceIndex);
    if (!device.deviceRole) errors.push(`devices[${index}].deviceRole is required`);
    if (!["capture_metadata", "fov_fallback"].includes(device.intrinsicsSource)) {
      errors.push(`devices[${index}].intrinsicsSource is invalid`);
    }
    validateMatrix3x3ForReport(device.intrinsic, `devices[${index}].intrinsic`, errors);
    validateMatrix3x3ForReport(device.rotation, `devices[${index}].rotation`, errors);
    validateVector3ForReport(device.translation, `devices[${index}].translation`, errors);
    const projectionValidation = validateProjectionMatrix({
      projection: device.projection,
    });
    if (!projectionValidation.ok) {
      errors.push(
        `devices[${index}].projection camera_projection_invalid: ${projectionValidation.reason}`,
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

function validateMatrix3x3ForReport(
  matrix: Matrix3x3,
  label: string,
  errors: string[],
) {
  if (matrix.length !== 9 || !matrix.every(Number.isFinite)) {
    errors.push(`${label} must contain 9 finite numbers`);
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
