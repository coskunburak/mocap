package com.anonymous.MocapExpo.pose

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

class PosePreviewViewManager : SimpleViewManager<PosePreviewView>() {
  override fun getName(): String = "PosePreviewView"

  override fun createViewInstance(reactContext: ThemedReactContext): PosePreviewView {
    return PosePreviewView(reactContext)
  }
}
