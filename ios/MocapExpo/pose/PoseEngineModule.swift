import AVFoundation
import Foundation
import React
import Vision

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
    private static let eventFrame = "PoseEngineFrame"

    private let moduleQueue = DispatchQueue(label: "com.mocapexpo.camera.module")
    private let stateLock = NSLock()

    private var engineState = EngineState.idle
    private var hasListeners = false
    private var previewActive = false
    private var lastTargetFps = 30
    private var poseFrameId = 0
    private var lastPoseFrameSentAtMs = 0.0
    private let poseFrameIntervalMs = 1000.0 / 15.0

    override static func requiresMainQueueSetup() -> Bool {
        false
    }

    override func supportedEvents() -> [String]! {
        [Self.eventStatus, Self.eventFrame]
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
                onFrame: self.poseFrameHandler(),
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
                onFrame: self.poseFrameHandler(),
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

    private func poseFrameHandler() -> (CMSampleBuffer) -> Void {
        { [weak self] sampleBuffer in
            self?.handlePoseFrame(sampleBuffer)
        }
    }

    private func handlePoseFrame(_ sampleBuffer: CMSampleBuffer) {
        let nowMs = Date().timeIntervalSince1970 * 1000.0

        stateLock.lock()
        let shouldAnalyze = hasListeners && nowMs - lastPoseFrameSentAtMs >= poseFrameIntervalMs
        if shouldAnalyze {
            lastPoseFrameSentAtMs = nowMs
        }
        stateLock.unlock()

        guard shouldAnalyze else { return }

        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let pixelWidth = CVPixelBufferGetWidth(imageBuffer)
        let pixelHeight = CVPixelBufferGetHeight(imageBuffer)
        let imageOrientation = visionOrientation(
            pixelWidth: pixelWidth,
            pixelHeight: pixelHeight
        )
        let normalizedSize = normalizedImageSize(
            pixelWidth: pixelWidth,
            pixelHeight: pixelHeight,
            orientation: imageOrientation
        )

        let request = VNDetectHumanBodyPoseRequest()
        let handler = VNImageRequestHandler(
            cmSampleBuffer: sampleBuffer,
            orientation: imageOrientation,
            options: [:]
        )

        do {
            try handler.perform([request])
            guard let observation = request.results?.first else { return }
            let points = try observation.recognizedPoints(.all)
            let landmarks = mediapipeLandmarks(from: points)
            guard landmarks.contains(where: { $0 > 0 }) else { return }

            stateLock.lock()
            poseFrameId += 1
            let frameId = poseFrameId
            stateLock.unlock()

            let payload: [String: Any] = [
                "ts": nowMs,
                "frameId": frameId,
                "fps": 15,
                "trackingProfile": "pose",
                "requestedTrackingProfile": "pose",
                "sourceDevice": "ios",
                "coordinateSpace": "image_normalized",
                "imageWidth": normalizedSize.width,
                "imageHeight": normalizedSize.height,
                "inputImageWidth": pixelWidth,
                "inputImageHeight": pixelHeight,
                "videoOrientation": "portrait",
                "cameraPosition": "back",
                "isMirrored": false,
                "orientationCorrection": String(describing: imageOrientation),
                "landmarks": landmarks
            ]

            DispatchQueue.main.async { [weak self] in
                self?.sendEvent(withName: Self.eventFrame, body: payload)
            }
        } catch {
            sendStatus("pose_frame_error", extra: ["message": error.localizedDescription])
        }
    }

    private func visionOrientation(
        pixelWidth: Int,
        pixelHeight: Int
    ) -> CGImagePropertyOrientation {
        if pixelHeight >= pixelWidth {
            return .up
        }
        return .right
    }

    private func normalizedImageSize(
        pixelWidth: Int,
        pixelHeight: Int,
        orientation: CGImagePropertyOrientation
    ) -> (width: Int, height: Int) {
        switch orientation {
        case .left, .leftMirrored, .right, .rightMirrored:
            return (width: pixelHeight, height: pixelWidth)
        default:
            return (width: pixelWidth, height: pixelHeight)
        }
    }

    private func mediapipeLandmarks(
        from points: [VNHumanBodyPoseObservation.JointName: VNRecognizedPoint]
    ) -> [Double] {
        var landmarks = Array(repeating: 0.0, count: 33 * 4)

        func write(_ index: Int, _ joint: VNHumanBodyPoseObservation.JointName) {
            guard let point = points[joint], point.confidence > 0.05 else { return }
            let offset = index * 4
            landmarks[offset] = Double(point.location.x)
            landmarks[offset + 1] = Double(1.0 - point.location.y)
            landmarks[offset + 2] = 0.0
            landmarks[offset + 3] = Double(point.confidence)
        }

        write(0, .nose)
        write(2, .leftEye)
        write(5, .rightEye)
        write(7, .leftEar)
        write(8, .rightEar)
        write(11, .leftShoulder)
        write(12, .rightShoulder)
        write(13, .leftElbow)
        write(14, .rightElbow)
        write(15, .leftWrist)
        write(16, .rightWrist)
        write(23, .leftHip)
        write(24, .rightHip)
        write(25, .leftKnee)
        write(26, .rightKnee)
        write(27, .leftAnkle)
        write(28, .rightAnkle)

        return landmarks
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
