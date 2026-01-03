import Foundation
import React

@objc(PoseEngineModule)
final class PoseEngineModule: RCTEventEmitter {

  // MARK: - Constants
  private enum Events {
    static let frame = "PoseEngineFrame"
    static let status = "PoseEngineStatus"
  }

  private enum EngineState: String {
    case idle, starting, running, stopping, error
  }

  // MARK: - State
  private var hasListeners = false
  private var state: EngineState = .idle
  private var timer: DispatchSourceTimer?
  private let queue = DispatchQueue(label: "pose.engine.queue", qos: .userInitiated)

  override static func requiresMainQueueSetup() -> Bool {
    // Module init often safe off-main; but if you touch UIKit/AVCapture, keep true.
    // For Sprint1 (no camera usage here), false is ok.
    return false
  }

  override func supportedEvents() -> [String]! {
    [Events.frame, Events.status]
  }

  override func startObserving() {
    hasListeners = true
    sendStatus("listener_on")
  }

  override func stopObserving() {
    hasListeners = false
    // keep running or stop? In production you'd probably keep running only if app needs it.
    sendStatus("listener_off")
  }

  // MARK: - Public API (Promises)

  @objc
  func ping(_ resolve: RCTPromiseResolveBlock,
            rejecter reject: RCTPromiseRejectBlock) {
    resolve([
      "ok": true,
      "version": "poseengine-ios-1.0"
    ])
  }

  @objc
  func start(_ options: NSDictionary,
             resolver resolve: @escaping RCTPromiseResolveBlock,
             rejecter reject: @escaping RCTPromiseRejectBlock) {

    queue.async { [weak self] in
      guard let self else { return }

      // Idempotent start
      if self.state == .running || self.state == .starting {
        resolve(nil)
        return
      }

      self.state = .starting
      self.sendStatus("starting")

      // Validate options (production hygiene)
      let minConfidence = (options["minConfidence"] as? NSNumber)?.doubleValue ?? 0.5
      let model = (options["model"] as? String) ?? "lite"
      if minConfidence < 0.0 || minConfidence > 1.0 {
        self.state = .error
        self.sendStatus("error_invalid_options")
        reject("E_OPTIONS", "minConfidence must be between 0 and 1", nil)
        return
      }

      // Sprint 1: mock pose frames (to verify overlay + fps end-to-end)
      self.startMockFrames(model: model, minConfidence: minConfidence)

      self.state = .running
      self.sendStatus("running")
      resolve(nil)
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
      self.sendStatus("stopping")

      self.stopTimer()

      self.state = .idle
      self.sendStatus("idle")
      resolve(nil)
    }
  }

  // MARK: - Internals

  private func sendStatus(_ status: String, extra: [String: Any] = [:]) {
    guard hasListeners else { return }
    var payload: [String: Any] = ["status": status, "engineState": state.rawValue]
    extra.forEach { payload[$0.key] = $0.value }
    sendEvent(withName: Events.status, body: payload)
  }

  private func startMockFrames(model: String, minConfidence: Double) {
    stopTimer()

    // 30 FPS mock stream
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now(), repeating: .milliseconds(33))

    var t: Double = 0
    timer.setEventHandler { [weak self] in
      guard let self else { return }
      t += 0.033

      // A simple "stick figure" 2D landmark set (normalized 0..1)
      // You will later replace this with real MediaPipe landmarks.
      let ts = Int(Date().timeIntervalSince1970 * 1000)

      // Example: 33 landmarks (MediaPipe Pose count). Here we generate a few meaningful points and fill rest.
      var landmarks: [[String: Any]] = []

      // Head
      let headX = 0.5 + 0.02 * sin(t)
      let headY = 0.20 + 0.01 * cos(t)
      landmarks.append(["id": 0, "x": headX, "y": headY, "v": 0.95])

      // Left shoulder
      landmarks.append(["id": 11, "x": 0.45, "y": 0.30, "v": 0.90])
      // Right shoulder
      landmarks.append(["id": 12, "x": 0.55, "y": 0.30, "v": 0.90])
      // Left hip
      landmarks.append(["id": 23, "x": 0.47, "y": 0.55, "v": 0.88])
      // Right hip
      landmarks.append(["id": 24, "x": 0.53, "y": 0.55, "v": 0.88])

      // Fill missing ids up to 33 so JS overlay logic can assume a stable set
      // In production, you'll send the full array from the pose landmarker.
      let importantIds = Set([0, 11, 12, 23, 24])
      for id in 0..<33 where !importantIds.contains(id) {
        landmarks.append(["id": id, "x": 0.5, "y": 0.5, "v": minConfidence])
      }

      let payload: [String: Any] = [
        "timestampMs": ts,
        "landmarks": landmarks
      ]

      if self.hasListeners {
        self.sendEvent(withName: Events.frame, body: payload)
      }
    }

    self.timer = timer
    timer.resume()
    sendStatus("mock_stream_on", extra: ["model": model, "minConfidence": minConfidence])
  }

  private func stopTimer() {
    if let timer {
      timer.setEventHandler {}
      timer.cancel()
      self.timer = nil
    }
  }

  deinit {
    stopTimer()
  }
}
