package com.anonymous.MocapExpo.pose

import android.content.Context
import android.widget.FrameLayout
import androidx.camera.view.PreviewView

class PosePreviewView(
  context: Context,
) : FrameLayout(context) {

  private val previewView =
    PreviewView(context).apply {
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
      scaleType = PreviewView.ScaleType.FILL_CENTER
      layoutParams =
        LayoutParams(
          LayoutParams.MATCH_PARENT,
          LayoutParams.MATCH_PARENT,
        )
    }

  init {
    clipToOutline = true
    addView(previewView)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    PoseCameraSession.attachPreviewView(previewView)
  }

  override fun onDetachedFromWindow() {
    PoseCameraSession.attachPreviewView(null)
    super.onDetachedFromWindow()
  }
}
