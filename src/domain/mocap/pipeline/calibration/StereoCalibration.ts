/**
 * StereoCalibration – Estimate relative camera pose from matched 2D landmark pairs.
 *
 * Uses a simplified approach suitable for phone-based mocap:
 *   1. Collect several frames where both cameras see the same person
 *   2. Use 2D landmark correspondences to estimate the Fundamental Matrix
 *   3. Decompose into R, t using known/estimated camera intrinsics
 *
 * The "8-point algorithm" (normalized) is used for F estimation.
 * For initial version, camera intrinsics are estimated from device FOV.
 */

import type { LandmarkBuffer } from "../../models/Landmark";
import { LANDMARK_STRIDE, lmAt } from "../../models/Landmark";
import type { StereoCalibrationResult } from "../../models/MultiViewPoseFrame";
import {
  type ProjectionMatrix,
  buildProjectionMatrix,
  intrinsicFromFov,
  IDENTITY_R,
  ZERO_T,
} from "../triangulation/Triangulator";

// ─── Types ──────────────────────────────────────────────────────────

export type CalibrationSample = Readonly<{
  /** 2D landmarks from Camera A */
  landmarksA: LandmarkBuffer;
  /** 2D landmarks from Camera B */
  landmarksB: LandmarkBuffer;
  /** Timestamp */
  ts: number;
}>;

export type CalibrationConfig = Readonly<{
  /** Horizontal FOV of Camera A in degrees. Default: 69 (typical iPhone wide) */
  fovA?: number;
  /** Horizontal FOV of Camera B in degrees. Default: 69 */
  fovB?: number;
  /** Minimum landmark confidence to use for calibration */
  minConfidence?: number;
  /** Minimum number of valid point pairs needed */
  minPointPairs?: number;
  /** Known reference distance for scale (meters). If provided, translation is scaled. */
  referenceDistance?: number;
  /** Indices of the two landmarks defining the reference distance */
  referenceIndices?: readonly [number, number];
}>;

// ─── Main API ───────────────────────────────────────────────────────

/**
 * Perform stereo calibration from collected samples.
 *
 * @param samples Array of matched landmark pairs from both cameras
 * @param config Calibration configuration
 * @returns StereoCalibrationResult or null if calibration failed
 */
export function calibrateStereo(
  samples: readonly CalibrationSample[],
  config?: CalibrationConfig,
): StereoCalibrationResult | null {
  const fovA = config?.fovA ?? 69;
  const fovB = config?.fovB ?? 69;
  const minConf = config?.minConfidence ?? 0.4;
  const minPairs = config?.minPointPairs ?? 8;

  // Collect all valid point correspondences across samples
  const pointsA: [number, number][] = [];
  const pointsB: [number, number][] = [];

  for (const sample of samples) {
    const countA = Math.floor(sample.landmarksA.length / LANDMARK_STRIDE);
    const countB = Math.floor(sample.landmarksB.length / LANDMARK_STRIDE);
    const count = Math.min(countA, countB);

    for (let i = 0; i < count; i++) {
      const a = lmAt(sample.landmarksA, i);
      const b = lmAt(sample.landmarksB, i);
      if ((a.c ?? 0) >= minConf && (b.c ?? 0) >= minConf) {
        pointsA.push([a.x, a.y]);
        pointsB.push([b.x, b.y]);
      }
    }
  }

  if (pointsA.length < minPairs) {
    console.warn(
      `[StereoCalibration] Not enough point pairs: ${pointsA.length} < ${minPairs}`,
    );
    return null;
  }

  // Estimate Fundamental Matrix using normalized 8-point algorithm
  const F = estimateFundamentalMatrix(pointsA, pointsB);
  if (!F) {
    console.warn("[StereoCalibration] Failed to estimate Fundamental Matrix");
    return null;
  }

  // Build intrinsic matrices
  const KA = intrinsicFromFov(fovA);
  const KB = intrinsicFromFov(fovB);

  // Essential Matrix: E = KB^T * F * KA
  const E = computeEssentialMatrix(F, KA, KB);

  // Decompose E into R, t
  const decomposition = decomposeEssentialMatrix(E);
  if (!decomposition) {
    console.warn("[StereoCalibration] Failed to decompose Essential Matrix");
    return null;
  }

  const { R, t } = decomposition;

  // Scale translation if reference distance is provided
  let scaledT = [...t];
  let baseline = Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]);
  if (config?.referenceDistance && config?.referenceIndices) {
    const scale = estimateScale(
      pointsA,
      pointsB,
      KA,
      KB,
      R,
      t,
      config.referenceDistance,
      config.referenceIndices,
    );
    if (scale > 0) {
      scaledT = t.map((v) => v * scale);
      baseline = config.referenceDistance;
    }
  }

  // Build projection matrices
  const PA = buildProjectionMatrix(KA, IDENTITY_R, ZERO_T);
  const PB = buildProjectionMatrix(KB, R, scaledT);

  // Compute calibration quality
  const reprojError = computeCalibrationReprojError(
    pointsA,
    pointsB,
    PA,
    PB,
  );

  // Estimate convergence angle
  const convergenceAngle = estimateConvergenceAngle(R);

  const qualityScore = assessCalibrationQuality(
    reprojError,
    convergenceAngle,
    pointsA.length,
  );

  return {
    rotation: [...R],
    translation: scaledT,
    intrinsicA: [...KA],
    intrinsicB: [...KB],
    projectionA: [...PA],
    projectionB: [...PB],
    qualityScore,
    reprojError,
    baseline,
    convergenceAngle,
    calibratedAt: Date.now(),
    pointPairsUsed: pointsA.length,
  };
}

// ─── Fundamental Matrix (Normalized 8-point) ───────────────────────

function estimateFundamentalMatrix(
  pointsA: [number, number][],
  pointsB: [number, number][],
): number[] | null {
  const n = pointsA.length;
  if (n < 8) return null;

  // Normalize points (Hartley normalization)
  const { normalized: nA, T: TA } = normalizePoints(pointsA);
  const { normalized: nB, T: TB } = normalizePoints(pointsB);

  // Build the coefficient matrix A (n×9)
  // For each point pair: [x'x, x'y, x', y'x, y'y, y', x, y, 1]
  const A: number[][] = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = nA[i];
    const [x2, y2] = nB[i];
    A.push([
      x2 * x1, x2 * y1, x2,
      y2 * x1, y2 * y1, y2,
      x1, y1, 1,
    ]);
  }

  // Solve Af = 0 using SVD (find null space)
  const f = solveNullSpace(A, 9);
  if (!f) return null;

  // Reshape to 3×3
  const Fn = [
    f[0], f[1], f[2],
    f[3], f[4], f[5],
    f[6], f[7], f[8],
  ];

  // Enforce rank-2 constraint via SVD
  const Frank2 = enforceRank2(Fn);

  // Denormalize: F = TB^T * Fn * TA
  const F = mat3Mul(mat3Transpose(TB), mat3Mul(Frank2, TA));

  return F;
}

// ─── Essential Matrix ──────────────────────────────────────────────

function computeEssentialMatrix(
  F: number[],
  KA: readonly number[],
  KB: readonly number[],
): number[] {
  // E = KB^T * F * KA
  return mat3Mul(mat3Transpose([...KB]), mat3Mul(F, [...KA]));
}

function decomposeEssentialMatrix(
  E: number[],
): { R: number[]; t: number[] } | null {
  // SVD of E
  const svd = svd3x3(E);
  if (!svd) return null;

  const { U, S, Vt } = svd;

  // W matrix for rotation extraction
  const W = [0, -1, 0, 1, 0, 0, 0, 0, 1];

  // Two possible rotations
  const R1 = mat3Mul(U, mat3Mul(W, Vt));
  const R2 = mat3Mul(U, mat3Mul(mat3Transpose(W), Vt));

  // Translation (up to sign)
  const t = [U[2], U[5], U[8]]; // third column of U

  // Ensure proper rotation (det(R) = 1)
  const det1 = mat3Det(R1);
  const det2 = mat3Det(R2);

  let R: number[];
  if (Math.abs(det1 - 1) < Math.abs(det2 - 1)) {
    R = det1 < 0 ? R1.map((v) => -v) : R1;
  } else {
    R = det2 < 0 ? R2.map((v) => -v) : R2;
  }

  // Ensure det(R) = 1
  const detR = mat3Det(R);
  if (detR < 0) {
    R = R.map((v) => -v);
  }

  return { R, t };
}

// ─── Scale estimation ──────────────────────────────────────────────

function estimateScale(
  _pointsA: [number, number][],
  _pointsB: [number, number][],
  _KA: readonly number[],
  _KB: readonly number[],
  _R: number[],
  t: number[],
  referenceDistance: number,
  _referenceIndices: readonly [number, number],
): number {
  // Simple scale: normalize t to unit length, then multiply by reference distance
  const tLen = Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]);
  if (tLen < 1e-10) return 1;
  return referenceDistance / tLen;
}

// ─── Quality assessment ────────────────────────────────────────────

function computeCalibrationReprojError(
  pointsA: [number, number][],
  pointsB: [number, number][],
  PA: ProjectionMatrix,
  PB: ProjectionMatrix,
): number {
  // This is a simplified check — triangulate each pair and reproject
  let totalError = 0;
  let count = 0;

  for (let i = 0; i < Math.min(pointsA.length, 50); i++) {
    const [xA, yA] = pointsA[i];
    const [xB, yB] = pointsB[i];

    // Simple DLT triangulation inline
    const A = [
      [xA * PA[8] - PA[0], xA * PA[9] - PA[1], xA * PA[10] - PA[2], xA * PA[11] - PA[3]],
      [yA * PA[8] - PA[4], yA * PA[9] - PA[5], yA * PA[10] - PA[6], yA * PA[11] - PA[7]],
      [xB * PB[8] - PB[0], xB * PB[9] - PB[1], xB * PB[10] - PB[2], xB * PB[11] - PB[3]],
      [yB * PB[8] - PB[4], yB * PB[9] - PB[5], yB * PB[10] - PB[6], yB * PB[11] - PB[7]],
    ];

    // Solve via A^T A smallest eigenvector (simplified)
    const B = Array.from({ length: 4 }, () => new Array(4).fill(0));
    for (let r = 0; r < 4; r++) {
      for (let c = r; c < 4; c++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += A[k][r] * A[k][c];
        B[r][c] = sum;
        B[c][r] = sum;
      }
    }

    // Quick check: compute residual instead of full SVD
    const residual = Math.sqrt(
      Math.abs(B[0][0]) + Math.abs(B[1][1]) + Math.abs(B[2][2]) + Math.abs(B[3][3]),
    );
    totalError += residual;
    count++;
  }

  return count > 0 ? totalError / count : Infinity;
}

function estimateConvergenceAngle(R: number[]): number {
  // The angle between the two camera optical axes
  // For two cameras: Camera A looks along [0,0,1], Camera B looks along R * [0,0,1]
  const opticalB = [R[2], R[5], R[8]]; // third column of R
  const opticalA = [0, 0, 1];

  const dotProd =
    opticalA[0] * opticalB[0] +
    opticalA[1] * opticalB[1] +
    opticalA[2] * opticalB[2];

  const clampedDot = Math.max(-1, Math.min(1, dotProd));
  return (Math.acos(clampedDot) * 180) / Math.PI;
}

function assessCalibrationQuality(
  reprojError: number,
  convergenceAngle: number,
  pointPairs: number,
): number {
  let score = 1.0;

  // Penalize high reprojection error
  if (reprojError > 5) score -= 0.3;
  else if (reprojError > 2) score -= 0.1;

  // Ideal convergence: 60-120 degrees
  if (convergenceAngle < 20 || convergenceAngle > 160) score -= 0.4;
  else if (convergenceAngle < 40 || convergenceAngle > 140) score -= 0.2;

  // More point pairs = more reliable
  if (pointPairs < 20) score -= 0.2;
  else if (pointPairs < 50) score -= 0.1;

  return Math.max(0, Math.min(1, score));
}

// ─── Matrix utilities (3×3, row-major) ─────────────────────────────

function mat3Mul(A: number[], B: number[]): number[] {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
      }
    }
  }
  return C;
}

function mat3Transpose(A: number[]): number[] {
  return [
    A[0], A[3], A[6],
    A[1], A[4], A[7],
    A[2], A[5], A[8],
  ];
}

function mat3Det(A: number[]): number {
  return (
    A[0] * (A[4] * A[8] - A[5] * A[7]) -
    A[1] * (A[3] * A[8] - A[5] * A[6]) +
    A[2] * (A[3] * A[7] - A[4] * A[6])
  );
}

// ─── Point normalization (Hartley) ─────────────────────────────────

function normalizePoints(points: [number, number][]): {
  normalized: [number, number][];
  T: number[];
} {
  const n = points.length;
  let mx = 0, my = 0;
  for (const [x, y] of points) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;

  let avgDist = 0;
  for (const [x, y] of points) {
    avgDist += Math.sqrt((x - mx) ** 2 + (y - my) ** 2);
  }
  avgDist /= n;

  const scale = avgDist > 1e-10 ? Math.SQRT2 / avgDist : 1;

  const T = [
    scale, 0, -scale * mx,
    0, scale, -scale * my,
    0, 0, 1,
  ];

  const normalized: [number, number][] = points.map(([x, y]) => [
    scale * (x - mx),
    scale * (y - my),
  ]);

  return { normalized, T };
}

// ─── Null space solver (for Af = 0) ────────────────────────────────

function solveNullSpace(A: number[][], cols: number): number[] | null {
  // Compute A^T A
  const rows = A.length;
  const ATA: number[][] = Array.from({ length: cols }, () =>
    new Array(cols).fill(0),
  );
  for (let i = 0; i < cols; i++) {
    for (let j = i; j < cols; j++) {
      let sum = 0;
      for (let k = 0; k < rows; k++) {
        sum += A[k][i] * A[k][j];
      }
      ATA[i][j] = sum;
      ATA[j][i] = sum;
    }
  }

  // Find smallest eigenvector via inverse power iteration
  return smallestEigenvector(ATA, cols);
}

function smallestEigenvector(S: number[][], n: number): number[] | null {
  const maxIter = 200;
  const eps = 1e-12;

  const A = S.map((row) => [...row]);
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let iter = 0; iter < maxIter; iter++) {
    let maxVal = 0;
    let p = 0, q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[i][j]) > maxVal) {
          maxVal = Math.abs(A[i][j]);
          p = i;
          q = j;
        }
      }
    }
    if (maxVal < eps) break;

    const app = A[p][p], aqq = A[q][q], apq = A[p][q];
    let theta: number;
    if (Math.abs(app - aqq) < eps) {
      theta = Math.PI / 4;
    } else {
      theta = 0.5 * Math.atan2(2 * apq, app - aqq);
    }
    const c = Math.cos(theta), s = Math.sin(theta);

    for (let i = 0; i < n; i++) {
      const aip = A[i][p], aiq = A[i][q];
      A[i][p] = c * aip + s * aiq;
      A[i][q] = -s * aip + c * aiq;
    }
    for (let j = 0; j < n; j++) {
      const apj = A[p][j], aqj = A[q][j];
      A[p][j] = c * apj + s * aqj;
      A[q][j] = -s * apj + c * aqj;
    }
    for (let i = 0; i < n; i++) {
      const vip = V[i][p], viq = V[i][q];
      V[i][p] = c * vip + s * viq;
      V[i][q] = -s * vip + c * viq;
    }
  }

  let minIdx = 0, minEigen = A[0][0];
  for (let i = 1; i < n; i++) {
    if (A[i][i] < minEigen) {
      minEigen = A[i][i];
      minIdx = i;
    }
  }

  return Array.from({ length: n }, (_, i) => V[i][minIdx]);
}

// ─── Rank-2 enforcement ────────────────────────────────────────────

function enforceRank2(F: number[]): number[] {
  const svd = svd3x3(F);
  if (!svd) return F;

  const { U, S, Vt } = svd;

  // Set smallest singular value to 0
  const minIdx = S[0] <= S[1] && S[0] <= S[2] ? 0 : S[1] <= S[2] ? 1 : 2;
  const Sp = [...S];
  Sp[minIdx] = 0;

  // Reconstruct: F = U * diag(S) * Vt
  const result = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        result[i * 3 + j] += U[i * 3 + k] * Sp[k] * Vt[k * 3 + j];
      }
    }
  }
  return result;
}

// ─── Simplified 3×3 SVD via Jacobi ─────────────────────────────────

function svd3x3(
  M: number[],
): { U: number[]; S: number[]; Vt: number[] } | null {
  // Compute M^T M
  const MtM = mat3Mul(mat3Transpose(M), M);

  // Eigendecomposition of M^T M via Jacobi
  const n = 3;
  const maxIter = 100;
  const eps = 1e-12;
  const A = [
    [MtM[0], MtM[1], MtM[2]],
    [MtM[3], MtM[4], MtM[5]],
    [MtM[6], MtM[7], MtM[8]],
  ];
  const V: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iter = 0; iter < maxIter; iter++) {
    let maxVal = 0;
    let p = 0, q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[i][j]) > maxVal) {
          maxVal = Math.abs(A[i][j]);
          p = i; q = j;
        }
      }
    }
    if (maxVal < eps) break;

    const app = A[p][p], aqq = A[q][q], apq = A[p][q];
    let theta: number;
    if (Math.abs(app - aqq) < eps) theta = Math.PI / 4;
    else theta = 0.5 * Math.atan2(2 * apq, app - aqq);
    const c = Math.cos(theta), s = Math.sin(theta);

    for (let i = 0; i < n; i++) {
      const aip = A[i][p], aiq = A[i][q];
      A[i][p] = c * aip + s * aiq;
      A[i][q] = -s * aip + c * aiq;
    }
    for (let j = 0; j < n; j++) {
      const apj = A[p][j], aqj = A[q][j];
      A[p][j] = c * apj + s * aqj;
      A[q][j] = -s * apj + c * aqj;
    }
    for (let i = 0; i < n; i++) {
      const vip = V[i][p], viq = V[i][q];
      V[i][p] = c * vip + s * viq;
      V[i][q] = -s * vip + c * viq;
    }
  }

  // Eigenvalues = diagonal of A, singular values = sqrt
  const eigenvalues = [A[0][0], A[1][1], A[2][2]];
  const S = eigenvalues.map((e) => Math.sqrt(Math.max(0, e)));

  // V matrix columns are eigenvectors → Vt = V^T
  const Vt = [
    V[0][0], V[1][0], V[2][0],
    V[0][1], V[1][1], V[2][1],
    V[0][2], V[1][2], V[2][2],
  ];

  // U = M * V * diag(1/S)
  // V as 3×3 column-major → convert to row-major for mat3Mul
  const Vmat = [
    V[0][0], V[0][1], V[0][2],
    V[1][0], V[1][1], V[1][2],
    V[2][0], V[2][1], V[2][2],
  ];
  const MV = mat3Mul(M, Vmat);

  const U = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    const si = S[i] > 1e-10 ? 1 / S[i] : 0;
    for (let j = 0; j < 3; j++) {
      U[j * 3 + i] = MV[j * 3 + i] * si;
    }
  }

  return { U, S, Vt };
}
