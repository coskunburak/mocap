import assert from "node:assert/strict";
import type { PoseFrame } from "../../models/PoseFrame";
import {
  evaluatePoseFrameQuality,
  projectNormalizedPointToView,
} from "./PoseFrameGeometry";

function frameWithCore(input: {
  shoulders?: [number, number, number, number];
  hips?: [number, number, number, number];
  confidence?: number;
}): PoseFrame {
  const confidence = input.confidence ?? 0.8;
  const landmarks = new Float32Array(33 * 4);
  const write = (index: number, x: number, y: number, c = confidence) => {
    const offset = index * 4;
    landmarks[offset] = x;
    landmarks[offset + 1] = y;
    landmarks[offset + 2] = 0;
    landmarks[offset + 3] = c;
  };

  const shoulders = input.shoulders ?? [0.42, 0.32, 0.58, 0.32];
  const hips = input.hips ?? [0.44, 0.56, 0.56, 0.56];
  write(11, shoulders[0], shoulders[1]);
  write(12, shoulders[2], shoulders[3]);
  write(23, hips[0], hips[1]);
  write(24, hips[2], hips[3]);
  write(0, 0.5, 0.2);
  write(13, 0.36, 0.4);
  write(14, 0.64, 0.4);
  write(15, 0.32, 0.5);
  write(16, 0.68, 0.5);
  write(25, 0.44, 0.72);
  write(26, 0.56, 0.72);
  write(27, 0.44, 0.9);
  write(28, 0.56, 0.9);

  return {
    ts: 1,
    landmarks,
    coordinateSpace: "image_normalized",
    imageWidth: 1080,
    imageHeight: 1920,
  };
}

function testAspectFillProjectionUsesImageGeometry() {
  const frame = frameWithCore({});
  const center = projectNormalizedPointToView(0.5, 0.5, frame, 393, 852);
  assert.equal(Math.round(center.x), 197);
  assert.equal(Math.round(center.y), 426);

  const leftEdge = projectNormalizedPointToView(0, 0.5, frame, 393, 852);
  assert.ok(leftEdge.x < 0, "portrait camera should be horizontally cropped in tall preview");
}

function testReliablePortraitPosePassesQualityGate() {
  const quality = evaluatePoseFrameQuality(frameWithCore({}));
  assert.equal(quality.reliable, true);
  assert.equal(quality.reason, undefined);
  assert.ok(quality.torsoVerticality > 1);
}

function testSidewaysPoseFailsQualityGate() {
  const quality = evaluatePoseFrameQuality(
    frameWithCore({
      shoulders: [0.42, 0.4, 0.58, 0.4],
      hips: [0.44, 0.45, 0.56, 0.45],
    }),
  );
  assert.equal(quality.reliable, false);
  assert.equal(quality.reason, "torso_orientation_unstable");
}

function testLowConfidencePoseFailsQualityGate() {
  const quality = evaluatePoseFrameQuality(frameWithCore({ confidence: 0.1 }));
  assert.equal(quality.reliable, false);
  assert.equal(quality.reason, "body_landmark_coverage_low");
}

testAspectFillProjectionUsesImageGeometry();
testReliablePortraitPosePassesQualityGate();
testSidewaysPoseFailsQualityGate();
testLowConfidencePoseFailsQualityGate();
console.log("pose frame geometry tests passed");
