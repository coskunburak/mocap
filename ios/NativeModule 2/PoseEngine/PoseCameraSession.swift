import Foundation
import AVFoundation
import UIKit

public final class PoseCameraSession: NSObject {

  public struct Config {
    public let position: AVCaptureDevice.Position
    public let fps: Int
    public let preset: AVCaptureSession.Preset

    public init(
      position: AVCaptureDevice.Position = .back,
      fps: Int = 30,
      preset: AVCaptureSession.Preset = .high
    ) {
      self.position = position
      self.fps = max(1, fps)
      self.preset = preset
    }
  }

  public struct FrameInfo {
    public let sampleBuffer: CMSampleBuffer
    public let videoOrientation: AVCaptureVideoOrientation
    public let isMirrored: Bool
    public let cameraPosition: AVCaptureDevice.Position
  }

  public typealias FrameCallback = (_ frame: FrameInfo) -> Void
  public typealias ErrorCallback = (_ message: String) -> Void

  private let session = AVCaptureSession()
  private let captureQueue = DispatchQueue(label: "pose.camera.capture.queue", qos: .userInitiated)

  private var videoOutput: AVCaptureVideoDataOutput?
  private var deviceInput: AVCaptureDeviceInput?

  private var onFrame: FrameCallback?
  private var onError: ErrorCallback?

  private var isRunning = false
  private var config: Config?

  public override init() {
    super.init()
  }

  deinit {
    Task { await stop() }
  }

  // MARK: - Public

  public func start(
    config: Config,
    onFrame: @escaping FrameCallback,
    onError: @escaping ErrorCallback
  ) async throws {

    if isRunning { return }

    self.config = config
    self.onFrame = onFrame
    self.onError = onError

    try await withCheckedThrowingContinuation { cont in
      captureQueue.async { [weak self] in
        guard let self else { return }
        do {
          try self.configureSessionLocked(config: config)
          self.session.startRunning()
          self.isRunning = true
          cont.resume()
        } catch {
          self.cleanupLocked(full: true)
          cont.resume(throwing: error)
        }
      }
    }
  }

  public func stop() async {
    if !isRunning {
      captureQueue.async { [weak self] in
        self?.cleanupLocked(full: true)
      }
      return
    }

    await withCheckedContinuation { cont in
      captureQueue.async { [weak self] in
        guard let self else { cont.resume(); return }
        self.session.stopRunning()
        self.isRunning = false
        self.cleanupLocked(full: true)
        cont.resume()
      }
    }
  }

  // MARK: - Configuration (captureQueue)

  private func configureSessionLocked(config: Config) throws {
    session.beginConfiguration()
    defer { session.commitConfiguration() }

    session.sessionPreset = config.preset

    // Remove existing
    if let input = deviceInput {
      session.removeInput(input)
      deviceInput = nil
    }
    if let output = videoOutput {
      session.removeOutput(output)
      videoOutput = nil
    }

    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: config.position) else {
      throw NSError(domain: "PoseCameraSession", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Camera device not found for position \(config.position)"])
    }

    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else {
      throw NSError(domain: "PoseCameraSession", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "Cannot add camera input"])
    }
    session.addInput(input)
    deviceInput = input

    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: captureQueue)

    guard session.canAddOutput(output) else {
      throw NSError(domain: "PoseCameraSession", code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "Cannot add video output"])
    }
    session.addOutput(output)
    videoOutput = output

    // Connection orientation + mirror
    if let conn = output.connection(with: .video) {
      if conn.isVideoOrientationSupported {
        conn.videoOrientation = .portrait // app portrait locked
      }
      if conn.isVideoMirroringSupported {
        conn.automaticallyAdjustsVideoMirroring = false
        conn.isVideoMirrored = (device.position == .front)
      }
    }

    // FPS (supported-range aware)
    try configureFPSLocked(device: device, targetFps: config.fps)
  }

  private func configureFPSLocked(device: AVCaptureDevice, targetFps: Int) throws {
    // Seçilen fps'i destekleyen en yakın formatı bul
    let desired = Double(targetFps)

    var bestFormat: AVCaptureDevice.Format?
    var bestRange: AVFrameRateRange?
    var bestScore = Double.greatestFiniteMagnitude

    for format in device.formats {
      for range in format.videoSupportedFrameRateRanges {
        let minFps = range.minFrameRate
        let maxFps = range.maxFrameRate
        guard desired >= minFps && desired <= maxFps else { continue }

        // desired'a ne kadar yakın? (küçük score daha iyi)
        let score = abs(maxFps - desired) + abs(desired - minFps)
        if score < bestScore {
          bestScore = score
          bestFormat = format
          bestRange = range
        }
      }
    }

    try device.lockForConfiguration()
    defer { device.unlockForConfiguration() }

    if let bestFormat, let _ = bestRange {
      device.activeFormat = bestFormat
      let duration = CMTime(value: 1, timescale: CMTimeScale(targetFps))
      device.activeVideoMinFrameDuration = duration
      device.activeVideoMaxFrameDuration = duration
    } else {
      // target fps bulunamadıysa dokunma (default)
      // İstersen burada 30'a fallback yapabilirsin.
    }
  }

  private func cleanupLocked(full: Bool) {
    onFrame = nil
    onError = nil
    config = nil

    if full {
      if let input = deviceInput {
        session.removeInput(input)
        deviceInput = nil
      }
      if let output = videoOutput {
        session.removeOutput(output)
        videoOutput = nil
      }
    }
  }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

extension PoseCameraSession: AVCaptureVideoDataOutputSampleBufferDelegate {
  public func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard let input = deviceInput else { return }

    let info = FrameInfo(
      sampleBuffer: sampleBuffer,
      videoOrientation: connection.videoOrientation,
      isMirrored: connection.isVideoMirrored,
      cameraPosition: input.device.position
    )

    onFrame?(info)
  }
}
