import UIKit
import AVFoundation

final class PosePreviewView: UIView {

  override class var layerClass: AnyClass {
    AVCaptureVideoPreviewLayer.self
  }

  private var previewLayer: AVCaptureVideoPreviewLayer {
    guard let layer = self.layer as? AVCaptureVideoPreviewLayer else {
      fatalError("PosePreviewView must use AVCaptureVideoPreviewLayer")
    }
    return layer
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    configure()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    configure()
  }

  private func configure() {
    clipsToBounds = true
    previewLayer.session = PoseCameraSession.shared.captureSession
    previewLayer.videoGravity = .resizeAspectFill
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }
}
