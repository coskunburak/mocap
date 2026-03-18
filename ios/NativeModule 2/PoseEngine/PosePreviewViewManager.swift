import Foundation
import UIKit
import React

@objc(PosePreviewViewManager)
final class PosePreviewViewManager: RCTViewManager {

  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func view() -> UIView! {
    PosePreviewView()
  }
}
