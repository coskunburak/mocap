import AVFoundation
import Foundation
import UIKit

final class VideoRecorder {
    enum State: String {
        case idle
        case preparing
        case recording
        case stopping
        case failed
    }

    struct Options {
        let takeId: String
        let fps: Int
        let orientation: String
    }

    struct Result {
        let takeId: String
        let url: URL
        let startedAt: Date
        let endedAt: Date
        let durationMs: Double
        let fps: Double
        let width: Int
        let height: Int
        let recordingStartWallClockMs: Double
        let recordingStartMonotonicMs: Double?
        let firstFrameTimestampMs: Double?
        let framePresentationTimestampsMs: [Double]
        let frameCount: Int
        let hasAudioTrack: Bool
        let fileSizeBytes: Int64
        let codec: String
        let container: String

        func asDictionary() -> [String: Any] {
            var dictionary: [String: Any] = [
                "takeId": takeId,
                "localUri": url.absoluteString,
                "startedAt": Self.iso8601.string(from: startedAt),
                "endedAt": Self.iso8601.string(from: endedAt),
                "durationMs": durationMs,
                "fps": fps,
                "width": width,
                "height": height,
                "recordingStartWallClockMs": recordingStartWallClockMs,
                "framePresentationTimestampsMs": framePresentationTimestampsMs,
                "frameCount": frameCount,
                "hasAudioTrack": hasAudioTrack,
                "fileSizeBytes": fileSizeBytes,
                "codec": codec,
                "container": container,
                "platform": "ios"
            ]
            if let recordingStartMonotonicMs {
                dictionary["recordingStartMonotonicMs"] = recordingStartMonotonicMs
            }
            if let firstFrameTimestampMs {
                dictionary["firstFrameTimestampMs"] = firstFrameTimestampMs
            }
            return dictionary
        }

        private static let iso8601: ISO8601DateFormatter = {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return formatter
        }()
    }

    private(set) var state = State.idle

    private var options: Options?
    private var outputURL: URL?
    private var writer: AVAssetWriter?
    private var writerInput: AVAssetWriterInput?
    private var firstSampleTime: CMTime?
    private var lastSampleTime: CMTime?
    private var startedAt: Date?
    private var recordingStartMonotonicMs: Double?
    private var framePresentationTimestampsMs: [Double] = []
    private var frameCount = 0
    private var width = 0
    private var height = 0

    func start(options: Options) throws {
        guard state == .idle || state == .failed else {
            throw recorderError(code: 20, message: "Video recorder is already active.")
        }

        let directory = try videosDirectory()
        let url = directory
            .appendingPathComponent(Self.sanitizedFileName(options.takeId))
            .appendingPathExtension("mov")

        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }

        self.options = options
        self.outputURL = url
        self.writer = nil
        self.writerInput = nil
        self.firstSampleTime = nil
        self.lastSampleTime = nil
        self.startedAt = Date()
        self.recordingStartMonotonicMs = ProcessInfo.processInfo.systemUptime * 1000.0
        self.framePresentationTimestampsMs = []
        self.frameCount = 0
        self.width = 0
        self.height = 0
        self.state = .preparing
    }

    func append(_ sampleBuffer: CMSampleBuffer) {
        guard state == .preparing || state == .recording else { return }
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }

        do {
            if writer == nil {
                try configureWriter(sampleBuffer)
            }

            guard let writer, let writerInput else { return }
            if writer.status == .failed {
                state = .failed
                return
            }
            guard writerInput.isReadyForMoreMediaData else { return }

            if writerInput.append(sampleBuffer) {
                let sampleTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
                frameCount += 1
                lastSampleTime = sampleTime
                framePresentationTimestampsMs.append(
                    presentationTimestampMs(sampleTime)
                )
                state = .recording
            } else if writer.status == .failed {
                state = .failed
            }
        } catch {
            state = .failed
        }
    }

    func stop(completion: @escaping (Result?, Error?) -> Void) {
        guard state == .preparing || state == .recording else {
            completion(nil, recorderError(code: 21, message: "Video recorder is not recording."))
            return
        }
        guard let writer, let writerInput, let outputURL, let options else {
            reset()
            completion(nil, recorderError(code: 22, message: "No video frames were recorded."))
            return
        }

        state = .stopping
        writerInput.markAsFinished()
        writer.finishWriting { [weak self] in
            guard let self else { return }

            let endedAt = Date()
            defer {
                self.reset()
            }

            if writer.status != .completed {
                completion(
                    nil,
                    writer.error ?? self.recorderError(code: 23, message: "Video writer failed.")
                )
                return
            }

            let fileSize = self.fileSize(url: outputURL)
            guard fileSize > 0 else {
                completion(nil, self.recorderError(code: 24, message: "Recorded video is empty."))
                return
            }

            let durationMs = self.durationMs(startedAt: self.startedAt, endedAt: endedAt)
            let measuredFps =
                durationMs > 0 && self.frameCount > 0
                ? Double(self.frameCount) / (durationMs / 1000.0)
                : Double(options.fps)

            completion(
                Result(
                    takeId: options.takeId,
                    url: outputURL,
                    startedAt: self.startedAt ?? endedAt,
                    endedAt: endedAt,
                    durationMs: durationMs,
                    fps: measuredFps,
                    width: self.width,
                    height: self.height,
                    recordingStartWallClockMs:
                        (self.startedAt ?? endedAt).timeIntervalSince1970 * 1000.0,
                    recordingStartMonotonicMs: self.recordingStartMonotonicMs,
                    firstFrameTimestampMs:
                        self.framePresentationTimestampsMs.first,
                    framePresentationTimestampsMs:
                        self.framePresentationTimestampsMs,
                    frameCount: self.frameCount,
                    hasAudioTrack: false,
                    fileSizeBytes: fileSize,
                    codec: "h264",
                    container: "mov"
                ),
                nil
            )
        }
    }

    func cancel() {
        writerInput?.markAsFinished()
        writer?.cancelWriting()
        if let outputURL, FileManager.default.fileExists(atPath: outputURL.path) {
            try? FileManager.default.removeItem(at: outputURL)
        }
        reset()
    }

    private func configureWriter(_ sampleBuffer: CMSampleBuffer) throws {
        guard let outputURL, let options else {
            throw recorderError(code: 25, message: "Video recorder options are missing.")
        }
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            throw recorderError(code: 26, message: "Sample buffer has no image buffer.")
        }

        let pixelWidth = CVPixelBufferGetWidth(imageBuffer)
        let pixelHeight = CVPixelBufferGetHeight(imageBuffer)
        width = pixelWidth
        height = pixelHeight

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
        let bitRate = max(6_000_000, min(24_000_000, pixelWidth * pixelHeight * 6))
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: pixelWidth,
            AVVideoHeightKey: pixelHeight,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: bitRate,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ]

        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        input.transform = transform(for: options.orientation)

        guard writer.canAdd(input) else {
            throw recorderError(code: 27, message: "Cannot add video writer input.")
        }

        writer.add(input)
        guard writer.startWriting() else {
            throw writer.error ?? recorderError(code: 28, message: "Video writer did not start.")
        }

        let firstTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        writer.startSession(atSourceTime: firstTime)
        firstSampleTime = firstTime

        self.writer = writer
        self.writerInput = input
    }

    private func transform(for orientation: String) -> CGAffineTransform {
        switch orientation {
        case "portrait":
            return CGAffineTransform(rotationAngle: .pi / 2)
        case "portrait_upside_down":
            return CGAffineTransform(rotationAngle: -.pi / 2)
        case "landscape_right":
            return CGAffineTransform(rotationAngle: .pi)
        default:
            return .identity
        }
    }

    private func durationMs(startedAt: Date?, endedAt: Date) -> Double {
        if
            let firstSampleTime,
            let lastSampleTime
        {
            let seconds = CMTimeGetSeconds(CMTimeSubtract(lastSampleTime, firstSampleTime))
            if seconds.isFinite && seconds > 0 {
                return seconds * 1000.0
            }
        }

        guard let startedAt else { return 0 }
        return max(0, endedAt.timeIntervalSince(startedAt) * 1000.0)
    }

    private func presentationTimestampMs(_ sampleTime: CMTime) -> Double {
        guard let firstSampleTime else { return 0 }
        let seconds = CMTimeGetSeconds(CMTimeSubtract(sampleTime, firstSampleTime))
        return seconds.isFinite ? max(0, seconds * 1000.0) : 0
    }

    private func videosDirectory() throws -> URL {
        let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("mocap", isDirectory: true)
            .appendingPathComponent("videos", isDirectory: true)
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )
        return root
    }

    private func fileSize(url: URL) -> Int64 {
        guard
            let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
            let size = attributes[.size] as? NSNumber
        else {
            return 0
        }
        return size.int64Value
    }

    private func reset() {
        state = .idle
        options = nil
        outputURL = nil
        writer = nil
        writerInput = nil
        firstSampleTime = nil
        lastSampleTime = nil
        startedAt = nil
        recordingStartMonotonicMs = nil
        framePresentationTimestampsMs = []
        frameCount = 0
        width = 0
        height = 0
    }

    private static func sanitizedFileName(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let scalars = value.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" }
        return String(scalars)
    }

    private func recorderError(code: Int, message: String) -> NSError {
        NSError(
            domain: "VideoRecorder",
            code: code,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}
