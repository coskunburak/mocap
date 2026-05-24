import assert from "node:assert/strict";
import type {
  Matrix3x3,
  ProjectionMatrix3x4,
  Vector3,
} from "../types";
import {
  TriangulationError,
  buildProjectionMatrix,
  computeReprojectionError,
  projectPoint,
  triangulateDLT,
  validateProjectionMatrix,
} from "./triangulation";

const IDENTITY_INTRINSIC: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY_ROTATION: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function distance(a: Vector3, b: Vector3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function assertTriangulationError(error: unknown, code: string) {
  assert.ok(error instanceof TriangulationError);
  assert.equal(error.code, code);
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

testSyntheticPointRoundTrip();
testLowConfidenceSkip();
testInvalidProjectionMatrix();
testDegenerateCameraSetup();

console.log("triangulation synthetic tests passed");
