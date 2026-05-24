import type {
  Matrix3x3,
  Point2D,
  ProjectionMatrix3x4,
  Vector3,
} from "../types";

const EPSILON = 1e-10;

type Vector4 = readonly [number, number, number, number];

export type TriangulationErrorCode =
  | "camera_projection_invalid"
  | "degenerate_camera_setup"
  | "triangulation_failed";

export class TriangulationError extends Error {
  constructor(
    readonly code: TriangulationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TriangulationError";
  }
}

export type ProjectionValidationResult =
  | { ok: true }
  | { ok: false; code: "camera_projection_invalid"; reason: string };

export type TriangulationObservation = {
  deviceIndex?: number;
  point: Point2D;
  projection: ProjectionMatrix3x4;
  confidence?: number;
};

export type TriangulationResult =
  | {
      status: "triangulated";
      point: Vector3;
      reprojectionErrorPx: number;
      observationsUsed: number;
    }
  | {
      status: "skipped";
      reason: "low_confidence" | "insufficient_observations";
      observationsUsed: number;
    };

export function validateProjectionMatrix(input: {
  projection: readonly number[];
}): ProjectionValidationResult {
  const { projection } = input;
  if (projection.length !== 12) {
    return {
      ok: false,
      code: "camera_projection_invalid",
      reason: "Projection matrix must contain 12 numbers.",
    };
  }
  if (!projection.every(Number.isFinite)) {
    return {
      ok: false,
      code: "camera_projection_invalid",
      reason: "Projection matrix contains NaN or Infinity.",
    };
  }
  const firstRowNorm = Math.hypot(projection[0], projection[1], projection[2]);
  const secondRowNorm = Math.hypot(projection[4], projection[5], projection[6]);
  const thirdRowNorm = Math.hypot(projection[8], projection[9], projection[10]);
  if (
    firstRowNorm < EPSILON ||
    secondRowNorm < EPSILON ||
    thirdRowNorm < EPSILON
  ) {
    return {
      ok: false,
      code: "camera_projection_invalid",
      reason: "Projection matrix has a zero camera axis row.",
    };
  }
  return { ok: true };
}

export function buildProjectionMatrix(input: {
  intrinsic: Matrix3x3;
  rotation: Matrix3x3;
  translation: Vector3;
}): ProjectionMatrix3x4 {
  const rt = [
    input.rotation[0],
    input.rotation[1],
    input.rotation[2],
    input.translation[0],
    input.rotation[3],
    input.rotation[4],
    input.rotation[5],
    input.translation[1],
    input.rotation[6],
    input.rotation[7],
    input.rotation[8],
    input.translation[2],
  ];

  const projection = new Array<number>(12);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += input.intrinsic[row * 3 + k] * rt[k * 4 + column];
      }
      projection[row * 4 + column] = sum;
    }
  }

  return projection as unknown as ProjectionMatrix3x4;
}

export function projectPoint(input: {
  projection: ProjectionMatrix3x4;
  point: Vector3;
}): Point2D {
  assertValidProjectionMatrix(input.projection);
  const [x, y, z] = input.point;
  const w =
    input.projection[8] * x +
    input.projection[9] * y +
    input.projection[10] * z +
    input.projection[11];
  if (Math.abs(w) < EPSILON) {
    throw new TriangulationError(
      "triangulation_failed",
      "Projected point has near-zero homogeneous depth.",
    );
  }
  return {
    x:
      (input.projection[0] * x +
        input.projection[1] * y +
        input.projection[2] * z +
        input.projection[3]) /
      w,
    y:
      (input.projection[4] * x +
        input.projection[5] * y +
        input.projection[6] * z +
        input.projection[7]) /
      w,
  };
}

export function computeReprojectionError(input: {
  projection: ProjectionMatrix3x4;
  point3d: Vector3;
  observed: Point2D;
}): number {
  const projected = projectPoint({
    projection: input.projection,
    point: input.point3d,
  });
  return Math.hypot(projected.x - input.observed.x, projected.y - input.observed.y);
}

export function triangulateDLT(input: {
  observations: readonly TriangulationObservation[];
  minConfidence?: number;
}): TriangulationResult {
  const minConfidence = input.minConfidence ?? 0;
  const observations = input.observations.filter(
    (observation) => (observation.confidence ?? 1) >= minConfidence,
  );

  if (input.observations.length < 2) {
    return {
      status: "skipped",
      reason: "insufficient_observations",
      observationsUsed: input.observations.length,
    };
  }
  if (observations.length < 2) {
    return {
      status: "skipped",
      reason: "low_confidence",
      observationsUsed: observations.length,
    };
  }

  for (const observation of observations) {
    assertValidProjectionMatrix(observation.projection);
  }
  assertNonDegenerateSetup(observations);

  const rows: number[][] = [];
  for (const observation of observations) {
    const p = observation.projection;
    rows.push([
      observation.point.x * p[8] - p[0],
      observation.point.x * p[9] - p[1],
      observation.point.x * p[10] - p[2],
      observation.point.x * p[11] - p[3],
    ]);
    rows.push([
      observation.point.y * p[8] - p[4],
      observation.point.y * p[9] - p[5],
      observation.point.y * p[10] - p[6],
      observation.point.y * p[11] - p[7],
    ]);
  }

  const homogeneous = solveHomogeneous(rows);
  const w = homogeneous[3];
  if (Math.abs(w) < EPSILON) {
    throw new TriangulationError(
      "triangulation_failed",
      "Triangulation produced a point at infinity.",
    );
  }

  const point: Vector3 = [
    homogeneous[0] / w,
    homogeneous[1] / w,
    homogeneous[2] / w,
  ];
  if (!point.every(Number.isFinite)) {
    throw new TriangulationError(
      "triangulation_failed",
      "Triangulation produced NaN or Infinity.",
    );
  }

  const reprojectionErrorPx =
    observations.reduce(
      (sum, observation) =>
        sum +
        computeReprojectionError({
          projection: observation.projection,
          point3d: point,
          observed: observation.point,
        }),
      0,
    ) / observations.length;

  if (!Number.isFinite(reprojectionErrorPx)) {
    throw new TriangulationError(
      "triangulation_failed",
      "Triangulation reprojection error is not finite.",
    );
  }

  return {
    status: "triangulated",
    point,
    reprojectionErrorPx,
    observationsUsed: observations.length,
  };
}

function assertValidProjectionMatrix(projection: ProjectionMatrix3x4) {
  const validation = validateProjectionMatrix({ projection });
  if (!validation.ok) {
    throw new TriangulationError(validation.code, validation.reason);
  }
}

function assertNonDegenerateSetup(
  observations: readonly TriangulationObservation[],
) {
  for (let i = 0; i < observations.length; i++) {
    for (let j = i + 1; j < observations.length; j++) {
      if (
        projectionDistance(
          observations[i].projection,
          observations[j].projection,
        ) > 1e-8
      ) {
        return;
      }
    }
  }
  throw new TriangulationError(
    "degenerate_camera_setup",
    "At least two distinct camera projection matrices are required.",
  );
}

function projectionDistance(
  a: ProjectionMatrix3x4,
  b: ProjectionMatrix3x4,
) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum;
}

function solveHomogeneous(rows: readonly number[][]): Vector4 {
  const normal = Array.from({ length: 4 }, () => new Array<number>(4).fill(0));
  for (const row of rows) {
    for (let i = 0; i < 4; i++) {
      for (let j = i; j < 4; j++) {
        normal[i][j] += row[i] * row[j];
        if (i !== j) normal[j][i] = normal[i][j];
      }
    }
  }
  return smallestEigenvector4x4(normal);
}

function smallestEigenvector4x4(matrix: number[][]): Vector4 {
  const size = 4;
  const values = matrix.map((row) => [...row]);
  const vectors: number[][] = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_unused, column) => (row === column ? 1 : 0)),
  );

  for (let iteration = 0; iteration < 100; iteration++) {
    let p = 0;
    let q = 1;
    let max = 0;
    for (let row = 0; row < size; row++) {
      for (let column = row + 1; column < size; column++) {
        const value = Math.abs(values[row][column]);
        if (value > max) {
          max = value;
          p = row;
          q = column;
        }
      }
    }
    if (max < 1e-12) break;

    const app = values[p][p];
    const aqq = values[q][q];
    const apq = values[p][q];
    const theta =
      Math.abs(app - aqq) < EPSILON
        ? Math.PI / 4
        : 0.5 * Math.atan2(2 * apq, app - aqq);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    for (let row = 0; row < size; row++) {
      const aip = values[row][p];
      const aiq = values[row][q];
      values[row][p] = c * aip + s * aiq;
      values[row][q] = -s * aip + c * aiq;
    }
    for (let column = 0; column < size; column++) {
      const apj = values[p][column];
      const aqj = values[q][column];
      values[p][column] = c * apj + s * aqj;
      values[q][column] = -s * apj + c * aqj;
    }
    for (let row = 0; row < size; row++) {
      const vip = vectors[row][p];
      const viq = vectors[row][q];
      vectors[row][p] = c * vip + s * viq;
      vectors[row][q] = -s * vip + c * viq;
    }
  }

  let minIndex = 0;
  let minEigenvalue = values[0][0];
  for (let i = 1; i < size; i++) {
    if (values[i][i] < minEigenvalue) {
      minEigenvalue = values[i][i];
      minIndex = i;
    }
  }

  return [
    vectors[0][minIndex],
    vectors[1][minIndex],
    vectors[2][minIndex],
    vectors[3][minIndex],
  ];
}
