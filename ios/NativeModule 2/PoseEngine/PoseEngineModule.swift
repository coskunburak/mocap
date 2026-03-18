import Foundation
import React
import AVFoundation

@objc(PoseEngineModule)
final class PoseEngineModule: RCTEventEmitter {

  // MARK: - Constants
  private enum Events {
    static let frame  = "PoseEngineFrame"
    static let status = "PoseEngineStatus"
  }

  private enum EngineState: String {
    case idle, starting, running, stopping, error
  }

  private enum EngineError: String {
    case cameraPermissionDenied = "E_CAMERA_PERMISSION"
    case startFailed            = "E_START"
    case stopFailed             = "E_STOP"
    case optionsInvalid         = "E_OPTIONS"
    case internalError          = "E_INTERNAL"
  }

  // MARK: - Concurrency / State
  private let queue = DispatchQueue(label: "pose.engine.queue", qos: .userInitiated)
  private let inferenceQueue = DispatchQueue(label: "pose.engine.inference.queue", qos: .userInitiated)

  private var hasListeners = false
  private var state: EngineState = .idle

  /// start/stop yarışlarını kesmek için
  private var sessionId: Int64 = 0

  /// camera frame gating için
  private var inputFrameCounter: Int = 0

  /// Native bileşenler
  private var camera: PoseCameraSession?
  private var runner: PoseLandmarkerRunner?
  private var previewActive = false

  /// Son start options (debug)
  private var lastEmitEveryNthFrame: Int = 1
  private var lastTargetFps: Int = 30

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    [Events.frame, Events.status]
  }

  override func startObserving() {
    queue.async { [weak self] in
      guard let self else { return }
      self.hasListeners = true
      self.sendStatusLocked("listener_on")
    }
  }

  override func stopObserving() {
    queue.async { [weak self] in
      guard let self else { return }
      self.hasListeners = false
      self.sendStatusLocked("listener_off")
    }
  }

  @objc
  func ping(_ resolve: RCTPromiseResolveBlock,
            rejecter reject: RCTPromiseRejectBlock) {
    resolve([
      "ok": true,
      "version": "poseengine-ios-5.1",
      "poseModel": self.resolvePoseModelName(requestedModel: "full"),
      "holisticAvailable": self.bundledModelExists(name: "holistic_landmarker"),
    ])
  }

  @objc
  func setPreviewActive(_ active: Bool,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    queue.async { [weak self] in
      guard let self else { return }

      self.previewActive = active
      if self.camera == nil { self.camera = PoseCameraSession.shared }

      guard let camera = self.camera else {
        resolve(nil)
        return
      }

      if !active {
        if self.state == .idle || self.state == .error {
          Task {
            await camera.stop()
            resolve(nil)
          }
        } else {
          resolve(nil)
        }
        return
      }

      if self.state != .idle && self.state != .error {
        resolve(nil)
        return
      }

      Task {
        do {
          try await camera.start(
            config: .init(position: .back, fps: self.lastTargetFps, preset: .high),
            onFrame: { _ in },
            onError: { _ in }
          )
          resolve(nil)
        } catch {
          reject(
            EngineError.startFailed.rawValue,
            "Preview start failed: \(error.localizedDescription)",
            error
          )
        }
      }
    }
  }

  @objc
  func start(_ options: NSDictionary,
             resolver resolve: @escaping RCTPromiseResolveBlock,
             rejecter reject: @escaping RCTPromiseRejectBlock) {

    queue.async { [weak self] in
      guard let self else { return }

      if self.state == .running || self.state == .starting {
        resolve(nil)
        return
      }

      self.state = .starting
      self.sessionId &+= 1
      let mySession = self.sessionId

      self.inputFrameCounter = 0

      let requestedModel = (options["model"] as? String) ?? "full"
      let poseModelName = self.resolvePoseModelName(requestedModel: requestedModel)
      let trackingProfileRaw = (options["trackingProfile"] as? String) ?? "auto"
      let trackingProfile =
        PoseLandmarkerRunner.TrackingProfileRequest(rawValue: trackingProfileRaw) ?? .auto

      let minConfidence = (options["minConfidence"] as? NSNumber)?.doubleValue ?? 0.5
      let minPoseConfidence = (options["minPoseConfidence"] as? NSNumber)?.doubleValue ?? minConfidence
      let minFaceConfidence = (options["minFaceConfidence"] as? NSNumber)?.doubleValue ?? minConfidence
      let minHandConfidence = (options["minHandConfidence"] as? NSNumber)?.doubleValue ?? minConfidence
      let outputFaceBlendshapes = (options["outputFaceBlendshapes"] as? Bool) ?? true
      let outputPoseSegmentationMask = (options["outputPoseSegmentationMask"] as? Bool) ?? false

      let targetFps = max(1, (options["targetFps"] as? NSNumber)?.intValue ?? 30)
      let emitEveryNthFrame = max(1, (options["emitEveryNthFrame"] as? NSNumber)?.intValue ?? 1)
      let debug = (options["debug"] as? Bool) ?? false

      self.lastEmitEveryNthFrame = emitEveryNthFrame
      self.lastTargetFps = targetFps

      func in01(_ v: Double) -> Bool { v >= 0.0 && v <= 1.0 }
      guard
        in01(minConfidence),
        in01(minPoseConfidence),
        in01(minFaceConfidence),
        in01(minHandConfidence)
      else {
        self.state = .error
        self.sendStatusLocked("error_invalid_options")
        reject(EngineError.optionsInvalid.rawValue,
               "Confidence values must be between 0 and 1",
               nil)
        return
      }

      if self.camera == nil { self.camera = PoseCameraSession.shared }
      if self.runner == nil { self.runner = PoseLandmarkerRunner() }

      let runnerCfg = PoseLandmarkerRunner.Config(
        poseModelName: poseModelName,
        holisticModelName: "holistic_landmarker",
        modelExt: "task",
        trackingProfile: trackingProfile,
        minPoseConfidence: Float(minPoseConfidence),
        minTrackingConfidence: Float(minConfidence),
        minPresenceConfidence: Float(minConfidence),
        minFaceConfidence: Float(minFaceConfidence),
        minHandConfidence: Float(minHandConfidence),
        outputFaceBlendshapes: outputFaceBlendshapes,
        outputPoseSegmentationMasks: outputPoseSegmentationMask,
        numPoses: 1,
        usesCPU: true,
        debug: debug
      )
      self.sendStatusLocked("starting", extra: [
        "requestedModel": requestedModel,
        "model": poseModelName,
        "requestedTrackingProfile": trackingProfileRaw,
        "targetFps": targetFps,
        "emitEveryNthFrame": emitEveryNthFrame,
      ])

      DispatchQueue.main.async { [weak self] in
        guard let self else { return }

        self.ensureCameraPermission { granted in
          self.queue.async { [weak self] in
            guard let self else { return }
            guard self.sessionId == mySession else { return } // stale start

            if !granted {
              self.state = .error
              self.sendStatusLocked("error_camera_permission_denied")
              reject(EngineError.cameraPermissionDenied.rawValue,
                     "Camera permission denied",
                     nil)
              return
            }

            Task { [weak self] in
              guard let self else { return }

              do {
                // 1) Start camera
                try await self.camera?.start(
                  config: .init(position: .back, fps: targetFps, preset: .high),
                  onFrame: { [weak self] frame in
                    guard let self else { return }

                    // heavy work off engine queue
                    self.inferenceQueue.async { [weak self] in
                      guard let self else { return }

                      let shouldProcess: Bool = self.queue.sync {
                        guard self.sessionId == mySession else { return false }
                        guard self.state == .running else { return false }

                        self.inputFrameCounter += 1
                        if (self.inputFrameCounter % emitEveryNthFrame) != 0 { return false }
                        return true
                      }
                      guard shouldProcess else { return }

                      self.runner?.process(
                        sampleBuffer: frame.sampleBuffer,
                        videoOrientation: frame.videoOrientation,
                        cameraPosition: frame.cameraPosition,
                        isMirrored: frame.isMirrored
                      )
                    }
                  },
                  onError: { [weak self] msg in
                    guard let self else { return }
                    self.queue.async {
                      guard self.sessionId == mySession else { return }
                      self.sendStatusLocked("camera_error", extra: ["message": msg])
                    }
                  }
                )

                // 2) Start runner
                do {
                  try self.runner?.start(
                    config: runnerCfg,
                    onOutput: { [weak self] _, payload in
                      guard let self else { return }
                      self.queue.async {
                        guard self.sessionId == mySession else { return }
                        guard self.state == .running else { return }
                        guard self.hasListeners else { return }

                        self.sendEvent(withName: Events.frame, body: payload)
                      }
                    },
                    onError: { [weak self] msg in
                      guard let self else { return }
                      self.queue.async {
                        guard self.sessionId == mySession else { return }
                        self.sendStatusLocked("runner_error", extra: ["message": msg])
                      }
                    }
                  )
                } catch {
                  if self.previewActive {
                    self.camera?.setCallbacks(onFrame: nil, onError: nil)
                  } else {
                    await self.camera?.stop()
                  }
                  self.queue.async {
                    guard self.sessionId == mySession else { return }
                    self.state = .error
                    self.sendStatusLocked("error_runner_start", extra: ["message": "\(error)"])
                    reject(EngineError.startFailed.rawValue,
                           "Runner start failed: \(error)",
                           error)
                  }
                  return
                }

                // 3) Mark running (camera + runner up)
                self.queue.async {
                  guard self.sessionId == mySession else { return }
                  self.state = .running
                  self.sendStatusLocked("running", extra: [
                    "model": poseModelName,
                    "requestedModel": requestedModel,
                    "requestedTrackingProfile": trackingProfileRaw,
                    "targetFps": targetFps,
                    "emitEveryNthFrame": emitEveryNthFrame
                  ])
                  resolve(nil)
                }

              } catch {
                self.queue.async {
                  guard self.sessionId == mySession else { return }
                  self.state = .error
                  self.sendStatusLocked("error_start_failed", extra: ["message": "\(error)"])
                  reject(EngineError.startFailed.rawValue,
                         "Camera start failed: \(error)",
                         error)
                }
              }
            }
          }
        }
      }
    }
  }

  @objc
  func stop(_ resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock) {

    queue.async { [weak self] in
      guard let self else { return }

      if self.state == .idle || self.state == .stopping {
        resolve(nil)
        return
      }

      self.state = .stopping
      self.sessionId &+= 1
      let mySession = self.sessionId

      self.sendStatusLocked("stopping")

      Task {
        self.runner?.stop()

        if self.previewActive {
          self.camera?.setCallbacks(onFrame: nil, onError: nil)
        } else {
          await self.camera?.stop()
        }

        self.queue.async {
          guard self.sessionId == mySession else { return }
          self.state = .idle
          self.sendStatusLocked("idle")
          resolve(nil)
        }
      }
    }
  }

  private func ensureCameraPermission(_ cb: @escaping (Bool) -> Void) {
    let status = AVCaptureDevice.authorizationStatus(for: .video)
    switch status {
    case .authorized:
      cb(true)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async { cb(granted) }
      }
    case .denied, .restricted:
      cb(false)
    @unknown default:
      cb(false)
    }
  }

  private func bundledModelExists(name: String, ext: String = "task") -> Bool {
    Bundle.main.path(forResource: name, ofType: ext) != nil
  }

  private func resolvePoseModelName(requestedModel: String) -> String {
    let preferred = requestedModel == "lite" ? "pose_landmarker_lite" : "pose_landmarker_full"
    if self.bundledModelExists(name: preferred) {
      return preferred
    }

    let fallback = requestedModel == "lite" ? "pose_landmarker_full" : "pose_landmarker_lite"
    if self.bundledModelExists(name: fallback) {
      return fallback
    }

    return preferred
  }

  private func sendStatusLocked(_ status: String, extra: [String: Any] = [:]) {
    guard hasListeners else { return }
    var payload: [String: Any] = ["status": status, "engineState": state.rawValue]
    extra.forEach { payload[$0.key] = $0.value }
    sendEvent(withName: Events.status, body: payload)
  }

  deinit {
    Task { [camera] in
      await camera?.stop()
    }
  }
}
