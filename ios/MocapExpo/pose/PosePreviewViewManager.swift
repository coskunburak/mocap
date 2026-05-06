import UIKit
import React

@objc(PosePreviewViewManager)
final class PosePreviewViewManager: RCTViewManager {
    override func view() -> UIView! {
        PosePreviewView()
    }

    override static func requiresMainQueueSetup() -> Bool {
        true
    }
}
