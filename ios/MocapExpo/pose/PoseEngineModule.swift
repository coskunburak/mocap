import AVFoundation
import Foundation
import React

@objc(PoseEngineModule)
final class PoseEngineModule: RCTEventEmitter {
    private enum EngineState: String {
        case idle
        case starting
        case running
        case stopping
        case error
    }

    private enum ErrorCode {
        static let cameraPermission = "E_CAMERA_PERMISSION"
        static let start = "E_START"
        static let stop = "E_STOP"
        static let options = "E_OPTIONS"
        static let recording = "E_VIDEO_RECORDING"
    }

    private static let eventStatus = "PoseEngineStatus"

    private let moduleQueue = DispatchQueue(label: "com.mocapexpo.camera.module")
    private let stateLock = NSLock()

    private var engineState = EngineState.idle
    private var hasListeners = false
    private var previewActive = false
    private var lastTargetFps = 30

    override static func requiresMainQueueSetup() -> Bool {
        false
    }

    override func supportedEvents() -> [String]! {
        [Self.eventStatus]
    }

    override func startObserving() {
        stateLock.lock()
        hasListeners = true
        stateLock.unlock()
        sendStatus("listener_on")
    }

    override func stopObserving() {
        stateLock.lock()
        hasListeners = false
        stateLock.unlock()
    }

    @objc
    func ping(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve([
            "ok": true,
            "version": "camera-ios-wham-upload-v1",
            "pipeline": "wham_video_upload"
        ])
    }

    @objc
    func setPreviewActive(
        _ active: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        moduleQueue.async {
            self.previewActive = active

            if !active {
                PoseCameraSession.shared.stop {
                    self.setEngineState(.idle)
                    self.sendStatus("idle")
                    resolve(nil)
                }
                return
            }

            guard self.hasCameraPermission() else {
                self.setEngineState(.error)
                self.sendStatus("error_camera_permission_denied")
                reject(ErrorCode.cameraPermission, "Camera permission denied", nil)
                return
            }

            self.setEngineState(.starting)
            self.sendStatus("starting")
            PoseCameraSession.shared.start(
                fps: self.lastTargetFps,
                onFrame: nil,
                onError: { [weak self] message in
                    self?.sendStatus("camera_error", extra: ["message": message])
                }
            ) { error in
                if let error {
                    self.setEngineState(.error)
                    self.sendStatus("error_start_failed", extra: ["message": error.localizedDescription])
                    reject(
                        ErrorCode.start,
                        "Preview start failed: \(error.localizedDescription)",
                        error
                    )
                } else {
                    self.setEngineState(.running)
                    self.sendStatus("running", extra: ["pipeline": "wham_video_upload"])
                    resolve(nil)
                }
            }
        }
    }

    @objc
    func start(
        _ options: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        moduleQueue.async {
            self.lastTargetFps = max(1, options.intValue("targetFps") ?? self.lastTargetFps)
            self.setPreviewActive(true, resolver: resolve, rejecter: reject)
        }
    }

    @objc
    func stop(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        moduleQueue.async {
            self.setEngineState(.stopping)
            self.sendStatus("stopping")
            PoseCameraSession.shared.stop {
                self.setEngineState(.idle)
                self.sendStatus("idle")
                resolve(nil)
            }
        }
    }

    @objc
    func startVideoRecording(
        _ options: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        moduleQueue.async {
            guard let takeId = options.stringValue("takeId"), !takeId.isEmpty else {
                reject(ErrorCode.options, "takeId is required", nil)
                return
            }

            let fps = max(1, options.intValue("fps") ?? self.lastTargetFps)
            let orientation = options.stringValue("orientation") ?? "portrait"
            self.lastTargetFps = fps

            let startRecording = {
                PoseCameraSession.shared.startRecording(
                    takeId: takeId,
                    fps: fps,
                    orientation: orientation
                ) { [weak self] error in
                    guard let self else { return }
                    if let error {
                        self.sendStatus(
                            "video_recording_error",
                            extra: ["message": error.localizedDescription]
                        )
                        reject(
                            ErrorCode.recording,
                            "Video recording failed to start: \(error.localizedDescription)",
                            error
                        )
                        return
                    }

                    self.sendStatus("video_recording_started")
                    resolve(nil)
                }
            }

            PoseCameraSession.shared.start(
                fps: fps,
                onFrame: nil,
                onError: { [weak self] message in
                    self?.sendStatus("camera_error", extra: ["message": message])
                }
            ) { error in
                if let error {
                    self.sendStatus("video_recording_error", extra: ["message": error.localizedDescription])
                    reject(
                        ErrorCode.recording,
                        "Camera failed to start before recording: \(error.localizedDescription)",
                        error
                    )
                    return
                }
                self.setEngineState(.running)
                startRecording()
            }
        }
    }

    @objc
    func stopVideoRecording(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        moduleQueue.async {
            PoseCameraSession.shared.stopRecording { [weak self] result, error in
                guard let self else { return }
                if let error {
                    self.sendStatus(
                        "video_recording_error",
                        extra: ["message": error.localizedDescription]
                    )
                    reject(
                        ErrorCode.recording,
                        "Video recording failed to stop: \(error.localizedDescription)",
                        error
                    )
                    return
                }

                guard let result else {
                    reject(ErrorCode.recording, "Video recording returned no result", nil)
                    return
                }

                self.sendStatus("video_recording_stopped")
                resolve(result.asDictionary())
            }
        }
    }

    override func invalidate() {
        PoseCameraSession.shared.stop {}
        super.invalidate()
    }

    private func setEngineState(_ state: EngineState) {
        stateLock.lock()
        engineState = state
        stateLock.unlock()
    }

    private func hasCameraPermission() -> Bool {
        AVCaptureDevice.authorizationStatus(for: .video) == .authorized
    }

    private func sendStatus(_ status: String, extra: [String: Any?] = [:]) {
        stateLock.lock()
        let shouldEmit = hasListeners
        let stateValue = engineState.rawValue
        stateLock.unlock()

        guard shouldEmit else { return }

        var payload: [String: Any] = [
            "status": status,
            "engineState": stateValue
        ]

        for (key, value) in extra {
            if let value {
                payload[key] = value
            }
        }

        DispatchQueue.main.async { [weak self] in
            self?.sendEvent(withName: Self.eventStatus, body: payload)
        }
    }
}

private extension NSDictionary {
    func stringValue(_ key: String) -> String? {
        guard let value = self[key], !(value is NSNull) else { return nil }
        return value as? String
    }

    func intValue(_ key: String) -> Int? {
        guard let value = self[key], !(value is NSNull) else { return nil }
        return (value as? NSNumber)?.intValue
    }
}
