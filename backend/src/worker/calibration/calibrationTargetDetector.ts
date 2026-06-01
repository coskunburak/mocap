import type {
  CalibrationObservationCameraSummary,
  CalibrationObservationFrame,
  CalibrationObservationPoint,
  CalibrationObservationStatus,
  CalibrationObservationsArtifact,
  CalibrationTargetType,
  Vector3,
} from "../types";
import type {
  CalibrationDetectionCameraInput,
  CalibrationDetectionInput,
} from "./calibrationDetectorTypes";

const MISSING_RUNTIME_WARNING =
  "Calibration observations unavailable. Camera extrinsics cannot be solved from calibration clip.";

export function buildMissingCalibrationObservationsArtifact(input: {
  takeId?: string;
  jobId: string;
  sessionId?: string | null;
  targetType: CalibrationTargetType;
  detectorSource: string;
  status?: CalibrationObservationStatus;
  reason: string;
  warnings?: readonly string[];
}): CalibrationObservationsArtifact {
  return {
    schemaVersion: "mocap.calibration_observations.v1",
    ...(input.takeId ? { takeId: input.takeId } : {}),
    jobId: input.jobId,
    sessionId: input.sessionId ?? null,
    targetType: input.targetType,
    detectorSource: input.detectorSource,
    status: input.status ?? "missing_calibration_observations",
    reason: input.reason,
    cameras: [],
    frames: [],
    warnings: dedupe([
      MISSING_RUNTIME_WARNING,
      ...(input.warnings ?? []),
    ]),
  };
}

export function parseCalibrationObservationsFixture(
  rawOutput: unknown,
  input: CalibrationDetectionInput & { detectorSource?: string },
): CalibrationObservationsArtifact {
  const output = recordOrNull(rawOutput);
  if (!output) {
    throw new Error("Calibration detector output must be a JSON object.");
  }

  const targetType =
    parseTargetType(output.targetType ?? output.target_type) ?? input.targetType;
  const detectorSource =
    stringValue(output.detectorSource ?? output.detector_source) ??
    input.detectorSource ??
    "fixture";
  const warnings: string[] = stringArray(output.warnings);
  const cameraInputs = normalizeDetectionCameras(input);
  const frames = parseFrames({
    rawFrames: arrayOrEmpty(output.frames),
    targetType,
    cameraInputs,
    warnings,
  });
  const cameras = buildCameraSummaries({
    rawCameras: arrayOrEmpty(output.cameras),
    cameraInputs,
    frames,
    warnings,
  });
  const observationCount = frames.reduce(
    (sum, frame) => sum + frame.observations.length,
    0,
  );
  const status =
    parseObservationStatus(output.status) ??
    statusFromCameraSummaries(cameras, observationCount);
  const reason =
    stringValue(output.reason) ??
    (status === "missing_calibration_observations"
      ? "Calibration detector produced no usable observations."
      : null);

  return {
    schemaVersion: "mocap.calibration_observations.v1",
    ...(input.takeId ? { takeId: input.takeId } : {}),
    jobId: input.jobId,
    sessionId: input.sessionId ?? null,
    targetType,
    detectorSource,
    status,
    reason,
    cameras,
    frames,
    warnings: dedupe(warnings),
  };
}

export function validateCalibrationObservationsArtifact(
  artifact: CalibrationObservationsArtifact,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (artifact.schemaVersion !== "mocap.calibration_observations.v1") {
    errors.push("schemaVersion must be mocap.calibration_observations.v1");
  }
  if (!artifact.jobId) errors.push("jobId is required");
  if (!isTargetType(artifact.targetType)) errors.push("targetType is invalid");
  if (!artifact.detectorSource) errors.push("detectorSource is required");
  if (!isObservationStatus(artifact.status)) errors.push("status is invalid");
  for (const [index, camera] of artifact.cameras.entries()) {
    if (!camera.cameraId) errors.push(`cameras[${index}].cameraId is required`);
    if (!isObservationStatus(camera.status)) {
      errors.push(`cameras[${index}].status is invalid`);
    }
    validateNonNegativeInteger(camera.frameCount, `cameras[${index}].frameCount`, errors);
    validateNonNegativeInteger(
      camera.observationCount,
      `cameras[${index}].observationCount`,
      errors,
    );
    validateUnitInterval(
      camera.averageConfidence,
      `cameras[${index}].averageConfidence`,
      errors,
    );
  }
  for (const [frameIndex, frame] of artifact.frames.entries()) {
    if (!frame.cameraId) errors.push(`frames[${frameIndex}].cameraId is required`);
    validateNonNegativeInteger(
      frame.frameIndex,
      `frames[${frameIndex}].frameIndex`,
      errors,
    );
    if (frame.timestampMs !== undefined && !Number.isFinite(frame.timestampMs)) {
      errors.push(`frames[${frameIndex}].timestampMs must be finite`);
    }
    for (const [observationIndex, observation] of frame.observations.entries()) {
      if (!observation.targetId) {
        errors.push(
          `frames[${frameIndex}].observations[${observationIndex}].targetId is required`,
        );
      }
      if (!observation.cornerId) {
        errors.push(
          `frames[${frameIndex}].observations[${observationIndex}].cornerId is required`,
        );
      }
      validateFiniteNumber(
        observation.x,
        `frames[${frameIndex}].observations[${observationIndex}].x`,
        errors,
      );
      validateFiniteNumber(
        observation.y,
        `frames[${frameIndex}].observations[${observationIndex}].y`,
        errors,
      );
      validateUnitInterval(
        observation.confidence,
        `frames[${frameIndex}].observations[${observationIndex}].confidence`,
        errors,
      );
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function normalizeDetectionCameras(
  input: CalibrationDetectionInput,
): CalibrationDetectionCameraInput[] {
  if (input.cameras?.length) {
    return input.cameras.map((camera) => ({ ...camera }));
  }
  if (!input.cameraId) {
    return [];
  }
  return [
    {
      cameraId: input.cameraId,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      ...(input.calibrationVideoPath
        ? { calibrationVideoPath: input.calibrationVideoPath }
        : {}),
      ...(input.normalizedVideoPath
        ? { normalizedVideoPath: input.normalizedVideoPath }
        : {}),
      ...(input.videoMetadata ? { videoMetadata: input.videoMetadata } : {}),
    },
  ];
}

function parseFrames(input: {
  rawFrames: readonly unknown[];
  targetType: CalibrationTargetType;
  cameraInputs: readonly CalibrationDetectionCameraInput[];
  warnings: string[];
}): CalibrationObservationFrame[] {
  const defaultCameraId = input.cameraInputs[0]?.cameraId;
  const deviceIdByCamera = new Map(
    input.cameraInputs.map((camera) => [camera.cameraId, camera.deviceId]),
  );
  return input.rawFrames.flatMap((rawFrame, fallbackFrameIndex) => {
    const frame = recordOrNull(rawFrame);
    if (!frame) {
      input.warnings.push(`Ignored malformed calibration frame ${fallbackFrameIndex}.`);
      return [];
    }
    const cameraId = stringValue(frame.cameraId ?? frame.camera_id) ?? defaultCameraId;
    const frameIndex = integerValue(frame.frameIndex ?? frame.frame_index);
    if (!cameraId || frameIndex === undefined) {
      input.warnings.push(`Ignored calibration frame ${fallbackFrameIndex} without cameraId or frameIndex.`);
      return [];
    }
    const observations = parseFrameObservations({
      frame,
      frameIndex,
      targetType: input.targetType,
      warnings: input.warnings,
    });
    return [
      {
        cameraId,
        ...(deviceIdByCamera.get(cameraId)
          ? { deviceId: deviceIdByCamera.get(cameraId) }
          : {}),
        frameIndex,
        ...(numberValue(frame.timestampMs ?? frame.timestamp_ms) !== undefined
          ? { timestampMs: numberValue(frame.timestampMs ?? frame.timestamp_ms) }
          : {}),
        observations,
        warnings: stringArray(frame.warnings),
      },
    ];
  });
}

function parseFrameObservations(input: {
  frame: Record<string, unknown>;
  frameIndex: number;
  targetType: CalibrationTargetType;
  warnings: string[];
}): CalibrationObservationPoint[] {
  const points: CalibrationObservationPoint[] = [];
  const targets = arrayOrEmpty(
    input.frame.targets ?? input.frame.tags ?? input.frame.markers,
  );
  for (const [targetIndex, target] of targets.entries()) {
    const targetRecord = recordOrNull(target);
    if (!targetRecord) continue;
    const targetId = targetIdForRecord(targetRecord, input.targetType, targetIndex);
    const corners = arrayOrEmpty(
      targetRecord.corners ??
        targetRecord.points ??
        targetRecord.observations ??
        targetRecord.charucoCorners,
    );
    for (const [cornerIndex, corner] of corners.entries()) {
      const parsed = parsePoint({
        rawPoint: corner,
        targetType: input.targetType,
        targetId,
        cornerIndex,
      });
      if (parsed) points.push(parsed);
    }
  }

  const directObservations = arrayOrEmpty(
    input.frame.observations ?? input.frame.corners ?? input.frame.points,
  );
  for (const [cornerIndex, point] of directObservations.entries()) {
    const pointRecord = recordOrNull(point);
    if (
      pointRecord &&
      !Number.isFinite(numberValue(pointRecord.x)) &&
      arrayOrEmpty(pointRecord.corners).length > 0
    ) {
      const targetId = targetIdForRecord(pointRecord, input.targetType, cornerIndex);
      for (const [nestedIndex, nested] of arrayOrEmpty(pointRecord.corners).entries()) {
        const parsed = parsePoint({
          rawPoint: nested,
          targetType: input.targetType,
          targetId,
          cornerIndex: nestedIndex,
        });
        if (parsed) points.push(parsed);
      }
      continue;
    }
    const parsed = parsePoint({
      rawPoint: point,
      targetType: input.targetType,
      cornerIndex,
    });
    if (parsed) points.push(parsed);
  }

  if (points.length === 0) {
    input.warnings.push(
      `Calibration frame ${input.frameIndex} contained no usable observed target points.`,
    );
  }
  return points;
}

function parsePoint(input: {
  rawPoint: unknown;
  targetType: CalibrationTargetType;
  targetId?: string;
  cornerIndex: number;
}): CalibrationObservationPoint | null {
  let x: number | undefined;
  let y: number | undefined;
  let confidence: number | undefined;
  let targetId = input.targetId;
  let cornerId: string | undefined;
  let objectPoint: Vector3 | undefined;

  if (Array.isArray(input.rawPoint)) {
    x = numberValue(input.rawPoint[0]);
    y = numberValue(input.rawPoint[1]);
    confidence = numberValue(input.rawPoint[2]);
  } else {
    const point = recordOrNull(input.rawPoint);
    if (!point) return null;
    x = numberValue(point.x);
    y = numberValue(point.y);
    confidence = numberValue(point.confidence) ?? numberValue(point.score);
    targetId =
      targetId ??
      stringValue(point.targetId ?? point.target_id) ??
      targetIdForRecord(point, input.targetType, 0);
    cornerId =
      stringValue(point.cornerId ?? point.corner_id) ??
      stringValue(point.cornerIndex ?? point.corner_index) ??
      stringValue(point.index);
    const rawObjectPoint = point.objectPoint ?? point.object_point;
    if (Array.isArray(rawObjectPoint) && rawObjectPoint.length === 3) {
      const ox = numberValue(rawObjectPoint[0]);
      const oy = numberValue(rawObjectPoint[1]);
      const oz = numberValue(rawObjectPoint[2]);
      if (ox !== undefined && oy !== undefined && oz !== undefined) {
        objectPoint = [ox, oy, oz];
      }
    }
  }

  if (
    x === undefined ||
    y === undefined ||
    confidence === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(confidence)
  ) {
    return null;
  }
  const observedX = x;
  const observedY = y;
  const observedConfidence = confidence;
  if (observedX === 0 && observedY === 0 && observedConfidence <= 0) {
    return null;
  }

  return {
    targetId: targetId ?? defaultTargetId(input.targetType, 0),
    cornerId: cornerId ?? String(input.cornerIndex),
    x: observedX,
    y: observedY,
    confidence: observedConfidence,
    ...(objectPoint ? { objectPoint } : {}),
  };
}

function buildCameraSummaries(input: {
  rawCameras: readonly unknown[];
  cameraInputs: readonly CalibrationDetectionCameraInput[];
  frames: readonly CalibrationObservationFrame[];
  warnings: string[];
}): CalibrationObservationCameraSummary[] {
  const cameraIds = new Set<string>();
  for (const camera of input.cameraInputs) cameraIds.add(camera.cameraId);
  for (const camera of input.rawCameras) {
    const record = recordOrNull(camera);
    const cameraId = stringValue(record?.cameraId ?? record?.camera_id);
    if (cameraId) cameraIds.add(cameraId);
  }
  for (const frame of input.frames) cameraIds.add(frame.cameraId);

  return Array.from(cameraIds).map((cameraId) => {
    const rawCamera = input.rawCameras
      .map(recordOrNull)
      .find(
        (camera) =>
          stringValue(camera?.cameraId ?? camera?.camera_id) === cameraId,
      );
    const frameItems = input.frames.filter((frame) => frame.cameraId === cameraId);
    const confidences = frameItems.flatMap((frame) =>
      frame.observations.map((observation) => observation.confidence),
    );
    const observationCount = confidences.length;
    const rawStatus = parseObservationStatus(rawCamera?.status);
    const status =
      rawStatus && rawStatus !== "ready"
        ? rawStatus
        : observationCount > 0
          ? "ready"
          : "missing_calibration_observations";
    return {
      cameraId,
      ...(stringValue(rawCamera?.deviceId ?? rawCamera?.device_id) ??
      input.cameraInputs.find((camera) => camera.cameraId === cameraId)?.deviceId
        ? {
            deviceId:
              stringValue(rawCamera?.deviceId ?? rawCamera?.device_id) ??
              input.cameraInputs.find((camera) => camera.cameraId === cameraId)
                ?.deviceId,
          }
        : {}),
      status,
      reason: stringValue(rawCamera?.reason) ?? null,
      frameCount:
        integerValue(rawCamera?.frameCount ?? rawCamera?.frame_count) ??
        frameItems.length,
      observationCount,
      averageConfidence: average(confidences),
      warnings: dedupe([
        ...stringArray(rawCamera?.warnings),
        ...(status === "missing_calibration_observations"
          ? ["No usable calibration observations were detected for this camera."]
          : []),
      ]),
    };
  });
}

function statusFromCameraSummaries(
  cameras: readonly CalibrationObservationCameraSummary[],
  observationCount: number,
): CalibrationObservationStatus {
  if (observationCount === 0) return "missing_calibration_observations";
  if (cameras.some((camera) => camera.status === "failed")) return "diagnostic_only";
  if (
    cameras.some(
      (camera) =>
        camera.status !== "ready" &&
        camera.status !== "diagnostic_only",
    )
  ) {
    return "diagnostic_only";
  }
  return "ready";
}

function targetIdForRecord(
  record: Record<string, unknown>,
  targetType: CalibrationTargetType,
  index: number,
) {
  return (
    stringValue(
      record.targetId ??
        record.target_id ??
        record.tagId ??
        record.tag_id ??
        record.markerId ??
        record.marker_id ??
        record.id,
    ) ?? defaultTargetId(targetType, index)
  );
}

function defaultTargetId(targetType: CalibrationTargetType, index: number) {
  if (targetType === "checkerboard") return "checkerboard";
  if (targetType === "charuco") return `charuco_${index}`;
  if (targetType === "human_pose_calibration") return `human_pose_${index}`;
  return `tag_${index}`;
}

function parseTargetType(value: unknown): CalibrationTargetType | undefined {
  const parsed = stringValue(value);
  return parsed && isTargetType(parsed) ? parsed : undefined;
}

function parseObservationStatus(value: unknown): CalibrationObservationStatus | undefined {
  const parsed = stringValue(value);
  return parsed && isObservationStatus(parsed) ? parsed : undefined;
}

function isTargetType(value: string): value is CalibrationTargetType {
  return ["apriltag", "checkerboard", "charuco", "human_pose_calibration"].includes(value);
}

function isObservationStatus(value: string): value is CalibrationObservationStatus {
  return [
    "ready",
    "disabled",
    "missing_runtime",
    "missing_dependency",
    "missing_calibration_observations",
    "unsupported_target",
    "failed",
    "diagnostic_only",
  ].includes(value);
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return arrayOrEmpty(value).flatMap((item) =>
    typeof item === "string" && item.trim().length > 0 ? [item.trim()] : [],
  );
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function average(values: readonly number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function dedupe(values: readonly string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function validateFiniteNumber(value: number, label: string, errors: string[]) {
  if (!Number.isFinite(value)) errors.push(`${label} must be finite`);
}

function validateNonNegativeInteger(value: number, label: string, errors: string[]) {
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${label} must be a non-negative integer`);
  }
}

function validateUnitInterval(value: number, label: string, errors: string[]) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(`${label} must be between 0 and 1`);
  }
}
