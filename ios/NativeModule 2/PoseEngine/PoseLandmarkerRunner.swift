import Foundation
import UIKit
import AVFoundation
import MediaPipeTasksVision

public final class PoseLandmarkerRunner: NSObject {

  public enum TrackingProfile: String {
    case pose
    case holistic
  }

  public enum TrackingProfileRequest: String {
    case auto
    case pose
    case holistic
  }

  // MARK: - Config

  public struct Config {
    public let poseModelName: String
    public let holisticModelName: String
    public let modelExt: String
    public let trackingProfile: TrackingProfileRequest
    public let minPoseConfidence: Float
    public let minTrackingConfidence: Float // 0..1
    public let minPresenceConfidence: Float
    public let minFaceConfidence: Float
    public let minHandConfidence: Float
    public let outputFaceBlendshapes: Bool
    public let outputPoseSegmentationMasks: Bool
    public let numPoses: Int
    public let usesCPU: Bool
    public let debug: Bool

    public init(
      poseModelName: String = "pose_landmarker_full",
      holisticModelName: String = "holistic_landmarker",
      modelExt: String = "task",
      trackingProfile: TrackingProfileRequest = .auto,
      minPoseConfidence: Float = 0.5,
      minTrackingConfidence: Float = 0.5,
      minPresenceConfidence: Float = 0.5,
      minFaceConfidence: Float = 0.5,
      minHandConfidence: Float = 0.5,
      outputFaceBlendshapes: Bool = true,
      outputPoseSegmentationMasks: Bool = false,
      numPoses: Int = 1,
      usesCPU: Bool = true,
      debug: Bool = false
    ) {
      self.poseModelName = poseModelName
      self.holisticModelName = holisticModelName
      self.modelExt = modelExt
      self.trackingProfile = trackingProfile
      self.minPoseConfidence = minPoseConfidence
      self.minTrackingConfidence = minTrackingConfidence
      self.minPresenceConfidence = minPresenceConfidence
      self.minFaceConfidence = minFaceConfidence
      self.minHandConfidence = minHandConfidence
      self.outputFaceBlendshapes = outputFaceBlendshapes
      self.outputPoseSegmentationMasks = outputPoseSegmentationMasks
      self.numPoses = numPoses
      self.usesCPU = usesCPU
      self.debug = debug
    }
  }

  public typealias OutputCallback = (
    _ timestampMs: Int64,
    _ payload: [String: Any]
  ) -> Void
  public typealias ErrorCallback  = (_ message: String) -> Void

  // MARK: - Private State

  private let queue = DispatchQueue(label: "pose.landmarker.runner.queue", qos: .userInitiated)

  private var poseLandmarker: PoseLandmarker?
  private var holisticLandmarker: HolisticLandmarker?
  private var onOutput: OutputCallback?
  private var onError: ErrorCallback?

  private var isRunning: Bool = false

  // Backpressure: inference devam ederken yeni frame gelirse drop
  private var inFlight: Bool = false
  private var droppedFrames: Int = 0

  // start/stop yarışlarına karşı session token
  private var sessionId: Int64 = 0
  private var activeProfile: TrackingProfile = .pose
  private var requestedProfile: TrackingProfileRequest = .auto

  // MARK: - Lifecycle

  public override init() { super.init() }

  deinit { stop() }

  // MARK: - API

  public func start(
    config: Config,
    onOutput: @escaping OutputCallback,
    onError: @escaping ErrorCallback
  ) throws {
    try queue.sync {
      self.sessionId &+= 1
      let mySession = self.sessionId

      self.onOutput = onOutput
      self.onError  = onError

      self.poseLandmarker = nil
      self.holisticLandmarker = nil
      self.isRunning = false
      self.inFlight = false
      self.droppedFrames = 0
      self.requestedProfile = config.trackingProfile
      self.activeProfile = try self.resolveProfile(config: config)

      do {
        switch self.activeProfile {
        case .pose:
          try self.startPoseLandmarker(config: config)
        case .holistic:
          try self.startHolisticLandmarker(config: config)
        }

        self.isRunning = true

        if config.debug {
          self.onError?(
            "[PoseRunner] started session=\(mySession) profile=\(self.activeProfile.rawValue) " +
            "request=\(self.requestedProfile.rawValue) delegate=\(config.usesCPU ? "CPU" : "GPU")"
          )
        }
      } catch {
        self.poseLandmarker = nil
        self.holisticLandmarker = nil
        self.isRunning = false
        throw error
      }
    }
  }

  public func update(config: Config) throws {
    let callbacks = try queue.sync {
      guard let out = self.onOutput, let err = self.onError else {
        throw NSError(domain: "PoseLandmarkerRunner", code: 2,
                      userInfo: [NSLocalizedDescriptionKey: "Runner not started. Call start() first."])
      }
      return (out, err)
    }
    try self.start(config: config, onOutput: callbacks.0, onError: callbacks.1)
  }

  public func stop() {
    queue.async { [weak self] in
      guard let self else { return }
      self.sessionId &+= 1
      self.poseLandmarker = nil
      self.holisticLandmarker = nil
      self.onOutput = nil
      self.onError = nil
      self.isRunning = false
      self.inFlight = false
      self.droppedFrames = 0
      self.activeProfile = .pose
      self.requestedProfile = .auto
    }
  }

  /// AVCapture sampleBuffer -> MPImage(CVPixelBuffer) -> detectAsync (liveStream)
  public func process(
    sampleBuffer: CMSampleBuffer,
    videoOrientation: AVCaptureVideoOrientation,
    cameraPosition: AVCaptureDevice.Position,
    isMirrored: Bool
  ) {
    queue.async(execute: { [weak self] in
      guard let self else { return }
      guard self.isRunning else { return }
      let poseLandmarker = self.poseLandmarker
      let holisticLandmarker = self.holisticLandmarker

      if self.inFlight {
        self.droppedFrames += 1
        return
      }

      guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

      let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
      let tsMs64 = Int64(pts.seconds * 1000.0)
      let tsMs = Int(tsMs64) // ✅ 0.10.x detectAsync Int istiyor (senin 205 hatan)

      let uiOrientation = Self.mapOrientation(
        videoOrientation: videoOrientation,
        cameraPosition: cameraPosition,
        isMirrored: isMirrored
      )

      // ✅ 0.10.x: MPImage init + orientation kullanımı (orientation arg’ı bazı sürümlerde yok)
      guard let mpImage = try? MPImage(pixelBuffer: pixelBuffer, orientation: uiOrientation) else {
        self.inFlight = false
        return
      }


      self.inFlight = true
      do {
        switch self.activeProfile {
        case .pose:
          guard let poseLandmarker else {
            self.inFlight = false
            return
          }
          try poseLandmarker.detectAsync(image: mpImage, timestampInMilliseconds: tsMs)
        case .holistic:
          guard let holisticLandmarker else {
            self.inFlight = false
            return
          }
          try holisticLandmarker.detectAsync(image: mpImage, timestampInMilliseconds: tsMs)
        }
      } catch {
        self.inFlight = false
        self.onError?("detectAsync failed: \(error.localizedDescription)")
      }
    })
  }

  // MARK: - Helpers

  private func clamp01(_ v: Float) -> Float { max(0, min(1, v)) }

  private func modelPath(for name: String, ext: String) -> String? {
    Bundle.main.path(forResource: name, ofType: ext)
  }

  private func resolveProfile(config: Config) throws -> TrackingProfile {
    switch config.trackingProfile {
    case .pose:
      guard self.modelPath(for: config.poseModelName, ext: config.modelExt) != nil else {
        throw self.modelMissingError(name: config.poseModelName, ext: config.modelExt)
      }
      return .pose
    case .holistic:
      guard self.modelPath(for: config.holisticModelName, ext: config.modelExt) != nil else {
        throw self.modelMissingError(name: config.holisticModelName, ext: config.modelExt)
      }
      return .holistic
    case .auto:
      if self.modelPath(for: config.holisticModelName, ext: config.modelExt) != nil {
        return .holistic
      }
      guard self.modelPath(for: config.poseModelName, ext: config.modelExt) != nil else {
        throw self.modelMissingError(name: config.poseModelName, ext: config.modelExt)
      }
      return .pose
    }
  }

  private func modelMissingError(name: String, ext: String) -> NSError {
    NSError(
      domain: "PoseLandmarkerRunner",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey:
        "Model not found in bundle: \(name).\(ext). " +
        "Xcode > Target > Build Phases > Copy Bundle Resources icinde oldugunu dogrula."]
    )
  }

  private func baseOptions(modelPath: String, usesCPU: Bool) -> BaseOptions {
    let baseOptions = BaseOptions()
    baseOptions.modelAssetPath = modelPath
    baseOptions.delegate = usesCPU ? .CPU : .GPU
    return baseOptions
  }

  private func startPoseLandmarker(config: Config) throws {
    guard let modelPath = self.modelPath(for: config.poseModelName, ext: config.modelExt) else {
      throw self.modelMissingError(name: config.poseModelName, ext: config.modelExt)
    }

    let options = PoseLandmarkerOptions()
    options.baseOptions = self.baseOptions(modelPath: modelPath, usesCPU: config.usesCPU)
    options.runningMode = .liveStream
    options.numPoses = max(1, config.numPoses)
    options.minPoseDetectionConfidence = clamp01(config.minPoseConfidence)
    options.minPosePresenceConfidence = clamp01(config.minPresenceConfidence)
    options.minTrackingConfidence = clamp01(config.minTrackingConfidence)
    options.poseLandmarkerLiveStreamDelegate = self

    self.poseLandmarker = try PoseLandmarker(options: options)
    self.holisticLandmarker = nil
  }

  private func startHolisticLandmarker(config: Config) throws {
    guard let modelPath = self.modelPath(for: config.holisticModelName, ext: config.modelExt) else {
      throw self.modelMissingError(name: config.holisticModelName, ext: config.modelExt)
    }

    let options = HolisticLandmarkerOptions()
    options.baseOptions = self.baseOptions(modelPath: modelPath, usesCPU: config.usesCPU)
    options.runningMode = .liveStream
    options.minFaceDetectionConfidence = clamp01(config.minFaceConfidence)
    options.minFacePresenceConfidence = clamp01(config.minFaceConfidence)
    options.minPoseDetectionConfidence = clamp01(config.minPoseConfidence)
    options.minPosePresenceConfidence = clamp01(config.minPresenceConfidence)
    options.minHandLandmarksConfidence = clamp01(config.minHandConfidence)
    options.outputFaceBlendshapes = config.outputFaceBlendshapes
    options.outputPoseSegmentationMasks = config.outputPoseSegmentationMasks
    options.holisticLandmarkerLiveStreamDelegate = self

    self.holisticLandmarker = try HolisticLandmarker(options: options)
    self.poseLandmarker = nil
  }

  private func landmarkConfidence(
    visibility: NSNumber?,
    presence: NSNumber?
  ) -> Float {
    if let visibility {
      return Float(truncating: visibility)
    }
    if let presence {
      return Float(truncating: presence)
    }
    return 1.0
  }

  private func encodeNormalizedLandmarks(_ landmarks: [NormalizedLandmark]) -> [[String: Any]] {
    var out: [[String: Any]] = []
    out.reserveCapacity(landmarks.count)

    for (i, lm) in landmarks.enumerated() {
      out.append([
        "id": i,
        "x": lm.x,
        "y": lm.y,
        "z": lm.z,
        "v": self.landmarkConfidence(visibility: lm.visibility, presence: lm.presence),
      ])
    }

    return out
  }

  private func encodeWorldLandmarks(_ landmarks: [Landmark]) -> [[String: Any]] {
    var out: [[String: Any]] = []
    out.reserveCapacity(landmarks.count)

    for (i, lm) in landmarks.enumerated() {
      out.append([
        "id": i,
        "x": lm.x,
        "y": lm.y,
        "z": lm.z,
        "v": self.landmarkConfidence(visibility: lm.visibility, presence: lm.presence),
      ])
    }

    return out
  }

  private func encodeBlendshapes(_ classifications: Classifications?) -> [[String: Any]] {
    guard let classifications else { return [] }

    var out: [[String: Any]] = []
    out.reserveCapacity(classifications.categories.count)

    for category in classifications.categories {
      var item: [String: Any] = [
        "index": category.index,
        "score": category.score,
      ]
      item["name"] = category.categoryName ?? ""
      if let displayName = category.displayName {
        item["displayName"] = displayName
      }
      out.append(item)
    }

    return out
  }

  private func basePayload(timestampMs: Int, profile: TrackingProfile) -> [String: Any] {
    [
      "timestampMs": Int64(timestampMs),
      "trackingProfile": profile.rawValue,
      "requestedTrackingProfile": self.requestedProfile.rawValue,
    ]
  }

  private static func mapOrientation(
    videoOrientation: AVCaptureVideoOrientation,
    cameraPosition: AVCaptureDevice.Position,
    isMirrored: Bool
  ) -> UIImage.Orientation {
    switch videoOrientation {
    case .portrait:
      return isMirrored ? .leftMirrored : .right
    case .portraitUpsideDown:
      return isMirrored ? .rightMirrored : .left
    case .landscapeRight:
      return isMirrored ? .downMirrored : .up
    case .landscapeLeft:
      return isMirrored ? .upMirrored : .down
    @unknown default:
      return isMirrored ? .leftMirrored : .right
    }
  }

  private func emitPose(timestampMs: Int, result: PoseLandmarkerResult?) {
    self.inFlight = false

    guard let onOutput = self.onOutput else { return }
    var payload = self.basePayload(timestampMs: timestampMs, profile: .pose)

    guard let result else {
      payload["landmarks"] = []
      payload["worldLandmarks"] = []
      onOutput(Int64(timestampMs), payload)
      return
    }

    let poseLandmarks = result.landmarks.first.map(self.encodeNormalizedLandmarks) ?? []
    let poseWorldLandmarks = result.worldLandmarks.first.map(self.encodeWorldLandmarks) ?? []

    payload["landmarks"] = poseLandmarks
    payload["worldLandmarks"] = poseWorldLandmarks
    onOutput(Int64(timestampMs), payload)
  }

  private func emitHolistic(timestampMs: Int, result: HolisticLandmarkerResult?) {
    self.inFlight = false

    guard let onOutput = self.onOutput else { return }
    var payload = self.basePayload(timestampMs: timestampMs, profile: .holistic)

    guard let result else {
      payload["landmarks"] = []
      payload["worldLandmarks"] = []
      onOutput(Int64(timestampMs), payload)
      return
    }

    payload["landmarks"] = self.encodeNormalizedLandmarks(result.poseLandmarks)
    payload["worldLandmarks"] = self.encodeWorldLandmarks(result.poseWorldLandmarks)

    let faceLandmarks = self.encodeNormalizedLandmarks(result.faceLandmarks)
    if !faceLandmarks.isEmpty {
      payload["faceLandmarks"] = faceLandmarks
    }

    let leftHandLandmarks = self.encodeNormalizedLandmarks(result.leftHandLandmarks)
    if !leftHandLandmarks.isEmpty {
      payload["leftHandLandmarks"] = leftHandLandmarks
    }

    let leftHandWorldLandmarks = self.encodeWorldLandmarks(result.leftHandWorldLandmarks)
    if !leftHandWorldLandmarks.isEmpty {
      payload["leftHandWorldLandmarks"] = leftHandWorldLandmarks
    }

    let rightHandLandmarks = self.encodeNormalizedLandmarks(result.rightHandLandmarks)
    if !rightHandLandmarks.isEmpty {
      payload["rightHandLandmarks"] = rightHandLandmarks
    }

    let rightHandWorldLandmarks = self.encodeWorldLandmarks(result.rightHandWorldLandmarks)
    if !rightHandWorldLandmarks.isEmpty {
      payload["rightHandWorldLandmarks"] = rightHandWorldLandmarks
    }

    let faceBlendshapes = self.encodeBlendshapes(result.faceBlendshapes)
    if !faceBlendshapes.isEmpty {
      payload["faceBlendshapes"] = faceBlendshapes
    }

    payload["hasPoseSegmentationMask"] = (result.poseSegmentationMask != nil)
    onOutput(Int64(timestampMs), payload)
  }

  private func emitError(_ msg: String) {
    self.inFlight = false
    self.onError?(msg)
  }
}

// MARK: - LiveStream Delegate
extension PoseLandmarkerRunner: PoseLandmarkerLiveStreamDelegate {

  // ✅ 0.10.x delegate imzası timestamp Int (senin 255 hatan buradan)
  public func poseLandmarker(
    _ poseLandmarker: PoseLandmarker,
    didFinishDetection result: PoseLandmarkerResult?,
    timestampInMilliseconds: Int,
    error: Error?
  ) {
    queue.async(execute: { [weak self] in
      guard let self else { return }

      if let error {
        self.emitError("PoseLandmarker error: \(error.localizedDescription)")
        return
      }

      self.emitPose(timestampMs: timestampInMilliseconds, result: result)
    })
  }
}

// MARK: - Holistic Delegate
extension PoseLandmarkerRunner: HolisticLandmarkerLiveStreamDelegate {
  public func holisticLandmarker(
    _ holisticLandmarker: HolisticLandmarker,
    didFinishDetection result: HolisticLandmarkerResult?,
    timestampInMilliseconds: Int,
    error: Error?
  ) {
    queue.async(execute: { [weak self] in
      guard let self else { return }

      if let error {
        self.emitError("HolisticLandmarker error: \(error.localizedDescription)")
        return
      }

      self.emitHolistic(timestampMs: timestampInMilliseconds, result: result)
    })
  }
}
