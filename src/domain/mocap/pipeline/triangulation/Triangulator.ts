/**
 * Triangulator – DLT (Direct Linear Transform) stereo triangulation.
 *
 * Given 2D landmark observations from two calibrated cameras,
 * computes the 3D world position via SVD of the linear system.
 *
 * No external math library — implements minimal SVD for the 4×4 case.
 */

import type { LandmarkBuffer } from "../../models/Landmark";
import { LANDMARK_STRIDE, lmAt } from "../../models/Landmark";

// ─── Types ──────────────────────────────────────────────────────────

/**
 * 3×4 camera projection matrix P = K * [R | t]
 * Stored row-major: [p00, p01, p02, p03, p10, p11, p12, p13, p20, p21, p22, p23]
 */
export type ProjectionMatrix = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type TriangulatedPoint = Readonly<{
  x: number;
  y: number;
  z: number;
  /** Average confidence from both views */
  confidence: number;
  /** Reprojection error (pixels, average of both views) */
  reprojError: number;
}>;

export type TriangulationResult = Readonly<{
  /** Triangulated 3D landmarks as Float32Array [x,y,z,c, ...] */
  landmarks3D: Float32Array;
  /** Per-landmark reprojection errors */
  reprojErrors: Float32Array;
  /** Average reprojection error across all landmarks */
  avgReprojError: number;
  /** Number of landmarks successfully triangulated */
  triangulatedCount: number;
  /** Number of landmarks that failed (low confidence in either view) */
  failedCount: number;
}>;

// ─── Main API ───────────────────────────────────────────────────────

/**
 * Triangulate all landmarks from two views.
 *
 * @param landmarksA 2D landmarks from Camera A (normalized 0..1)
 * @param landmarksB 2D landmarks from Camera B (normalized 0..1)
 * @param P1 Projection matrix for Camera A
 * @param P2 Projection matrix for Camera B
 * @param minConfidence Minimum confidence to attempt triangulation
 * @returns TriangulationResult with 3D landmarks
 */
export function triangulateLandmarks(
  landmarksA: LandmarkBuffer,
  landmarksB: LandmarkBuffer,
  P1: ProjectionMatrix,
  P2: ProjectionMatrix,
  minConfidence = 0.3,
): TriangulationResult {
  const countA = Math.floor(landmarksA.length / LANDMARK_STRIDE);
  const countB = Math.floor(landmarksB.length / LANDMARK_STRIDE);
  const count = Math.min(countA, countB);

  const landmarks3D = new Float32Array(count * LANDMARK_STRIDE);
  const reprojErrors = new Float32Array(count);

  let totalError = 0;
  let triangulatedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < count; i++) {
    const a = lmAt(landmarksA, i);
    const b = lmAt(landmarksB, i);
    const confA = a.c ?? 0;
    const confB = b.c ?? 0;
    const offset = i * LANDMARK_STRIDE;

    if (confA < minConfidence || confB < minConfidence) {
      // Cannot triangulate — set zero with zero confidence
      landmarks3D[offset] = 0;
      landmarks3D[offset + 1] = 0;
      landmarks3D[offset + 2] = 0;
      landmarks3D[offset + 3] = 0;
      reprojErrors[i] = Infinity;
      failedCount++;
      continue;
    }

    const pt = triangulatePoint(a.x, a.y, b.x, b.y, P1, P2);
    const avgConf = (confA + confB) / 2;

    landmarks3D[offset] = pt.x;
    landmarks3D[offset + 1] = pt.y;
    landmarks3D[offset + 2] = pt.z;
    landmarks3D[offset + 3] = avgConf;

    reprojErrors[i] = pt.reprojError;
    totalError += pt.reprojError;
    triangulatedCount++;
  }

  return {
    landmarks3D,
    reprojErrors,
    avgReprojError: triangulatedCount > 0 ? totalError / triangulatedCount : Infinity,
    triangulatedCount,
    failedCount,
  };
}

/**
 * Triangulate a single point from two 2D observations using DLT.
 *
 * The method sets up the system Ax = 0 where:
 *   x_a × (P1 · X) = 0  →  2 independent equations
 *   x_b × (P2 · X) = 0  →  2 independent equations
 * Resulting in a 4×4 system solved via SVD.
 */
export function triangulatePoint(
  xA: number, yA: number,
  xB: number, yB: number,
  P1: ProjectionMatrix,
  P2: ProjectionMatrix,
): TriangulatedPoint {
  // Build A matrix (4×4)
  // Row 0: xA * P1[row2] - P1[row0]
  // Row 1: yA * P1[row2] - P1[row1]
  // Row 2: xB * P2[row2] - P2[row0]
  // Row 3: yB * P2[row2] - P2[row1]

  const A: number[][] = [
    [
      xA * P1[8] - P1[0],
      xA * P1[9] - P1[1],
      xA * P1[10] - P1[2],
      xA * P1[11] - P1[3],
    ],
    [
      yA * P1[8] - P1[4],
      yA * P1[9] - P1[5],
      yA * P1[10] - P1[6],
      yA * P1[11] - P1[7],
    ],
    [
      xB * P2[8] - P2[0],
      xB * P2[9] - P2[1],
      xB * P2[10] - P2[2],
      xB * P2[11] - P2[3],
    ],
    [
      yB * P2[8] - P2[4],
      yB * P2[9] - P2[5],
      yB * P2[10] - P2[6],
      yB * P2[11] - P2[7],
    ],
  ];

  // Solve Ax = 0 via SVD — the solution is the last column of V
  const X = solveHomogeneous4x4(A);

  // Convert from homogeneous: [X, Y, Z, W] → [X/W, Y/W, Z/W]
  const w = X[3];
  const invW = Math.abs(w) > 1e-10 ? 1 / w : 0;
  const x3d = X[0] * invW;
  const y3d = X[1] * invW;
  const z3d = X[2] * invW;

  // Compute reprojection error
  const errorA = reprojectionError(x3d, y3d, z3d, xA, yA, P1);
  const errorB = reprojectionError(x3d, y3d, z3d, xB, yB, P2);
  const avgError = (errorA + errorB) / 2;

  return {
    x: x3d,
    y: y3d,
    z: z3d,
    confidence: 1.0, // will be set by caller
    reprojError: avgError,
  };
}

// ─── SVD for 4×4 homogeneous system ────────────────────────────────

/**
 * Solve Ax = 0 for a 4×4 matrix using the eigenvalue approach.
 *
 * Computes A^T A, then finds the eigenvector corresponding to the
 * smallest eigenvalue via power iteration on the inverse.
 *
 * Returns the 4-element solution vector (last column of V in SVD).
 */
function solveHomogeneous4x4(A: number[][]): [number, number, number, number] {
  // Compute B = A^T * A (4×4 symmetric)
  const B: number[][] = Array.from({ length: 4 }, () => new Array(4).fill(0));
  for (let i = 0; i < 4; i++) {
    for (let j = i; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += A[k][i] * A[k][j];
      }
      B[i][j] = sum;
      B[j][i] = sum;
    }
  }

  // Use Jacobi eigenvalue algorithm for 4×4 symmetric matrix
  return smallestEigenvector4x4(B);
}

/**
 * Jacobi eigenvalue algorithm for a 4×4 symmetric matrix.
 * Returns the eigenvector corresponding to the smallest eigenvalue.
 */
function smallestEigenvector4x4(
  S: number[][],
): [number, number, number, number] {
  const n = 4;
  const maxIter = 100;
  const eps = 1e-12;

  // Working copy
  const A: number[][] = S.map((row) => [...row]);
  // V starts as identity
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let iter = 0; iter < maxIter; iter++) {
    // Find largest off-diagonal element
    let maxVal = 0;
    let p = 0;
    let q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const absVal = Math.abs(A[i][j]);
        if (absVal > maxVal) {
          maxVal = absVal;
          p = i;
          q = j;
        }
      }
    }

    if (maxVal < eps) break;

    // Compute rotation angle
    const app = A[p][p];
    const aqq = A[q][q];
    const apq = A[p][q];

    let theta: number;
    if (Math.abs(app - aqq) < eps) {
      theta = Math.PI / 4;
    } else {
      theta = 0.5 * Math.atan2(2 * apq, app - aqq);
    }

    const c = Math.cos(theta);
    const s = Math.sin(theta);

    // Apply Jacobi rotation
    for (let i = 0; i < n; i++) {
      const aip = A[i][p];
      const aiq = A[i][q];
      A[i][p] = c * aip + s * aiq;
      A[i][q] = -s * aip + c * aiq;
    }
    for (let j = 0; j < n; j++) {
      const apj = A[p][j];
      const aqj = A[q][j];
      A[p][j] = c * apj + s * aqj;
      A[q][j] = -s * apj + c * aqj;
    }

    // Update eigenvectors
    for (let i = 0; i < n; i++) {
      const vip = V[i][p];
      const viq = V[i][q];
      V[i][p] = c * vip + s * viq;
      V[i][q] = -s * vip + c * viq;
    }
  }

  // Find the smallest eigenvalue
  let minIdx = 0;
  let minEigen = A[0][0];
  for (let i = 1; i < n; i++) {
    if (A[i][i] < minEigen) {
      minEigen = A[i][i];
      minIdx = i;
    }
  }

  // Return corresponding eigenvector (column of V)
  return [V[0][minIdx], V[1][minIdx], V[2][minIdx], V[3][minIdx]];
}

// ─── Reprojection error ────────────────────────────────────────────

function reprojectionError(
  X: number, Y: number, Z: number,
  u: number, v: number,
  P: ProjectionMatrix,
): number {
  // Project 3D → 2D: [u', v', w'] = P · [X, Y, Z, 1]
  const w = P[8] * X + P[9] * Y + P[10] * Z + P[11];
  if (Math.abs(w) < 1e-10) return Infinity;

  const uProj = (P[0] * X + P[1] * Y + P[2] * Z + P[3]) / w;
  const vProj = (P[4] * X + P[5] * Y + P[6] * Z + P[7]) / w;

  const du = uProj - u;
  const dv = vProj - v;
  return Math.sqrt(du * du + dv * dv);
}

// ─── Camera model helpers ──────────────────────────────────────────

/**
 * Build an intrinsic matrix K from camera FOV and image dimensions.
 * Returns a 3×3 row-major array.
 *
 * @param fovDeg Horizontal field of view in degrees
 * @param width Image width in pixels (or 1.0 for normalized coords)
 * @param height Image height in pixels (or aspect ratio for normalized)
 */
export function intrinsicFromFov(
  fovDeg: number,
  width = 1.0,
  height = 1.0,
): [number, number, number, number, number, number, number, number, number] {
  const fovRad = (fovDeg * Math.PI) / 180;
  const fx = (width / 2) / Math.tan(fovRad / 2);
  const fy = fx; // square pixels assumed
  const cx = width / 2;
  const cy = height / 2;

  return [
    fx, 0, cx,
    0, fy, cy,
    0, 0, 1,
  ];
}

/**
 * Build a projection matrix P = K * [R | t]
 *
 * @param K 3×3 intrinsic matrix (row-major)
 * @param R 3×3 rotation matrix (row-major)
 * @param t 3×1 translation vector
 */
export function buildProjectionMatrix(
  K: readonly number[], // 9 elements
  R: readonly number[], // 9 elements
  t: readonly number[], // 3 elements
): ProjectionMatrix {
  // [R | t] is 3×4
  const Rt = [
    R[0], R[1], R[2], t[0],
    R[3], R[4], R[5], t[1],
    R[6], R[7], R[8], t[2],
  ];

  // P = K × [R|t]  (3×3 × 3×4 = 3×4)
  const P: number[] = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += K[i * 3 + k] * Rt[k * 4 + j];
      }
      P[i * 4 + j] = sum;
    }
  }

  return P as unknown as ProjectionMatrix;
}

/**
 * Identity rotation (camera at origin looking down -Z or +Z depending on convention).
 */
export const IDENTITY_R: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Zero translation.
 */
export const ZERO_T: readonly number[] = [0, 0, 0];
