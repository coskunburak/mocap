import type {
  CameraCalibrationArtifact,
  CaptureVolumeArtifact,
  CaptureVolumeStatus,
} from "../types";

export type BuildCaptureVolumeInput = {
  takeId?: string;
  jobId: string;
  sessionId?: string | null;
  calibrationArtifact: CameraCalibrationArtifact;
};

export function buildCaptureVolumeArtifact(
  input: BuildCaptureVolumeInput,
): CaptureVolumeArtifact {
  const devices = input.calibrationArtifact.devices;
  const validCameraCount = devices.filter((device) =>
    Boolean(device.projectionMatrixP ?? device.projection),
  ).length;
  const status = captureVolumeStatus(input.calibrationArtifact, validCameraCount);
  const baseline = finiteOrNull(
    input.calibrationArtifact.baselineEstimate ??
      input.calibrationArtifact.quality.baseline,
  );
  const originCamera = devices[0];
  const originSource =
    originCamera?.extrinsicsSource === "role_angle_fallback"
      ? "diagnostic_role_angle"
      : input.calibrationArtifact.source;

  return {
    schemaVersion: "mocap.capture_volume.v1",
    volumeId: input.takeId ?? input.jobId,
    ...(input.takeId ? { takeId: input.takeId } : {}),
    jobId: input.jobId,
    sessionId: input.sessionId ?? null,
    cameraIds: devices.map(
      (device) => device.cameraId ?? `device_${device.deviceIndex}`,
    ),
    validCameraCount,
    worldOrigin: {
      source: originSource,
      description: "camera_0_origin",
    },
    coordinateSystem: {
      upAxis: "Y",
      forwardAxis: "Z",
      unit: "meter",
    },
    floorPlane: null,
    baselineEstimate: baseline,
    captureBounds: null,
    status,
    warnings: captureVolumeWarnings(input.calibrationArtifact, status),
  };
}

function captureVolumeStatus(
  calibration: CameraCalibrationArtifact,
  validCameraCount: number,
): CaptureVolumeStatus {
  if (validCameraCount < 2) return "insufficient_cameras";
  if (
    calibration.status === "missing_calibration" ||
    calibration.devices.length === 0
  ) {
    return "missing_extrinsics";
  }
  if (calibration.status === "invalid_calibration") return "failed";
  if (calibration.devices.some((device) => device.intrinsicsSource === "fov_fallback")) {
    return "approximate";
  }
  if (
    calibration.devices.some(
      (device) => device.extrinsicsSource === "role_angle_fallback",
    )
  ) {
    return "diagnostic_only";
  }
  if (calibration.status === "approximate") return "approximate";
  if (calibration.status === "diagnostic_only") return "diagnostic_only";
  if (calibration.status === "insufficient_views") return "insufficient_cameras";
  if (calibration.status === "failed") return "failed";
  return "ready";
}

function captureVolumeWarnings(
  calibration: CameraCalibrationArtifact,
  status: CaptureVolumeStatus,
) {
  const warnings = new Set<string>(calibration.warnings.map(String));
  if (status !== "ready") {
    warnings.add(`capture_volume_${status}`);
  }
  if (
    calibration.devices.some(
      (device) => device.extrinsicsSource === "role_angle_fallback",
    )
  ) {
    warnings.add("capture_volume_role_angle_diagnostic_only");
  }
  return Array.from(warnings);
}

function finiteOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
