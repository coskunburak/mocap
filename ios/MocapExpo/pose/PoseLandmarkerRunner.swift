import AVFoundation
import Foundation
import MediaPipeTasksVision
import UIKit

final class PoseLandmarkerRunner: NSObject,
    PoseLandmarkerLiveStreamDelegate,
    HolisticLandmarkerLiveStreamDelegate {

    enum TrackingProfile: String {
        case pose
        case holistic
    }

    enum TrackingProfileRequest: String {
        case auto
        case pose
        case holistic
    }

    struct Config {
        let poseModelName: String
        let holisticModelName: String
        let trackingProfile: String
        let minPoseConfidence: Float
        let minTrackingConfidence: Float
        let minPresenceConfidence: Float
        let minFaceConfidence: Float
        let minHandConfidence: Float
        let outputFaceBlendshapes: Bool
        let outputPoseSegmentationMasks: Bool
        let numPoses: Int
        let usesCpu: Bool
        let debug: Bool
    }

    private let lock = NSLock()

    private var poseLandmarker: PoseLandmarker?
    private var holisticLandmarker: HolisticLandmarker?
    private var pendingImage: MPImage?
    private var onOutput: (([String: Any]) -> Void)?
    private var onError: ((String) -> Void)?

    private var isRunning = false
    private var inFlight = false
    private var activeProfile = TrackingProfile.pose
    private var requestedProfile = TrackingProfileRequest.auto
    private var lastTimestampMs = 0

    static func bundledModelExists(_ name: String, ext: String = "task") -> Bool {
        Bundle.main.path(forResource: name, ofType: ext) != nil
    }

    func start(
        config: Config,
        onOutput: @escaping ([String: Any]) -> Void,
        onError: @escaping (String) -> Void
    ) throws {
        lock.lock()
        stopLocked()

        self.onOutput = onOutput
        self.onError = onError
        self.requestedProfile = TrackingProfileRequest(rawValue: config.trackingProfile) ?? .auto
        self.activeProfile = try resolveProfile(config: config)
        self.lastTimestampMs = 0

        do {
            switch activeProfile {
            case .pose:
                poseLandmarker = try makePoseLandmarker(config: config)
                holisticLandmarker = nil
            case .holistic:
                holisticLandmarker = try makeHolisticLandmarker(config: config)
                poseLandmarker = nil
            }
            isRunning = true
            lock.unlock()
        } catch {
            stopLocked()
            lock.unlock()
            throw error
        }
    }

    func stop() {
        lock.lock()
        stopLocked()
        lock.unlock()
    }

    func process(_ sampleBuffer: CMSampleBuffer) {
        guard let image = try? MPImage(sampleBuffer: sampleBuffer, orientation: .up) else {
            emitError("Failed to create MediaPipe image from camera frame.")
            return
        }

        let rawTimestamp = timestampMs(from: sampleBuffer)

        lock.lock()
        guard isRunning, !inFlight else {
            lock.unlock()
            return
        }

        let timestamp = max(rawTimestamp, lastTimestampMs + 1)
        lastTimestampMs = timestamp
        inFlight = true
        pendingImage = image

        let profile = activeProfile
        let poseTask = poseLandmarker
        let holisticTask = holisticLandmarker
        let errorHandler = onError
        lock.unlock()

        do {
            switch profile {
            case .pose:
                guard let task = poseTask else {
                    throw runnerError("Pose landmarker is not initialized.")
                }
                try task.detectAsync(
                    image: image,
                    timestampInMilliseconds: timestamp
                )
            case .holistic:
                guard let task = holisticTask else {
                    throw runnerError("Holistic landmarker is not initialized.")
                }
                try task.detectAsync(
                    image: image,
                    timestampInMilliseconds: timestamp
                )
            }
        } catch {
            releasePendingImage()
            errorHandler?("detectAsync failed: \(error.localizedDescription)")
        }
    }

    func poseLandmarker(
        _ poseLandmarker: PoseLandmarker,
        didFinishDetection result: PoseLandmarkerResult?,
        timestampInMilliseconds: Int,
        error: Error?
    ) {
        releasePendingImage()

        if let error {
            emitError("PoseLandmarker error: \(error.localizedDescription)")
            return
        }

        guard let result else { return }

        let callback: (([String: Any]) -> Void)?
        let requestedProfileValue: String
        lock.lock()
        if !isRunning {
            lock.unlock()
            return
        }
        callback = onOutput
        requestedProfileValue = requestedProfile.rawValue
        lock.unlock()

        var payload: [String: Any] = [
            "timestampMs": timestampInMilliseconds,
            "trackingProfile": TrackingProfile.pose.rawValue,
            "requestedTrackingProfile": requestedProfileValue,
            "landmarks": formatNormalizedLandmarks(result.landmarks.first ?? []),
            "worldLandmarks": formatWorldLandmarks(result.worldLandmarks.first ?? []),
            "hasPoseSegmentationMask": !result.segmentationMasks.isEmpty
        ]

        if payload["worldLandmarks"] == nil {
            payload["worldLandmarks"] = []
        }

        callback?(payload)
    }

    func holisticLandmarker(
        _ holisticLandmarker: HolisticLandmarker,
        didFinishDetection result: HolisticLandmarkerResult?,
        timestampInMilliseconds: Int,
        error: Error?
    ) {
        releasePendingImage()

        if let error {
            emitError("HolisticLandmarker error: \(error.localizedDescription)")
            return
        }

        guard let result else { return }

        let callback: (([String: Any]) -> Void)?
        let requestedProfileValue: String
        lock.lock()
        if !isRunning {
            lock.unlock()
            return
        }
        callback = onOutput
        requestedProfileValue = requestedProfile.rawValue
        lock.unlock()

        var payload: [String: Any] = [
            "timestampMs": timestampInMilliseconds,
            "trackingProfile": TrackingProfile.holistic.rawValue,
            "requestedTrackingProfile": requestedProfileValue,
            "landmarks": formatNormalizedLandmarks(result.poseLandmarks),
            "worldLandmarks": formatWorldLandmarks(result.poseWorldLandmarks),
            "hasPoseSegmentationMask": result.poseSegmentationMask != nil
        ]

        if !result.faceLandmarks.isEmpty {
            payload["faceLandmarks"] = formatNormalizedLandmarks(result.faceLandmarks)
        }
        if !result.leftHandLandmarks.isEmpty {
            payload["leftHandLandmarks"] = formatNormalizedLandmarks(result.leftHandLandmarks)
        }
        if !result.leftHandWorldLandmarks.isEmpty {
            payload["leftHandWorldLandmarks"] = formatWorldLandmarks(result.leftHandWorldLandmarks)
        }
        if !result.rightHandLandmarks.isEmpty {
            payload["rightHandLandmarks"] = formatNormalizedLandmarks(result.rightHandLandmarks)
        }
        if !result.rightHandWorldLandmarks.isEmpty {
            payload["rightHandWorldLandmarks"] = formatWorldLandmarks(result.rightHandWorldLandmarks)
        }
        if let blendshapes = result.faceBlendshapes, !blendshapes.categories.isEmpty {
            payload["faceBlendshapes"] = formatBlendshapes(blendshapes.categories)
        }

        callback?(payload)
    }

    private func stopLocked() {
        pendingImage = nil
        poseLandmarker = nil
        holisticLandmarker = nil
        onOutput = nil
        onError = nil
        isRunning = false
        inFlight = false
        activeProfile = .pose
        requestedProfile = .auto
        lastTimestampMs = 0
    }

    private func resolveProfile(config: Config) throws -> TrackingProfile {
        let requested = TrackingProfileRequest(rawValue: config.trackingProfile) ?? .auto

        switch requested {
        case .pose:
            try ensureModelExists(config.poseModelName)
            return .pose
        case .holistic:
            try ensureModelExists(config.holisticModelName)
            return .holistic
        case .auto:
            if Self.bundledModelExists(config.holisticModelName) {
                return .holistic
            }
            try ensureModelExists(config.poseModelName)
            return .pose
        }
    }

    private func makePoseLandmarker(config: Config) throws -> PoseLandmarker {
        try ensureModelExists(config.poseModelName)
        guard let modelPath = Bundle.main.path(forResource: config.poseModelName, ofType: "task") else {
            throw runnerError("Model not found in bundle: \(config.poseModelName).task")
        }

        let options = PoseLandmarkerOptions()
        options.baseOptions.modelAssetPath = modelPath
        options.baseOptions.delegate = config.usesCpu ? .CPU : .GPU
        options.runningMode = .liveStream
        options.poseLandmarkerLiveStreamDelegate = self
        options.numPoses = max(1, config.numPoses)
        options.minPoseDetectionConfidence = clamp01(config.minPoseConfidence)
        options.minPosePresenceConfidence = clamp01(config.minPresenceConfidence)
        options.minTrackingConfidence = clamp01(config.minTrackingConfidence)
        options.shouldOutputSegmentationMasks = config.outputPoseSegmentationMasks

        return try PoseLandmarker(options: options)
    }

    private func makeHolisticLandmarker(config: Config) throws -> HolisticLandmarker {
        try ensureModelExists(config.holisticModelName)
        guard let modelPath = Bundle.main.path(forResource: config.holisticModelName, ofType: "task") else {
            throw runnerError("Model not found in bundle: \(config.holisticModelName).task")
        }

        let options = HolisticLandmarkerOptions()
        options.baseOptions.modelAssetPath = modelPath
        options.baseOptions.delegate = config.usesCpu ? .CPU : .GPU
        options.runningMode = .liveStream
        options.holisticLandmarkerLiveStreamDelegate = self
        options.minFaceDetectionConfidence = clamp01(config.minFaceConfidence)
        options.minFacePresenceConfidence = clamp01(config.minFaceConfidence)
        options.minPoseDetectionConfidence = clamp01(config.minPoseConfidence)
        options.minPosePresenceConfidence = clamp01(config.minPresenceConfidence)
        options.minHandLandmarksConfidence = clamp01(config.minHandConfidence)
        options.outputFaceBlendshapes = config.outputFaceBlendshapes
        options.outputPoseSegmentationMasks = config.outputPoseSegmentationMasks

        return try HolisticLandmarker(options: options)
    }

    private func ensureModelExists(_ name: String) throws {
        if !Self.bundledModelExists(name) {
            throw runnerError("Model not found in bundle: \(name).task")
        }
    }

    private func releasePendingImage() {
        lock.lock()
        pendingImage = nil
        inFlight = false
        lock.unlock()
    }

    private func emitError(_ message: String) {
        let errorHandler: ((String) -> Void)?
        lock.lock()
        errorHandler = isRunning ? onError : nil
        lock.unlock()
        errorHandler?(message)
    }

    private func timestampMs(from sampleBuffer: CMSampleBuffer) -> Int {
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if presentationTime.isValid && presentationTime.seconds.isFinite && presentationTime.seconds > 0 {
            return Int(presentationTime.seconds * 1000)
        }
        return Int(Date().timeIntervalSince1970 * 1000)
    }

    private func formatNormalizedLandmarks(_ landmarks: [NormalizedLandmark]) -> [[String: Any]] {
        landmarks.enumerated().map { index, landmark in
            [
                "id": index,
                "x": Double(landmark.x),
                "y": Double(landmark.y),
                "z": Double(landmark.z),
                "v": confidence(visibility: landmark.visibility, presence: landmark.presence)
            ]
        }
    }

    private func formatWorldLandmarks(_ landmarks: [Landmark]) -> [[String: Any]] {
        landmarks.enumerated().map { index, landmark in
            [
                "id": index,
                "x": Double(landmark.x),
                "y": Double(landmark.y),
                "z": Double(landmark.z),
                "v": confidence(visibility: landmark.visibility, presence: landmark.presence)
            ]
        }
    }

    private func formatBlendshapes(_ categories: [ResultCategory]) -> [[String: Any]] {
        categories.enumerated().map { fallbackIndex, category in
            var item: [String: Any] = [
                "index": category.index >= 0 ? category.index : fallbackIndex,
                "name": category.categoryName ?? "",
                "score": Double(category.score)
            ]

            if let displayName = category.displayName, !displayName.isEmpty {
                item["displayName"] = displayName
            }

            return item
        }
    }

    private func confidence(visibility: NSNumber?, presence: NSNumber?) -> Double {
        if let visibility {
            return visibility.doubleValue
        }
        if let presence {
            return presence.doubleValue
        }
        return 1.0
    }

    private func clamp01(_ value: Float) -> Float {
        min(1.0, max(0.0, value))
    }

    private func runnerError(_ message: String) -> NSError {
        NSError(
            domain: "PoseLandmarkerRunner",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}
