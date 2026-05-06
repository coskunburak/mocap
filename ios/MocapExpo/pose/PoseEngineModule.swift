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

    private static let eventFrame = "PoseEngineFrame"
    private static let eventStatus = "PoseEngineStatus"

    private let moduleQueue = DispatchQueue(label: "com.mocapexpo.pose.module")
    private let inferenceQueue = DispatchQueue(label: "com.mocapexpo.pose.inference")
    private let stateLock = NSLock()
    private let runner = PoseLandmarkerRunner()

    private var engineState = EngineState.idle
    private var hasListeners = false
    private var previewActive = false
    private var sessionId = 0
    private var inputFrameCounter = 0
    private var lastEmitEveryNthFrame = 1
    private var lastTargetFps = 30

    override static func requiresMainQueueSetup() -> Bool {
        false
    }

    override func supportedEvents() -> [String]! {
        [Self.eventFrame, Self.eventStatus]
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
        let poseModelName = resolvePoseModelName(requestedModel: "full")
        resolve([
            "ok": true,
            "version": "poseengine-ios-swift-5.1",
            "poseModel": poseModelName,
            "holisticAvailable": PoseLandmarkerRunner.bundledModelExists("holistic_landmarker")
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
            let currentState = self.currentEngineState()

            if !active {
                if currentState == .idle || currentState == .error {
                    PoseCameraSession.shared.stop {
                        resolve(nil)
                    }
                } else {
                    resolve(nil)
                }
                return
            }

            if currentState != .idle && currentState != .error {
                resolve(nil)
                return
            }

            guard self.hasCameraPermission() else {
                reject(ErrorCode.cameraPermission, "Camera permission denied", nil)
                return
            }

            PoseCameraSession.shared.start(
                fps: self.lastTargetFps,
                onFrame: nil,
                onError: { [weak self] message in
                    self?.sendStatus("camera_error", extra: ["message": message])
                }
            ) { error in
                if let error {
                    reject(
                        ErrorCode.start,
                        "Preview start failed: \(error.localizedDescription)",
                        error
                    )
                } else {
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
            let currentState = self.currentEngineState()
            if currentState == .running || currentState == .starting {
                resolve(nil)
                return
            }

            guard self.hasCameraPermission() else {
                self.setEngineState(.error)
                self.sendStatus("error_camera_permission_denied")
                reject(ErrorCode.cameraPermission, "Camera permission denied", nil)
                return
            }

            let requestedModel = options.stringValue("model") ?? "full"
            let poseModelName = self.resolvePoseModelName(requestedModel: requestedModel)
            let trackingProfile = options.stringValue("trackingProfile") ?? "auto"

            let minConfidence = options.doubleValue("minConfidence") ?? 0.5
            let minPoseConfidence = options.doubleValue("minPoseConfidence") ?? minConfidence
            let minFaceConfidence = options.doubleValue("minFaceConfidence") ?? minConfidence
            let minHandConfidence = options.doubleValue("minHandConfidence") ?? minConfidence

            guard
                self.inZeroToOne(minConfidence),
                self.inZeroToOne(minPoseConfidence),
                self.inZeroToOne(minFaceConfidence),
                self.inZeroToOne(minHandConfidence)
            else {
                self.setEngineState(.error)
                self.sendStatus("error_invalid_options")
                reject(ErrorCode.options, "Confidence values must be between 0 and 1", nil)
                return
            }

            let targetFps = max(1, options.intValue("targetFps") ?? 30)
            let emitEveryNthFrame = max(1, options.intValue("emitEveryNthFrame") ?? 1)
            let outputFaceBlendshapes = options.boolValue("outputFaceBlendshapes") ?? true
            let outputPoseSegmentationMask =
                options.boolValue("outputPoseSegmentationMask") ?? false
            let debug = options.boolValue("debug") ?? false

            let currentSession = self.nextSession(
                state: .starting,
                emitEveryNthFrame: emitEveryNthFrame,
                targetFps: targetFps
            )

            let runnerConfig = PoseLandmarkerRunner.Config(
                poseModelName: poseModelName,
                holisticModelName: "holistic_landmarker",
                trackingProfile: trackingProfile,
                minPoseConfidence: Float(minPoseConfidence),
                minTrackingConfidence: Float(minConfidence),
                minPresenceConfidence: Float(minConfidence),
                minFaceConfidence: Float(minFaceConfidence),
                minHandConfidence: Float(minHandConfidence),
                outputFaceBlendshapes: outputFaceBlendshapes,
                outputPoseSegmentationMasks: outputPoseSegmentationMask,
                numPoses: 1,
                usesCpu: true,
                debug: debug
            )

            self.sendStatus(
                "starting",
                extra: [
                    "requestedModel": requestedModel,
                    "model": poseModelName,
                    "requestedTrackingProfile": trackingProfile,
                    "targetFps": targetFps,
                    "emitEveryNthFrame": emitEveryNthFrame
                ]
            )

            PoseCameraSession.shared.start(
                fps: targetFps,
                onFrame: { [weak self] sampleBuffer in
                    guard let self else { return }
                    self.inferenceQueue.async {
                        guard self.shouldProcessFrame(session: currentSession) else {
                            return
                        }
                        self.runner.process(sampleBuffer)
                    }
                },
                onError: { [weak self] message in
                    guard let self else { return }
                    if self.isCurrentSession(currentSession) {
                        self.sendStatus("camera_error", extra: ["message": message])
                    }
                }
            ) { [weak self] cameraError in
                guard let self else { return }

                self.moduleQueue.async {
                    if let cameraError {
                        if self.isCurrentSession(currentSession) {
                            self.setEngineState(.error)
                        }
                        self.sendStatus(
                            "error_start_failed",
                            extra: ["message": cameraError.localizedDescription]
                        )
                        reject(
                            ErrorCode.start,
                            "Camera start failed: \(cameraError.localizedDescription)",
                            cameraError
                        )
                        return
                    }

                    do {
                        try self.runner.start(
                            config: runnerConfig,
                            onOutput: { [weak self] payload in
                                guard let self else { return }
                                self.moduleQueue.async {
                                    guard
                                        self.isCurrentSession(currentSession),
                                        self.currentEngineState() == .running,
                                        self.currentHasListeners()
                                    else {
                                        return
                                    }
                                    self.emit(Self.eventFrame, body: payload)
                                }
                            },
                            onError: { [weak self] message in
                                guard let self else { return }
                                self.moduleQueue.async {
                                    if self.isCurrentSession(currentSession) {
                                        self.sendStatus(
                                            "runner_error",
                                            extra: ["message": message]
                                        )
                                    }
                                }
                            }
                        )
                    } catch {
                        self.runner.stop()
                        if self.previewActive {
                            PoseCameraSession.shared.setCallbacks(onFrame: nil, onError: nil)
                        } else {
                            PoseCameraSession.shared.stop {}
                        }

                        if self.isCurrentSession(currentSession) {
                            self.setEngineState(.error)
                        }
                        self.sendStatus(
                            "error_runner_start",
                            extra: ["message": error.localizedDescription]
                        )
                        reject(
                            ErrorCode.start,
                            "Runner start failed: \(error.localizedDescription)",
                            error
                        )
                        return
                    }

                    if self.isCurrentSession(currentSession) {
                        self.setEngineState(.running)
                    }

                    self.sendStatus(
                        "running",
                        extra: [
                            "model": poseModelName,
                            "requestedModel": requestedModel,
                            "requestedTrackingProfile": trackingProfile,
                            "targetFps": targetFps,
                            "emitEveryNthFrame": emitEveryNthFrame
                        ]
                    )
                    resolve(nil)
                }
            }
        }
    }

    @objc
    func stop(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        moduleQueue.async {
            let currentState = self.currentEngineState()
            if currentState == .idle || currentState == .stopping {
                resolve(nil)
                return
            }

            let currentSession = self.nextSession(state: .stopping)
            self.sendStatus("stopping")

            self.runner.stop()

            let finishStop = {
                self.moduleQueue.async {
                    if self.isCurrentSession(currentSession) {
                        self.setEngineState(.idle)
                    }
                    self.sendStatus("idle")
                    resolve(nil)
                }
            }

            if self.previewActive {
                PoseCameraSession.shared.setCallbacks(
                    onFrame: nil,
                    onError: nil,
                    completion: finishStop
                )
            } else {
                PoseCameraSession.shared.stop(completion: finishStop)
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
        runner.stop()
        PoseCameraSession.shared.stop {}
        super.invalidate()
    }

    private func nextSession(
        state: EngineState,
        emitEveryNthFrame: Int? = nil,
        targetFps: Int? = nil
    ) -> Int {
        stateLock.lock()
        engineState = state
        sessionId += 1
        inputFrameCounter = 0
        if let emitEveryNthFrame {
            lastEmitEveryNthFrame = emitEveryNthFrame
        }
        if let targetFps {
            lastTargetFps = targetFps
        }
        let current = sessionId
        stateLock.unlock()
        return current
    }

    private func shouldProcessFrame(session: Int) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }

        guard sessionId == session, engineState == .running else {
            return false
        }

        inputFrameCounter += 1
        return inputFrameCounter % lastEmitEveryNthFrame == 0
    }

    private func isCurrentSession(_ session: Int) -> Bool {
        stateLock.lock()
        let current = sessionId == session
        stateLock.unlock()
        return current
    }

    private func setEngineState(_ state: EngineState) {
        stateLock.lock()
        engineState = state
        stateLock.unlock()
    }

    private func currentEngineState() -> EngineState {
        stateLock.lock()
        let state = engineState
        stateLock.unlock()
        return state
    }

    private func currentHasListeners() -> Bool {
        stateLock.lock()
        let value = hasListeners
        stateLock.unlock()
        return value
    }

    private func hasCameraPermission() -> Bool {
        AVCaptureDevice.authorizationStatus(for: .video) == .authorized
    }

    private func resolvePoseModelName(requestedModel: String) -> String {
        let preferred =
            requestedModel == "lite" ? "pose_landmarker_lite" : "pose_landmarker_full"
        if PoseLandmarkerRunner.bundledModelExists(preferred) {
            return preferred
        }

        let fallback =
            requestedModel == "lite" ? "pose_landmarker_full" : "pose_landmarker_lite"
        if PoseLandmarkerRunner.bundledModelExists(fallback) {
            return fallback
        }

        return preferred
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

        emit(Self.eventStatus, body: payload)
    }

    private func emit(_ name: String, body: Any) {
        DispatchQueue.main.async { [weak self] in
            self?.sendEvent(withName: name, body: body)
        }
    }

    private func inZeroToOne(_ value: Double) -> Bool {
        (0.0...1.0).contains(value)
    }
}

private extension NSDictionary {
    func stringValue(_ key: String) -> String? {
        guard let value = self[key], !(value is NSNull) else { return nil }
        return value as? String
    }

    func boolValue(_ key: String) -> Bool? {
        guard let value = self[key], !(value is NSNull) else { return nil }
        if let value = value as? Bool {
            return value
        }
        return (value as? NSNumber)?.boolValue
    }

    func doubleValue(_ key: String) -> Double? {
        guard let value = self[key], !(value is NSNull) else { return nil }
        return (value as? NSNumber)?.doubleValue
    }

    func intValue(_ key: String) -> Int? {
        guard let value = self[key], !(value is NSNull) else { return nil }
        return (value as? NSNumber)?.intValue
    }
}
