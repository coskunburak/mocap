import type {
  CleanupAction,
  CleanupReport,
  PoseFrameArtifactFrame,
  PoseFramesArtifact,
  PoseLandmark,
  SolvedMotionArtifact,
  SolvedMotionFrame,
} from "../types";

type Vec3 = [number, number, number];
type Euler = [number, number, number];

const MP = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

const BONES: Array<[number, number]> = [
  [MP.leftShoulder, MP.leftElbow],
  [MP.leftElbow, MP.leftWrist],
  [MP.rightShoulder, MP.rightElbow],
  [MP.rightElbow, MP.rightWrist],
  [MP.leftHip, MP.leftKnee],
  [MP.leftKnee, MP.leftAnkle],
  [MP.rightHip, MP.rightKnee],
  [MP.rightKnee, MP.rightAnkle],
  [MP.leftShoulder, MP.rightShoulder],
  [MP.leftHip, MP.rightHip],
];

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function v(x = 0, y = 0, z = 0): Vec3 {
  return [finite(x), finite(y), finite(z)];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul(a: Vec3, scale: number): Vec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function lerpEuler(a: Euler, b: Euler, t: number): Euler {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function dist(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function horizontalDist(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function std(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
  return sorted[index];
}

function landmarkPoint(frame: PoseFrameArtifactFrame, index: number): Vec3 | null {
  const source = frame.worldLandmarks?.length ? frame.worldLandmarks : frame.landmarks;
  const scale = frame.worldLandmarks?.length ? 100 : 180;
  const landmark = source[index];
  if (!landmark || ![landmark.x, landmark.y, landmark.z].every(Number.isFinite)) {
    return null;
  }
  return v(landmark.x * scale, -landmark.y * scale, -landmark.z * scale);
}

function visibility(landmark: PoseLandmark | undefined) {
  return clamp01(landmark?.visibility ?? landmark?.presence ?? 0);
}

function confidenceForPoseFrame(frame: PoseFrameArtifactFrame | undefined) {
  if (!frame) return 0;
  const landmarks = frame.worldLandmarks?.length ? frame.worldLandmarks : frame.landmarks;
  if (!landmarks.length) return 0;
  return clamp01(frame.poseConfidence || mean(landmarks.map(visibility)));
}

function cloneFrame(frame: SolvedMotionFrame): SolvedMotionFrame {
  return {
    frameIndex: frame.frameIndex,
    timestampMs: frame.timestampMs,
    rootTranslation: [...frame.rootTranslation],
    joints: Object.fromEntries(
      Object.entries(frame.joints).map(([name, rotation]) => [name, [...rotation] as Euler]),
    ),
  };
}

function interpolateFrame(
  frameIndex: number,
  timestampMs: number,
  previous: SolvedMotionFrame,
  next: SolvedMotionFrame,
): SolvedMotionFrame {
  const span = Math.max(1, next.frameIndex - previous.frameIndex);
  const t = Math.max(0, Math.min(1, (frameIndex - previous.frameIndex) / span));
  const joints: Record<string, Euler> = {};
  const names = new Set([...Object.keys(previous.joints), ...Object.keys(next.joints)]);
  for (const name of names) {
    joints[name] = lerpEuler(
      (previous.joints[name] ?? [0, 0, 0]) as Euler,
      (next.joints[name] ?? previous.joints[name] ?? [0, 0, 0]) as Euler,
      t,
    );
  }
  return {
    frameIndex,
    timestampMs,
    rootTranslation: lerpVec(previous.rootTranslation, next.rootTranslation, t),
    joints,
  };
}

function densifyFrames(
  pose: PoseFramesArtifact,
  solved: SolvedMotionArtifact,
): { frames: SolvedMotionFrame[]; interpolated: number } {
  const byFrame = new Map(solved.frames.map((frame) => [frame.frameIndex, frame]));
  let interpolated = 0;
  const frames = pose.frames.map((poseFrame, index) => {
    const exact = byFrame.get(poseFrame.frameIndex);
    if (exact) return cloneFrame(exact);

    const previous = [...solved.frames]
      .reverse()
      .find((frame) => frame.frameIndex < poseFrame.frameIndex);
    const next = solved.frames.find((frame) => frame.frameIndex > poseFrame.frameIndex);
    interpolated += 1;

    if (previous && next) {
      return interpolateFrame(poseFrame.frameIndex, poseFrame.timestampMs, previous, next);
    }
    if (previous) {
      return { ...cloneFrame(previous), frameIndex: poseFrame.frameIndex, timestampMs: poseFrame.timestampMs };
    }
    if (next) {
      return { ...cloneFrame(next), frameIndex: poseFrame.frameIndex, timestampMs: poseFrame.timestampMs };
    }
    return {
      frameIndex: poseFrame.frameIndex,
      timestampMs: poseFrame.timestampMs,
      rootTranslation: [0, 0, 0] as Vec3,
      joints: {},
    };
  });
  return { frames, interpolated };
}

function rejectOutliers(frames: SolvedMotionFrame[]) {
  if (frames.length < 3) return { frames, count: 0 };
  const speeds = frames.slice(1).map((frame, index) =>
    dist(frame.rootTranslation, frames[index].rootTranslation),
  );
  const threshold = percentile(speeds, 0.9) * 3 + 12;
  let count = 0;
  const next = frames.map(cloneFrame);

  for (let index = 1; index < next.length - 1; index += 1) {
    const jumpIn = dist(next[index].rootTranslation, next[index - 1].rootTranslation);
    const jumpOut = dist(next[index + 1].rootTranslation, next[index].rootTranslation);
    if (jumpIn > threshold && jumpOut > threshold) {
      count += 1;
      next[index].rootTranslation = lerpVec(
        next[index - 1].rootTranslation,
        next[index + 1].rootTranslation,
        0.5,
      );
      for (const [name, rotation] of Object.entries(next[index].joints)) {
        next[index].joints[name] = lerpEuler(
          (next[index - 1].joints[name] ?? rotation) as Euler,
          (next[index + 1].joints[name] ?? rotation) as Euler,
          0.5,
        );
      }
    }
  }

  return { frames: next, count };
}

function smoothFrames(frames: SolvedMotionFrame[], pose: PoseFramesArtifact) {
  if (frames.length < 2) return { frames, smoothingStrength: 0 };
  const poseByFrame = new Map(pose.frames.map((frame) => [frame.frameIndex, frame]));
  const usesWhamInternalPose = pose.detector.name === "wham_internal_vitpose";
  const next = frames.map(cloneFrame);
  let smoothingSum = 0;

  for (let index = 1; index < next.length; index += 1) {
    const poseFrame = poseByFrame.get(next[index].frameIndex);
    const confidence = usesWhamInternalPose
      ? clamp01(poseFrame?.poseConfidence ?? 1)
      : confidenceForPoseFrame(poseFrame);
    const alpha = 0.28 + (1 - confidence) * 0.42;
    smoothingSum += alpha;
    next[index].rootTranslation = lerpVec(
      next[index].rootTranslation,
      next[index - 1].rootTranslation,
      alpha * 0.45,
    );
    next[index].rootTranslation[1] = lerp(
      next[index].rootTranslation[1],
      next[index - 1].rootTranslation[1],
      alpha * 0.75,
    );
    for (const [name, rotation] of Object.entries(next[index].joints)) {
      next[index].joints[name] = lerpEuler(rotation as Euler, (next[index - 1].joints[name] ?? rotation) as Euler, alpha);
    }
  }

  return { frames: next, smoothingStrength: smoothingSum / Math.max(1, next.length - 1) };
}

function footPoints(pose: PoseFramesArtifact) {
  return pose.frames.map((frame) => ({
    frameIndex: frame.frameIndex,
    left: landmarkPoint(frame, MP.leftAnkle),
    right: landmarkPoint(frame, MP.rightAnkle),
  }));
}

function applyFootLock(frames: SolvedMotionFrame[], pose: PoseFramesArtifact) {
  const points = footPoints(pose);
  const heights = points.flatMap((item) => [item.left?.[1], item.right?.[1]]).filter((value): value is number => value != null);
  const floor = percentile(heights, 0.15);
  const byIndex = new Map(points.map((item) => [item.frameIndex, item]));
  const next = frames.map(cloneFrame);
  let contactFrames = 0;
  let lockFrames = 0;
  let slidingDistance = 0;
  let activeFoot: "left" | "right" | null = null;
  let anchor: Vec3 | null = null;
  let previousFoot: Vec3 | null = null;

  for (const frame of next) {
    const point = byIndex.get(frame.frameIndex);
    const candidates = [
      { foot: "left" as const, point: point?.left },
      { foot: "right" as const, point: point?.right },
    ].filter((item): item is { foot: "left" | "right"; point: Vec3 } => Boolean(item.point));
    const contact = candidates
      .filter((item) => Math.abs(item.point[1] - floor) < 8)
      .sort((a, b) => a.point[1] - b.point[1])[0];

    if (!contact) {
      activeFoot = null;
      anchor = null;
      previousFoot = null;
      continue;
    }

    contactFrames += 1;
    if (activeFoot !== contact.foot || !anchor) {
      activeFoot = contact.foot;
      anchor = contact.point;
      previousFoot = contact.point;
      continue;
    }

    if (previousFoot) {
      slidingDistance += horizontalDist(previousFoot, contact.point);
    }
    const drift = sub(contact.point, anchor);
    frame.rootTranslation[0] -= drift[0] * 0.65;
    frame.rootTranslation[2] -= drift[2] * 0.65;
    lockFrames += 1;
    previousFoot = contact.point;
  }

  const avgSliding = contactFrames > 1 ? slidingDistance / (contactFrames - 1) : 0;
  return { frames: next, contactFrames, lockFrames, slidingDistance: avgSliding };
}

function jitterRms(frames: SolvedMotionFrame[]) {
  if (frames.length < 3) return 0;
  const acceleration = [];
  for (let index = 2; index < frames.length; index += 1) {
    const a = frames[index - 2].rootTranslation;
    const b = frames[index - 1].rootTranslation;
    const c = frames[index].rootTranslation;
    acceleration.push(dist(sub(c, mul(b, 2)), mul(a, -1)));
  }
  return Math.sqrt(mean(acceleration.map((value) => value ** 2)));
}

function rootVerticalJitter(frames: SolvedMotionFrame[]) {
  if (frames.length < 2) return 0;
  return std(frames.map((frame) => frame.rootTranslation[1]));
}

function boneLengthConsistency(pose: PoseFramesArtifact) {
  const variations: number[] = [];
  for (const [a, b] of BONES) {
    const lengths = pose.frames
      .map((frame) => {
        const pa = landmarkPoint(frame, a);
        const pb = landmarkPoint(frame, b);
        return pa && pb ? dist(pa, pb) : null;
      })
      .filter((value): value is number => value != null && value > 1);
    if (lengths.length < 4) continue;
    variations.push(std(lengths) / Math.max(1, mean(lengths)));
  }
  const variation = mean(variations);
  return {
    variation,
    score: clamp01(1 - variation * 2.5),
  };
}

function leftRightSwapCount(pose: PoseFramesArtifact) {
  const signs = pose.frames
    .map((frame) => {
      const left = landmarkPoint(frame, MP.leftShoulder) ?? landmarkPoint(frame, MP.leftHip);
      const right = landmarkPoint(frame, MP.rightShoulder) ?? landmarkPoint(frame, MP.rightHip);
      if (!left || !right) return null;
      return Math.sign(right[0] - left[0]);
    })
    .filter((value): value is number => value != null && value !== 0);
  if (signs.length < 2) return 0;
  const reference = signs[0];
  return signs.filter((sign) => sign !== reference).length;
}

function createActions(metrics: CleanupReport["metrics"], validationWarnings: string[]): CleanupAction[] {
  const actions: CleanupAction[] = [];
  if (metrics.missingLandmarkRatio > 0.25) {
    actions.push({
      code: "subject_visibility_low",
      severity: "critical",
      message: "Keep the full body in frame for the whole take and avoid occluding arms or feet.",
    });
  }
  if (metrics.footSlidingScore < 0.62) {
    actions.push({
      code: "foot_sliding_high",
      severity: "warning",
      message: "Record with feet clearly visible and avoid shiny floors or camera shake.",
    });
  }
  if (metrics.jitterScore < 0.58) {
    actions.push({
      code: "motion_jitter_high",
      severity: "warning",
      message: "Improve lighting and keep the camera stable to reduce landmark jitter.",
    });
  }
  if (metrics.leftRightSwapCount > Math.max(2, metrics.sourceFrameCount * 0.03)) {
    actions.push({
      code: "left_right_swap_detected",
      severity: "warning",
      message: "Avoid side-on turns and arm/body overlap; the solver detected left/right swaps.",
    });
  }
  for (const warning of validationWarnings) {
    actions.push({
      code: "export_validation_warning",
      severity: "info",
      message: warning,
    });
  }
  return actions;
}

export function cleanupSolvedMotion(
  pose: PoseFramesArtifact,
  solved: SolvedMotionArtifact,
): { cleaned: SolvedMotionArtifact; report: CleanupReport } {
  const densified = densifyFrames(pose, solved);
  const rejected = rejectOutliers(densified.frames);
  const smoothed = smoothFrames(rejected.frames, pose);
  const locked = applyFootLock(smoothed.frames, pose);
  const jitter = jitterRms(locked.frames);
  const vertical = rootVerticalJitter(locked.frames);
  const bone = boneLengthConsistency(pose);
  const swapCount = leftRightSwapCount(pose);
  const missingLandmarkRatio =
    pose.quality.frameCount > 0
      ? 1 - pose.quality.detectedFrameCount / pose.quality.frameCount
      : 1;
  const hasPoseLandmarks = pose.frames.some(
    (frame) => frame.landmarks.length > 0 || Boolean(frame.worldLandmarks?.length),
  );
  const metrics: CleanupReport["metrics"] = {
    sourceFrameCount: pose.quality.frameCount,
    solvedFrameCount: solved.frameCount,
    cleanedFrameCount: locked.frames.length,
    interpolatedFrameCount: densified.interpolated,
    outlierFrameCount: rejected.count,
    missingLandmarkRatio,
    jitterScore: clamp01(1 / (1 + jitter / 12)),
    jitterRms: jitter,
    rootStability: clamp01(1 / (1 + vertical / 18)),
    rootVerticalJitter: vertical,
    footSlidingScore: clamp01(1 / (1 + locked.slidingDistance / 4)),
    footSlidingDistance: locked.slidingDistance,
    footContactFrameCount: locked.contactFrames,
    footLockFrameCount: locked.lockFrames,
    boneLengthConsistency: bone.score,
    boneLengthVariation: bone.variation,
    leftRightSwapCount: swapCount,
    smoothingStrength: smoothed.smoothingStrength,
  };
  const warnings = [
    ...(metrics.interpolatedFrameCount > 0 ? [`Interpolated ${metrics.interpolatedFrameCount} missing solve frames.`] : []),
    ...(metrics.outlierFrameCount > 0 ? [`Rejected ${metrics.outlierFrameCount} root outlier frames.`] : []),
    ...(hasPoseLandmarks && metrics.footLockFrameCount === 0 ? ["No reliable foot contact found for locking."] : []),
  ];
  const report: CleanupReport = {
    schema: "mocap.cleanup_report.v1",
    takeId: pose.takeId,
    jobId: pose.jobId,
    algorithm: {
      name: "cleanup_quality_v1_5",
      smoothing: "confidence_aware_exponential",
      interpolation: "nearest_linear",
      footLocking: "basic_contact_anchor",
    },
    metrics,
    warnings,
    actions: createActions(metrics, warnings),
  };
  return {
    cleaned: {
      ...solved,
      frameCount: locked.frames.length,
      frames: locked.frames,
      validation: {
        ...solved.validation,
        warnings: [...solved.validation.warnings, ...warnings],
      },
    },
    report,
  };
}
