import assert from "node:assert/strict";
import type {
  Matrix3x3,
  ProjectionMatrix3x4,
  Vector3,
} from "../types";
import {
  TriangulationError,
  type TriangulationKeypoint2D,
  buildProjectionMatrix,
  computeReprojectionError,
  projectPoint,
  triangulateDLT,
  triangulateMatchedFramePair,
  validateProjectionMatrix,
} from "./triangulation";

const IDENTITY_INTRINSIC: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const PIXEL_INTRINSIC: Matrix3x3 = [800, 0, 320, 0, 805, 240, 0, 0, 1];
const IDENTITY_ROTATION: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const PRIMARY_TRANSLATION: Vector3 = [0, 0, 0];
const SECONDARY_TRANSLATION: Vector3 = [-1.2, 0, 0];
const SYNTHETIC_POINT: Vector3 = [0.25, -0.15, 3.5];

function distance(a: Vector3, b: Vector3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function assertTriangulationError(error: unknown, code: string) {
  assert.ok(error instanceof TriangulationError);
  assert.equal(error.code, code);
}

function assertVectorClose(actual: Vector3, expected: Vector3, tolerance: number) {
  assert.ok(
    distance(actual, expected) <= tolerance,
    `expected ${actual.join(",")} to be within ${tolerance} of ${expected.join(",")}`,
  );
}

function syntheticPixelCameras(input?: {
  secondaryTranslation?: Vector3;
}): {
  cameraA: ProjectionMatrix3x4;
  cameraB: ProjectionMatrix3x4;
} {
  return {
    cameraA: buildProjectionMatrix({
      intrinsic: PIXEL_INTRINSIC,
      rotation: IDENTITY_ROTATION,
      translation: PRIMARY_TRANSLATION,
    }),
    cameraB: buildProjectionMatrix({
      intrinsic: PIXEL_INTRINSIC,
      rotation: IDENTITY_ROTATION,
      translation: input?.secondaryTranslation ?? SECONDARY_TRANSLATION,
    }),
  };
}

function keypoint(input: {
  jointId: string;
  point: ReturnType<typeof projectPoint>;
  confidence?: number;
  name?: string;
}): TriangulationKeypoint2D {
  return {
    jointId: input.jointId,
    ...(input.name ? { name: input.name } : {}),
    x: input.point.x,
    y: input.point.y,
    confidence: input.confidence ?? 1,
  };
}

function testSyntheticPointRoundTrip() {
  const cameraA = buildProjectionMatrix({
    intrinsic: IDENTITY_INTRINSIC,
    rotation: IDENTITY_ROTATION,
    translation: [0, 0, 0],
  });
  const cameraB = buildProjectionMatrix({
    intrinsic: IDENTITY_INTRINSIC,
    rotation: IDENTITY_ROTATION,
    translation: [-1, 0, 0],
  });
  const sourcePoint: Vector3 = [0.2, 0.1, 4];
  const observationA = projectPoint({ projection: cameraA, point: sourcePoint });
  const observationB = projectPoint({ projection: cameraB, point: sourcePoint });

  const result = triangulateDLT({
    observations: [
      { deviceIndex: 0, point: observationA, projection: cameraA, confidence: 0.99 },
      { deviceIndex: 1, point: observationB, projection: cameraB, confidence: 0.98 },
    ],
    minConfidence: 0.3,
  });

  assert.equal(result.status, "triangulated");
  assert.equal(result.observationsUsed, 2);
  if (result.status === "triangulated") {
    assert.ok(Number.isFinite(result.point[0]));
    assert.ok(Number.isFinite(result.point[1]));
    assert.ok(Number.isFinite(result.point[2]));
    assert.ok(distance(result.point, sourcePoint) < 1e-6);
    assert.ok(result.reprojectionErrorPx < 1e-8);
    assert.ok(
      computeReprojectionError({
        projection: cameraA,
        point3d: result.point,
        observed: observationA,
      }) < 1e-8,
    );
  }
}

function testSyntheticPixelProjectionRoundTrip() {
  const { cameraA, cameraB } = syntheticPixelCameras();
  const observationA = projectPoint({
    projection: cameraA,
    point: SYNTHETIC_POINT,
  });
  const observationB = projectPoint({
    projection: cameraB,
    point: SYNTHETIC_POINT,
  });

  const result = triangulateDLT({
    observations: [
      { deviceIndex: 0, point: observationA, projection: cameraA, confidence: 1 },
      { deviceIndex: 1, point: observationB, projection: cameraB, confidence: 1 },
    ],
    minConfidence: 0.3,
  });

  assert.equal(result.status, "triangulated");
  assert.equal(result.observationsUsed, 2);
  if (result.status === "triangulated") {
    assertVectorClose(result.point, SYNTHETIC_POINT, 1e-6);
    assert.ok(result.reprojectionErrorPx < 1e-7);
  }
}

function testCleanReprojectionErrorNearZero() {
  const { cameraA, cameraB } = syntheticPixelCameras();
  const observationA = projectPoint({
    projection: cameraA,
    point: SYNTHETIC_POINT,
  });
  const observationB = projectPoint({
    projection: cameraB,
    point: SYNTHETIC_POINT,
  });
  const result = triangulateDLT({
    observations: [
      { deviceIndex: 0, point: observationA, projection: cameraA, confidence: 0.95 },
      { deviceIndex: 1, point: observationB, projection: cameraB, confidence: 0.96 },
    ],
    minConfidence: 0.3,
  });

  assert.equal(result.status, "triangulated");
  if (result.status === "triangulated") {
    const errorA = computeReprojectionError({
      projection: cameraA,
      point3d: result.point,
      observed: observationA,
    });
    const errorB = computeReprojectionError({
      projection: cameraB,
      point3d: result.point,
      observed: observationB,
    });

    assert.ok(errorA < 1e-7);
    assert.ok(errorB < 1e-7);
    assert.ok(result.reprojectionErrorPx < 1e-7);
  }
}

function testNoisyObservationsStayBounded() {
  const { cameraA, cameraB } = syntheticPixelCameras();
  const cleanObservationA = projectPoint({
    projection: cameraA,
    point: SYNTHETIC_POINT,
  });
  const cleanObservationB = projectPoint({
    projection: cameraB,
    point: SYNTHETIC_POINT,
  });
  const clean = triangulateDLT({
    observations: [
      {
        deviceIndex: 0,
        point: cleanObservationA,
        projection: cameraA,
        confidence: 0.95,
      },
      {
        deviceIndex: 1,
        point: cleanObservationB,
        projection: cameraB,
        confidence: 0.95,
      },
    ],
    minConfidence: 0.3,
  });
  const noisy = triangulateDLT({
    observations: [
      {
        deviceIndex: 0,
        point: {
          x: cleanObservationA.x + 0.35,
          y: cleanObservationA.y - 0.2,
        },
        projection: cameraA,
        confidence: 0.82,
      },
      {
        deviceIndex: 1,
        point: {
          x: cleanObservationB.x - 0.25,
          y: cleanObservationB.y + 0.15,
        },
        projection: cameraB,
        confidence: 0.8,
      },
    ],
    minConfidence: 0.3,
  });

  assert.equal(clean.status, "triangulated");
  assert.equal(noisy.status, "triangulated");
  if (clean.status === "triangulated" && noisy.status === "triangulated") {
    assert.equal(noisy.observationsUsed, 2);
    assert.ok(noisy.reprojectionErrorPx > clean.reprojectionErrorPx);
    assert.ok(noisy.reprojectionErrorPx < 0.5);
    assert.ok(distance(noisy.point, SYNTHETIC_POINT) < 0.05);
  }
}

function testMatchedFrameTriangulatesLandmarksByJointId() {
  const { cameraA, cameraB } = syntheticPixelCameras();
  const hipPoint: Vector3 = [0.15, -0.12, 3.25];
  const kneePoint: Vector3 = [0.18, -0.62, 3.4];
  const hipA = projectPoint({ projection: cameraA, point: hipPoint });
  const hipB = projectPoint({ projection: cameraB, point: hipPoint });
  const kneeA = projectPoint({ projection: cameraA, point: kneePoint });
  const kneeB = projectPoint({ projection: cameraB, point: kneePoint });

  const result = triangulateMatchedFramePair({
    device0Frame: {
      cameraId: "device_0",
      frameIndex: 12,
      timestampMs: 400,
      keypoints: [
        keypoint({ jointId: "left_hip", point: hipA, confidence: 0.8 }),
        keypoint({ jointId: "left_knee", point: kneeA, confidence: 0.9 }),
      ],
    },
    device1Frame: {
      cameraId: "device_1",
      frameIndex: 13,
      timestampMs: 402,
      keypoints: [
        keypoint({ jointId: "left_knee", point: kneeB, confidence: 0.88 }),
        keypoint({ jointId: "left_hip", point: hipB, confidence: 0.7 }),
      ],
    },
    projectionMatrixPDevice0: cameraA,
    projectionMatrixPDevice1: cameraB,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.landmarks.length, 2);
  assert.equal(result.rejectedLandmarks.length, 0);
  const hip = result.landmarks.find((landmark) => landmark.jointId === "left_hip");
  const knee = result.landmarks.find((landmark) => landmark.jointId === "left_knee");
  assert.ok(hip);
  assert.ok(knee);
  assertVectorClose([hip.x, hip.y, hip.z], hipPoint, 1e-6);
  assertVectorClose([knee.x, knee.y, knee.z], kneePoint, 1e-6);
  assert.deepEqual(hip.sourceCameraIds, ["device_0", "device_1"]);
  assert.equal(hip.confidence, 0.75);
  assert.equal(result.metrics.triangulatedJointRatio, 1);
}

function testMatchedFrameCanMatchByName() {
  const { cameraA, cameraB } = syntheticPixelCameras();
  const sourcePoint: Vector3 = [0.1, -0.2, 3.1];
  const pointA = projectPoint({ projection: cameraA, point: sourcePoint });
  const pointB = projectPoint({ projection: cameraB, point: sourcePoint });
  const result = triangulateMatchedFramePair({
    device0Frame: {
      cameraId: "device_0",
      keypoints: [{ name: "pelvis", x: pointA.x, y: pointA.y, confidence: 1 }],
    },
    device1Frame: {
      cameraId: "device_1",
      keypoints: [{ name: "pelvis", x: pointB.x, y: pointB.y, confidence: 1 }],
    },
    projectionMatrixPDevice0: cameraA,
    projectionMatrixPDevice1: cameraB,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.landmarks[0].jointId, "pelvis");
  assert.equal(result.landmarks[0].name, "pelvis");
  assertVectorClose(
    [result.landmarks[0].x, result.landmarks[0].y, result.landmarks[0].z],
    sourcePoint,
    1e-6,
  );
}

function testMatchedFrameRejectsHighReprojectionError() {
  const { cameraA, cameraB } = syntheticPixelCameras();
  const pointA = projectPoint({ projection: cameraA, point: SYNTHETIC_POINT });
  const pointB = projectPoint({ projection: cameraB, point: SYNTHETIC_POINT });
  const result = triangulateMatchedFramePair({
    device0Frame: {
      cameraId: "device_0",
      keypoints: [keypoint({ jointId: "spine", point: pointA, confidence: 0.95 })],
    },
    device1Frame: {
      cameraId: "device_1",
      keypoints: [
        keypoint({
          jointId: "spine",
          point: { x: pointB.x + 120, y: pointB.y - 80 },
          confidence: 0.95,
        }),
      ],
    },
    projectionMatrixPDevice0: cameraA,
    projectionMatrixPDevice1: cameraB,
    maxReprojectionErrorPx: 1,
  });

  assert.equal(result.status, "diagnostic_only");
  assert.equal(result.landmarks.length, 0);
  assert.equal(result.rejectedLandmarks[0].status, "high_reprojection_error");
  assert.ok((result.rejectedLandmarks[0].reprojectionErrorPx ?? 0) > 1);
  assert.equal(result.warnings[0].code, "reprojection_error_high");
}

function testMatchedFrameRejectsLowConfidenceWithoutFakePoint() {
  const { cameraA, cameraB } = syntheticPixelCameras();
  const pointA = projectPoint({ projection: cameraA, point: SYNTHETIC_POINT });
  const pointB = projectPoint({ projection: cameraB, point: SYNTHETIC_POINT });
  const result = triangulateMatchedFramePair({
    device0Frame: {
      cameraId: "device_0",
      keypoints: [keypoint({ jointId: "ankle", point: pointA, confidence: 0.95 })],
    },
    device1Frame: {
      cameraId: "device_1",
      keypoints: [keypoint({ jointId: "ankle", point: pointB, confidence: 0.1 })],
    },
    projectionMatrixPDevice0: cameraA,
    projectionMatrixPDevice1: cameraB,
    minConfidence: 0.3,
  });

  assert.equal(result.status, "insufficient_views");
  assert.equal(result.landmarks.length, 0);
  assert.equal(result.rejectedLandmarks[0].status, "low_confidence");
  assert.equal(result.warnings[0].code, "low_confidence");
}

function testMatchedFrameRejectsMissingObservationWithoutFakePoint() {
  const { cameraA, cameraB } = syntheticPixelCameras();
  const pointA = projectPoint({ projection: cameraA, point: SYNTHETIC_POINT });
  const result = triangulateMatchedFramePair({
    device0Frame: {
      cameraId: "device_0",
      keypoints: [keypoint({ jointId: "wrist", point: pointA, confidence: 0.9 })],
    },
    device1Frame: {
      cameraId: "device_1",
      keypoints: [],
    },
    projectionMatrixPDevice0: cameraA,
    projectionMatrixPDevice1: cameraB,
  });

  assert.equal(result.status, "insufficient_views");
  assert.equal(result.landmarks.length, 0);
  assert.equal(result.rejectedLandmarks[0].status, "missing_observations");
  assert.deepEqual(result.rejectedLandmarks[0].sourceCameraIds, ["device_0"]);
}

function testMatchedFrameRejectsDegenerateBaseline() {
  const { cameraA, cameraB } = syntheticPixelCameras({
    secondaryTranslation: [-1e-12, 0, 0],
  });
  const pointA = projectPoint({ projection: cameraA, point: SYNTHETIC_POINT });
  const pointB = projectPoint({ projection: cameraB, point: SYNTHETIC_POINT });
  const result = triangulateMatchedFramePair({
    device0Frame: {
      cameraId: "device_0",
      keypoints: [keypoint({ jointId: "head", point: pointA, confidence: 1 })],
    },
    device1Frame: {
      cameraId: "device_1",
      keypoints: [keypoint({ jointId: "head", point: pointB, confidence: 1 })],
    },
    projectionMatrixPDevice0: cameraA,
    projectionMatrixPDevice1: cameraB,
  });

  assert.equal(result.status, "degenerate_baseline");
  assert.equal(result.landmarks.length, 0);
  assert.equal(result.warnings[0].code, "degenerate_baseline");
}

function testLowConfidenceSkip() {
  const cameraA = buildProjectionMatrix({
    intrinsic: IDENTITY_INTRINSIC,
    rotation: IDENTITY_ROTATION,
    translation: [0, 0, 0],
  });
  const cameraB = buildProjectionMatrix({
    intrinsic: IDENTITY_INTRINSIC,
    rotation: IDENTITY_ROTATION,
    translation: [-1, 0, 0],
  });
  const sourcePoint: Vector3 = [0.2, 0.1, 4];
  const result = triangulateDLT({
    observations: [
      {
        deviceIndex: 0,
        point: projectPoint({ projection: cameraA, point: sourcePoint }),
        projection: cameraA,
        confidence: 0.1,
      },
      {
        deviceIndex: 1,
        point: projectPoint({ projection: cameraB, point: sourcePoint }),
        projection: cameraB,
        confidence: 0.9,
      },
    ],
    minConfidence: 0.3,
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "low_confidence");
  assert.equal(result.observationsUsed, 1);
}

function testMissingKeypointInOneCameraSkipsAsInsufficientViews() {
  const { cameraA } = syntheticPixelCameras();
  const observationA = projectPoint({
    projection: cameraA,
    point: SYNTHETIC_POINT,
  });
  const result = triangulateDLT({
    observations: [
      {
        deviceIndex: 0,
        point: observationA,
        projection: cameraA,
        confidence: 0.99,
      },
    ],
    minConfidence: 0.3,
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "insufficient_views");
  assert.equal(result.observationsUsed, 1);
}

function testInvalidProjectionMatrix() {
  const invalidProjection = [
    1,
    0,
    0,
    0,
    0,
    Number.NaN,
    0,
    0,
    0,
    0,
    1,
    0,
  ] as unknown as ProjectionMatrix3x4;

  assert.equal(
    validateProjectionMatrix({ projection: invalidProjection }).ok,
    false,
  );
  assert.throws(
    () =>
      projectPoint({
        projection: invalidProjection,
        point: [0.2, 0.1, 4],
      }),
    (error) => {
      assertTriangulationError(error, "camera_projection_invalid");
      return true;
    },
  );
}

function testDegenerateCameraSetup() {
  const camera = buildProjectionMatrix({
    intrinsic: IDENTITY_INTRINSIC,
    rotation: IDENTITY_ROTATION,
    translation: [0, 0, 0],
  });
  const sourcePoint: Vector3 = [0.2, 0.1, 4];
  const observation = projectPoint({ projection: camera, point: sourcePoint });

  assert.throws(
    () =>
      triangulateDLT({
        observations: [
          { deviceIndex: 0, point: observation, projection: camera, confidence: 1 },
          { deviceIndex: 1, point: observation, projection: camera, confidence: 1 },
        ],
      }),
    (error) => {
      assertTriangulationError(error, "degenerate_camera_setup");
      return true;
    },
  );
}

function testNearZeroBaselineDegenerateCameraSetup() {
  const { cameraA, cameraB } = syntheticPixelCameras({
    secondaryTranslation: [-1e-12, 0, 0],
  });
  const observationA = projectPoint({
    projection: cameraA,
    point: SYNTHETIC_POINT,
  });
  const observationB = projectPoint({
    projection: cameraB,
    point: SYNTHETIC_POINT,
  });

  assert.throws(
    () =>
      triangulateDLT({
        observations: [
          { deviceIndex: 0, point: observationA, projection: cameraA, confidence: 1 },
          { deviceIndex: 1, point: observationB, projection: cameraB, confidence: 1 },
        ],
      }),
    (error) => {
      assertTriangulationError(error, "degenerate_camera_setup");
      return true;
    },
  );
}

testSyntheticPointRoundTrip();
testSyntheticPixelProjectionRoundTrip();
testCleanReprojectionErrorNearZero();
testNoisyObservationsStayBounded();
testMatchedFrameTriangulatesLandmarksByJointId();
testMatchedFrameCanMatchByName();
testMatchedFrameRejectsHighReprojectionError();
testMatchedFrameRejectsLowConfidenceWithoutFakePoint();
testMatchedFrameRejectsMissingObservationWithoutFakePoint();
testMatchedFrameRejectsDegenerateBaseline();
testLowConfidenceSkip();
testMissingKeypointInOneCameraSkipsAsInsufficientViews();
testInvalidProjectionMatrix();
testDegenerateCameraSetup();
testNearZeroBaselineDegenerateCameraSetup();

console.log("triangulation synthetic tests passed");
