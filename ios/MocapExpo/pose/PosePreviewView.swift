import UIKit

final class PosePreviewView: UIView {

    override init(frame: CGRect) {
        super.init(frame: frame)
        setup()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setup()
    }

    private func setup() {
        backgroundColor = .black
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        PoseCameraSession.shared.updatePreviewBounds(bounds)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil {
            PoseCameraSession.shared.attachPreview(to: self)
        } else {
            PoseCameraSession.shared.detachPreview(from: self)
        }
    }
}
