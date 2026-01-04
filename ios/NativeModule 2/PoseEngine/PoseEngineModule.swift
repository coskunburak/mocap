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

  // MARK: - Public API

  @objc
  func ping(_ resolve: RCTPromiseResolveBlock,
            rejecter reject: RCTPromiseRejectBlock) {
    resolve(["ok": true, "version": "poseengine-ios-4.1-prod"])
  }

  @objc
func start(_ options: NSDictionary,
           resolver resolve: @escaping RCTPromiseResolveBlock,
           rejecter reject: @escaping RCTPromiseRejectBlock) {

  queue.async { [weak self] in
    guard let self else { return }

    // Idempotent
    if self.state == .running || self.state == .starting {
      resolve(nil)
      return
    }

    self.state = .starting
    self.sessionId &+= 1
    let mySession = self.sessionId

    self.inputFrameCounter = 0
    self.sendStatusLocked("starting")

    // ---- options ----
    // Not: FULL kullanıyoruz. model sadece debug/status için okunuyor.
    let requestedModel = (options["model"] as? String) ?? "full"

    let minConfidence = (options["minConfidence"] as? NSNumber)?.doubleValue ?? 0.5
    let minPoseConfidence = (options["minPoseConfidence"] as? NSNumber)?.doubleValue ?? minConfidence

    let targetFps = max(1, (options["targetFps"] as? NSNumber)?.intValue ?? 30)
    let emitEveryNthFrame = max(1, (options["emitEveryNthFrame"] as? NSNumber)?.intValue ?? 1)
    let debug = (options["debug"] as? Bool) ?? false

    self.lastEmitEveryNthFrame = emitEveryNthFrame
    self.lastTargetFps = targetFps

    func in01(_ v: Double) -> Bool { v >= 0.0 && v <= 1.0 }
    guard in01(minConfidence), in01(minPoseConfidence) else {
      self.state = .error
      self.sendStatusLocked("error_invalid_options")
      reject(EngineError.optionsInvalid.rawValue,
             "Confidence values must be between 0 and 1",
             nil)
      return
    }

    // init singletons
    if self.camera == nil { self.camera = PoseCameraSession() }
    if self.runner == nil { self.runner = PoseLandmarkerRunner() }

    // ✅ FULL MODELE KİLİTLİ
    let runnerCfg = PoseLandmarkerRunner.Config(
      modelName: "pose_landmarker_full",
      modelExt: "task",
      minPoseConfidence: Float(minPoseConfidence),
      minTrackingConfidence: Float(minConfidence),
      minPresenceConfidence: Float(minConfidence),
      numPoses: 1,
      usesCPU: true,
      debug: debug
    )

    // Permission (MAIN)
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
                  onOutput: { [weak self] tsMs, lms in
                    guard let self else { return }
                    self.queue.async {
                      guard self.sessionId == mySession else { return }
                      guard self.state == .running else { return }
                      guard self.hasListeners else { return }

                      self.sendEvent(withName: Events.frame, body: [
                        "timestampMs": tsMs,
                        "landmarks": lms
                      ])
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
                // runner failed -> stop camera
                await self.camera?.stop()
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
                  "model": "full",                 // ✅ gerçek kullanılan
                  "requestedModel": requestedModel, // ✅ debug
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
        await self.camera?.stop()
        self.runner?.stop()

        self.queue.async {
          guard self.sessionId == mySession else { return }
          self.state = .idle
          self.sendStatusLocked("idle")
          resolve(nil)
        }
      }
    }
  }

  // MARK: - Permission

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

  // MARK: - Event helpers (queue only)

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
