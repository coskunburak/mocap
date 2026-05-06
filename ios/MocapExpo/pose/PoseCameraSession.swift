import AVFoundation
import UIKit

final class PoseCameraSession: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    static let shared = PoseCameraSession()

    private let sessionQueue = DispatchQueue(label: "com.mocapexpo.pose.camera.session")

    private var captureSession: AVCaptureSession?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private weak var previewView: UIView?
    private var activeDevice: AVCaptureDevice?

    private var onFrame: ((CMSampleBuffer) -> Void)?
    private var onError: ((String) -> Void)?
    private var isRunning = false
    private var currentFps = 30

    func start(
        fps: Int,
        onFrame: ((CMSampleBuffer) -> Void)?,
        onError: ((String) -> Void)?,
        completion: @escaping (Error?) -> Void
    ) {
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            completion(cameraError(code: 10, message: "Camera permission denied"))
            return
        }

        sessionQueue.async {
            self.onFrame = onFrame
            self.onError = onError

            do {
                let targetFps = max(1, fps)
                if self.isRunning {
                    try self.applyFrameRate(targetFps)
                    self.currentFps = targetFps
                    DispatchQueue.main.async {
                        self.installPreviewLayerIfPossible()
                        completion(nil)
                    }
                    return
                }

                try self.setupSession(fps: targetFps)
                self.captureSession?.startRunning()
                self.isRunning = true
                self.currentFps = targetFps

                DispatchQueue.main.async {
                    self.installPreviewLayerIfPossible()
                    completion(nil)
                }
            } catch {
                DispatchQueue.main.async {
                    completion(error)
                }
            }
        }
    }

    func stop(completion: @escaping () -> Void) {
        sessionQueue.async {
            if self.isRunning {
                self.captureSession?.stopRunning()
            }

            self.captureSession = nil
            self.videoOutput = nil
            self.activeDevice = nil
            self.onFrame = nil
            self.onError = nil
            self.isRunning = false

            DispatchQueue.main.async {
                self.previewLayer?.removeFromSuperlayer()
                self.previewLayer = nil
                completion()
            }
        }
    }

    func setCallbacks(
        onFrame: ((CMSampleBuffer) -> Void)?,
        onError: ((String) -> Void)?,
        completion: (() -> Void)? = nil
    ) {
        sessionQueue.async {
            self.onFrame = onFrame
            self.onError = onError
            DispatchQueue.main.async {
                completion?()
            }
        }
    }

    func attachPreview(to view: UIView) {
        DispatchQueue.main.async {
            self.previewView = view
            self.installPreviewLayerIfPossible()
        }
    }

    func detachPreview(from view: UIView) {
        DispatchQueue.main.async {
            guard self.previewView === view else { return }
            self.previewLayer?.removeFromSuperlayer()
            self.previewLayer = nil
            self.previewView = nil
        }
    }

    func updatePreviewBounds(_ bounds: CGRect) {
        DispatchQueue.main.async {
            self.previewLayer?.frame = bounds
        }
    }

    private func setupSession(fps: Int) throws {
        let session = AVCaptureSession()
        session.beginConfiguration()
        session.sessionPreset = .high

        guard let device = AVCaptureDevice.default(
            .builtInWideAngleCamera,
            for: .video,
            position: .back
        ) else {
            throw cameraError(code: 1, message: "No back camera available")
        }

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw cameraError(code: 2, message: "Cannot add camera input")
        }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)
        ]
        output.setSampleBufferDelegate(self, queue: sessionQueue)

        guard session.canAddOutput(output) else {
            throw cameraError(code: 3, message: "Cannot add camera output")
        }
        session.addOutput(output)

        if let connection = output.connection(with: .video),
           connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
        }

        self.captureSession = session
        self.videoOutput = output
        self.activeDevice = device
        try applyFrameRate(fps)

        session.commitConfiguration()
    }

    private func applyFrameRate(_ requestedFps: Int) throws {
        guard let device = activeDevice else { return }

        let ranges = device.activeFormat.videoSupportedFrameRateRanges
        guard let range = ranges.first(where: {
            $0.minFrameRate <= Double(requestedFps) && Double(requestedFps) <= $0.maxFrameRate
        }) ?? ranges.max(by: { $0.maxFrameRate < $1.maxFrameRate }) else {
            return
        }

        let selectedFps = min(max(Double(requestedFps), range.minFrameRate), range.maxFrameRate)
        let frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, Int(round(selectedFps)))))

        try device.lockForConfiguration()
        device.activeVideoMinFrameDuration = frameDuration
        device.activeVideoMaxFrameDuration = frameDuration
        device.unlockForConfiguration()
    }

    private func installPreviewLayerIfPossible() {
        guard let view = previewView, let session = captureSession else { return }

        let layer: AVCaptureVideoPreviewLayer
        if let existingLayer = previewLayer {
            layer = existingLayer
            layer.session = session
        } else {
            layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspectFill
            previewLayer = layer
        }

        layer.frame = view.bounds
        if layer.superlayer !== view.layer {
            layer.removeFromSuperlayer()
            view.layer.insertSublayer(layer, at: 0)
        }
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        onFrame?(sampleBuffer)
    }

    private func cameraError(code: Int, message: String) -> NSError {
        NSError(
            domain: "PoseCameraSession",
            code: code,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}
