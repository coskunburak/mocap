import Foundation
import UIKit
import AVFoundation
import MediaPipeTasksVision

// JS'e döneceğimiz sade landmark (Dictionary'e çevireceğiz)
public struct PoseLM {
  public let id: Int
  public let x: Float
  public let y: Float
  public let z: Float
  public let v: Float  // visibility / confidence
}

public final class PoseLandmarkerRunner: NSObject {

  // MARK: - Config

  public struct Config {
    public let modelName: String            // e.g. "pose_landmarker_full"
    public let modelExt: String             // "task"
    public let minPoseConfidence: Float     // 0..1
    public let minTrackingConfidence: Float // 0..1
    public let minPresenceConfidence: Float // 0..1
    public let numPoses: Int                // usually 1
    public let usesCPU: Bool                // true = daha stabil başlangıç
    public let debug: Bool

    public init(
      modelName: String = "pose_landmarker_full",
      modelExt: String = "task",
      minPoseConfidence: Float = 0.5,
      minTrackingConfidence: Float = 0.5,
      minPresenceConfidence: Float = 0.5,
      numPoses: Int = 1,
      usesCPU: Bool = true,
      debug: Bool = false
    ) {
      self.modelName = modelName
      self.modelExt = modelExt
      self.minPoseConfidence = minPoseConfidence
      self.minTrackingConfidence = minTrackingConfidence
      self.minPresenceConfidence = minPresenceConfidence
      self.numPoses = numPoses
      self.usesCPU = usesCPU
      self.debug = debug
    }
  }

  public typealias OutputCallback = (_ timestampMs: Int64, _ landmarks: [[String: Any]]) -> Void
  public typealias ErrorCallback  = (_ message: String) -> Void

  // MARK: - Private State

  private let queue = DispatchQueue(label: "pose.landmarker.runner.queue", qos: .userInitiated)

  private var landmarker: PoseLandmarker?
  private var onOutput: OutputCallback?
  private var onError: ErrorCallback?

  private var isRunning: Bool = false

  // Backpressure: inference devam ederken yeni frame gelirse drop
  private var inFlight: Bool = false
  private var droppedFrames: Int = 0

  // start/stop yarışlarına karşı session token
  private var sessionId: Int64 = 0

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

      self.landmarker = nil
      self.isRunning = false
      self.inFlight = false
      self.droppedFrames = 0

      guard let modelPath = Bundle.main.path(forResource: config.modelName, ofType: config.modelExt) else {
        throw NSError(
          domain: "PoseLandmarkerRunner",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey:
                      "Model not found in bundle: \(config.modelName).\(config.modelExt). " +
                      "Xcode > Target > Build Phases > Copy Bundle Resources içine ekli mi?"]
        )
      }

      // ✅ 0.10.x: BaseOptions init arg almıyor (senin 115. satır hatan bunun yüzünden)
      let baseOptions = BaseOptions()
      baseOptions.modelAssetPath = modelPath
      baseOptions.delegate = config.usesCPU ? .CPU : .GPU

      let options = PoseLandmarkerOptions()
      options.baseOptions = baseOptions
      options.runningMode = .liveStream
      options.numPoses = max(1, config.numPoses)
      options.minPoseDetectionConfidence = clamp01(config.minPoseConfidence)
      options.minPosePresenceConfidence  = clamp01(config.minPresenceConfidence)
      options.minTrackingConfidence      = clamp01(config.minTrackingConfidence)

      // ✅ delegate set
      options.poseLandmarkerLiveStreamDelegate = self

      do {
        self.landmarker = try PoseLandmarker(options: options)
        self.isRunning = true

        if config.debug {
          self.onError?("[PoseRunner] started session=\(mySession) model=\(config.modelName).\(config.modelExt) delegate=\(config.usesCPU ? "CPU" : "GPU")")
        }
      } catch {
        self.landmarker = nil
        self.isRunning = false
        throw error
      }
    }
  }

  public func update(config: Config) throws {
    try queue.sync {
      guard let out = self.onOutput, let err = self.onError else {
        throw NSError(domain: "PoseLandmarkerRunner", code: 2,
                      userInfo: [NSLocalizedDescriptionKey: "Runner not started. Call start() first."])
      }
      try self.start(config: config, onOutput: out, onError: err)
    }
  }

  public func stop() {
    queue.async { [weak self] in
      guard let self else { return }
      self.sessionId &+= 1
      self.landmarker = nil
      self.onOutput = nil
      self.onError = nil
      self.isRunning = false
      self.inFlight = false
      self.droppedFrames = 0
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
      guard self.isRunning, let landmarker = self.landmarker else { return }

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
        try landmarker.detectAsync(image: mpImage, timestampInMilliseconds: tsMs)
      } catch {
        self.inFlight = false
        self.onError?("detectAsync failed: \(error.localizedDescription)")
      }
    })
  }

  // MARK: - Helpers

  private func clamp01(_ v: Float) -> Float { max(0, min(1, v)) }

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

  private func emit(timestampMs: Int, result: PoseLandmarkerResult?) {
    // inFlight bitti
    self.inFlight = false

    guard let onOutput = self.onOutput else { return }

    guard let result, let firstPose = result.landmarks.first else {
      onOutput(Int64(timestampMs), [])
      return
    }


    var out: [[String: Any]] = []
    out.reserveCapacity(firstPose.count)

    for (i, lm) in firstPose.enumerated() {
      let v = Float(lm.visibility ?? 1.0)
      out.append([
        "id": i,
        "x": lm.x,
        "y": lm.y,
        "z": lm.z,
        "v": v
      ])
    }

    onOutput(Int64(timestampMs), out)
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

      self.emit(timestampMs: timestampInMilliseconds, result: result)
    })
  }
}
